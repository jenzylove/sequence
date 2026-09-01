#!/usr/bin/env bash
set -euo pipefail
echo ">> adding self-subscribe entrypoints to handler + test"

python3 - << 'PY'
p = "src/SequenceHandler.sol"
s = open(p).read()

s = s.replace(
'import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";',
'import {SomniaEventHandler} from "@somnia-chain/reactivity-contracts/contracts/SomniaEventHandler.sol";\n'
'import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";'
)

s = s.replace(
'    IBinaryMarketsModule public immutable module;',
'    IBinaryMarketsModule public immutable module;\n\n'
'    uint256 public subscriptionId;\n\n'
'    event Subscribed(uint256 indexed subscriptionId, bytes32 indexed marketId, bool wildcard);\n'
'    event Unsubscribed(uint256 indexed subscriptionId);\n'
'    error AlreadySubscribed(uint256 subscriptionId);\n'
'    error NoSubscription();'
)

s = s.replace(
'    constructor(address module_) {',
'    receive() external payable {}\n\n'
'    constructor(address module_) {'
)

methods = r'''
    // ---- Reactivity subscription management ----
    // THIS contract is the subscription owner, so it must hold >= 32 SOM before
    // calling these. Filter: emitter = OracleHub, topic0 = AnswerDelivered,
    // marketId optionally pinned in topic2.

    function _subscribe(bytes32 marketIdOrZero, bool wildcard) internal returns (uint256 id) {
        if (subscriptionId != 0) revert AlreadySubscribed(subscriptionId);

        bytes32[4] memory topics;
        topics[0] = Verified.ANSWER_DELIVERED_TOPIC0;
        topics[1] = bytes32(0);
        topics[2] = wildcard ? bytes32(0) : marketIdOrZero;
        topics[3] = bytes32(0);

        SomniaExtensions.SubscriptionFilter memory filter = SomniaExtensions.SubscriptionFilter({
            eventTopics: topics,
            origin: address(0),
            emitter: Verified.ORACLE_HUB
        });

        id = SomniaExtensions.subscribe(
            address(this),
            filter,
            SomniaExtensions.defaultSubscriptionOptions()
        );
        subscriptionId = id;
        emit Subscribed(id, marketIdOrZero, wildcard);
    }

    function subscribeToMarket(bytes32 marketId) external returns (uint256) {
        if (msg.sender != owner) revert NotOwner();
        return _subscribe(marketId, false);
    }

    function subscribeAllMarkets() external returns (uint256) {
        if (msg.sender != owner) revert NotOwner();
        return _subscribe(bytes32(0), true);
    }

    function cancelSubscription() external {
        if (msg.sender != owner) revert NotOwner();
        if (subscriptionId == 0) revert NoSubscription();
        uint256 id = subscriptionId;
        SomniaExtensions.unsubscribe(id);
        subscriptionId = 0;
        emit Unsubscribed(id);
    }
'''

idx = s.rstrip().rfind('}')
s = s[:idx] + methods + '\n}\n'
open(p,'w').write(s)
print("patched SequenceHandler.sol")
PY

cat > test/Subscribe.t.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceHandler} from "../src/SequenceHandler.sol";
import {Verified} from "../src/Verified.sol";

// PLUMBING mock of the reactivity precompile at 0x0100. Records SubscriptionData
// so we assert the handler built the correct filter. Proves our call shape, NOT
// that Somnia accepts it live.
contract MockPrecompile {
    bytes32[4] public lastTopics;
    address public lastEmitter;
    address public lastHandler;
    uint256 public nextId = 1;

    struct SubscriptionData {
        bytes32[4] eventTopics; address origin; address caller; address emitter;
        address handlerContractAddress; bytes4 handlerFunctionSelector;
        uint64 priorityFeePerGas; uint64 maxFeePerGas; uint64 gasLimit;
        bool isGuaranteed; bool isCoalesced;
    }

    function subscribe(SubscriptionData calldata d) external returns (uint256) {
        lastTopics = d.eventTopics;
        lastEmitter = d.emitter;
        lastHandler = d.handlerContractAddress;
        return nextId++;
    }
    function unsubscribe(uint256) external {}
}

contract SubscribeTest is Test {
    SequenceHandler handler;
    MockPrecompile mock;
    address constant PRECOMPILE = address(0x0100);
    address constant MODULE = address(0xD0D);

    function setUp() public {
        handler = new SequenceHandler(MODULE);
        MockPrecompile impl = new MockPrecompile();
        vm.etch(PRECOMPILE, address(impl).code);
        mock = MockPrecompile(PRECOMPILE);
        vm.deal(address(handler), 40 ether);
    }

    function test_subscribe_single_market_builds_correct_filter() public {
        bytes32 marketId = keccak256("live-market");
        uint256 id = handler.subscribeToMarket(marketId);
        assertGt(id, 0);
        assertEq(handler.subscriptionId(), id);
        assertEq(mock.lastEmitter(), Verified.ORACLE_HUB);
        assertEq(mock.lastHandler(), address(handler));
        assertEq(mock.lastTopics(0), Verified.ANSWER_DELIVERED_TOPIC0);
        assertEq(mock.lastTopics(1), bytes32(0));
        assertEq(mock.lastTopics(2), marketId);
        assertEq(mock.lastTopics(3), bytes32(0));
    }

    function test_subscribe_all_wildcards_marketid() public {
        uint256 id = handler.subscribeAllMarkets();
        assertGt(id, 0);
        assertEq(mock.lastTopics(0), Verified.ANSWER_DELIVERED_TOPIC0);
        assertEq(mock.lastTopics(2), bytes32(0));
    }

    function test_insufficient_balance_reverts() public {
        SequenceHandler poor = new SequenceHandler(MODULE);
        vm.expectRevert();
        poor.subscribeToMarket(keccak256("x"));
    }

    function test_double_subscribe_reverts() public {
        handler.subscribeToMarket(keccak256("a"));
        vm.expectRevert();
        handler.subscribeToMarket(keccak256("b"));
    }

    function test_only_owner_subscribes() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(SequenceHandler.NotOwner.selector);
        handler.subscribeToMarket(keccak256("a"));
    }
}
SOL

echo ">> build + full test"
forge build && forge test -vv
