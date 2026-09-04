// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceVault} from "../src/SequenceVault.sol";
import {Verified} from "../src/Verified.sol";

/// A market that reports its own resolution, the way BinaryMarket does.
contract SyncMarket {
    bool public isResolved;
    bool public isVoided;
    uint256[] internal _payouts;

    function resolve(uint256[] memory payouts) external { _payouts = payouts; isResolved = true; }
    function voidIt() external { isVoided = true; }
    function payoutNumerators() external view returns (uint256[] memory) { return _payouts; }
    function settlementWindow() external pure returns (uint64) { return 300; }
    function expiry() external pure returns (uint64) { return 0; }
}

contract SyncModule {
    mapping(bytes32 => uint256) public qid;
    mapping(bytes32 => address) public marketOf;
    function set(bytes32 m, uint256 q, address mkt) external { qid[m] = q; marketOf[m] = mkt; }
    function markets(bytes32 m) external view
      returns (uint256,uint8,uint8,address,uint32,bytes32,address,address,address,address,uint256,uint256,uint64,uint64){
        return (qid[m],2,0,address(0),0,bytes32(0),address(0),address(0),marketOf[m],address(0),0,0,0,0);
    }
}

contract SyncPool {
    uint256 public calls; uint8 public lastKind;
    function placeBinaryOrder(uint8 k,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64)
        external payable returns (bool,uint128) { calls++; lastKind = k; return (true, uint128(calls)); }
}
contract SyncERC20 { function approve(address,uint256) external pure returns (bool){ return true; } }

