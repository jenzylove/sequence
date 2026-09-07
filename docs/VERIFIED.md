# Verified interface facts and live proof — Somnia Shannon

This file is the compact provenance record for the interfaces, addresses and production claims used by Sequence.

## DreamDEX resolution event

Canonical event:

`AnswerDelivered(uint256,bytes32,uint32,uint256[],bool)`

- emitter: OracleHub `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b`
- indexed: `oracleQuestionId` (topic1), `marketId` (topic2)
- topic0: `0x981074cb1e0ea7eac4cbc8c4c9ddbef8b964373e7e8cd0904c8e0951c4430541`
- outcome truth: `payoutNumerators` / `payoutDenominator`, with explicit `voided`

The signature and addresses were derived from the installed DreamDEX/Somnia SDK surfaces and checked against the deployed Shannon contracts.

## Core addresses

| Contract | Address |
| --- | --- |
| OracleHub | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| BinaryMarketsModule | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| MarketsCore | `0x2802504314685D89bF6C992CA5a8e7cC78bc0294` |
| BinarySettlement | `0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23` |
| OutcomeToken6909 | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` |
| Test USDC (6 dp) | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |

## Sequence deployment

| Component | Address / value |
| --- | --- |
| SequenceVaultFactory | `0xF492234a4b522D19dd76dBB435ad9471a652f950` |
| Hardened SequenceSubscriptionManager | `0x88a3b51437c959ec80123f8cd12be3ae817bf529` |
| Manager deploy tx | `0x23321ed2975cbc2a1390ae8c14d49225a4e84047a67dbe9b59ec7da4083a3b28` |
| Final proof trader | `0x8c2E517fC6409EddE58b4D5875e13251E492bB84` |
| Final proof vault | `0x34E1583Fc4753C2fCB3E2a818c020167A0b7A8Bc` |
| Final proof registration tx | `0x710f64ebd005d073531df8215adb5cd813e4ae713c702c458627b38e13f60bd2` |
| Final proof subscriptions | `16421932`, `16421933` |

The hardened manager is bound to the canonical factory. It may only spend shared Reactivity capacity for a caller's own factory-created vault and only for markets already present in that vault's real dependent chain.

## Reactivity architecture

Somnia charges the subscription owner while allowing the owner to name another contract as handler.

Sequence uses that separation deliberately:

- `SequenceSubscriptionManager` owns the subscriptions and keeps the shared native stake.
- each trader's own `SequenceVault` is the handler.
- the manager cannot withdraw trader collateral or alter trader rules.
- registration walks the stored dependent chain and creates subscriptions for every link atomically.

`SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE` is 32 native tokens. The final hardened manager was funded to roughly 35 STT; the final proof trader held only 3.71 STT and therefore did not carry the Reactivity stake.

## Final unattended two-step proof

Source: `docs/CHAINED_REACTIVITY_LIVE.json`.

Question proved:

> Can one user activate a dependent two-step Sequence once and leave, with Somnia Reactivity advancing both settlements automatically?

Answer: **yes**.

Timeline:

```text
2026-09-06 10:00:01Z  Triggered -> Placed -> StepArmed -> ChainAdvanced
2026-09-06 12:00:02Z  ExposureReleased -> Triggered -> Placed
```

- one registration transaction
- two exact-market subscriptions owned by the hardened manager
- handler for both subscriptions = trader's own vault
- both dependent steps ended `PLACED`
- manual `syncResolution` calls = **0**

Step 1 tx: `0x035a66e4c8f854de994e2fd84c1b0bbf243092401b70690e3a924c854684b27e`

Step 2 tx: `0xbbb54e73bcf2f3de7aa13f5ecbed5c6045091f8ce152da1093685e6bfcab0113`

## Multi-user shared-stake proof

Source: `docs/SHARED_REACTIVITY_LIVE.json`.

Two unrelated wallets, each with its own factory-created vault and neither holding a 32 STT stake, both advanced automatically under one project-owned Reactivity stake.

That earlier proof used manager `0x14978582d694ee15e8228f012a7d5ee64972c0f7`; it was later superseded by the hardened canonical-factory manager above.

## Redemption proof

Source: `docs/REDEMPTION.json`.

Measured redemption tx:

`0xb7cc85e283b290886e83f242e123a599ca68804c588a0148fb785bada4823e34`

A winning ERC-6909 position was redeemed back into collateral. The measured vault balance moved from `$198.0732` to `$202.4392` while the winning position went to zero.

## Order units and execution semantics

Measured from Shannon binary pools:

- `tickSize = 1000`
- `minQuantity = 1000`
- `lotSize = 1000`
- price uses 6-decimal fractions of one collateral unit
- quantity uses 6-decimal base units
- notional cost = `price * quantity / 1e6`

`placeBinaryOrder` returning success means the order was accepted by the pool. It does **not** prove a fill. Sequence therefore records the state as `PLACED`, not `EXECUTED`.

## Delivery caveat

Reactivity itself has been proven to deliver and to drive real Sequence execution. The remaining platform caveat is narrower: OracleHub does not emit `AnswerDelivered` for every market that finalizes, and the set of delivered market series varies over time.

For that reason Sequence keeps permissionless `syncResolution` as a recovery path. It cannot invent an outcome; it reads the same finalized market state and shares the same idempotency boundary as the Reactivity callback.

See `docs/FINDINGS.md` for the full integration feedback report and the corrected evidence history.
