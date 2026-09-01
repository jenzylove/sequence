#!/usr/bin/env bash
set -euo pipefail
echo ">> rewriting handler for self-owned placeBinaryOrder (Sequence vault architecture)"

# --- interfaces: real binary pool + minimal ERC20 ---
cat > src/IDreamDEX.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// BinaryMarketsModule read surface (verified from binaryModuleReadAbi).
// markets() returns a 14-field record; we use oracleQuestionId (cross-check) and
// pool (placement target). NO status/winner here - resolution comes from the event.
interface IBinaryMarketsModule {
    function markets(bytes32 marketId)
        external view
        returns (
            uint256 oracleQuestionId, uint8 outcomeSlotCount, uint8 voidPolicy,
            address collateral, uint32 originOperatorId, bytes32 originVenueId,
            address oracleAdapter, address creator, address market, address pool,
            uint256 yesId, uint256 noId, uint64 tradingStart, uint64 expiry
        );
}

// BinaryPool self-placement (verified from binaryPoolWriteAbi). Sequence calls
// this AS ITSELF - it owns the bankroll, so no owner arg, no operator registry.
// kind enum: 0 BUY_YES, 1 SELL_YES, 2 BUY_NO, 3 SELL_NO.
interface IBinaryPool {
    function placeBinaryOrder(
        uint8 kind,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k,
        uint64 userData
    ) external payable returns (bool success, uint128 id);
}

// Minimal ERC20 - Sequence approves the pool to pull its bounded tUSDC bankroll.
interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}
SOL

# --- handler: self-placement, vault-owned ---
cat > src/SequenceHandler.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {Verified} from "./Verified.sol";
import {IBinaryMarketsModule, IBinaryPool, IERC20} from "./IDreamDEX.sol";

