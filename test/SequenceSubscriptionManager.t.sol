// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceSubscriptionManager} from "../src/SequenceSubscriptionManager.sol";

contract FakeVault {
    struct Step {
        uint8 status;
        bytes32 triggerMarketId;
        address pool;
        uint256 price;
        uint256 quantity;
        uint64 expireNs;
        uint8 orderType;
        uint8 actionOnWin0;
        uint8 actionOnWin1;
        uint256 notionalCap;
        bytes32 successorMarketId;
        bytes32 nextStepId;
        uint128 orderId;
        uint8 winningOutcome;
    }

    address public owner;
    mapping(bytes32 => Step) public steps;
    mapping(bytes32 => bytes32) public stepForMarket;

    constructor(address o) { owner = o; }

    function setStep(bytes32 id, uint8 status, bytes32 marketId, bytes32 next) external {
        steps[id] = Step({
            status: status,
            triggerMarketId: marketId,
            pool: address(1),
            price: 1,
            quantity: 1,
            expireNs: 1,
            orderType: 0,
            actionOnWin0: 0,
            actionOnWin1: 0,
            notionalCap: 1,
            successorMarketId: bytes32(uint256(1)),
            nextStepId: next,
            orderId: 0,
            winningOutcome: 0
        });
    }

    function armMarket(bytes32 marketId, bytes32 stepId) external {
        stepForMarket[marketId] = stepId;
    }
}

contract FakeFactory {
    mapping(address => address) public vaultOf;
    function setVault(address who, address vault) external { vaultOf[who] = vault; }
}

/// The manager pays for everybody's automatic execution, so the things worth
/// pinning are who may spend that stake and which real Sequence rules may spend it.
contract SequenceSubscriptionManagerTest is Test {
    SequenceSubscriptionManager manager;
    FakeFactory factory;
    address constant OPERATOR = address(0x0FE9A701);
    address constant ALICE = address(0xA11CE);
    address constant MALLORY = address(0xBAD);
    bytes32 constant MARKET = keccak256("market-1");
    bytes32 constant MARKET2 = keccak256("market-2");
    bytes32 constant STEP1 = keccak256("step-1");
    bytes32 constant STEP2 = keccak256("step-2");

    FakeVault aliceVault;

    function setUp() public {
        factory = new FakeFactory();
        aliceVault = new FakeVault(ALICE);
        factory.setVault(ALICE, address(aliceVault));

        aliceVault.setStep(STEP1, 1, MARKET, STEP2); // ARMED
        aliceVault.setStep(STEP2, 8, MARKET2, bytes32(0)); // PENDING
        aliceVault.armMarket(MARKET, STEP1);

        manager = new SequenceSubscriptionManager{value: 35 ether}(OPERATOR, address(factory));
    }

    function test_the_stake_lives_on_the_manager_not_the_user() public view {
        assertEq(address(manager).balance, 35 ether, "Sequence carries the stake");
        assertEq(ALICE.balance, 0, "a trader stakes nothing");
    }

    function test_a_stranger_cannot_register_somebody_elses_vault() public {
        vm.prank(MALLORY);
        vm.expectRevert(
            abi.encodeWithSelector(SequenceSubscriptionManager.NotFactoryVault.selector, address(aliceVault), MALLORY)
        );
        manager.registrationMarkets(address(aliceVault), MARKET);
    }

    function test_a_lookalike_owned_contract_cannot_spend_shared_stake() public {
        FakeVault rogue = new FakeVault(ALICE);
        rogue.setStep(STEP1, 1, MARKET, bytes32(0));
        rogue.armMarket(MARKET, STEP1);

        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(SequenceSubscriptionManager.NotFactoryVault.selector, address(rogue), ALICE)
        );
        manager.registrationMarkets(address(rogue), MARKET);
    }

    function test_registration_must_point_at_a_real_stored_step() public {
        bytes32 invented = keccak256("invented-market");
        vm.prank(ALICE);
        vm.expectRevert(
            abi.encodeWithSelector(SequenceSubscriptionManager.UnknownStep.selector, address(aliceVault), invented)
        );
        manager.registrationMarkets(address(aliceVault), invented);
    }

    function test_registration_walks_the_real_queued_chain() public {
        vm.prank(ALICE);
        bytes32[] memory markets = manager.registrationMarkets(address(aliceVault), MARKET);
        assertEq(markets.length, 2);
        assertEq(markets[0], MARKET);
        assertEq(markets[1], MARKET2);
    }

    function test_a_chain_longer_than_the_product_limit_is_rejected() public {
        bytes32 s1 = keccak256("long-1");
        bytes32 s2 = keccak256("long-2");
        bytes32 s3 = keccak256("long-3");
        bytes32 s4 = keccak256("long-4");
        bytes32 s5 = keccak256("long-5");
        bytes32 m1 = keccak256("long-market-1");
        aliceVault.setStep(s1, 1, m1, s2);
        aliceVault.setStep(s2, 8, keccak256("long-market-2"), s3);
        aliceVault.setStep(s3, 8, keccak256("long-market-3"), s4);
        aliceVault.setStep(s4, 8, keccak256("long-market-4"), s5);
        aliceVault.setStep(s5, 8, keccak256("long-market-5"), bytes32(0));
        aliceVault.armMarket(m1, s1);

        vm.prank(ALICE);
        vm.expectRevert(SequenceSubscriptionManager.ChainTooLong.selector);
        manager.registrationMarkets(address(aliceVault), m1);
    }

    function test_registering_the_zero_address_is_refused() public {
        vm.prank(ALICE);
        vm.expectRevert(SequenceSubscriptionManager.ZeroVault.selector);
        manager.registrationMarkets(address(0), MARKET);
    }

    function test_only_the_operator_may_reclaim_the_stake() public {
        vm.prank(MALLORY);
        vm.expectRevert(SequenceSubscriptionManager.NotOperator.selector);
        manager.withdraw(payable(MALLORY), 1 ether);
    }

    function test_the_operator_can_reclaim_unused_stake() public {
        uint256 before = OPERATOR.balance;
        vm.prank(OPERATOR);
        manager.withdraw(payable(OPERATOR), 3 ether);
        assertEq(OPERATOR.balance, before + 3 ether);
        assertEq(address(manager).balance, 32 ether);
    }

    function test_a_stranger_cannot_unregister_somebody_elses_subscription() public {
        vm.prank(MALLORY);
        vm.expectRevert(
            abi.encodeWithSelector(SequenceSubscriptionManager.NotRegistered.selector, address(aliceVault), MARKET)
        );
        manager.unregister(address(aliceVault), MARKET);
    }

    function test_the_manager_holds_no_authority_over_user_funds() public view {
        assertEq(manager.operator(), OPERATOR);
        assertEq(address(manager.factory()), address(factory));
        assertEq(manager.liveSubscriptions(), 0);
        assertFalse(manager.isRegistered(address(aliceVault), MARKET));
    }

    function test_it_accepts_top_ups_from_anyone() public {
        vm.deal(MALLORY, 5 ether);
        vm.prank(MALLORY);
        (bool ok, ) = address(manager).call{value: 5 ether}("");
        assertTrue(ok, "anyone may help pay for delivery");
        assertEq(address(manager).balance, 40 ether);
    }
}
