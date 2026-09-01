#!/usr/bin/env bash
set -euo pipefail
echo ">> rewriting tests for armed successor path + mocks"

cat > test/SequenceHandler.t.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceHandler} from "../src/SequenceHandler.sol";
import {Verified} from "../src/Verified.sol";

// ---- MOCKS (clearly labelled; not the live proof) ----
// Mock module returns a chosen oracleQuestionId for a market, matching the
// verified 14-field markets() shape. Only field 0 is meaningful to the handler.
contract MockModule {
    mapping(bytes32 => uint256) public qid;
    function setQid(bytes32 m, uint256 q) external { qid[m] = q; }
    function markets(bytes32 marketId)
        external view
        returns (uint256, uint8, uint8, address, uint32, bytes32, address, address, address, address, uint256, uint256, uint64, uint64)
    {
        return (qid[marketId], 2, 0, address(0), 0, bytes32(0), address(0), address(0), address(0), address(0), 0, 0, 0, 0);
    }
}

// Mock pool records the exact placeOrderFor call args so we assert the handler
// fired ONE bounded order with the configured params. Signature matches ISpotPool.
contract MockPool {
    uint256 public calls;
    address public lastOwner;
    bool public lastIsBid;
    uint256 public lastPrice;
    uint256 public lastQuantity;
    uint64 public lastExpireNs;
    uint8 public lastOrderType;
    address public lastBuilder;

    function placeOrderFor(
        address owner_, bool isBid, uint64, uint256 price, uint256 quantity,
        uint64 expireTimestampNs, uint8 orderType, uint8, address builder, uint96
    ) external payable returns (bool, uint128) {
        calls += 1;
        lastOwner = owner_; lastIsBid = isBid; lastPrice = price; lastQuantity = quantity;
        lastExpireNs = expireTimestampNs; lastOrderType = orderType; lastBuilder = builder;
        return (true, uint128(calls));
    }
}

