// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceVault} from "../src/SequenceVault.sol";
import {Verified} from "../src/Verified.sol";

contract ChainModule {
    mapping(bytes32 => uint256) public qid;
    function setQid(bytes32 m, uint256 q) external { qid[m] = q; }
    function markets(bytes32 m) external view
      returns (uint256,uint8,uint8,address,uint32,bytes32,address,address,address,address,uint256,uint256,uint64,uint64){
        return (qid[m],2,0,address(0),0,bytes32(0),address(0),address(0),address(0),address(0),0,0,0,0);
    }
}

/// A pool that can refuse, so "the order was rejected" is actually testable.
contract ChainPool {
    uint256 public calls; uint8 public lastKind; bool public refuse;
    function setRefuse(bool r) external { refuse = r; }
    function placeBinaryOrder(uint8 k,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64)
        external payable returns (bool,uint128)
    {
        calls++; lastKind = k;
        if (refuse) return (false, 0);
        return (true, uint128(calls));
    }
}

contract ChainERC20 { function approve(address,uint256) external pure returns (bool){ return true; } }

/// Covers the three correctness bugs found in the product audit:
///   - a sequence must be conditional, not a set of triggers armed up front
///   - PLACED must not be claimed when the pool refused the order
///   - exposure must come back when the market traded into settles
contract SequenceChainTest is Test {
    SequenceVault vault; ChainModule module; ChainPool pool; ChainERC20 usdc;
    address constant PRECOMPILE = address(0x0100);
    address constant HUB = 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b;

    uint8 constant BUY_YES = 0;
    uint8 constant BUY_NO  = 2;
    uint8 constant STOP    = 255;

    function setUp() public {
        module = new ChainModule(); pool = new ChainPool(); usdc = new ChainERC20();
        vault = new SequenceVault(address(this), address(module), address(usdc), 1_000_000_000);
    }

    function _topics(uint256 q, bytes32 m) internal pure returns (bytes32[] memory t){
        t = new bytes32[](3); t[0] = Verified.ANSWER_DELIVERED_TOPIC0; t[1] = bytes32(q); t[2] = m;
    }
    function _up() internal pure returns (bytes memory){ uint256[] memory n = new uint256[](2); n[0]=1; n[1]=0; return abi.encode(uint32(1), n, false); }
    function _down() internal pure returns (bytes memory){ uint256[] memory n = new uint256[](2); n[0]=0; n[1]=1; return abi.encode(uint32(1), n, false); }
    function _fire(uint256 q, bytes32 m, bytes memory d) internal { vm.prank(PRECOMPILE); vault.onEvent(HUB, _topics(q, m), d); }

    function _succ(bytes32 m) internal pure returns (bytes32) { return keccak256(abi.encodePacked(m, "successor")); }

    function _mk(bytes32 market, uint8 on0, uint8 on1) internal view returns (SequenceVault.Step memory s) {
        s.triggerMarketId = market;
        s.pool = address(pool);
        s.price = 100; s.quantity = 5; s.notionalCap = 1000;
        s.expireNs = uint64(block.timestamp + 3600) * 1e9;
        s.orderType = 2;
        s.actionOnWin0 = on0; s.actionOnWin1 = on1;
        s.successorMarketId = _succ(market);
    }

    function _arm(bytes32 id, bytes32 market, uint8 on0, uint8 on1) internal {
        vault.armStep(id, _mk(market, on0, on1));
    }

    /// first -> second, where second only starts listening if first places.
    function _chain(bytes32 first, bytes32 second, bytes32 m1, bytes32 m2, uint8 on0, uint8 on1) internal {
        SequenceVault.Step memory a = _mk(m1, on0, on1);
        a.nextStepId = second;
        vault.queueStep(second, _mk(m2, BUY_YES, BUY_NO));
        vault.armStep(first, a);
    }

    // ---- truthful placement -------------------------------------------------

    function test_rejected_order_is_not_reported_as_placed() public {
        bytes32 sid = keccak256("r1"); bytes32 m = keccak256("mR1"); module.setQid(m, 21);
        _arm(sid, m, BUY_YES, BUY_NO);
        pool.setRefuse(true);
        _fire(21, m, _up());
        assertEq(uint256(vault.stepStatus(sid)), uint256(SequenceVault.Status.SKIPPED));
        assertEq(vault.outstandingNotional(), 0);
    }

    function test_accepted_order_is_placed() public {
        bytes32 sid = keccak256("r2"); bytes32 m = keccak256("mR2"); module.setQid(m, 22);
        _arm(sid, m, BUY_YES, BUY_NO);
        _fire(22, m, _up());
        assertEq(uint256(vault.stepStatus(sid)), uint256(SequenceVault.Status.PLACED));
        assertEq(vault.outstandingNotional(), 500);
    }

    // ---- exposure release ---------------------------------------------------

    function test_exposure_returns_when_the_successor_market_settles() public {
        bytes32 sid = keccak256("e1"); bytes32 m = keccak256("mE1"); module.setQid(m, 31);
        _arm(sid, m, BUY_YES, BUY_NO);
        _fire(31, m, _up());
        assertEq(vault.outstandingNotional(), 500);
        assertEq(vault.outstandingByMarket(_succ(m)), 500);

        module.setQid(_succ(m), 32);
        _fire(32, _succ(m), _up());
        assertEq(vault.outstandingNotional(), 0);
        assertEq(vault.outstandingByMarket(_succ(m)), 0);
    }

    function test_rolling_is_not_blocked_by_stale_exposure() public {
        vault.setMaxOutstanding(600); // room for one trade at a time

        bytes32 s1 = keccak256("e2a"); bytes32 m1 = keccak256("mE2a"); module.setQid(m1, 41);
        _arm(s1, m1, BUY_YES, BUY_NO);
        _fire(41, m1, _up());
        assertEq(vault.outstandingNotional(), 500);

        module.setQid(_succ(m1), 42);
        _fire(42, _succ(m1), _up()); // that position settles

        bytes32 s2 = keccak256("e2b"); bytes32 m2 = keccak256("mE2b"); module.setQid(m2, 43);
        _arm(s2, m2, BUY_YES, BUY_NO);
        _fire(43, m2, _up());
        assertEq(uint256(vault.stepStatus(s2)), uint256(SequenceVault.Status.PLACED));
        assertEq(pool.calls(), 2);
    }

    function test_owner_can_release_stuck_exposure() public {
        bytes32 sid = keccak256("e3"); bytes32 m = keccak256("mE3"); module.setQid(m, 51);
        _arm(sid, m, BUY_YES, BUY_NO);
        _fire(51, m, _up());
        vault.releaseExposure(_succ(m));
        assertEq(vault.outstandingNotional(), 0);
    }

    function test_release_requires_actual_exposure() public {
        vm.expectRevert(abi.encodeWithSelector(SequenceVault.NoExposure.selector, keccak256("nope")));
        vault.releaseExposure(keccak256("nope"));
    }

    // ---- conditional chaining ----------------------------------------------

    function test_a_queued_step_does_not_fire_on_its_own_market() public {
        bytes32 s1 = keccak256("c1a"); bytes32 s2 = keccak256("c1b");
        bytes32 m1 = keccak256("mC1a"); bytes32 m2 = keccak256("mC1b");
        module.setQid(m1, 61); module.setQid(m2, 62);
        _chain(s1, s2, m1, m2, BUY_YES, BUY_NO);

        assertEq(uint256(vault.stepStatus(s2)), uint256(SequenceVault.Status.PENDING));
        _fire(62, m2, _up());                 // the later market settles first
        assertEq(pool.calls(), 0);            // it must not trade
        assertEq(uint256(vault.stepStatus(s2)), uint256(SequenceVault.Status.PENDING));
    }

    function test_chain_advances_only_after_a_real_placement() public {
        bytes32 s1 = keccak256("c2a"); bytes32 s2 = keccak256("c2b");
        bytes32 m1 = keccak256("mC2a"); bytes32 m2 = keccak256("mC2b");
        module.setQid(m1, 63); module.setQid(m2, 64);
        _chain(s1, s2, m1, m2, BUY_YES, BUY_NO);

        _fire(63, m1, _up());
        assertEq(uint256(vault.stepStatus(s1)), uint256(SequenceVault.Status.PLACED));
        assertEq(uint256(vault.stepStatus(s2)), uint256(SequenceVault.Status.ARMED));
        assertEq(vault.stepForMarket(m2), s2);

        _fire(64, m2, _up());
        assertEq(pool.calls(), 2);
    }

    function test_a_stop_ends_the_chain() public {
        bytes32 s1 = keccak256("c3a"); bytes32 s2 = keccak256("c3b");
        bytes32 m1 = keccak256("mC3a"); bytes32 m2 = keccak256("mC3b");
        module.setQid(m1, 65); module.setQid(m2, 66);
        _chain(s1, s2, m1, m2, BUY_YES, STOP);

        _fire(65, m1, _down());               // outcome 1 -> STOP
        assertEq(uint256(vault.stepStatus(s1)), uint256(SequenceVault.Status.SKIPPED));
        assertEq(uint256(vault.stepStatus(s2)), uint256(SequenceVault.Status.PENDING));

        _fire(66, m2, _up());                 // the rest of the chain is dead
        assertEq(pool.calls(), 0);
    }

    function test_a_rejected_order_ends_the_chain() public {
        bytes32 s1 = keccak256("c4a"); bytes32 s2 = keccak256("c4b");
        bytes32 m1 = keccak256("mC4a"); bytes32 m2 = keccak256("mC4b");
        module.setQid(m1, 67); module.setQid(m2, 68);
        _chain(s1, s2, m1, m2, BUY_YES, BUY_NO);
        pool.setRefuse(true);

        _fire(67, m1, _up());
        assertEq(uint256(vault.stepStatus(s2)), uint256(SequenceVault.Status.PENDING));
    }

    function test_a_void_ends_the_chain() public {
        bytes32 s1 = keccak256("c5a"); bytes32 s2 = keccak256("c5b");
        bytes32 m1 = keccak256("mC5a"); bytes32 m2 = keccak256("mC5b");
        module.setQid(m1, 69); module.setQid(m2, 70);
        _chain(s1, s2, m1, m2, BUY_YES, BUY_NO);

        uint256[] memory n = new uint256[](2);
        vm.prank(PRECOMPILE);
        vault.onEvent(HUB, _topics(69, m1), abi.encode(uint32(2), n, true)); // voided
        assertEq(uint256(vault.stepStatus(s2)), uint256(SequenceVault.Status.PENDING));
    }

    function test_queueing_is_owner_only() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(SequenceVault.NotOwner.selector);
        vault.queueStep(keccak256("qx"), _mk(keccak256("mX"), BUY_YES, BUY_NO));
    }
}
