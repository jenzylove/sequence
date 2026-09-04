// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceVaultFactory} from "../src/SequenceVaultFactory.sol";
import {SequenceVault} from "../src/SequenceVault.sol";

contract FactoryModule {
    function markets(bytes32) external pure
      returns (uint256,uint8,uint8,address,uint32,bytes32,address,address,address,address,uint256,uint256,uint64,uint64){
        return (0,2,0,address(0),0,bytes32(0),address(0),address(0),address(0),address(0),0,0,0,0);
    }
}
contract FactoryERC20 { function approve(address,uint256) external pure returns (bool){ return true; } }

/// The product was single-tenant: every visitor read one vault they did not own.
/// These tests describe what "each wallet has its own account" must mean.
contract SequenceVaultFactoryTest is Test {
    SequenceVaultFactory factory;
    FactoryModule module;
    FactoryERC20 usdc;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        module = new FactoryModule();
        usdc = new FactoryERC20();
        factory = new SequenceVaultFactory(address(module), address(usdc), 5_000_000);
    }

    function test_a_new_wallet_has_no_vault_until_it_asks() public view {
        assertEq(factory.vaultFor(alice), address(0));
        assertFalse(factory.hasVault(alice));
    }

    function test_each_wallet_gets_its_own_vault_that_it_owns() public {
        vm.prank(alice);
        address aliceVault = factory.createVault();
        vm.prank(bob);
        address bobVault = factory.createVault();

        assertTrue(aliceVault != bobVault);
        assertEq(SequenceVault(payable(aliceVault)).owner(), alice);
        assertEq(SequenceVault(payable(bobVault)).owner(), bob);
        assertEq(factory.vaultFor(alice), aliceVault);
        assertEq(factory.vaultFor(bob), bobVault);
        assertEq(factory.vaultCount(), 2);
    }

    function test_the_factory_has_no_power_over_the_vaults_it_deploys() public {
        vm.prank(alice);
        address aliceVault = factory.createVault();

        // The factory is not the owner, so its calls are rejected like anyone's.
        vm.prank(address(factory));
        vm.expectRevert(SequenceVault.NotOwner.selector);
        SequenceVault(payable(aliceVault)).setPaused(true);
    }

    function test_one_wallet_cannot_strand_its_own_vault_by_reprovisioning() public {
        vm.prank(alice);
        address first = factory.createVault();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SequenceVaultFactory.AlreadyProvisioned.selector, first));
        factory.createVault();
    }

    function test_a_wallet_cannot_touch_another_wallets_vault() public {
        vm.prank(alice);
        address aliceVault = factory.createVault();

        vm.prank(bob);
        vm.expectRevert(SequenceVault.NotOwner.selector);
        SequenceVault(payable(aliceVault)).setPaused(true);
    }

    function test_vaults_carry_the_shared_configuration() public {
        vm.prank(alice);
        SequenceVault v = SequenceVault(payable(factory.createVault()));
        assertEq(address(v.module()), address(module));
        assertEq(address(v.collateral()), address(usdc));
        assertEq(v.maxOutstandingNotional(), 5_000_000);
    }

    function test_a_caller_may_choose_its_own_limit() public {
        vm.prank(alice);
        SequenceVault v = SequenceVault(payable(factory.createVault(1_234_567)));
        assertEq(v.maxOutstandingNotional(), 1_234_567);
    }
}
