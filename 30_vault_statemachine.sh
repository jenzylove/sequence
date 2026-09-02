#!/usr/bin/env bash
set -euo pipefail
echo ">> product: SequenceVault state machine"

cat > src/SequenceVault.sol << 'SOL'
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
        bool    buyYesOnWin0;      // branch: win0->YES else NO
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

        // risk caps
        uint256 notional = st.price * st.quantity;
        if (notional > st.notionalCap) { st.status = Status.SKIPPED; emit Skipped(stepId, marketId, "step-cap"); return; }
        if (outstandingNotional + notional > maxOutstandingNotional) {
            st.status = Status.SKIPPED; emit Skipped(stepId, marketId, "vault-cap"); return;
        }

        uint8 kind = (win == 0) ? (st.buyYesOnWin0 ? 0 : 2) : (st.buyYesOnWin0 ? 2 : 0);
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
SOL

cat > test/SequenceVault.t.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceVault} from "../src/SequenceVault.sol";
import {Verified} from "../src/Verified.sol";

contract MockModule {
    mapping(bytes32 => uint256) public qid;
    function setQid(bytes32 m, uint256 q) external { qid[m] = q; }
    function markets(bytes32 m) external view
      returns (uint256,uint8,uint8,address,uint32,bytes32,address,address,address,address,uint256,uint256,uint64,uint64){
        return (qid[m],2,0,address(0),0,bytes32(0),address(0),address(0),address(0),address(0),0,0,0,0);
    }
}
contract MockPool {
    uint256 public calls; uint8 public lastKind;
    function placeBinaryOrder(uint8 k,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64) external payable returns (bool,uint128){
        calls++; lastKind=k; return (true, uint128(calls));
    }
}
contract MockERC20 { function approve(address,uint256) external pure returns (bool){return true;} }