// SequenceHandler - a capped strategy vault.
// It OWNS its tUSDC bankroll and, on a real DreamDEX resolution delivered by
// Somnia Reactivity, validates the branch and places its OWN successor
// placeBinaryOrder. No operator registry, no placeOrderFor, no external owner.
contract SequenceHandler is SomniaEventHandler {
    error UnexpectedEmitter(address got);
    error UnexpectedTopic0(bytes32 got);
    error BadTopicsLength(uint256 got);
    error NotOwner();
    error AlreadySubscribed(uint256 id);
    error NoSubscription();

    event Detected(bytes32 indexed marketId, uint256 indexed oracleQuestionId, bool voided, uint8 winningOutcome);
    event AlreadyHandled(bytes32 indexed marketId, uint256 indexed oracleQuestionId);
    event SkippedNotArmed(bytes32 indexed marketId);
    event QuestionIdMismatch(bytes32 indexed marketId, uint256 fromEvent, uint256 fromModule);
    event SuccessorPlaced(bytes32 indexed marketId, address indexed pool, uint8 kind, bool success, uint128 orderId);
    event Subscribed(uint256 indexed subscriptionId, bool wildcard);
    event Unsubscribed(uint256 indexed subscriptionId);

    // Bounded successor order, owner-configured per trigger market.
    struct Successor {
        bool armed;
        address pool;        // successor BinaryPool
        uint256 price;       // limit price (raw)
        uint256 quantity;    // bounded size (raw)
        uint64 expireNs;     // 0 < expireNs <= successor market expiry
        uint8 orderType;     // 0 Normal,1 FOK,2 IOC,3 PostOnly
        bool buyYesOnWin0;   // true: winner0->BUY_YES(0)/winner1->BUY_NO(2)
    }

    address public immutable owner;
    IBinaryMarketsModule public immutable module;
    IERC20 public immutable collateral;   // tUSDC bankroll token

    uint256 public subscriptionId;
    mapping(bytes32 => Successor) public successorFor;   // triggerMarketId => order
    mapping(bytes32 => bool) public handled;             // keccak(marketId,qid) => done
    uint256 public processedCount;

    receive() external payable {}

    constructor(address module_, address collateral_) {
        owner = msg.sender;
        module = IBinaryMarketsModule(module_);
        collateral = IERC20(collateral_);
    }

    // ---- vault funding: approve a pool to pull the bounded bankroll ----
    function approvePool(address pool, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        collateral.approve(pool, amount);
    }

    // ---- arm a bounded successor order for a trigger market ----
    function arm(bytes32 triggerMarketId, Successor calldata sConf) external {
        if (msg.sender != owner) revert NotOwner();
        Successor memory x = sConf;
        x.armed = true;
        successorFor[triggerMarketId] = x;
    }
    function disarm(bytes32 triggerMarketId) external {
        if (msg.sender != owner) revert NotOwner();
        delete successorFor[triggerMarketId];
    }

    // ---- reactivity subscription (handler is its own subscription owner) ----
    function _subscribe(bool wildcard, bytes32 marketId) internal returns (uint256 id) {
        if (subscriptionId != 0) revert AlreadySubscribed(subscriptionId);
        bytes32[4] memory topics;
        topics[0] = Verified.ANSWER_DELIVERED_TOPIC0;
        topics[2] = wildcard ? bytes32(0) : marketId;
        SomniaExtensions.SubscriptionFilter memory filter = SomniaExtensions.SubscriptionFilter({
            eventTopics: topics, origin: address(0), emitter: Verified.ORACLE_HUB
        });
        id = SomniaExtensions.subscribe(address(this), filter, SomniaExtensions.defaultSubscriptionOptions());
        subscriptionId = id;
        emit Subscribed(id, wildcard);
    }
    function subscribeAllMarkets() external returns (uint256) {
        if (msg.sender != owner) revert NotOwner();
        return _subscribe(true, bytes32(0));
    }
    function subscribeToMarket(bytes32 marketId) external returns (uint256) {
        if (msg.sender != owner) revert NotOwner();
        return _subscribe(false, marketId);
    }
    function cancelSubscription() external {
        if (msg.sender != owner) revert NotOwner();
        if (subscriptionId == 0) revert NoSubscription();
        uint256 id = subscriptionId;
        SomniaExtensions.unsubscribe(id);
        subscriptionId = 0;
        emit Unsubscribed(id);
    }

    function _key(bytes32 m, uint256 q) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(m, q));
    }

    function _onEvent(address emitter, bytes32[] calldata eventTopics, bytes calldata data) internal override {
        if (emitter != Verified.ORACLE_HUB) revert UnexpectedEmitter(emitter);
        if (eventTopics.length < 3) revert BadTopicsLength(eventTopics.length);
        if (eventTopics[0] != Verified.ANSWER_DELIVERED_TOPIC0) revert UnexpectedTopic0(eventTopics[0]);

        uint256 oracleQuestionId = uint256(eventTopics[1]);
        bytes32 marketId = eventTopics[2];
        (uint32 payoutDenominator, uint256[] memory payoutNumerators, bool voided) =
            abi.decode(data, (uint32, uint256[], bool));

        bytes32 k = _key(marketId, oracleQuestionId);
        if (handled[k]) { emit AlreadyHandled(marketId, oracleQuestionId); return; }
        handled[k] = true;
        processedCount += 1;

        uint8 winningOutcome = _winner(payoutNumerators, payoutDenominator, voided);
        emit Detected(marketId, oracleQuestionId, voided, winningOutcome);

        if (voided) return;
        if (winningOutcome == type(uint8).max) return;

        Successor memory sc = successorFor[marketId];
        if (!sc.armed) { emit SkippedNotArmed(marketId); return; }

        // integrity: event questionId must match module record for this market
        (uint256 modQ,,,,,,,,,,,,,) = module.markets(marketId);
        if (modQ != oracleQuestionId) { emit QuestionIdMismatch(marketId, oracleQuestionId, modQ); return; }

        // branch -> kind. winner 0 => BUY_YES(0) or BUY_NO(2) per config.
        uint8 kind;
        if (winningOutcome == 0) kind = sc.buyYesOnWin0 ? 0 : 2;
        else kind = sc.buyYesOnWin0 ? 2 : 0;

        (bool ok, uint128 orderId) = IBinaryPool(sc.pool).placeBinaryOrder(
            kind, sc.price, sc.quantity, sc.expireNs, sc.orderType, 0, address(0), 0, 0
        );
        emit SuccessorPlaced(marketId, sc.pool, kind, ok, orderId);
    }

    function _winner(uint256[] memory nums, uint256 denom, bool voided) internal pure returns (uint8) {
        if (voided || denom == 0) return type(uint8).max;
        if (nums.length > 2) return type(uint8).max;
        uint8 win = type(uint8).max;
        for (uint256 i = 0; i < nums.length; i++) {
            if (nums[i] == denom) {
                if (win != type(uint8).max) return type(uint8).max;
                // forge-lint: disable-next-line(unsafe-typecast)
                win = uint8(i); // safe: nums.length <= 2
            }
        }
        return win;
    }
}
SOL

# --- tests: mock binary pool with the REAL placeBinaryOrder signature ---
cat > test/SequenceHandler.t.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceHandler} from "../src/SequenceHandler.sol";
import {Verified} from "../src/Verified.sol";

contract MockModule {
    mapping(bytes32 => uint256) public qid;
    function setQid(bytes32 m, uint256 q) external { qid[m] = q; }
    function markets(bytes32 m) external view
      returns (uint256,uint8,uint8,address,uint32,bytes32,address,address,address,address,uint256,uint256,uint64,uint64) {
        return (qid[m],2,0,address(0),0,bytes32(0),address(0),address(0),address(0),address(0),0,0,0,0);
    }
}
contract MockBinaryPool {
    uint256 public calls; uint8 public lastKind; uint256 public lastPrice; uint256 public lastQty; uint8 public lastType;
    function placeBinaryOrder(uint8 kind,uint256 price,uint256 quantity,uint64,uint8 orderType,uint8,address,uint96,uint64)
      external payable returns (bool,uint128) {
        calls++; lastKind=kind; lastPrice=price; lastQty=quantity; lastType=orderType; return (true,uint128(calls));
    }
}
contract MockERC20 {
    function approve(address,uint256) external pure returns (bool){ return true; }
    function balanceOf(address) external pure returns (uint256){ return 0; }
}

