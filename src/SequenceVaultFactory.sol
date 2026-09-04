// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SequenceVault} from "./SequenceVault.sol";

/// @title SequenceVaultFactory
/// @notice One trading account per wallet.
///
/// Without this the product is single-tenant: every visitor reads the same
/// vault, sees an owner that is not them, and can do nothing. The factory gives
/// each wallet its own SequenceVault, owned by that wallet, and records it so
/// the interface can resolve "your account" from the connected address alone.
///
/// The factory holds no funds and has no privileges over the vaults it deploys.
/// It cannot arm, pause, or withdraw; it only creates and remembers.
contract SequenceVaultFactory {
    error AlreadyProvisioned(address vault);
    error NoVault(address owner);

    /// Shared configuration every vault is deployed with, fixed at construction
    /// so no caller can point their vault at a different module or collateral.
    address public immutable module;
    address public immutable collateral;
    uint256 public immutable defaultMaxOutstanding;

    mapping(address => address) public vaultOf;
    address[] public allVaults;

    event VaultCreated(address indexed owner, address indexed vault, uint256 maxOutstanding);

    constructor(address module_, address collateral_, uint256 defaultMaxOutstanding_) {
        module = module_;
        collateral = collateral_;
        defaultMaxOutstanding = defaultMaxOutstanding_;
    }

    /// Deploy the caller's vault. One per wallet: a second call reverts rather
    /// than silently orphaning the first, which would strand any funds in it.
    function createVault(uint256 maxOutstanding) public returns (address vault) {
        address existing = vaultOf[msg.sender];
        if (existing != address(0)) revert AlreadyProvisioned(existing);

        vault = address(new SequenceVault(
            msg.sender,
            module,
            collateral,
            maxOutstanding == 0 ? defaultMaxOutstanding : maxOutstanding
        ));

        vaultOf[msg.sender] = vault;
        allVaults.push(vault);
        emit VaultCreated(msg.sender, vault, maxOutstanding == 0 ? defaultMaxOutstanding : maxOutstanding);
    }

    /// Convenience for the common path.
    function createVault() external returns (address) {
        return createVault(0);
    }

    /// The caller's vault, or the zero address if they have not provisioned one.
    /// The interface uses this to decide between "your account" and "get set up".
    function vaultFor(address owner_) external view returns (address) {
        return vaultOf[owner_];
    }

    function hasVault(address owner_) external view returns (bool) {
        return vaultOf[owner_] != address(0);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
