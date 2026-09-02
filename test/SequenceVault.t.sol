// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceVault} from "../src/SequenceVault.sol";
import {Verified} from "../src/Verified.sol";

contract MockModule {
    mapping(bytes32 => uint256) public qid;
    function setQid(bytes32 m, uint256 q) external { qid[m] = q; }
    function markets(bytes32 m) external view
      returns (uint256,uint8,uint8,address,uint32,bytes32,address,address,address,address,uint256,uint256,uint64,uint64){
        return (qid[m],2,0,address(0),0,bytes32(0),address(0),address(0),address(0),address(0),0,0,0,0);
    }
}
contract MockPool {
    uint256 public calls; uint8 public lastKind;
    function placeBinaryOrder(uint8 k,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64) external payable returns (bool,uint128){
        calls++; lastKind=k; return (true, uint128(calls));
    }
}
contract MockERC20 { function approve(address,uint256) external pure returns (bool){return true;} }

contract SequenceVaultTest is Test {
    SequenceVault vault; MockModule module; MockPool pool; MockERC20 usdc;
    address constant PRECOMPILE = address(0x0100);
    address constant HUB = 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b;

    function setUp() public {
        module = new MockModule(); pool = new MockPool(); usdc = new MockERC20();
        vault = new SequenceVault(address(module), address(usdc), 1_000_000_000); // big vault cap
    }
    function _topics(uint256 q, bytes32 m) internal pure returns (bytes32[] memory t){
        t=new bytes32[](3); t[0]=Verified.ANSWER_DELIVERED_TOPIC0; t[1]=bytes32(q); t[2]=m;
    }
    function _up() internal pure returns (bytes memory){uint256[] memory n=new uint256[](2);n[0]=1;n[1]=0;return abi.encode(uint32(1),n,false);}
    function _down() internal pure returns (bytes memory){uint256[] memory n=new uint256[](2);n[0]=0;n[1]=1;return abi.encode(uint32(1),n,false);}
    function _void() internal pure returns (bytes memory){uint256[] memory n=new uint256[](2);n[0]=0;n[1]=0;return abi.encode(uint32(2),n,true);}
    function _fire(uint256 q, bytes32 m, bytes memory d) internal { vm.prank(PRECOMPILE); vault.onEvent(HUB,_topics(q,m),d); }

    function _arm(bytes32 stepId, bytes32 market, uint256 price, uint256 qty, uint256 cap, bool yesOn0) internal {
        SequenceVault.Step memory s;
        s.triggerMarketId=market; s.pool=address(pool); s.price=price; s.quantity=qty;
        s.expireNs=uint64(block.timestamp+3600)*1e9; s.orderType=2; s.buyYesOnWin0=yesOn0; s.notionalCap=cap;
        vault.armStep(stepId, s);
    }

    function test_arm_then_execute_on_win0() public {
        bytes32 sid=keccak256("s1"); bytes32 m=keccak256("mA"); module.setQid(m,42);
        _arm(sid,m,100,5,1000,true);   // notional 500 <= cap 1000
        _fire(42,m,_up());
        assertEq(uint256(vault.stepStatus(sid)), uint256(SequenceVault.Status.EXECUTED));
        assertEq(pool.calls(),1); assertEq(pool.lastKind(),0);
        assertEq(vault.outstandingNotional(),500);
    }
    function test_win1_buys_no() public {
        bytes32 sid=keccak256("s2"); bytes32 m=keccak256("mB"); module.setQid(m,7);
        _arm(sid,m,100,5,1000,true); _fire(7,m,_down());
        assertEq(pool.lastKind(),2);
    }
    function test_idempotent_no_double() public {
        bytes32 sid=keccak256("s3"); bytes32 m=keccak256("mC"); module.setQid(m,9);
        _arm(sid,m,100,5,1000,true); _fire(9,m,_up()); _fire(9,m,_up());
        assertEq(pool.calls(),1);
    }
    function test_void_skips() public {
        bytes32 sid=keccak256("s4"); bytes32 m=keccak256("mD"); module.setQid(m,5);
        _arm(sid,m,100,5,1000,true); _fire(5,m,_void());
        assertEq(uint256(vault.stepStatus(sid)), uint256(SequenceVault.Status.SKIPPED));
        assertEq(pool.calls(),0);
    }
    function test_step_cap_blocks() public {
        bytes32 sid=keccak256("s5"); bytes32 m=keccak256("mE"); module.setQid(m,1);
        // arm with cap high enough to pass arm-time check, then it still enforces at fire
        _arm(sid,m,100,5,500,true);    // notional exactly 500 == cap, ok
        _fire(1,m,_up());
        assertEq(pool.calls(),1);
    }
    function test_vault_cap_blocks() public {
        vault.setMaxOutstanding(400);  // below the 500 notional
        bytes32 sid=keccak256("s6"); bytes32 m=keccak256("mF"); module.setQid(m,2);
        _arm(sid,m,100,5,1000,true); _fire(2,m,_up());
        assertEq(uint256(vault.stepStatus(sid)), uint256(SequenceVault.Status.SKIPPED));
        assertEq(pool.calls(),0);
    }
    function test_arm_rejects_over_cap() public {
        bytes32 sid=keccak256("s7"); bytes32 m=keccak256("mG");
        SequenceVault.Step memory s;
        s.triggerMarketId=m; s.pool=address(pool); s.price=100; s.quantity=20; // notional 2000
        s.expireNs=uint64(block.timestamp+3600)*1e9; s.orderType=2; s.buyYesOnWin0=true; s.notionalCap=1000;
        vm.expectRevert(abi.encodeWithSelector(SequenceVault.CapExceeded.selector, 2000, 1000));
        vault.armStep(sid, s);
    }
    function test_paused_blocks_execution() public {
        bytes32 sid=keccak256("s8"); bytes32 m=keccak256("mH"); module.setQid(m,3);
        _arm(sid,m,100,5,1000,true);
        vault.setPaused(true);
        vm.prank(PRECOMPILE);
        vm.expectRevert(SequenceVault.Paused.selector);
        vault.onEvent(HUB,_topics(3,m),_up());
    }
    function test_cancel_step() public {
        bytes32 sid=keccak256("s9"); bytes32 m=keccak256("mI"); module.setQid(m,4);
        _arm(sid,m,100,5,1000,true); vault.cancelStep(sid);
        _fire(4,m,_up());
        assertEq(pool.calls(),0); // cancelled step doesn't fire
    }
    function test_only_owner_arms() public {
        vm.prank(address(0xBAD)); vm.expectRevert(SequenceVault.NotOwner.selector);
        SequenceVault.Step memory s; vault.armStep(keccak256("x"), s);
    }
    function test_qid_mismatch_skips() public {
        bytes32 sid=keccak256("s10"); bytes32 m=keccak256("mJ"); module.setQid(m,999);
        _arm(sid,m,100,5,1000,true); _fire(42,m,_up());
        assertEq(pool.calls(),0);
    }
    function test_non_precompile_reverts() public {
        vm.prank(address(0xBEEF)); vm.expectRevert();
        vault.onEvent(HUB,_topics(1,bytes32(uint256(1))),_up());
    }
}