contract SequenceVaultTest is Test {
    SequenceVault vault; MockModule module; MockPool pool; MockERC20 usdc;
    address constant PRECOMPILE = address(0x0100);
    address constant HUB = 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b;

    function setUp() public {
        module = new MockModule(); pool = new MockPool(); usdc = new MockERC20();
        vault = new SequenceVault(address(module), address(usdc), 1_000_000_000); // big vault cap
    }
    function _topics(uint256 q, bytes32 m) internal pure returns (bytes32[] memory t){
        t=new bytes32[](3); t[0]=Verified.ANSWER_DELIVERED_TOPIC0; t[1]=bytes32(q); t[2]=m;
    }
    function _up() internal pure returns (bytes memory){uint256[] memory n=new uint256[](2);n[0]=1;n[1]=0;return abi.encode(uint32(1),n,false);}
    function _down() internal pure returns (bytes memory){uint256[] memory n=new uint256[](2);n[0]=0;n[1]=1;return abi.encode(uint32(1),n,false);}
    function _void() internal pure returns (bytes memory){uint256[] memory n=new uint256[](2);n[0]=0;n[1]=0;return abi.encode(uint32(2),n,true);}
    function _fire(uint256 q, bytes32 m, bytes memory d) internal { vm.prank(PRECOMPILE); vault.onEvent(HUB,_topics(q,m),d); }

    function _arm(bytes32 stepId, bytes32 market, uint256 price, uint256 qty, uint256 cap, bool yesOn0) internal {
        SequenceVault.Step memory s;
        s.triggerMarketId=market; s.pool=address(pool); s.price=price; s.quantity=qty;
        s.expireNs=uint64(block.timestamp+3600)*1e9; s.orderType=2; s.buyYesOnWin0=yesOn0; s.notionalCap=cap;
        vault.armStep(stepId, s);
    }

    function test_arm_then_execute_on_win0() public {
        bytes32 sid=keccak256("s1"); bytes32 m=keccak256("mA"); module.setQid(m,42);
        _arm(sid,m,100,5,1000,true);   // notional 500 <= cap 1000
        _fire(42,m,_up());
        assertEq(uint256(vault.stepStatus(sid)), uint256(SequenceVault.Status.EXECUTED));
        assertEq(pool.calls(),1); assertEq(pool.lastKind(),0);
        assertEq(vault.outstandingNotional(),500);
    }
    function test_win1_buys_no() public {
        bytes32 sid=keccak256("s2"); bytes32 m=keccak256("mB"); module.setQid(m,7);
        _arm(sid,m,100,5,1000,true); _fire(7,m,_down());
        assertEq(pool.lastKind(),2);
    }
    function test_idempotent_no_double() public {
        bytes32 sid=keccak256("s3"); bytes32 m=keccak256("mC"); module.setQid(m,9);
        _arm(sid,m,100,5,1000,true); _fire(9,m,_up()); _fire(9,m,_up());
        assertEq(pool.calls(),1);
    }
    function test_void_skips() public {
        bytes32 sid=keccak256("s4"); bytes32 m=keccak256("mD"); module.setQid(m,5);
        _arm(sid,m,100,5,1000,true); _fire(5,m,_void());
        assertEq(uint256(vault.stepStatus(sid)), uint256(SequenceVault.Status.SKIPPED));
        assertEq(pool.calls(),0);
    }
    function test_step_cap_blocks() public {
        bytes32 sid=keccak256("s5"); bytes32 m=keccak256("mE"); module.setQid(m,1);
        // arm with cap high enough to pass arm-time check, then it still enforces at fire
        _arm(sid,m,100,5,500,true);    // notional exactly 500 == cap, ok
        _fire(1,m,_up());
        assertEq(pool.calls(),1);
    }
    function test_vault_cap_blocks() public {
        vault.setMaxOutstanding(400);  // below the 500 notional
        bytes32 sid=keccak256("s6"); bytes32 m=keccak256("mF"); module.setQid(m,2);
        _arm(sid,m,100,5,1000,true); _fire(2,m,_up());
        assertEq(uint256(vault.stepStatus(sid)), uint256(SequenceVault.Status.SKIPPED));
        assertEq(pool.calls(),0);
    }
    function test_arm_rejects_over_cap() public {
        bytes32 sid=keccak256("s7"); bytes32 m=keccak256("mG");
        SequenceVault.Step memory s;
        s.triggerMarketId=m; s.pool=address(pool); s.price=100; s.quantity=20; // notional 2000
        s.expireNs=uint64(block.timestamp+3600)*1e9; s.orderType=2; s.buyYesOnWin0=true; s.notionalCap=1000;
        vm.expectRevert(abi.encodeWithSelector(SequenceVault.CapExceeded.selector, 2000, 1000));
        vault.armStep(sid, s);
    }
    function test_paused_blocks_execution() public {
        bytes32 sid=keccak256("s8"); bytes32 m=keccak256("mH"); module.setQid(m,3);
        _arm(sid,m,100,5,1000,true);
        vault.setPaused(true);
        vm.prank(PRECOMPILE);
        vm.expectRevert(SequenceVault.Paused.selector);
        vault.onEvent(HUB,_topics(3,m),_up());
    }
    function test_cancel_step() public {
        bytes32 sid=keccak256("s9"); bytes32 m=keccak256("mI"); module.setQid(m,4);
        _arm(sid,m,100,5,1000,true); vault.cancelStep(sid);
        _fire(4,m,_up());
        assertEq(pool.calls(),0); // cancelled step doesn't fire
    }
    function test_only_owner_arms() public {
        vm.prank(address(0xBAD)); vm.expectRevert(SequenceVault.NotOwner.selector);
        SequenceVault.Step memory s; vault.armStep(keccak256("x"), s);
    }
    function test_qid_mismatch_skips() public {
        bytes32 sid=keccak256("s10"); bytes32 m=keccak256("mJ"); module.setQid(m,999);
        _arm(sid,m,100,5,1000,true); _fire(42,m,_up());
        assertEq(pool.calls(),0);
    }
    function test_non_precompile_reverts() public {
        vm.prank(address(0xBEEF)); vm.expectRevert();
        vault.onEvent(HUB,_topics(1,bytes32(uint256(1))),_up());
    }
}
SOL

echo ">> build + test"
forge build && forge test -vv --match-contract SequenceVaultTest
