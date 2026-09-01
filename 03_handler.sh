#!/usr/bin/env bash
set -euo pipefail
echo ">> writing handler + remappings + interfaces"

# --- remappings so foundry resolves the npm-published reactivity contracts ---
cat > remappings.txt << 'RM'
@somnia-chain/reactivity-contracts/=node_modules/@somnia-chain/reactivity-contracts/
forge-std/=lib/forge-std/src/
RM

# --- minimal DreamDEX interfaces, ONLY the functions we verified from docs/SDK ---
cat > src/IDreamDEX.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @notice Subset of BinaryMarketsModule we rely on. markets(marketId) returns
///         the per-window market record. We read status to gate the successor action.
/// @dev Field layout of the market record is NOT yet verified from ABI — see
///      docs/VERIFIED.md TODO. getMarketOnchain-style status read is confirmed to
///      exist via the SDK (getMarketOnchain(...).status); the exact on-chain
///      selector/shape is probed in the next step before we depend on it.
interface IBinaryMarketsModule {
    /// @dev placeholder: resolved in 04 once we read the module ABI's read fns.
    function markets(bytes32 marketId) external view returns (address market, address pool, uint8 status);
}

/// @notice SpotPool / order book placement, operator path. Verified from
///         dreamDEX functions docs. Selector 0x80054449.
interface ISpotPool {
    function placeOrderFor(
        address owner,
        bool isBid,
        uint64 userData,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,           // OrderType enum: 0 Normal,1 FOK,2 IOC,3 PostOnly
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k
    ) external payable returns (bool success, uint128 orderId);
}
SOL

# --- the handler ---
cat > src/SequenceHandler.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";
import {Verified} from "./Verified.sol";

/// @title SequenceHandler
/// @notice Reacts to DreamDEX OracleHub `AnswerDelivered` and prepares ONE bounded
///         successor action. Spike scope: prove detection -> decode -> idempotent
///         single-fire. The actual placeOrderFor wiring is gated behind config set
///         by the owner; unconfigured, the handler records the decode and stops.
contract SequenceHandler is SomniaEventHandler {
    /// @dev AnswerDelivered(uint256 oracleQuestionId, bytes32 marketId,
    ///      uint32 payoutDenominator, uint256[] payoutNumerators, bool voided)
    ///      indexed: oracleQuestionId (topic1), marketId (topic2).

    error UnexpectedEmitter(address got);
    error UnexpectedTopic0(bytes32 got);
    error BadTopicsLength(uint256 got);

    event Detected(bytes32 indexed marketId, uint256 indexed oracleQuestionId, bool voided, uint8 winningOutcome);
    event AlreadyHandled(bytes32 indexed marketId, uint256 indexed oracleQuestionId);
    event SuccessorPrepared(bytes32 indexed marketId, uint256 indexed oracleQuestionId, uint8 winningOutcome);

    /// @dev idempotency: keccak(marketId, questionId) => handled
    mapping(bytes32 => bool) public handled;

    /// @notice how many distinct resolutions we've processed (spike observability)
    uint256 public processedCount;

    function _key(bytes32 marketId, uint256 questionId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(marketId, questionId));
    }

    /// @inheritdoc SomniaEventHandler
    function _onEvent(
        address emitter,
        bytes32[] calldata eventTopics,
        bytes calldata data
    ) internal override {
        // Defense-in-depth: even though the subscription filter pins these,
        // never trust the callback blindly.
        if (emitter != Verified.ORACLE_HUB) revert UnexpectedEmitter(emitter);
        if (eventTopics.length < 3) revert BadTopicsLength(eventTopics.length);
        if (eventTopics[0] != Verified.ANSWER_DELIVERED_TOPIC0) revert UnexpectedTopic0(eventTopics[0]);

        uint256 oracleQuestionId = uint256(eventTopics[1]);
        bytes32 marketId = eventTopics[2];

        // Non-indexed args: (uint32 payoutDenominator, uint256[] payoutNumerators, bool voided)
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

        if (voided) {
            // Voided markets: no directional successor action. Stop here by design.
            return;
        }

        // Bounded successor action is prepared here. Wiring to placeOrderFor is
        // deliberately staged (next step) so we never claim a live trade the
        // spike hasn't actually executed on-chain.
        emit SuccessorPrepared(marketId, oracleQuestionId, winningOutcome);
    }

    /// @dev Winner = index of the sole numerator == denominator. For a clean binary
    ///      resolution exactly one outcome pays full. Returns type(uint8).max if the
    ///      vector isn't a clean win (e.g. split), which the caller can treat as no-op.
    function _winner(uint256[] memory nums, uint256 denom, bool voided) internal pure returns (uint8) {
        if (voided || denom == 0) return type(uint8).max;
        uint8 win = type(uint8).max;
        for (uint256 i = 0; i < nums.length; i++) {
            if (nums[i] == denom) {
                if (win != type(uint8).max) return type(uint8).max; // more than one full payout => not clean
                win = uint8(i);
            }
        }
        return win;
    }
}
SOL

echo ">> forge build (verify compile against real base contract)"
forge build
