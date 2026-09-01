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
