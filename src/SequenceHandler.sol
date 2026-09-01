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

    // ---- owner rescue: pull SOM / tUSDC back out (funds must never strand) ----
    function withdrawNative(uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        (bool ok,) = payable(owner).call{value: amount}("");
        require(ok, "native withdraw failed");
    }
    function withdrawToken(address token, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        IERC20(token).approve(address(this), 0); // noop guard; approve not transfer
        // use low-level transfer via IERC20 minimal - add transfer to interface
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSignature("transfer(address,uint256)", owner, amount));
        require(ok && (ret.length == 0 || abi.decode(ret,(bool))), "token withdraw failed");
    }

}
