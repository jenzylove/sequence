// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {Verified} from "./Verified.sol";

interface ISequenceVaultFactoryRegistry {
    function vaultOf(address owner) external view returns (address);
}

interface ISequenceVaultView {
    function owner() external view returns (address);
    function stepForMarket(bytes32 marketId) external view returns (bytes32);
    function steps(bytes32 stepId) external view returns (
        uint8 status,
        bytes32 triggerMarketId,
        address pool,
        uint256 price,
        uint256 quantity,
        uint64 expireNs,
        uint8 orderType,
        uint8 actionOnWin0,
        uint8 actionOnWin1,
        uint256 notionalCap,
        bytes32 successorMarketId,
        bytes32 nextStepId,
        uint128 orderId,
        uint8 winningOutcome
    );
}

/// Who pays for Reactivity.
///
/// Somnia charges the subscription *owner*, and separately lets that owner name
/// any contract as the *handler*. Sequence owns the subscriptions and stake;
/// each trader's factory-created vault remains the handler and the only contract
/// that can touch that trader's collateral.
///
/// Registration is deliberately strict because the shared stake is project
/// infrastructure. A caller may only spend it for their own vault from the
/// canonical factory, and only for markets already stored in that vault's real
/// armed/queued chain. The manager walks the chain once at activation and creates
/// exact-market subscriptions for every link, so later steps remain automatic
/// after the first one advances.
contract SequenceSubscriptionManager {
    uint8 internal constant STATUS_ARMED = 1;
    uint8 internal constant STATUS_WAITING = 2;
    uint8 internal constant STATUS_PENDING = 8;

    uint256 public constant MAX_CHAIN_STEPS = 4;
    uint256 public constant MAX_LIVE_PER_VAULT = 16;

    address public immutable operator;
    ISequenceVaultFactoryRegistry public immutable factory;

    /// keccak(vault, marketId) -> subscription id.
    mapping(bytes32 => uint256) public subscriptionOf;
    uint256 public liveSubscriptions;
    mapping(address => uint256) public liveSubscriptionsByVault;

    event Registered(address indexed vault, bytes32 indexed marketId, uint256 subscriptionId);
    event Unregistered(address indexed vault, bytes32 indexed marketId, uint256 subscriptionId);
    event Funded(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    error NotOperator();
    error NotVaultOwner(address vault, address caller);
    error NotFactoryVault(address vault, address caller);
    error AlreadyRegistered(address vault, bytes32 marketId);
    error NotRegistered(address vault, bytes32 marketId);
    error UnknownStep(address vault, bytes32 marketId);
    error InvalidStepState(bytes32 stepId, uint8 status);
    error TriggerMismatch(bytes32 expected, bytes32 stored);
    error ChainTooLong();
    error VaultSubscriptionCap(uint256 requested, uint256 maximum);
    error StakeTooLow(uint256 balance, uint256 minimum);
    error ZeroVault();
    error ZeroFactory();

    constructor(address operator_, address factory_) payable {
        if (factory_ == address(0)) revert ZeroFactory();
        operator = operator_ == address(0) ? msg.sender : operator_;
        factory = ISequenceVaultFactoryRegistry(factory_);
    }

    receive() external payable { emit Funded(msg.sender, msg.value); }

    function _key(address vault, bytes32 marketId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(vault, marketId));
    }

    function _assertCanonicalVault(address vault, address caller) internal view {
        if (vault == address(0)) revert ZeroVault();
        address canonical = factory.vaultOf(caller);
        if (canonical != vault) revert NotFactoryVault(vault, caller);
        if (ISequenceVaultView(vault).owner() != caller) revert NotVaultOwner(vault, caller);
    }

    function _stepMeta(address vault, bytes32 stepId)
        internal view returns (uint8 status, bytes32 triggerMarketId, bytes32 nextStepId)
    {
        (
            status,
            triggerMarketId,
            ,,,,,,,,
            ,
            nextStepId,
            ,
        ) = ISequenceVaultView(vault).steps(stepId);
    }

    /// Return the exact markets this activation is allowed to spend shared
    /// Reactivity on. Useful to the UI/tests and, more importantly, the same
    /// validation path used by register().
    function registrationMarkets(address vault, bytes32 firstMarketId)
        external view returns (bytes32[] memory markets)
    {
        _assertCanonicalVault(vault, msg.sender);
        return _registrationMarkets(vault, firstMarketId);
    }

    function _registrationMarkets(address vault, bytes32 firstMarketId)
        internal view returns (bytes32[] memory markets)
    {
        bytes32 stepId = ISequenceVaultView(vault).stepForMarket(firstMarketId);
        if (stepId == bytes32(0)) revert UnknownStep(vault, firstMarketId);

        bytes32[] memory tmp = new bytes32[](MAX_CHAIN_STEPS);
        uint256 count;

        while (stepId != bytes32(0) && count < MAX_CHAIN_STEPS) {
            (uint8 status, bytes32 triggerMarketId, bytes32 nextStepId) = _stepMeta(vault, stepId);
            bool valid = count == 0
                ? (status == STATUS_ARMED || status == STATUS_WAITING)
                : (status == STATUS_PENDING || status == STATUS_ARMED || status == STATUS_WAITING);
            if (!valid) revert InvalidStepState(stepId, status);
            if (triggerMarketId == bytes32(0)) revert UnknownStep(vault, triggerMarketId);
            if (count == 0 && triggerMarketId != firstMarketId) {
                revert TriggerMismatch(firstMarketId, triggerMarketId);
            }

            tmp[count] = triggerMarketId;
            unchecked { count += 1; }
            stepId = nextStepId;
        }

        if (stepId != bytes32(0)) revert ChainTooLong();

        markets = new bytes32[](count);
        for (uint256 i; i < count; ++i) markets[i] = tmp[i];
    }

    /// Point Reactivity at this user's vault for every market already stored in
    /// the real sequence chain. All subscriptions are created atomically: either
    /// the whole chain is automatic, or none of the new subscriptions persist.
    function register(address vault, bytes32 firstMarketId) external returns (uint256 firstSubscriptionId) {
        _assertCanonicalVault(vault, msg.sender);
        bytes32[] memory markets = _registrationMarkets(vault, firstMarketId);

        uint256 newCount;
        for (uint256 i; i < markets.length; ++i) {
            if (subscriptionOf[_key(vault, markets[i])] == 0) unchecked { newCount += 1; }
        }
        uint256 requested = liveSubscriptionsByVault[vault] + newCount;
        if (requested > MAX_LIVE_PER_VAULT) revert VaultSubscriptionCap(requested, MAX_LIVE_PER_VAULT);

        uint256 minimum = SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE;
        if (address(this).balance < minimum) revert StakeTooLow(address(this).balance, minimum);

        for (uint256 i; i < markets.length; ++i) {
            bytes32 marketId = markets[i];
            bytes32 k = _key(vault, marketId);
            uint256 existing = subscriptionOf[k];
            if (existing != 0) {
                if (i == 0) firstSubscriptionId = existing;
                continue;
            }

            bytes32[4] memory topics;
            topics[0] = Verified.ANSWER_DELIVERED_TOPIC0;
            topics[2] = marketId;

            uint256 subscriptionId = SomniaExtensions.subscribe(
                vault,
                SomniaExtensions.SubscriptionFilter({
                    eventTopics: topics, origin: address(0), emitter: Verified.ORACLE_HUB
                }),
                SomniaExtensions.SubscriptionOptions({
                    priorityFeePerGas: 1 gwei, maxFeePerGas: 40 gwei, gasLimit: 10_000_000
                })
            );

            subscriptionOf[k] = subscriptionId;
            unchecked {
                liveSubscriptions += 1;
                liveSubscriptionsByVault[vault] += 1;
            }
            if (i == 0) firstSubscriptionId = subscriptionId;
            emit Registered(vault, marketId, subscriptionId);
        }
    }

    function unregister(address vault, bytes32 marketId) external {
        bytes32 k = _key(vault, marketId);
        uint256 id = subscriptionOf[k];
        if (id == 0) revert NotRegistered(vault, marketId);

        if (msg.sender != operator) _assertCanonicalVault(vault, msg.sender);

        delete subscriptionOf[k];
        unchecked {
            liveSubscriptions -= 1;
            liveSubscriptionsByVault[vault] -= 1;
        }
        SomniaExtensions.unsubscribe(id);
        emit Unregistered(vault, marketId, id);
    }

    /// Reclaim unused native STT. While live subscriptions exist, the manager
    /// refuses to be withdrawn below Somnia's owner minimum so the operator
    /// cannot accidentally switch automatic execution off for everybody.
    function withdraw(address payable to, uint256 amount) external {
        if (msg.sender != operator) revert NotOperator();
        uint256 afterBalance = address(this).balance - amount;
        uint256 minimum = SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE;
        if (liveSubscriptions != 0 && afterBalance < minimum) revert StakeTooLow(afterBalance, minimum);
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
        emit Withdrawn(to, amount);
    }

    function isRegistered(address vault, bytes32 marketId) external view returns (bool) {
        return subscriptionOf[_key(vault, marketId)] != 0;
    }

    function stake() external view returns (uint256) { return address(this).balance; }
}
