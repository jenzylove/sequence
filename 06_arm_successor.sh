#!/usr/bin/env bash
set -euo pipefail
echo ">> wiring bounded successor action (option A: fixed bounded order)"

# Rewrite handler with armable config + real placeOrderFor + questionId cross-check.
cat > src/SequenceHandler.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {Verified} from "./Verified.sol";
import {IBinaryMarketsModule, ISpotPool} from "./IDreamDEX.sol";

// SequenceHandler
// Reacts to DreamDEX OracleHub AnswerDelivered and, when armed, fires ONE bounded
// successor order via placeOrderFor. Spike scope: option A (fixed bounded order) -
// the action is predetermined and capped, not outcome-directed. See docs/VERIFIED.md.
contract SequenceHandler is SomniaEventHandler {
    error UnexpectedEmitter(address got);
    error UnexpectedTopic0(bytes32 got);
    error BadTopicsLength(uint256 got);
    error NotOwner();
    error AlreadyArmedFor(bytes32 marketId);

    event Detected(bytes32 indexed marketId, uint256 indexed oracleQuestionId, bool voided, uint8 winningOutcome);
    event AlreadyHandled(bytes32 indexed marketId, uint256 indexed oracleQuestionId);
    event SuccessorPrepared(bytes32 indexed marketId, uint256 indexed oracleQuestionId, uint8 winningOutcome);
    event SuccessorFired(bytes32 indexed marketId, address indexed pool, bool success, uint128 orderId);
    event QuestionIdMismatch(bytes32 indexed marketId, uint256 fromEvent, uint256 fromModule);
    event SkippedNotArmed(bytes32 indexed marketId);

    // Bounded successor order config, set by owner per trigger market.
    struct Successor {
        bool armed;
        address pool;          // successor SpotPool to place on
        address orderOwner;    // the account the order is placed FOR (manual-vault mode)
        bool isBid;
        uint256 price;
        uint256 quantity;
        uint64 expireDeltaNs;  // added to block time (seconds*1e9) at fire time
        uint8 orderType;       // 2 = IOC recommended
    }

    address public immutable owner;
    IBinaryMarketsModule public immutable module;

    // triggerMarketId => successor config
    mapping(bytes32 => Successor) public successorFor;
    // idempotency: keccak(marketId, questionId) => handled
    mapping(bytes32 => bool) public handled;
    uint256 public processedCount;

    constructor(address module_) {
        owner = msg.sender;
        module = IBinaryMarketsModule(module_);
    }

    function arm(bytes32 triggerMarketId, Successor calldata s) external {
        if (msg.sender != owner) revert NotOwner();
        successorFor[triggerMarketId] = Successor({
            armed: true,
            pool: s.pool,
            orderOwner: s.orderOwner,
            isBid: s.isBid,
            price: s.price,
            quantity: s.quantity,
            expireDeltaNs: s.expireDeltaNs,
            orderType: s.orderType
        });
    }

    function disarm(bytes32 triggerMarketId) external {
        if (msg.sender != owner) revert NotOwner();
        delete successorFor[triggerMarketId];
    }

    function _key(bytes32 marketId, uint256 questionId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(marketId, questionId));
    }

    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        if (emitter != Verified.ORACLE_HUB) revert UnexpectedEmitter(emitter);
        if (eventTopics.length < 3) revert BadTopicsLength(eventTopics.length);
        if (eventTopics[0] != Verified.ANSWER_DELIVERED_TOPIC0) revert UnexpectedTopic0(eventTopics[0]);

        uint256 oracleQuestionId = uint256(eventTopics[1]);
        bytes32 marketId = eventTopics[2];

        (uint32 payoutDenominator, uint256[] memory payoutNumerators, bool voided) =
            abi.decode(data, (uint32, uint256[], bool));

        bytes32 k = _key(marketId, oracleQuestionId);
        if (handled[k]) {
            emit AlreadyHandled(marketId, oracleQuestionId);
            return;
        }
        handled[k] = true;
        processedCount += 1;

        uint8 winningOutcome = _winner(payoutNumerators, payoutDenominator, voided);
        emit Detected(marketId, oracleQuestionId, voided, winningOutcome);

        if (voided) return;
        if (winningOutcome == type(uint8).max) return; // not a clean single winner

        Successor memory s = successorFor[marketId];
        if (!s.armed) { emit SkippedNotArmed(marketId); emit SuccessorPrepared(marketId, oracleQuestionId, winningOutcome); return; }

        // Integrity cross-check: the event's questionId must match the module's record
        // for this market. If it doesn't, something is inconsistent - do NOT act.
        ( uint256 modQuestionId,,,,,,,,,,,,, ) = module.markets(marketId);
        if (modQuestionId != oracleQuestionId) {
            emit QuestionIdMismatch(marketId, oracleQuestionId, modQuestionId);
            return;
        }

        // Fire ONE bounded order. Expiry is nanoseconds, strictly future.
        uint64 expireNs = uint64(block.timestamp) * 1_000_000_000 + s.expireDeltaNs;
        (bool ok, uint128 orderId) = ISpotPool(s.pool).placeOrderFor(
            s.orderOwner,
            s.isBid,
            0,                 // userData
            s.price,
            s.quantity,
            expireNs,
            s.orderType,
            0,                 // selfMatchingOption default
            address(0),        // builder (testnet cap = 0)
            0                  // builderFeeBpsTimes1k
        );
        emit SuccessorFired(marketId, s.pool, ok, orderId);
    }

    function _winner(uint256[] memory nums, uint256 denom, bool voided) internal pure returns (uint8) {
        if (voided || denom == 0) return type(uint8).max;
        if (nums.length > 2) return type(uint8).max;
        uint8 win = type(uint8).max;
        for (uint256 i = 0; i < nums.length; i++) {
            if (nums[i] == denom) {
                if (win != type(uint8).max) return type(uint8).max;
                // forge-lint: disable-next-line(unsafe-typecast)
                win = uint8(i); // safe: nums.length <= 2 here, so i <= 1
            }
        }
        return win;
    }
}
SOL

echo ">> forge build"
forge build