/// Reactivity is the primary path, but a delivery can be missed: we watched
/// OracleHub emit AnswerDelivered, the market finalize on chain, and the
/// subscription never invoke the vault, leaving the step ARMED for ever.
/// These describe the backstop that stops a sequence dying silently.
contract SequenceSyncTest is Test {
    SequenceVault vault; SyncModule module; SyncPool pool; SyncERC20 usdc; SyncMarket market;
    address constant PRECOMPILE = address(0x0100);
    address constant HUB = 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b;
    address constant STRANGER = address(0xCAFE);

    uint8 constant BUY_YES = 0;
    uint8 constant BUY_NO  = 2;
    uint8 constant STOP    = 255;

    bytes32 constant M = keccak256("market");
    bytes32 constant SID = keccak256("step");
    uint256 constant Q = 4242;

    function setUp() public {
        module = new SyncModule(); pool = new SyncPool(); usdc = new SyncERC20(); market = new SyncMarket();
        vault = new SequenceVault(address(this), address(module), address(usdc), 1_000_000_000);
        module.set(M, Q, address(market));
    }

    function _arm(uint8 on0, uint8 on1) internal {
        SequenceVault.Step memory s;
        s.triggerMarketId = M; s.pool = address(pool);
        s.price = 100000; s.quantity = 5_000000; s.notionalCap = 1_000000;
        s.expireNs = uint64(block.timestamp + 3600) * 1e9;
        s.orderType = 2; s.actionOnWin0 = on0; s.actionOnWin1 = on1;
        s.successorMarketId = keccak256("successor");
        vault.armStep(SID, s);
    }
    function _up() internal pure returns (uint256[] memory n) { n = new uint256[](2); n[0] = 1; n[1] = 0; }
    function _down() internal pure returns (uint256[] memory n) { n = new uint256[](2); n[0] = 0; n[1] = 1; }

    function _topics() internal pure returns (bytes32[] memory t) {
        t = new bytes32[](3); t[0] = Verified.ANSWER_DELIVERED_TOPIC0; t[1] = bytes32(Q); t[2] = M;
    }

    // ---- the stuck case ------------------------------------------------------

    function test_a_step_stays_armed_when_no_delivery_arrives() public {
        _arm(BUY_YES, BUY_NO);
        market.resolve(_up());                       // the market resolved on chain
        assertEq(uint256(vault.stepStatus(SID)), uint256(SequenceVault.Status.ARMED));
        assertEq(pool.calls(), 0);                   // and nothing happened, which is the bug
    }

    function test_anyone_can_sync_a_missed_resolution() public {
        _arm(BUY_YES, BUY_NO);
        market.resolve(_up());

        vm.prank(STRANGER);                          // permissionless on purpose
        vault.syncResolution(M);

        assertEq(uint256(vault.stepStatus(SID)), uint256(SequenceVault.Status.PLACED));
        assertEq(pool.calls(), 1);
        assertEq(pool.lastKind(), BUY_YES);
        assertEq(vault.outstandingNotional(), 500000);
    }

    function test_sync_reads_the_outcome_from_chain_not_the_caller() public {
        _arm(BUY_YES, BUY_NO);
        market.resolve(_down());                     // outcome 1 won

        vm.prank(STRANGER);
        vault.syncResolution(M);                     // caller supplies only a market id

        assertEq(pool.lastKind(), BUY_NO);           // the chain decided, not the caller
    }

    function test_sync_refuses_a_market_that_has_not_resolved() public {
        _arm(BUY_YES, BUY_NO);
        vm.expectRevert(abi.encodeWithSelector(SequenceVault.NotResolvedYet.selector, M));
        vault.syncResolution(M);
    }

    function test_sync_refuses_an_unknown_market() public {
        bytes32 nowhere = keccak256("nowhere");
        vm.expectRevert(abi.encodeWithSelector(SequenceVault.UnknownMarket.selector, nowhere));
        vault.syncResolution(nowhere);
    }

    // ---- it must not become a second way to double-fire ----------------------

    function test_a_later_delivery_cannot_fire_a_synced_step_again() public {
        _arm(BUY_YES, BUY_NO);
        market.resolve(_up());
        vault.syncResolution(M);
        assertEq(pool.calls(), 1);

        // Reactivity finally delivers the event it owed us.
        vm.prank(PRECOMPILE);
        vault.onEvent(HUB, _topics(), abi.encode(uint32(1), _up(), false));
        assertEq(pool.calls(), 1);                   // still one order, not two
    }

    function test_a_sync_after_a_delivery_changes_nothing() public {
        _arm(BUY_YES, BUY_NO);
        market.resolve(_up());
        vm.prank(PRECOMPILE);
        vault.onEvent(HUB, _topics(), abi.encode(uint32(1), _up(), false));
        assertEq(pool.calls(), 1);

        vault.syncResolution(M);
        assertEq(pool.calls(), 1);
    }

    function test_sync_cannot_be_replayed() public {
        _arm(BUY_YES, BUY_NO);
        market.resolve(_up());
        vault.syncResolution(M);
        vault.syncResolution(M);
        assertEq(pool.calls(), 1);
    }

    // ---- a queued step must not lose its own resolution ----------------------

    /// The race: a queued step's market resolves BEFORE the link ahead of it
    /// arms it. If that resolution were consumed while nothing was listening,
    /// the step would activate onto a market whose one resolution had already
    /// been spent and would wait for ever.
    function test_a_resolution_nobody_is_listening_for_is_not_consumed() public {
        bytes32 second = keccak256("second");
        bytes32 m2 = keccak256("market2");
        SyncMarket market2 = new SyncMarket();
        module.set(m2, 777, address(market2));

        SequenceVault.Step memory b;
        b.triggerMarketId = m2; b.pool = address(pool);
        b.price = 100000; b.quantity = 5_000000; b.notionalCap = 1_000000;
        b.expireNs = uint64(block.timestamp + 3600) * 1e9;
        b.orderType = 2; b.actionOnWin0 = BUY_YES; b.actionOnWin1 = BUY_NO;
        b.successorMarketId = keccak256("successor2");
        vault.queueStep(second, b);

        SequenceVault.Step memory a;
        a.triggerMarketId = M; a.pool = address(pool);
        a.price = 100000; a.quantity = 5_000000; a.notionalCap = 1_000000;
        a.expireNs = uint64(block.timestamp + 3600) * 1e9;
        a.orderType = 2; a.actionOnWin0 = BUY_YES; a.actionOnWin1 = BUY_NO;
        a.successorMarketId = keccak256("successor");
        a.nextStepId = second;
        vault.armStep(SID, a);

        // The queued step's market resolves early, while it is still PENDING.
        market2.resolve(_up());
        vm.prank(PRECOMPILE);
        bytes32[] memory t2 = new bytes32[](3);
        t2[0] = Verified.ANSWER_DELIVERED_TOPIC0; t2[1] = bytes32(uint256(777)); t2[2] = m2;
        vault.onEvent(HUB, t2, abi.encode(uint32(1), _up(), false));

        assertEq(uint256(vault.stepStatus(second)), uint256(SequenceVault.Status.PENDING));
        assertEq(pool.calls(), 0);
        // Crucially, that resolution was NOT spent.
        assertEq(vault.consumed(keccak256(abi.encodePacked(m2, uint256(777)))), false);

        // The first step now places and advances the chain.
        market.resolve(_up());
        vault.syncResolution(M);
        assertEq(uint256(vault.stepStatus(second)), uint256(SequenceVault.Status.ARMED));

        // The queued step can still act on the resolution that already happened.
        vault.syncResolution(m2);
        assertEq(uint256(vault.stepStatus(second)), uint256(SequenceVault.Status.PLACED));
        assertEq(pool.calls(), 2);
    }

    function test_syncing_an_already_resolved_market_acts_exactly_once() public {
        _arm(BUY_YES, BUY_NO);
        market.resolve(_up());
        vault.syncResolution(M);
        vault.syncResolution(M);
        vault.syncResolution(M);
        assertEq(pool.calls(), 1);
    }

    function test_a_late_delivery_after_a_sync_cannot_double_fire() public {
        _arm(BUY_YES, BUY_NO);
        market.resolve(_up());
        vault.syncResolution(M);

        vm.prank(PRECOMPILE);
        vault.onEvent(HUB, _topics(), abi.encode(uint32(1), _up(), false));
        assertEq(pool.calls(), 1);
        assertEq(uint256(vault.stepStatus(SID)), uint256(SequenceVault.Status.PLACED));
    }

    function test_a_delivery_before_arming_does_not_burn_the_resolution() public {
        // Nothing armed yet at all.
        market.resolve(_up());
        vm.prank(PRECOMPILE);
        vault.onEvent(HUB, _topics(), abi.encode(uint32(1), _up(), false));
        assertEq(vault.consumed(keccak256(abi.encodePacked(M, Q))), false);

        _arm(BUY_YES, BUY_NO);
        vault.syncResolution(M);
        assertEq(uint256(vault.stepStatus(SID)), uint256(SequenceVault.Status.PLACED));
    }

    // ---- it obeys every rule the reactive path obeys -------------------------

    function test_sync_honours_a_stop_branch() public {
        _arm(BUY_YES, STOP);
        market.resolve(_down());                     // outcome 1 -> STOP
        vault.syncResolution(M);
        assertEq(uint256(vault.stepStatus(SID)), uint256(SequenceVault.Status.SKIPPED));
        assertEq(pool.calls(), 0);
    }

    function test_sync_honours_the_vault_cap() public {
        vault.setMaxOutstanding(400000);                // below the 500 notional
        _arm(BUY_YES, BUY_NO);
        market.resolve(_up());
        vault.syncResolution(M);
        assertEq(uint256(vault.stepStatus(SID)), uint256(SequenceVault.Status.SKIPPED));
        assertEq(pool.calls(), 0);
    }

    function test_sync_honours_pause() public {
        _arm(BUY_YES, BUY_NO);
        market.resolve(_up());
        vault.setPaused(true);
        vm.expectRevert(SequenceVault.Paused.selector);
        vault.syncResolution(M);
    }

    function test_sync_handles_a_voided_market() public {
        _arm(BUY_YES, BUY_NO);
        market.voidIt();
        vault.syncResolution(M);
        assertEq(uint256(vault.stepStatus(SID)), uint256(SequenceVault.Status.SKIPPED));
        assertEq(pool.calls(), 0);
    }

    function test_sync_advances_a_chain_exactly_like_a_delivery() public {
        bytes32 second = keccak256("second");
        bytes32 m2 = keccak256("market2");
        SyncMarket market2 = new SyncMarket();
        module.set(m2, 777, address(market2));

        SequenceVault.Step memory b;
        b.triggerMarketId = m2; b.pool = address(pool);
        b.price = 100000; b.quantity = 5_000000; b.notionalCap = 1_000000;
        b.expireNs = uint64(block.timestamp + 3600) * 1e9;
        b.orderType = 2; b.actionOnWin0 = BUY_YES; b.actionOnWin1 = BUY_NO;
        b.successorMarketId = keccak256("successor2");
        vault.queueStep(second, b);

        SequenceVault.Step memory a;
        a.triggerMarketId = M; a.pool = address(pool);
        a.price = 100000; a.quantity = 5_000000; a.notionalCap = 1_000000;
        a.expireNs = uint64(block.timestamp + 3600) * 1e9;
        a.orderType = 2; a.actionOnWin0 = BUY_YES; a.actionOnWin1 = BUY_NO;
        a.successorMarketId = keccak256("successor");
        a.nextStepId = second;
        vault.armStep(SID, a);

        market.resolve(_up());
        vault.syncResolution(M);

        assertEq(uint256(vault.stepStatus(SID)), uint256(SequenceVault.Status.PLACED));
        assertEq(uint256(vault.stepStatus(second)), uint256(SequenceVault.Status.ARMED));
    }

    function test_sync_releases_exposure_for_a_settled_successor() public {
        _arm(BUY_YES, BUY_NO);
        market.resolve(_up());
        vault.syncResolution(M);
        assertEq(vault.outstandingNotional(), 500000);

        // The market the order went into now settles; syncing it frees the room.
        bytes32 succ = keccak256("successor");
        SyncMarket successorMarket = new SyncMarket();
        module.set(succ, 999, address(successorMarket));
        successorMarket.resolve(_up());
        vault.syncResolution(succ);

        assertEq(vault.outstandingNotional(), 0);
    }
}
