// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {Verified} from "./Verified.sol";
import {IBinaryMarketsModule, IBinaryPool, IERC20} from "./IDreamDEX.sol";

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

    // ---- per-outcome actions ----
    // What the vault does when an outcome wins. The two buy values are the
    // IBinaryPool `kind` codes themselves, so nothing is translated at the call
    // site; STOP is a sentinel outside the kind range (0-3) meaning "place
    // nothing". Each outcome carries its own action, so a trader can stop on
    // one side while still trading the other.
    uint8 internal constant ACT_BUY_YES = 0;
    uint8 internal constant ACT_BUY_NO = 2;
    uint8 internal constant ACT_STOP = 255;

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
        uint256 notional = s.price * s.quantity;
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
        uint256 notional = s.price * s.quantity;
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

    // ---- subscription (vault owns its own; needs >=32 SOM) ----
    function subscribeAllMarkets() external onlyOwner returns (uint256) {
        if (subscriptionId != 0) revert AlreadySubscribed(subscriptionId);
        bytes32[4] memory topics;
        topics[0] = Verified.ANSWER_DELIVERED_TOPIC0;
        SomniaExtensions.SubscriptionFilter memory f = SomniaExtensions.SubscriptionFilter({
            eventTopics: topics, origin: address(0), emitter: Verified.ORACLE_HUB
        });
        subscriptionId = SomniaExtensions.subscribe(address(this), f, SomniaExtensions.defaultSubscriptionOptions());
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

        uint256 questionId = uint256(topics[1]);
        bytes32 marketId = topics[2];

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
        consumed[ck] = true;

        bytes32 stepId = stepForMarket[marketId];
        if (stepId == bytes32(0)) return;         // no step armed for this market
        Step storage st = steps[stepId];
        if (st.status != Status.ARMED && st.status != Status.WAITING) return;

        ( , uint256[] memory nums, bool voided) = abi.decode(data, (uint32, uint256[], bool));
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
        uint256 notional = st.price * st.quantity;
        if (notional > st.notionalCap) { st.status = Status.SKIPPED; emit Skipped(stepId, marketId, "step-cap"); return; }
        if (outstandingNotional + notional > maxOutstandingNotional) {
            st.status = Status.SKIPPED; emit Skipped(stepId, marketId, "vault-cap"); return;
        }

        (bool ok, uint128 orderId) = IBinaryPool(st.pool).placeBinaryOrder(
            kind, st.price, st.quantity, st.expireNs, st.orderType, 0, address(0), 0, 0
        );

        // The pool refused the order. Nothing was placed, so nothing is
        // committed and the chain does not advance. Saying EXECUTED here would
        // be a lie the interface would then repeat.
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
