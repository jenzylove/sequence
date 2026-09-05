// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceSubscriptionManager} from "../src/SequenceSubscriptionManager.sol";

contract FakeVault {
    address public owner;
    constructor(address o) { owner = o; }
}

/// The manager pays for everybody's automatic execution, so the things worth
/// pinning are who may spend that stake and what the manager can never touch.
contract SequenceSubscriptionManagerTest is Test {
    SequenceSubscriptionManager manager;
    address constant OPERATOR = address(0x0FE9A701);
    address constant ALICE = address(0xA11CE);
    address constant MALLORY = address(0xBAD);
    bytes32 constant MARKET = keccak256("market");

    FakeVault aliceVault;

    function setUp() public {
        manager = new SequenceSubscriptionManager{value: 35 ether}(OPERATOR);
        aliceVault = new FakeVault(ALICE);
    }

    function test_the_stake_lives_on_the_manager_not_the_user() public view {
        assertEq(address(manager).balance, 35 ether, "Sequence carries the stake");
        assertEq(ALICE.balance, 0, "a trader stakes nothing");
    }

    function test_a_stranger_cannot_register_somebody_elses_vault() public {
        vm.prank(MALLORY);
        vm.expectRevert(
            abi.encodeWithSelector(SequenceSubscriptionManager.NotVaultOwner.selector, address(aliceVault), MALLORY)
        );
        manager.register(address(aliceVault), MARKET);
    }

    function test_registering_the_zero_address_is_refused() public {
        vm.prank(ALICE);
        vm.expectRevert(SequenceSubscriptionManager.ZeroVault.selector);
        manager.register(address(0), MARKET);
    }

    function test_only_the_operator_may_reclaim_the_stake() public {
        vm.prank(MALLORY);
        vm.expectRevert(SequenceSubscriptionManager.NotOperator.selector);
        manager.withdraw(payable(MALLORY), 1 ether);
    }

    function test_the_operator_can_reclaim_what_it_put_up() public {
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

    /// The manager has no token surface at all: there is no function on it that
    /// could move a user's collateral, which is the property that makes shared
    /// funding safe rather than merely convenient.
    function test_the_manager_holds_no_authority_over_user_funds() public view {
        assertEq(manager.operator(), OPERATOR);
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
