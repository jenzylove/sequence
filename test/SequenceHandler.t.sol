// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceHandler} from "../src/SequenceHandler.sol";
import {Verified} from "../src/Verified.sol";

contract MockModule {
    mapping(bytes32 => uint256) public qid;
    function setQid(bytes32 m, uint256 q) external { qid[m] = q; }
    function markets(bytes32 m) external view
      returns (uint256,uint8,uint8,address,uint32,bytes32,address,address,address,address,uint256,uint256,uint64,uint64) {
        return (qid[m],2,0,address(0),0,bytes32(0),address(0),address(0),address(0),address(0),0,0,0,0);
    }
}
contract MockBinaryPool {
    uint256 public calls; uint8 public lastKind; uint256 public lastPrice; uint256 public lastQty; uint8 public lastType;
    function placeBinaryOrder(uint8 kind,uint256 price,uint256 quantity,uint64,uint8 orderType,uint8,address,uint96,uint64)
      external payable returns (bool,uint128) {
        calls++; lastKind=kind; lastPrice=price; lastQty=quantity; lastType=orderType; return (true,uint128(calls));
    }
}
contract MockERC20 {
    function approve(address,uint256) external pure returns (bool){ return true; }
    function balanceOf(address) external pure returns (uint256){ return 0; }
}

contract SequenceHandlerTest is Test {
    SequenceHandler handler; MockModule module; MockBinaryPool pool; MockERC20 usdc;
    address constant PRECOMPILE = address(0x0100);
    address constant ORACLE_HUB = 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b;
    bytes32 constant EXP_T0 = keccak256("AnswerDelivered(uint256,bytes32,uint32,uint256[],bool)");

    event SuccessorPlaced(bytes32 indexed marketId, address indexed pool, uint8 kind, bool success, uint128 orderId);
    event AlreadyHandled(bytes32 indexed marketId, uint256 indexed oracleQuestionId);
    event SkippedNotArmed(bytes32 indexed marketId);

    function setUp() public {
        module = new MockModule(); pool = new MockBinaryPool(); usdc = new MockERC20();
        handler = new SequenceHandler(address(module), address(usdc));
    }
    function _topics(uint256 q, bytes32 m) internal pure returns (bytes32[] memory t){
        t=new bytes32[](3); t[0]=Verified.ANSWER_DELIVERED_TOPIC0; t[1]=bytes32(q); t[2]=m;
    }
    function _up() internal pure returns (bytes memory){ uint256[] memory n=new uint256[](2); n[0]=1; n[1]=0; return abi.encode(uint32(1),n,false); }
    function _down() internal pure returns (bytes memory){ uint256[] memory n=new uint256[](2); n[0]=0; n[1]=1; return abi.encode(uint32(1),n,false); }
    function _void() internal pure returns (bytes memory){ uint256[] memory n=new uint256[](2); n[0]=0; n[1]=0; return abi.encode(uint32(2),n,true); }
    function _fire(uint256 q, bytes32 m, bytes memory d) internal { vm.prank(PRECOMPILE); handler.onEvent(ORACLE_HUB,_topics(q,m),d); }
    function _arm(bytes32 m, bool buyYesOnWin0) internal {
        SequenceHandler.Successor memory s;
        s.pool=address(pool); s.price=600000; s.quantity=5; s.expireNs=uint64(block.timestamp+3600)*1e9; s.orderType=2; s.buyYesOnWin0=buyYesOnWin0;
        handler.arm(m,s);
    }

    function test_topic0() public pure { assertEq(Verified.ANSWER_DELIVERED_TOPIC0, EXP_T0); }

    function test_win0_buys_yes_kind0() public {
        bytes32 m=keccak256("A"); module.setQid(m,42); _arm(m,true);
        vm.expectEmit(true,true,false,false); emit SuccessorPlaced(m,address(pool),0,true,1);
        _fire(42,m,_up());
        assertEq(pool.calls(),1); assertEq(pool.lastKind(),0); assertEq(pool.lastType(),2);
    }
    function test_win1_buys_no_kind2() public {
        bytes32 m=keccak256("B"); module.setQid(m,7); _arm(m,true);
        _fire(7,m,_down());
        assertEq(pool.lastKind(),2);
    }
    function test_idempotent_no_double_place() public {
        bytes32 m=keccak256("C"); module.setQid(m,9); _arm(m,true);
        _fire(9,m,_up()); assertEq(pool.calls(),1);
        vm.expectEmit(true,true,false,false); emit AlreadyHandled(m,9);
        _fire(9,m,_up()); assertEq(pool.calls(),1);
    }
    function test_void_no_place() public {
        bytes32 m=keccak256("D"); module.setQid(m,5); _arm(m,true);
        _fire(5,m,_void()); assertEq(pool.calls(),0);
    }
    function test_qid_mismatch_no_place() public {
        bytes32 m=keccak256("E"); module.setQid(m,999); _arm(m,true);
        _fire(42,m,_up()); assertEq(pool.calls(),0);
    }
    function test_unarmed_no_place() public {
        bytes32 m=keccak256("F");
        vm.expectEmit(true,false,false,false); emit SkippedNotArmed(m);
        _fire(1,m,_up()); assertEq(pool.calls(),0);
    }
    function test_only_owner_arms() public {
        vm.prank(address(0xBAD)); vm.expectRevert(SequenceHandler.NotOwner.selector);
        SequenceHandler.Successor memory s; handler.arm(keccak256("G"),s);
    }
    function test_rejects_non_precompile() public {
        vm.prank(address(0xBEEF)); vm.expectRevert();
        handler.onEvent(ORACLE_HUB,_topics(1,bytes32(uint256(1))),_up());
    }
}