contract SequenceHandlerTest is Test {
    SequenceHandler handler;
    MockModule module;
    MockPool pool;

    address constant PRECOMPILE = address(0x0100);
    address constant ORACLE_HUB = 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b;
    address constant ORDER_OWNER = address(0xA11CE);

    bytes32 constant EXPECTED_TOPIC0 =
        keccak256("AnswerDelivered(uint256,bytes32,uint32,uint256[],bool)");

    event Detected(bytes32 indexed marketId, uint256 indexed oracleQuestionId, bool voided, uint8 winningOutcome);
    event AlreadyHandled(bytes32 indexed marketId, uint256 indexed oracleQuestionId);
    event SuccessorFired(bytes32 indexed marketId, address indexed pool, bool success, uint128 orderId);
    event QuestionIdMismatch(bytes32 indexed marketId, uint256 fromEvent, uint256 fromModule);
    event SkippedNotArmed(bytes32 indexed marketId);

    function setUp() public {
        module = new MockModule();
        pool = new MockPool();
        handler = new SequenceHandler(address(module));
    }

    // ---- helpers ----
    function _topics(uint256 q, bytes32 m) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](3);
        t[0] = Verified.ANSWER_DELIVERED_TOPIC0;
        t[1] = bytes32(q);
        t[2] = m;
    }
    function _dataUpWins() internal pure returns (bytes memory) {
        uint256[] memory n = new uint256[](2); n[0] = 1; n[1] = 0;
        return abi.encode(uint32(1), n, false);
    }
    function _dataDownWins() internal pure returns (bytes memory) {
        uint256[] memory n = new uint256[](2); n[0] = 0; n[1] = 1;
        return abi.encode(uint32(1), n, false);
    }
    function _dataVoided() internal pure returns (bytes memory) {
        uint256[] memory n = new uint256[](2); n[0] = 0; n[1] = 0;
        return abi.encode(uint32(2), n, true);
    }
    function _fire(uint256 q, bytes32 m, bytes memory data) internal {
        vm.prank(PRECOMPILE);
        handler.onEvent(ORACLE_HUB, _topics(q, m), data);
    }
    function _arm(bytes32 m) internal {
        SequenceHandler.Successor memory s = SequenceHandler.Successor({
            armed: true, pool: address(pool), orderOwner: ORDER_OWNER,
            isBid: true, price: 600000, quantity: 5, expireDeltaNs: 60_000_000_000, orderType: 2
        });
        handler.arm(m, s);
    }

    // ---- unchanged core guarantees ----
    function test_topic0_matches_signature() public pure {
        assertEq(Verified.ANSWER_DELIVERED_TOPIC0, EXPECTED_TOPIC0);
    }
    function test_rejects_non_precompile_caller() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        handler.onEvent(ORACLE_HUB, _topics(1, bytes32(uint256(1))), _dataUpWins());
    }
    function test_rejects_wrong_emitter() public {
        vm.prank(PRECOMPILE);
        vm.expectRevert(abi.encodeWithSelector(SequenceHandler.UnexpectedEmitter.selector, address(0xDEAD)));
        handler.onEvent(address(0xDEAD), _topics(1, bytes32(uint256(1))), _dataUpWins());
    }

    // ---- unarmed: decode + skip, no order ----
    function test_unarmed_fires_no_order() public {
        bytes32 m = keccak256("mkt-unarmed");
        vm.expectEmit(true, false, false, false);
        emit SkippedNotArmed(m);
        _fire(1, m, _dataUpWins());
        assertEq(pool.calls(), 0, "should not place when unarmed");
        assertEq(handler.processedCount(), 1);
    }

    // ---- armed happy path: exactly ONE bounded order with configured params ----
    function test_armed_fires_one_bounded_order() public {
        bytes32 m = keccak256("mkt-armed");
        module.setQid(m, 42);      // module agrees with the event's questionId
        _arm(m);

        vm.expectEmit(true, true, false, false);
        emit SuccessorFired(m, address(pool), true, 1);
        _fire(42, m, _dataUpWins());

        assertEq(pool.calls(), 1, "must fire exactly one order");
        assertEq(pool.lastOwner(), ORDER_OWNER);
        assertEq(pool.lastPrice(), 600000);
        assertEq(pool.lastQuantity(), 5);
        assertEq(pool.lastOrderType(), 2);        // IOC
        assertEq(pool.lastBuilder(), address(0)); // testnet cap = 0
        assertTrue(pool.lastExpireNs() > uint64(block.timestamp) * 1_000_000_000, "expiry must be future ns");
    }

    // ---- armed idempotency: repeat delivery does NOT place a second order ----
    function test_armed_idempotent_no_double_order() public {
        bytes32 m = keccak256("mkt-idem");
        module.setQid(m, 7);
        _arm(m);
        _fire(7, m, _dataUpWins());
        assertEq(pool.calls(), 1);

        vm.expectEmit(true, true, false, false);
        emit AlreadyHandled(m, 7);
        _fire(7, m, _dataUpWins());
        assertEq(pool.calls(), 1, "double order on repeat!");
        assertEq(handler.processedCount(), 1);
    }

    // ---- questionId mismatch: armed but module disagrees => no order ----
    function test_questionid_mismatch_blocks_order() public {
        bytes32 m = keccak256("mkt-mismatch");
        module.setQid(m, 999);     // module says 999
        _arm(m);
        vm.expectEmit(true, false, false, true);
        emit QuestionIdMismatch(m, 42, 999);
        _fire(42, m, _dataUpWins());   // event says 42
        assertEq(pool.calls(), 0, "must not fire on mismatch");
    }

    // ---- void: armed, matching qid, but voided => no order ----
    function test_voided_fires_no_order_even_when_armed() public {
        bytes32 m = keccak256("mkt-void");
        module.setQid(m, 5);
        _arm(m);
        _fire(5, m, _dataVoided());
        assertEq(pool.calls(), 0, "void must not place an order");
        assertEq(handler.processedCount(), 1);
    }

    // ---- down-win still fires (outcome index 1 is a clean winner) ----
    function test_down_win_fires_order() public {
        bytes32 m = keccak256("mkt-down");
        module.setQid(m, 8);
        _arm(m);
        _fire(8, m, _dataDownWins());
        assertEq(pool.calls(), 1);
    }

    // ---- only owner can arm ----
    function test_only_owner_can_arm() public {
        bytes32 m = keccak256("mkt-auth");
        vm.prank(address(0xBAD));
        vm.expectRevert(SequenceHandler.NotOwner.selector);
        SequenceHandler.Successor memory s;
        handler.arm(m, s);
    }
}
SOL

echo ">> running full suite"
forge test -vv
