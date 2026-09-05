// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {SequenceVault} from "../src/SequenceVault.sol";

/// The ERC-6909 singleton: one contract holding every market's YES/NO positions
/// as ids, with per-operator approval rather than per-market allowance.
contract MockOutcomeToken {
    mapping(address => mapping(uint256 => uint256)) public bal;
    mapping(address => mapping(address => bool)) public operators;

    function mint(address to, uint256 id, uint256 amount) external { bal[to][id] += amount; }
    function burn(address from, uint256 id, uint256 amount) external { bal[from][id] -= amount; }
    function balanceOf(address owner, uint256 id) external view returns (uint256) { return bal[owner][id]; }
    function isOperator(address owner, address spender) external view returns (bool) { return operators[owner][spender]; }
    function setOperator(address spender, bool approved) external returns (bool) {
        operators[msg.sender][spender] = approved; return true;
    }
}

contract MockCollateral {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address, uint256) external pure returns (bool) { return true; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
}

contract RedeemMarket {
    bool public isResolved;
    bool public isVoided;
    uint256[] internal _payouts;
    address public outcomeToken;
    constructor(address token) { outcomeToken = token; }
    function resolve(uint256[] memory p) external { _payouts = p; isResolved = true; }
    function voidIt() external { isVoided = true; }
    function payoutNumerators() external view returns (uint256[] memory) { return _payouts; }
    function settlementWindow() external pure returns (uint64) { return 300; }
    function expiry() external pure returns (uint64) { return 0; }
}

/// Stands in for BinaryMarketsModule: holds the market record and implements the
/// redeem entry, burning the caller's outcome tokens and paying collateral.
contract RedeemModule {
    MockOutcomeToken public token;
    MockCollateral public cash;
    mapping(bytes32 => address) public marketOf;
    mapping(bytes32 => uint256) public yesOf;
    mapping(bytes32 => uint256) public noOf;
    bool public failRedeem;
    uint256 public payoutPerToken = 1e6;   // 1 collateral unit per whole token

    constructor(MockOutcomeToken t, MockCollateral c) { token = t; cash = c; }
    function set(bytes32 m, address market, uint256 yesId, uint256 noId) external {
        marketOf[m] = market; yesOf[m] = yesId; noOf[m] = noId;
    }
    function setFail(bool f) external { failRedeem = f; }
    function setPayout(uint256 p) external { payoutPerToken = p; }

    function markets(bytes32 m) external view
      returns (uint256,uint8,uint8,address,uint32,bytes32,address,address,address,address,uint256,uint256,uint64,uint64){
        return (0,2,0,address(0),0,bytes32(0),address(0),address(0),marketOf[m],address(0),yesOf[m],noOf[m],0,0);
    }

    function redeem(uint32, bytes32, bytes32 marketId, uint8 outcomeIdx, uint256 amount) external {
        require(!failRedeem, "settlement unavailable");
        require(token.isOperator(msg.sender, address(this)), "not operator");
        uint256 id = outcomeIdx == 0 ? yesOf[marketId] : noOf[marketId];
        token.burn(msg.sender, id, amount);
        cash.mint(msg.sender, (amount * payoutPerToken) / 1e6);
    }
}

contract RedeemPool {
    function placeBinaryOrder(uint8,uint256,uint256,uint64,uint8,uint8,address,uint96,uint64)
        external payable returns (bool,uint128) { return (true, 1); }
}

