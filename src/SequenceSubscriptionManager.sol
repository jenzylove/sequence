// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {Verified} from "./Verified.sol";

interface IOwned {
    function owner() external view returns (address);
}

/// Who pays for Reactivity.
///
/// Somnia charges the subscription *owner*, and separately lets that owner name
/// any contract as the *handler*. Those being different fields is the whole
/// point: one funded owner can drive many handlers.
///
/// Before this, every trader had to put up 32 STT of their own before a sequence
/// would run by itself. On a testnet where a faucet hands out a fraction of that,
/// the honest reading is that automatic execution was not actually available to
/// anyone but us — which makes "it runs while you sleep" a claim the product
/// could not keep. Sequence pays for delivery instead, once, and every user's
/// vault is a handler on a subscription this contract owns.
///
/// What this contract deliberately does not do: hold, move, or have any authority
/// over a user's trading collateral. It owns subscriptions and native STT for the
/// stake, nothing else. A vault's `onlyOwner` surface is untouched by it, and a
/// subscription firing can only drive the vault's existing state machine, which
/// reads outcomes from the market itself.
contract SequenceSubscriptionManager {
    /// The account that funds the stake and can reclaim it. It has no power over
    /// any user's vault or funds.
    address public immutable operator;

    /// keccak(vault, marketId) -> subscription id.
    mapping(bytes32 => uint256) public subscriptionOf;
    /// How many live subscriptions this owner is carrying, for cleanup and for
    /// answering "how far does one stake stretch" with a number rather than a
    /// guess.
    uint256 public liveSubscriptions;

    event Registered(address indexed vault, bytes32 indexed marketId, uint256 subscriptionId);
    event Unregistered(address indexed vault, bytes32 indexed marketId, uint256 subscriptionId);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error NotOperator();
    error NotVaultOwner(address vault, address caller);
    error AlreadyRegistered(address vault, bytes32 marketId);
    error NotRegistered(address vault, bytes32 marketId);
    error StakeTooLow(uint256 balance, uint256 minimum);
    error ZeroVault();

    constructor(address operator_) payable {
        operator = operator_ == address(0) ? msg.sender : operator_;
    }

    receive() external payable { emit Funded(msg.sender, msg.value); }

    function _key(address vault, bytes32 marketId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(vault, marketId));
    }

    /// Point Reactivity at one vault for one market.
    ///
    /// Only the vault's own owner may do this, so nobody can attach a
    /// subscription to somebody else's account or spend the shared stake on a
    /// vault they do not control.
    ///
    /// The filter names the exact market, so a settlement only wakes the vaults
    /// that actually care about it. A wildcard would invoke every registered
    /// vault on every settlement, which costs the shared stake more and gives
    /// each vault work it will only discard.
    function register(address vault, bytes32 marketId) external returns (uint256 subscriptionId) {
        if (vault == address(0)) revert ZeroVault();
        if (IOwned(vault).owner() != msg.sender) revert NotVaultOwner(vault, msg.sender);

        bytes32 k = _key(vault, marketId);
        if (subscriptionOf[k] != 0) revert AlreadyRegistered(vault, marketId);

        uint256 minimum = SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE;
        if (address(this).balance < minimum) revert StakeTooLow(address(this).balance, minimum);

        bytes32[4] memory topics;
        topics[0] = Verified.ANSWER_DELIVERED_TOPIC0;
        topics[2] = marketId;                     // exact market; topic 1 is the question id

        subscriptionId = SomniaExtensions.subscribe(
            vault,
            SomniaExtensions.SubscriptionFilter({
                eventTopics: topics, origin: address(0), emitter: Verified.ORACLE_HUB
            }),
            SomniaExtensions.SubscriptionOptions({
                priorityFeePerGas: 1 gwei, maxFeePerGas: 40 gwei, gasLimit: 10_000_000
            })
        );

        subscriptionOf[k] = subscriptionId;
        unchecked { liveSubscriptions += 1; }
        emit Registered(vault, marketId, subscriptionId);
    }

    /// Release a subscription once its market is done with.
    ///
    /// The vault's owner can always clean up their own, and the operator can
    /// clean up anything — it is paying for all of them, and a subscription for a
    /// market that settled last week is pure cost.
    function unregister(address vault, bytes32 marketId) external {
        bytes32 k = _key(vault, marketId);
        uint256 id = subscriptionOf[k];
        if (id == 0) revert NotRegistered(vault, marketId);
        if (msg.sender != operator && IOwned(vault).owner() != msg.sender) {
            revert NotVaultOwner(vault, msg.sender);
        }
        delete subscriptionOf[k];
        unchecked { liveSubscriptions -= 1; }
        SomniaExtensions.unsubscribe(id);
        emit Unregistered(vault, marketId, id);
    }

    /// Reclaim stake. Only ever native STT this contract was funded with; there
    /// is no path here to anything a user owns.
    function withdraw(address payable to, uint256 amount) external {
        if (msg.sender != operator) revert NotOperator();
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(to, amount);
    }

    function isRegistered(address vault, bytes32 marketId) external view returns (bool) {
        return subscriptionOf[_key(vault, marketId)] != 0;
    }

    function stake() external view returns (uint256) { return address(this).balance; }
}
