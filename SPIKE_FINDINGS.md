# Sequence Technical Spike — Findings

Date: 2026-09-01 · Chain: Somnia Shannon (50312) · Status: gate proven except final live successor-order fire (funding-blocked)

## Question the spike tested
Real DreamDEX BinaryMarket resolution on Shannon → exact resolution event detected →
Somnia Reactivity invokes our Solidity handler → handler deterministically triggers/prepares
the next permitted DreamDEX action.

## PROVEN (verified from shipped ABIs + witnessed live on Shannon)
- Resolution event is `AnswerDelivered(uint256 oracleQuestionId, bytes32 marketId, uint32 payoutDenominator, uint256[] payoutNumerators, bool voided)`, emitted by OracleHub.
  - topic0 `0x981074cb1e0ea7eac4cbc8c4c9ddbef8b964373e7e8cd0904c8e0951c4430541` (derived via viem from oracleHubEventsAbi, cross-checked in unit test).
  - marketId indexed at topic2, questionId at topic1.
  - NOTE: the `Resolved(uint8)`/`Voided()` signatures originally supplied DO NOT EXIST in any shipped ABI. Market Resolved(4)/Voided(5) are STATUS values, not events. The real reactive signal is OracleHub AnswerDelivered.
- Somnia Reactivity subscription created on-chain, filter confirmed from precompile storage: emitter=OracleHub, topic0=AnswerDelivered, handler owns its own subscription.
- **LIVE WITNESSED**: 4 real market resolutions across 2 blocks invoked our handler's `_onEvent`, which decoded the payout vector and emitted `Detected` in the same block. This closes the detection→reactivity→handler gate.
- Successor architecture resolved: Sequence is a self-owned vault. It places its OWN `placeBinaryOrder` (verified from binaryPoolWriteAbi), funded by a plain ERC-20 `approve(pool, amount)` on tUSDC (SDK source confirms: buys need an ERC-20 allowance the pool pulls). NO operator registry, NO placeOrderFor, NO Permit2 signature required. Contract-owned placement is fully supported.
- Winner→kind branch: outcome 0 → BUY_YES (kind 0), outcome 1 → BUY_NO (kind 2). Enum: 0 BUY_YES,1 SELL_YES,2 BUY_NO,3 SELL_NO.
- 14/14 unit tests green: idempotency (one fire per marketId+questionId), void/mismatch/unarmed guards, precompile-only caller, owner-gating, winner→kind mapping, all against a mock pool with the REAL placeBinaryOrder signature.

## NOT YET PROVEN (final integration milestone before submission)
- Live on-chain fire of the successor `placeBinaryOrder` on a genuine resolution.
  - Blocked ONLY by the 32-SOM Somnia subscription bond (SUBSCRIPTION_OWNER_MINIMUM_BALANCE). Faucets dispense fractions of a token; a larger grant is needed via Somnia dev channels.
  - Architecturally complete: correct function, funding model, and branch logic all verified. This is a funding wait, not an unknown.

## Verified addresses (Shannon, testnet==mainnet via CREATE3 except collateral)
- OracleHub          0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b
- BinaryMarketsModule 0x3ecC694Cef705358864a646142ac17A90E29e388
- BinarySettlement   0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23
- binaryPoolImpl     0x48e523c9f22f98548d263f0aD444D732e5202C0E
- test USDC (6dp)    0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E
- Reactivity precompile 0x0000000000000000000000000000000000000100
- Indexer (GraphQL)  https://dev.smk.somnia.host/v1/graphql

## Deployed artifacts
- Vault handler (current, HAS withdraw): 0x998A0F8be4991C352142E4350346Ecf86886C9F8
- Old handler (NO withdraw, 33 SOM stranded — known loss): 0x3822aA670CF07C252246E758F822E4673106B3C3

## Known issues / lessons
- First handler had no native withdraw; 33 test-SOM is permanently stuck there. Current handler adds withdrawNative/withdrawToken. All future fund-holding contracts MUST ship an owner recovery fn before funding.
- Binary pools differ from spot docs: placeBinaryOrder (not placeOrder/placeOrderFor), no manual-vault mode, allowance-based funding.
