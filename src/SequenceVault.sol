// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {Verified} from "./Verified.sol";
import {IBinaryMarketsModule, IBinaryPool, IBinaryMarket, IBinaryModuleRedeem, IOutcomeToken6909, IERC20} from "./IDreamDEX.sol";

// SequenceVault
// A capped strategy vault. Off-chain planner arms ONE step at a time; the vault
// is the trustless on-chain executor. Each real DreamDEX resolution advances the
// step's state machine and, if the branch matches, places the step's bounded order
// using the vault's OWN escrowed bankroll (verified architecture from the spike).
//
// On-chain guarantees (protect the bankroll even if the planner misbehaves):
//   - per-step notional cap and a vault-wide max-outstanding cap
//   - one execution per (marketId, questionId): no double-fire
//   - only the reactivity precompile can drive execution
//   - owner can pause, cancel a step, and recover funds
contract SequenceVault is SomniaEventHandler {
    // ---- errors ----
    error NotOwner();
    error UnexpectedEmitter(address got);
    error BadTopics();
    error WrongTopic0();
    error StepNotArmed();
    error StepExpired();
    error CapExceeded(uint256 requested, uint256 cap);
    error VaultCapExceeded(uint256 outstanding, uint256 cap);
    error Paused();
    error AlreadySubscribed(uint256 id);
    error NoSubscription();
    error BadState(Status have, Status need);
    error BadAction(uint8 action);
    error NotQueued(bytes32 stepId);
    error NoExposure(bytes32 marketId);
    error NotResolvedYet(bytes32 marketId);
    error UnknownMarket(bytes32 marketId);
    error NotSettled(bytes32 marketId);
    error NothingToRedeem(bytes32 marketId);
    error RedeemFailed(bytes32 marketId, uint8 outcomeIdx);

    // ---- per-outcome actions ----
    // What the vault does when an outcome wins. The two buy values are the
    // IBinaryPool `kind` codes themselves, so nothing is translated at the call
    // site; STOP is a sentinel outside the kind range (0-3) meaning "place
    // nothing". Each outcome carries its own action, so a trader can stop on
    // one side while still trading the other.
    uint8 internal constant ACT_BUY_YES = 0;
    uint8 internal constant ACT_BUY_NO = 2;
    uint8 internal constant ACT_STOP = 255;

    // Prices are a fraction of one collateral unit in 6dp, and quantities are
    // base units in 6dp, so what an order actually costs is price*quantity/1e6.
    // Multiplying them raw overstates the commitment by a million and makes
    // every cap meaningless.
    uint256 internal constant PRICE_SCALE = 1e6;

    function _cost(uint256 price, uint256 quantity) internal pure returns (uint256) {
        return (price * quantity) / PRICE_SCALE;
    }

    function _validAction(uint8 a) internal pure returns (bool) {
        return a == ACT_BUY_YES || a == ACT_BUY_NO || a == ACT_STOP;
    }

    // ---- state machine ----
    // PLACED, not EXECUTED: the pool accepted the order. A blockchain success
    // is not proof of a fill, and the vault cannot observe fills from inside the
    // reactive callback, so it never claims more than it knows. PENDING is a
    // step registered for the chain but deliberately not yet listening.
    enum Status { NONE, ARMED, WAITING, TRIGGERED, PLACED, SKIPPED, EXPIRED, CANCELLED, PENDING }

    struct Step {
        Status status;
        bytes32 triggerMarketId;   // resolution that drives this step
        address pool;              // successor BinaryPool to place on
        uint256 price;             // limit price (raw)
        uint256 quantity;          // bounded size (raw)
        uint64  expireNs;          // order expiry (0 < e <= market expiry)
        uint8   orderType;         // 0 Normal,1 FOK,2 IOC,3 PostOnly
        uint8   actionOnWin0;      // ACT_BUY_YES | ACT_BUY_NO | ACT_STOP
        uint8   actionOnWin1;      // ACT_BUY_YES | ACT_BUY_NO | ACT_STOP
        uint256 notionalCap;       // max price*qty this step may commit (raw)
        bytes32 successorMarketId; // market the order is placed INTO; its own
                                   // resolution releases this step's exposure
        bytes32 nextStepId;        // armed only after this step actually places
        uint128 orderId;           // set once PLACED
        uint8   winningOutcome;    // recorded on trigger
    }

    address public immutable owner;
    IBinaryMarketsModule public immutable module;
    IERC20 public immutable collateral;

    uint256 public subscriptionId;
    bool public paused;

    // vault-wide risk: total notional currently committed to open orders
    uint256 public outstandingNotional;
    uint256 public maxOutstandingNotional; // owner-set hard cap

    // steps keyed by an owner-chosen stepId (lets the planner address them)
    mapping(bytes32 => Step) public steps;
    // idempotency: keccak(marketId, questionId) => consumed
    mapping(bytes32 => bool) public consumed;
    // reverse index: which stepId is armed for a triggerMarketId
    mapping(bytes32 => bytes32) public stepForMarket;
    // exposure committed into a successor market, released when that market
    // itself resolves. Without this the vault-wide cap only ever ratchets up
    // and a rolling sequence eventually blocks itself.
    mapping(bytes32 => uint256) public outstandingByMarket;

    // ---- events (the execution timeline the frontend renders) ----
    event StepArmed(bytes32 indexed stepId, bytes32 indexed triggerMarketId, address pool);
    event StepWaiting(bytes32 indexed stepId, uint256 subscriptionId);
    event Triggered(bytes32 indexed stepId, bytes32 indexed marketId, uint256 questionId, bool voided, uint8 winningOutcome);
    event Placed(bytes32 indexed stepId, address indexed pool, uint8 kind, uint128 orderId, uint256 notional);
    event PlacementRejected(bytes32 indexed stepId, address indexed pool, uint8 kind);
    event StepQueued(bytes32 indexed stepId, bytes32 indexed triggerMarketId);
    event ChainAdvanced(bytes32 indexed fromStepId, bytes32 indexed toStepId);
    event ExposureReleased(bytes32 indexed marketId, uint256 amount);
    event ResolutionSynced(bytes32 indexed marketId, uint256 questionId, address indexed by);
    event Redeemed(bytes32 indexed marketId, uint8 outcomeIdx, uint256 tokens, uint256 collateral);
    event Skipped(bytes32 indexed stepId, bytes32 indexed marketId, string reason);
    event StepCancelled(bytes32 indexed stepId);
    event PausedSet(bool paused);
    event Subscribed(uint256 indexed subscriptionId);
    event Recovered(address indexed token, uint256 amount);

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    receive() external payable {}

    // owner_ is passed rather than taken from msg.sender so a factory can deploy
    // a vault that belongs to the caller, not to the factory.
    constructor(address owner_, address module_, address collateral_, uint256 maxOutstanding_) {
        owner = owner_ == address(0) ? msg.sender : owner_;
        module = IBinaryMarketsModule(module_);
        collateral = IERC20(collateral_);
        maxOutstandingNotional = maxOutstanding_;
    }

    // ---- owner controls ----
    function setPaused(bool p) external onlyOwner { paused = p; emit PausedSet(p); }
    function setMaxOutstanding(uint256 cap) external onlyOwner { maxOutstandingNotional = cap; }
    function approvePool(address pool, uint256 amount) external onlyOwner { collateral.approve(pool, amount); }

    function withdrawNative(uint256 amount) external onlyOwner {
        (bool ok,) = payable(owner).call{value: amount}("");
        require(ok, "native recover failed");
        emit Recovered(address(0), amount);
    }
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSignature("transfer(address,uint256)", owner, amount));
        require(ok && (ret.length == 0 || abi.decode(ret,(bool))), "token recover failed");
        emit Recovered(token, amount);
    }

    // ---- arm a step (off-chain planner) ----
    function armStep(bytes32 stepId, Step calldata s) external onlyOwner {
        // reject unknown branch actions before anything is stored
        if (!_validAction(s.actionOnWin0)) revert BadAction(s.actionOnWin0);
        if (!_validAction(s.actionOnWin1)) revert BadAction(s.actionOnWin1);

        // enforce per-step notional cap at arm time
        uint256 notional = _cost(s.price, s.quantity);
        if (notional > s.notionalCap) revert CapExceeded(notional, s.notionalCap);

        Step memory x = s;
        x.status = Status.ARMED;
        x.orderId = 0;
        x.winningOutcome = 0;
        steps[stepId] = x;
        stepForMarket[s.triggerMarketId] = stepId;
        emit StepArmed(stepId, s.triggerMarketId, s.pool);
    }

    // Register a later link in a chain WITHOUT listening for its market. It only
    // starts listening if the step before it actually places an order, which is
    // what makes a sequence conditional rather than a set of independent
    // triggers armed up front.
    function queueStep(bytes32 stepId, Step calldata s) external onlyOwner {
        if (!_validAction(s.actionOnWin0)) revert BadAction(s.actionOnWin0);
        if (!_validAction(s.actionOnWin1)) revert BadAction(s.actionOnWin1);
        uint256 notional = _cost(s.price, s.quantity);
        if (notional > s.notionalCap) revert CapExceeded(notional, s.notionalCap);

        Step memory x = s;
        x.status = Status.PENDING;
        x.orderId = 0;
        x.winningOutcome = 0;
        steps[stepId] = x;
        // deliberately NOT written into stepForMarket
        emit StepQueued(stepId, s.triggerMarketId);
    }

    // Release exposure by hand if a successor market never delivers a
    // resolution. Owner-only, and it can only release what was committed.
    function releaseExposure(bytes32 marketId) external onlyOwner {
        uint256 amount = outstandingByMarket[marketId];
        if (amount == 0) revert NoExposure(marketId);
        outstandingByMarket[marketId] = 0;
        outstandingNotional -= amount;
        emit ExposureReleased(marketId, amount);
    }

    function cancelStep(bytes32 stepId) external onlyOwner {
        Step storage st = steps[stepId];
        if (st.status == Status.NONE) revert BadState(st.status, Status.ARMED);
        st.status = Status.CANCELLED;
        delete stepForMarket[st.triggerMarketId];
        emit StepCancelled(stepId);
    }

    // ---- subscription (the vault owns its own; needs >=32 SOM held here) ----
    //
    // The library default sets priorityFeePerGas to 0, which leaves a validator
    // no reason to include the callback. Subscribing with an explicit priority
    // fee is the first thing to change when deliveries do not arrive, so the fee
    // is a parameter rather than a constant.
    function subscribeAllMarkets() external onlyOwner returns (uint256) {
        return _subscribeWith(1 gwei, 40 gwei, 10_000_000);
    }

    function subscribeAllMarketsWith(uint64 priorityFeePerGas, uint64 maxFeePerGas, uint64 gasLimit)
        external onlyOwner returns (uint256)
    {
        return _subscribeWith(priorityFeePerGas, maxFeePerGas, gasLimit);
    }

    function _subscribeWith(uint64 priorityFeePerGas, uint64 maxFeePerGas, uint64 gasLimit)
        internal returns (uint256)
    {
        if (subscriptionId != 0) revert AlreadySubscribed(subscriptionId);
        bytes32[4] memory topics;
        topics[0] = Verified.ANSWER_DELIVERED_TOPIC0;
        SomniaExtensions.SubscriptionFilter memory f = SomniaExtensions.SubscriptionFilter({
            eventTopics: topics, origin: address(0), emitter: Verified.ORACLE_HUB
        });
        SomniaExtensions.SubscriptionOptions memory o = SomniaExtensions.SubscriptionOptions({
            priorityFeePerGas: priorityFeePerGas,
            maxFeePerGas: maxFeePerGas,
            gasLimit: gasLimit
        });
        subscriptionId = SomniaExtensions.subscribe(address(this), f, o);
        emit Subscribed(subscriptionId);
        return subscriptionId;
    }
    function cancelSubscription() external onlyOwner {
        if (subscriptionId == 0) revert NoSubscription();
        uint256 id = subscriptionId;
        SomniaExtensions.unsubscribe(id);
        subscriptionId = 0;
    }

    // ---- the reactive core ----
    function _onEvent(address emitter, bytes32[] calldata topics, bytes calldata data) internal override {
        if (paused) revert Paused();
        if (emitter != Verified.ORACLE_HUB) revert UnexpectedEmitter(emitter);
        if (topics.length < 3) revert BadTopics();
        if (topics[0] != Verified.ANSWER_DELIVERED_TOPIC0) revert WrongTopic0();

        ( , uint256[] memory nums, bool voided) = abi.decode(data, (uint32, uint256[], bool));
        _applyResolution(uint256(topics[1]), topics[2], nums, voided);
    }

    /// Drive a step from the market's own on-chain resolution, without waiting
    /// for a delivered event.
    ///
    /// Reactivity is the primary path and stays that way; it is what actually
    /// drives a sequence in normal operation. This is the backstop for the case
    /// where a delivery is delayed or never arrives, which would otherwise leave
    /// a step ARMED for ever with the trader's rules unrun. A sequence that
    /// silently stops is worse than one that trades.
    ///
    /// An earlier version of this comment cited a delivery we had observed fail.
    /// That observation did not survive review - it came from an evidence
    /// harness that matched the wrong log entirely - so it is withdrawn. The
    /// backstop stays regardless: a delivery guarantee is not something this
    /// contract can verify from the inside, and being recoverable costs nothing.
    ///
    /// Permissionless on purpose: anyone may nudge a stuck step, because the
    /// caller supplies nothing but a market id. The outcome is read from the
    /// market contract itself, so there is nothing to lie about, and the same
    /// idempotency key means a later delivery cannot double-fire it.
    function syncResolution(bytes32 marketId) external {
        if (paused) revert Paused();

        (uint256 questionId,,,,,,,, address market,,,,,) = module.markets(marketId);
        if (market == address(0)) revert UnknownMarket(marketId);

        IBinaryMarket m = IBinaryMarket(market);
        bool voided = m.isVoided();
        if (!voided && !m.isResolved()) revert NotResolvedYet(marketId);

        uint256[] memory nums = voided ? new uint256[](0) : m.payoutNumerators();
        emit ResolutionSynced(marketId, questionId, msg.sender);
        _applyResolution(questionId, marketId, nums, voided);
    }

    /// Turn settled outcome positions back into collateral the vault can trade
    /// with again. Without this a rolling strategy slowly converts its bankroll
    /// into won positions it can never reuse.
    ///
    /// Permissionless, because the caller chooses nothing: the market is read
    /// from the module, the outcome from the market itself, the amount from the
    /// vault's own balance, and the collateral can only land in this vault.
    /// There is no recipient argument to abuse.
    ///
    /// Deliberately its own function rather than part of the resolution
    /// callback: a redemption that reverts must never be able to stop a
    /// sequence from executing.
    function redeemPosition(bytes32 marketId) external returns (uint256 collateralGained) {
        (,,,,,,,, address market,, uint256 yesId, uint256 noId,,) = module.markets(marketId);
        if (market == address(0)) revert UnknownMarket(marketId);

        IBinaryMarket m = IBinaryMarket(market);
        bool voided = m.isVoided();
        if (!voided && !m.isResolved()) revert NotSettled(marketId);

        IOutcomeToken6909 tokens = IOutcomeToken6909(m.outcomeToken());
        // One operator approval covers every market on the singleton.
        if (!tokens.isOperator(address(this), address(module))) {
            tokens.setOperator(address(module), true);
        }

        uint256 before = collateral.balanceOf(address(this));

        if (voided) {
            // A voided market pays both sides, so both are redeemed.
            _redeemSide(marketId, 0, yesId, tokens);
            _redeemSide(marketId, 1, noId, tokens);
        } else {
            uint256[] memory nums = m.payoutNumerators();
            uint8 win = _winner(nums, false);
            if (win == type(uint8).max) revert NotSettled(marketId);
            // Only the winning side is worth anything; the loser is left alone
            // rather than burning gas on a redemption that returns nothing.
            _redeemSide(marketId, win, win == 0 ? yesId : noId, tokens);
        }

        collateralGained = collateral.balanceOf(address(this)) - before;
        if (collateralGained == 0) revert NothingToRedeem(marketId);
        return collateralGained;
    }

    function _redeemSide(bytes32 marketId, uint8 outcomeIdx, uint256 tokenId, IOutcomeToken6909 tokens) internal {
        uint256 amount = tokens.balanceOf(address(this), tokenId);
        if (amount == 0) return;                       // nothing held on this side
        uint256 before = collateral.balanceOf(address(this));
        // operatorId and venueId are attribution only and may be zero.
        try IBinaryModuleRedeem(address(module)).redeem(0, bytes32(0), marketId, outcomeIdx, amount) {
            emit Redeemed(marketId, outcomeIdx, amount, collateral.balanceOf(address(this)) - before);
        } catch {
            revert RedeemFailed(marketId, outcomeIdx);
        }
    }

    function _applyResolution(uint256 questionId, bytes32 marketId, uint256[] memory nums, bool voided) internal {
        // A market this vault holds exposure in has settled: that exposure is no
        // longer outstanding. Done before the idempotency gate because releasing
        // is about the successor market, not about a trigger firing.
        uint256 committed = outstandingByMarket[marketId];
        if (committed != 0) {
            outstandingByMarket[marketId] = 0;
            outstandingNotional -= committed;
            emit ExposureReleased(marketId, committed);
        }

        bytes32 ck = keccak256(abi.encodePacked(marketId, questionId));
        if (consumed[ck]) return;                 // idempotent: already handled

        // Consume only once there is something to consume it. Marking the
        // resolution first stranded a queued step whose own market resolved
        // before the link ahead of it armed: the chain would later activate that
        // step onto a market whose one resolution had already been spent, and it
        // would wait for ever. A resolution nobody is listening for is left
        // unconsumed so the step can still act on it once it is armed.
        bytes32 stepId = stepForMarket[marketId];
        if (stepId == bytes32(0)) return;         // nothing armed for this market
        Step storage st = steps[stepId];
        if (st.status != Status.ARMED && st.status != Status.WAITING) return;

        consumed[ck] = true;                      // now it is genuinely handled

        uint8 win = _winner(nums, voided);
        st.winningOutcome = win;
        st.status = Status.TRIGGERED;
        emit Triggered(stepId, marketId, questionId, voided, win);

        if (voided || win == type(uint8).max) {
            st.status = Status.SKIPPED;
            emit Skipped(stepId, marketId, voided ? "voided" : "no-clean-winner");
            return;
        }

        // integrity: event questionId must match module record
        (uint256 modQ,,,,,,,,,,,,,) = module.markets(marketId);
        if (modQ != questionId) {
            st.status = Status.SKIPPED;
            emit Skipped(stepId, marketId, "questionId-mismatch");
            return;
        }

        // the branch the trader configured for this outcome
        uint8 kind = (win == 0) ? st.actionOnWin0 : st.actionOnWin1;
        if (kind == ACT_STOP) {
            // A deliberate stop, not a rejection: the resolution is still
            // consumed, so this step can never fire again.
            st.status = Status.SKIPPED;
            emit Skipped(stepId, marketId, "stop");
            return;
        }

        // risk caps
        uint256 notional = _cost(st.price, st.quantity);
        if (notional > st.notionalCap) { st.status = Status.SKIPPED; emit Skipped(stepId, marketId, "step-cap"); return; }
        if (outstandingNotional + notional > maxOutstandingNotional) {
            st.status = Status.SKIPPED; emit Skipped(stepId, marketId, "vault-cap"); return;
        }

        // The pool can revert outright, not just return false: an order below its
        // minimum quantity reverts QuantityBelowMinimum. Letting that bubble
        // would abort the whole callback, leaving the step ARMED for ever with
        // no record of why, which is the exact failure this vault exists to
        // avoid. A refusal is caught and recorded instead.
        bool ok;
        uint128 orderId;
        try IBinaryPool(st.pool).placeBinaryOrder(
            kind, st.price, st.quantity, st.expireNs, st.orderType, 0, address(0), 0, 0
        ) returns (bool placed, uint128 id) {
            ok = placed;
            orderId = id;
        } catch {
            ok = false;
        }

        // The pool refused the order. Nothing was placed, so nothing is
        // committed and the chain does not advance. Saying it executed here
        // would be a lie the interface would then repeat.
        if (!ok) {
            st.status = Status.SKIPPED;
            emit PlacementRejected(stepId, st.pool, kind);
            emit Skipped(stepId, marketId, "order-rejected");
            return;
        }

        st.orderId = orderId;
        st.status = Status.PLACED;
        outstandingNotional += notional;
        // Attribute the exposure to the market it was placed into, so that
        // market's own resolution releases it.
        outstandingByMarket[st.successorMarketId] += notional;
        emit Placed(stepId, st.pool, kind, orderId, notional);

        // Only a real placement advances the chain. A stop, a skip or a
        // rejection ends it, which is what "if NO, stop" has to mean.
        bytes32 nextId = st.nextStepId;
        if (nextId != bytes32(0)) {
            Step storage nx = steps[nextId];
            if (nx.status == Status.PENDING) {
                nx.status = Status.ARMED;
                stepForMarket[nx.triggerMarketId] = nextId;
                emit StepArmed(nextId, nx.triggerMarketId, nx.pool);
                emit ChainAdvanced(stepId, nextId);
            }
        }
    }

    function _winner(uint256[] memory nums, bool voided) internal pure returns (uint8) {
        if (voided || nums.length == 0 || nums.length > 2) return type(uint8).max;
        // denom is implicit: winner is the sole nonzero-max entry
        uint256 maxv; uint8 idx = type(uint8).max; uint256 count;
        for (uint256 i = 0; i < nums.length; i++) {
            if (nums[i] > maxv) { maxv = nums[i]; }
        }
        if (maxv == 0) return type(uint8).max;
        for (uint256 i = 0; i < nums.length; i++) {
            if (nums[i] == maxv) { count++; // forge-lint: disable-next-line(unsafe-typecast)
                idx = uint8(i); }
        }
        return count == 1 ? idx : type(uint8).max;
    }

    // ---- views for the frontend timeline ----
    function stepStatus(bytes32 stepId) external view returns (Status) { return steps[stepId].status; }
}
