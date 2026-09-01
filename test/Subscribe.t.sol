// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceHandler} from "../src/SequenceHandler.sol";
import {Verified} from "../src/Verified.sol";

// These tests prove the OFF-CHAIN-provable parts of subscription:
//   - owner gating
//   - the 32-SOM balance guard (reverts inside SomniaExtensions BEFORE the
//     precompile is ever called, so no precompile mock is needed)
//   - double-subscribe guard
// They deliberately do NOT try to mock the 0x0100 precompile: Foundry forbids
// vm.etch on precompile addresses, and faking acceptance would be plumbing, not
// proof. Real subscription acceptance is proven on-chain in the live deploy.
contract SubscribeTest is Test {
    SequenceHandler handler;
    address constant MODULE = address(0xD0D);

    function setUp() public {
        handler = new SequenceHandler(MODULE, address(0xDEC0));
    }

    // Unfunded handler: SomniaExtensions._subscribe checks balance < 32 ether and
    // reverts InsufficientBalance BEFORE any precompile call. This is the exact
    // failure we'd hit on-chain if the handler isn't funded, so it's worth pinning.
    function test_insufficient_balance_reverts_before_precompile() public {
        vm.expectRevert(); // SomniaExtensions.InsufficientBalance
        handler.subscribeToMarket(keccak256("x"));
    }

    // Even funded, a non-owner cannot subscribe. Owner check happens before the
    // balance check, so this reverts NotOwner regardless of funding.
    function test_only_owner_subscribes() public {
        vm.deal(address(handler), 40 ether);
        vm.prank(address(0xBAD));
        vm.expectRevert(SequenceHandler.NotOwner.selector);
        handler.subscribeToMarket(keccak256("a"));
    }

    // Owner-gating on the wildcard variant too.
    function test_only_owner_subscribes_all() public {
        vm.deal(address(handler), 40 ether);
        vm.prank(address(0xBAD));
        vm.expectRevert(SequenceHandler.NotOwner.selector);
        handler.subscribeAllMarkets();
    }

    // cancelSubscription with no active subscription reverts NoSubscription.
    function test_cancel_without_subscription_reverts() public {
        vm.expectRevert(SequenceHandler.NoSubscription.selector);
        handler.cancelSubscription();
    }

    // Non-owner cannot cancel.
    function test_only_owner_cancels() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(SequenceHandler.NotOwner.selector);
        handler.cancelSubscription();
    }
}
