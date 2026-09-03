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
    enum Status { NONE, ARMED, WAITING, TRIGGERED, EXECUTED, SKIPPED, EXPIRED, CANCELLED }

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
        uint128 orderId;           // set once EXECUTED
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

    // ---- events (the execution timeline the frontend renders) ----
    event StepArmed(bytes32 indexed stepId, bytes32 indexed triggerMarketId, address pool);
    event StepWaiting(bytes32 indexed stepId, uint256 subscriptionId);
    event Triggered(bytes32 indexed stepId, bytes32 indexed marketId, uint256 questionId, bool voided, uint8 winningOutcome);
    event Executed(bytes32 indexed stepId, address indexed pool, uint8 kind, bool success, uint128 orderId, uint256 notional);
    event Skipped(bytes32 indexed stepId, bytes32 indexed marketId, string reason);
    event StepCancelled(bytes32 indexed stepId);
    event PausedSet(bool paused);
    event Subscribed(uint256 indexed subscriptionId);
    event Recovered(address indexed token, uint256 amount);

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    receive() external payable {}

    constructor(address module_, address collateral_, uint256 maxOutstanding_) {
        owner = msg.sender;
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
        st.orderId = orderId;
        st.status = Status.EXECUTED;
        outstandingNotional += notional;
        emit Executed(stepId, st.pool, kind, ok, orderId, notional);
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