contract SequenceHandlerTest is Test {
    SequenceHandler handler; MockModule module; MockBinaryPool pool; MockERC20 usdc;
    address constant PRECOMPILE = address(0x0100);
    address constant ORACLE_HUB = 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b;
    bytes32 constant EXP_T0 = keccak256("AnswerDelivered(uint256,bytes32,uint32,uint256[],bool)");

    event SuccessorPlaced(bytes32 indexed marketId, address indexed pool, uint8 kind, bool success, uint128 orderId);
    event AlreadyHandled(bytes32 indexed marketId, uint256 indexed oracleQuestionId);
    event SkippedNotArmed(bytes32 indexed marketId);

    function setUp() public {
        module = new MockModule(); pool = new MockBinaryPool(); usdc = new MockERC20();
        handler = new SequenceHandler(address(module), address(usdc));
    }
    function _topics(uint256 q, bytes32 m) internal pure returns (bytes32[] memory t){
        t=new bytes32[](3); t[0]=Verified.ANSWER_DELIVERED_TOPIC0; t[1]=bytes32(q); t[2]=m;
    }
    function _up() internal pure returns (bytes memory){ uint256[] memory n=new uint256[](2); n[0]=1; n[1]=0; return abi.encode(uint32(1),n,false); }
    function _down() internal pure returns (bytes memory){ uint256[] memory n=new uint256[](2); n[0]=0; n[1]=1; return abi.encode(uint32(1),n,false); }
    function _void() internal pure returns (bytes memory){ uint256[] memory n=new uint256[](2); n[0]=0; n[1]=0; return abi.encode(uint32(2),n,true); }
    function _fire(uint256 q, bytes32 m, bytes memory d) internal { vm.prank(PRECOMPILE); handler.onEvent(ORACLE_HUB,_topics(q,m),d); }
    function _arm(bytes32 m, bool buyYesOnWin0) internal {
        SequenceHandler.Successor memory s;
        s.pool=address(pool); s.price=600000; s.quantity=5; s.expireNs=uint64(block.timestamp+3600)*1e9; s.orderType=2; s.buyYesOnWin0=buyYesOnWin0;
        handler.arm(m,s);
    }

    function test_topic0() public pure { assertEq(Verified.ANSWER_DELIVERED_TOPIC0, EXP_T0); }

    function test_win0_buys_yes_kind0() public {
        bytes32 m=keccak256("A"); module.setQid(m,42); _arm(m,true);
        vm.expectEmit(true,true,false,false); emit SuccessorPlaced(m,address(pool),0,true,1);
        _fire(42,m,_up());
        assertEq(pool.calls(),1); assertEq(pool.lastKind(),0); assertEq(pool.lastType(),2);
    }
    function test_win1_buys_no_kind2() public {
        bytes32 m=keccak256("B"); module.setQid(m,7); _arm(m,true);
        _fire(7,m,_down());
        assertEq(pool.lastKind(),2);
    }
    function test_idempotent_no_double_place() public {
        bytes32 m=keccak256("C"); module.setQid(m,9); _arm(m,true);
        _fire(9,m,_up()); assertEq(pool.calls(),1);
        vm.expectEmit(true,true,false,false); emit AlreadyHandled(m,9);
        _fire(9,m,_up()); assertEq(pool.calls(),1);
    }
    function test_void_no_place() public {
        bytes32 m=keccak256("D"); module.setQid(m,5); _arm(m,true);
        _fire(5,m,_void()); assertEq(pool.calls(),0);
    }
    function test_qid_mismatch_no_place() public {
        bytes32 m=keccak256("E"); module.setQid(m,999); _arm(m,true);
        _fire(42,m,_up()); assertEq(pool.calls(),0);
    }
    function test_unarmed_no_place() public {
        bytes32 m=keccak256("F");
        vm.expectEmit(true,false,false,false); emit SkippedNotArmed(m);
        _fire(1,m,_up()); assertEq(pool.calls(),0);
    }
    function test_only_owner_arms() public {
        vm.prank(address(0xBAD)); vm.expectRevert(SequenceHandler.NotOwner.selector);
        SequenceHandler.Successor memory s; handler.arm(keccak256("G"),s);
    }
    function test_rejects_non_precompile() public {
        vm.prank(address(0xBEEF)); vm.expectRevert();
        handler.onEvent(ORACLE_HUB,_topics(1,bytes32(uint256(1))),_up());
    }
}
SOL

echo ">> build + test"
forge build && forge test -vv
