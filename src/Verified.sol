// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Verified DreamDEX / Somnia constants (Shannon testnet)
/// @notice Every value here was confirmed against the shipped
///         the somnia-chain markets-sdk ABIs and the official dreamDEX docs.
///         Do not edit by hand without re-deriving from the markets-sdk package.
library Verified {
    // Somnia Reactivity precompile (the only permitted caller of a handler)
    address internal constant REACTIVITY_PRECOMPILE = 0x0000000000000000000000000000000000000100;

    // OracleHub is the emitter of the resolution signal on Shannon.
    address internal constant ORACLE_HUB = 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b;

    // BinaryMarketsModule: markets(marketId) registry + user entrypoint.
    address internal constant BINARY_MODULE = 0x3ecC694Cef705358864a646142ac17A90E29e388;

    // Testnet collateral (test USDC, 6 decimals).
    address internal constant TEST_USDC = 0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E;

    // topic0 of AnswerDelivered(uint256,bytes32,uint32,uint256[],bool)
    // derived via viem toEventSelector over oracleHubEventsAbi.
    bytes32 internal constant ANSWER_DELIVERED_TOPIC0 =
        0x981074cb1e0ea7eac4cbc8c4c9ddbef8b964373e7e8cd0904c8e0951c4430541;

    // placeOrderFor selector (operator-placed order). From dreamDEX functions docs.
    bytes4 internal constant PLACE_ORDER_FOR_SELECTOR = 0x80054449;

    // Lifecycle status values read from market state (NOT events).
    uint8 internal constant STATUS_TRADING  = 1;
    uint8 internal constant STATUS_RESOLVED = 4;
    uint8 internal constant STATUS_VOIDED   = 5;
}