/// A rolling strategy that never redeems slowly turns its bankroll into won
/// positions it cannot reuse. These describe turning them back into collateral.
contract SequenceRedeemTest is Test {
    SequenceVault vault;
    RedeemModule module;
    MockOutcomeToken token;
    MockCollateral cash;
    RedeemMarket market;

    bytes32 constant M = keccak256("market");
    uint256 constant YES_ID = 1001;
    uint256 constant NO_ID = 1002;
    address constant STRANGER = address(0xCAFE);

    function setUp() public {
        token = new MockOutcomeToken();
        cash = new MockCollateral();
        module = new RedeemModule(token, cash);
        market = new RedeemMarket(address(token));
        module.set(M, address(market), YES_ID, NO_ID);
        vault = new SequenceVault(address(this), address(module), address(cash), 1_000_000_000);
    }

    function _up() internal pure returns (uint256[] memory n) { n = new uint256[](2); n[0] = 1; n[1] = 0; }
    function _down() internal pure returns (uint256[] memory n) { n = new uint256[](2); n[0] = 0; n[1] = 1; }

    // ---- the winning side ----------------------------------------------------

    function test_redeems_a_winning_position_into_the_vault() public {
        token.mint(address(vault), YES_ID, 4_000000);
        market.resolve(_up());                       // outcome 0 won

        uint256 gained = vault.redeemPosition(M);

        assertEq(gained, 4_000000);
        assertEq(cash.balanceOf(address(vault)), 4_000000, "collateral must land in the vault");
        assertEq(token.balanceOf(address(vault), YES_ID), 0, "position must be spent");
    }

    function test_collateral_can_only_land_in_the_vault() public {
        token.mint(address(vault), YES_ID, 4_000000);
        market.resolve(_up());

        vm.prank(STRANGER);                          // anyone may trigger it
        vault.redeemPosition(M);

        assertEq(cash.balanceOf(address(vault)), 4_000000);
        assertEq(cash.balanceOf(STRANGER), 0, "the caller must gain nothing");
    }

    function test_authorises_the_module_on_the_singleton_once() public {
        token.mint(address(vault), YES_ID, 1_000000);
        market.resolve(_up());
        assertFalse(token.isOperator(address(vault), address(module)));
        vault.redeemPosition(M);
        assertTrue(token.isOperator(address(vault), address(module)));
    }

    // ---- the losing side -----------------------------------------------------

    function test_a_losing_position_yields_nothing_and_says_so() public {
        token.mint(address(vault), NO_ID, 4_000000); // held NO, outcome 0 won
        market.resolve(_up());
        vm.expectRevert(abi.encodeWithSelector(SequenceVault.NothingToRedeem.selector, M));
        vault.redeemPosition(M);
        assertEq(token.balanceOf(address(vault), NO_ID), 4_000000, "the loser is left untouched");
    }

    function test_redeems_the_winner_when_the_other_outcome_wins() public {
        token.mint(address(vault), NO_ID, 3_000000);
        market.resolve(_down());                     // outcome 1 won
        uint256 gained = vault.redeemPosition(M);
        assertEq(gained, 3_000000);
    }

    // ---- voided --------------------------------------------------------------

    function test_a_voided_market_redeems_both_sides() public {
        token.mint(address(vault), YES_ID, 2_000000);
        token.mint(address(vault), NO_ID, 2_000000);
        module.setPayout(500000);                    // a void pays each side 0.5
        market.voidIt();

        uint256 gained = vault.redeemPosition(M);

        assertEq(gained, 2_000000, "half of each side is the whole position back");
        assertEq(token.balanceOf(address(vault), YES_ID), 0);
        assertEq(token.balanceOf(address(vault), NO_ID), 0);
    }

    // ---- nothing to do -------------------------------------------------------

    function test_refuses_a_market_that_has_not_settled() public {
        token.mint(address(vault), YES_ID, 1_000000);
        vm.expectRevert(abi.encodeWithSelector(SequenceVault.NotSettled.selector, M));
        vault.redeemPosition(M);
    }

    function test_refuses_an_unknown_market() public {
        bytes32 nowhere = keccak256("nowhere");
        vm.expectRevert(abi.encodeWithSelector(SequenceVault.UnknownMarket.selector, nowhere));
        vault.redeemPosition(nowhere);
    }

    function test_zero_balance_is_refused_rather_than_silently_succeeding() public {
        market.resolve(_up());
        vm.expectRevert(abi.encodeWithSelector(SequenceVault.NothingToRedeem.selector, M));
        vault.redeemPosition(M);
    }

    function test_redeeming_twice_does_not_double_pay() public {
        token.mint(address(vault), YES_ID, 4_000000);
        market.resolve(_up());
        vault.redeemPosition(M);
        assertEq(cash.balanceOf(address(vault)), 4_000000);

        vm.expectRevert(abi.encodeWithSelector(SequenceVault.NothingToRedeem.selector, M));
        vault.redeemPosition(M);
        assertEq(cash.balanceOf(address(vault)), 4_000000, "balance unchanged by the second attempt");
    }

    // ---- failure -------------------------------------------------------------

    function test_a_failing_redemption_reverts_and_keeps_the_position() public {
        token.mint(address(vault), YES_ID, 4_000000);
        market.resolve(_up());
        module.setFail(true);

        vm.expectRevert(abi.encodeWithSelector(SequenceVault.RedeemFailed.selector, M, uint8(0)));
        vault.redeemPosition(M);

        assertEq(token.balanceOf(address(vault), YES_ID), 4_000000, "the position survives a failure");
        assertEq(cash.balanceOf(address(vault)), 0);
    }

    /// Redemption lives outside the resolution callback on purpose: a settlement
    /// service having a bad day must never stop a sequence from trading.
    function test_a_broken_redemption_cannot_block_execution() public {
        module.setFail(true);
        token.mint(address(vault), YES_ID, 4_000000);
        market.resolve(_up());

        vm.expectRevert();
        vault.redeemPosition(M);

        // Arming and the rest of the machine are entirely unaffected.
        SequenceVault.Step memory s;
        s.triggerMarketId = keccak256("other"); s.pool = address(new RedeemPool());
        s.price = 100000; s.quantity = 5_000000; s.notionalCap = 1_000000;
        s.expireNs = uint64(block.timestamp + 3600) * 1e9;
        s.orderType = 2; s.actionOnWin0 = 0; s.actionOnWin1 = 2;
        vault.armStep(keccak256("live"), s);
        assertEq(uint256(vault.stepStatus(keccak256("live"))), uint256(SequenceVault.Status.ARMED));
    }
}
