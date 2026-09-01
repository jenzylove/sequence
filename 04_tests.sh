#!/usr/bin/env bash
set -euo pipefail
echo ">> writing test suite"

cat > test/SequenceHandler.t.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceHandler} from "../src/SequenceHandler.sol";
import {Verified} from "../src/Verified.sol";

contract SequenceHandlerTest is Test {
    SequenceHandler handler;

    address constant PRECOMPILE = address(0x0100);
    address constant ORACLE_HUB = 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b;

    // Recompute topic0 independently so the test cross-checks Verified.sol
    // rather than trusting the same constant it's validating.
    bytes32 constant EXPECTED_TOPIC0 =
        keccak256("AnswerDelivered(uint256,bytes32,uint32,uint256[],bool)");

    event Detected(bytes32 indexed marketId, uint256 indexed oracleQuestionId, bool voided, uint8 winningOutcome);
    event AlreadyHandled(bytes32 indexed marketId, uint256 indexed oracleQuestionId);
    event SuccessorPrepared(bytes32 indexed marketId, uint256 indexed oracleQuestionId, uint8 winningOutcome);

    function setUp() public {
        handler = new SequenceHandler();
    }

    // --- helpers: build the callback exactly as the real event serializes ---

    function _topics(uint256 questionId, bytes32 marketId) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](3);
        t[0] = Verified.ANSWER_DELIVERED_TOPIC0;
        t[1] = bytes32(questionId);
        t[2] = marketId;
    }

    // Up wins => payoutNumerators = [1,0], denom = 1 (outcome index 0 pays full)
    function _dataUpWins() internal pure returns (bytes memory) {
        uint256[] memory nums = new uint256[](2);
        nums[0] = 1; nums[1] = 0;
        return abi.encode(uint32(1), nums, false);
    }

    // Down wins => [0,1]
    function _dataDownWins() internal pure returns (bytes memory) {
        uint256[] memory nums = new uint256[](2);
        nums[0] = 0; nums[1] = 1;
        return abi.encode(uint32(1), nums, false);
    }

    function _dataVoided() internal pure returns (bytes memory) {
        uint256[] memory nums = new uint256[](2);
        nums[0] = 0; nums[1] = 0;
        return abi.encode(uint32(2), nums, true);
    }

    function _fire(uint256 q, bytes32 m, bytes memory data) internal {
        vm.prank(PRECOMPILE);
        handler.onEvent(ORACLE_HUB, _topics(q, m), data);
    }

    // --- 0. our own constant matches the independently derived topic0 ---
    function test_topic0_matches_signature() public pure {
        assertEq(Verified.ANSWER_DELIVERED_TOPIC0, EXPECTED_TOPIC0, "Verified topic0 wrong");
    }

    // --- 1. only the precompile may invoke the handler ---
    function test_rejects_non_precompile_caller() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert(); // OnlyReactivityPrecompile() from base
        handler.onEvent(ORACLE_HUB, _topics(1, bytes32(uint256(1))), _dataUpWins());
    }

    // --- 2. wrong emitter rejected even if precompile calls ---
    function test_rejects_wrong_emitter() public {
        vm.prank(PRECOMPILE);
        vm.expectRevert(abi.encodeWithSelector(SequenceHandler.UnexpectedEmitter.selector, address(0xDEAD)));
        handler.onEvent(address(0xDEAD), _topics(1, bytes32(uint256(1))), _dataUpWins());
    }

    // --- 3. wrong topic0 rejected ---
    function test_rejects_wrong_topic0() public {
        bytes32[] memory t = _topics(1, bytes32(uint256(1)));
        t[0] = bytes32(uint256(0x1234));
        vm.prank(PRECOMPILE);
        vm.expectRevert(abi.encodeWithSelector(SequenceHandler.UnexpectedTopic0.selector, bytes32(uint256(0x1234))));
        handler.onEvent(ORACLE_HUB, t, _dataUpWins());
    }

    // --- 4. happy path: detect + decode winner + prepare successor ---
    function test_detects_and_prepares_up_win() public {
        bytes32 m = keccak256("market-A");
        vm.expectEmit(true, true, false, true);
        emit Detected(m, 42, false, 0);
        vm.expectEmit(true, true, false, true);
        emit SuccessorPrepared(m, 42, 0);
        _fire(42, m, _dataUpWins());
        assertEq(handler.processedCount(), 1);
        assertTrue(handler.handled(keccak256(abi.encodePacked(m, uint256(42)))));
    }

    function test_detects_down_win_outcome_index_1() public {
        bytes32 m = keccak256("market-B");
        vm.expectEmit(true, true, false, true);
        emit Detected(m, 7, false, 1);
        _fire(7, m, _dataDownWins());
    }

    // --- 5. THE idempotency gate: same (market,question) fires once ---
    function test_idempotent_on_repeat() public {
        bytes32 m = keccak256("market-C");
        _fire(99, m, _dataUpWins());
        assertEq(handler.processedCount(), 1);

        // second identical delivery -> AlreadyHandled, no double count
        vm.expectEmit(true, true, false, false);
        emit AlreadyHandled(m, 99);
        _fire(99, m, _dataUpWins());
        assertEq(handler.processedCount(), 1, "double-processed!");
    }

    // distinct questions on same market are NOT deduped
    function test_distinct_questions_not_deduped() public {
        bytes32 m = keccak256("market-D");
        _fire(1, m, _dataUpWins());
        _fire(2, m, _dataUpWins());
        assertEq(handler.processedCount(), 2);
    }

    // --- 6. voided: processed, marked handled, but no successor ---
    function test_voided_prepares_nothing() public {
        bytes32 m = keccak256("market-E");
        vm.recordLogs();
        _fire(5, m, _dataVoided());
        assertEq(handler.processedCount(), 1);
        // winner sentinel for void == type(uint8).max == 255
        vm.expectEmit(true, true, false, true);
        emit Detected(m, 6, true, 255);
        _fire(6, m, _dataVoided());
    }
}
SOL

echo ">> running tests"
forge test -vv
