# Sequence

**Program what happens next.**

Sequence is outcome-driven execution for rolling DreamDEX Event Contracts on Somnia.

A trader defines a bounded sequence before a market settles. When the watched DreamDEX market resolves, Somnia Reactivity delivers the result to that trader's own Sequence vault. The vault evaluates the outcome, places only the pre-authorized successor order, and then arms the next dependent step.

Sequence does not predict markets. It executes rules the trader committed to in advance.

## Why Sequence

Prediction-market trades are usually isolated: a market settles, then the trader has to come back, inspect the result, and decide what to do next.

Sequence turns that into a programmable workflow:

`market resolves -> bounded trade -> next market resolves -> bounded trade`

A later step cannot become active until the previous step has actually placed its order.

## How it works

1. Choose a live DreamDEX Event Contract to watch.
2. Define what should happen for each outcome: buy YES, buy NO, or stop.
3. Set the position size and hard risk caps.
4. Optionally add dependent follow-on steps.
5. Activate once from the user's wallet.
6. Somnia Reactivity delivers matching `AnswerDelivered` events to the user's vault.
7. The vault rechecks the finalized outcome and executes only the action already stored onchain.
8. If the order is accepted, the next step is armed automatically.

Reactivity is the primary delivery path. A permissionless `syncResolution` path exists only as a recovery mechanism for markets that finalize without a corresponding OracleHub `AnswerDelivered` event. Both paths use the same finalized market state and the same idempotency key.

## Safety model

`SequenceVault` is the trust boundary.

- one canonical vault per wallet, created by `SequenceVaultFactory`
- the trader owns the vault and its collateral
- the shared Reactivity manager cannot withdraw user funds or rewrite strategies
- each outcome branch is stored before activation
- each step has its own notional cap
- the vault has a maximum outstanding-notional cap
- later steps stay pending until their predecessor succeeds
- one execution per `(marketId, questionId)` prevents duplicate resolution handling
- owner-only pause, cancellation and fund recovery
- order acceptance is recorded as `PLACED`, never falsely described as a fill

## Shared Reactivity, without a 32 STT burden per trader

Somnia charges the subscription owner while allowing that owner to point delivery at another contract as the handler.

Sequence uses `SequenceSubscriptionManager` as shared infrastructure: the manager holds the Reactivity stake and owns the subscriptions, while each trader's own vault remains the handler that enforces that trader's rules.

The hardened manager also validates that the caller owns the canonical factory vault and registers the full dependent market chain atomically, so later steps remain automatic after the first step advances.

## Live unattended proof

The central product claim has been proven on Somnia Shannon.

One trader activated one two-step dependent sequence once. A single registration created subscriptions `16421932` and `16421933` through the hardened manager.

Then, with no user action and zero `syncResolution` calls:

```text
10:00:01Z  Triggered -> Placed -> StepArmed -> ChainAdvanced
12:00:02Z  ExposureReleased -> Triggered -> Placed
```

Both dependent steps reached `PLACED`, two settlements two hours apart.

Evidence: [`docs/CHAINED_REACTIVITY_LIVE.json`](docs/CHAINED_REACTIVITY_LIVE.json)

The same architecture was also proven across two unrelated users sharing one Reactivity stake, with separate user-owned vaults and no manual resolution step. Evidence: [`docs/SHARED_REACTIVITY_LIVE.json`](docs/SHARED_REACTIVITY_LIVE.json).

The capital cycle was separately closed onchain by redeeming a winning DreamDEX position back into spendable collateral. Evidence: [`docs/REDEMPTION.json`](docs/REDEMPTION.json).

## Deployed Shannon contracts

| Contract | Address |
| --- | --- |
| SequenceVaultFactory | `0xF492234a4b522D19dd76dBB435ad9471a652f950` |
| Hardened SequenceSubscriptionManager | `0x88a3b51437c959ec80123f8cd12be3ae817bf529` |
| OracleHub | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| BinaryMarketsModule | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| Test USDC | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |

The final chained proof used vault `0x34E1583Fc4753C2fCB3E2a818c020167A0b7A8Bc` and registration transaction `0x710f64ebd005d073531df8215adb5cd813e4ae713c702c458627b38e13f60bd2`.

## Where the data comes from

Nothing in the product invents market state.

- market ids, pools, questions, expiries and payout vectors come from DreamDEX/Somnia market data
- resolution truth comes from the deployed OracleHub and finalized market state
- vault status, sequence state, balances and execution history come from contract reads/events
- arming and activation are real wallet-signed transactions
- order pricing is grounded in the live DreamDEX book

Simulation is computed locally and labelled as simulation.

## Stack

- Solidity / Foundry
- Somnia Shannon testnet
- DreamDEX Event Contracts + market data
- `@somnia-chain/reactivity-contracts`
- `@somnia-chain/markets-sdk`
- React + Vite
- viem

## Repository map

| Path | Purpose |
| --- | --- |
| `src/SequenceVault.sol` | bounded user-owned execution vault |
| `src/SequenceVaultFactory.sol` | one canonical vault per wallet |
| `src/SequenceSubscriptionManager.sol` | shared Reactivity stake + full-chain registration |
| `src/IDreamDEX.sol`, `src/Verified.sol` | verified DreamDEX interfaces/constants |
| `test/` | contract state-machine and security coverage |
| `app/planner/` | deterministic planning/simulation |
| `app/web/` | user-facing product |
| `docs/VERIFIED.md` | interface/address/proof provenance |
| `docs/FINDINGS.md` | required SDK/docs integration feedback report |
| `docs/CHAINED_REACTIVITY_LIVE.json` | final two-step unattended proof |
| `docs/SHARED_REACTIVITY_LIVE.json` | two-user shared-stake proof |
| `docs/REDEMPTION.json` | real redemption evidence |

## Verification

```bash
forge test -vv

cd app/web
npm ci
npm run test:units
npm run e2e
npm run verify:refs
npm run verify:clone
```

Latest final verification before submission:

- **98 / 98** contract tests
- **57 / 57** unit tests
- **61 / 61** browser checks
- **40** modules reference-checked

## Honest limitation

Automatic Reactivity delivery depends on OracleHub actually emitting `AnswerDelivered` for the watched market. Delivery has been observed to vary by market series over time. Sequence therefore retains the permissionless `syncResolution` recovery path instead of pretending every finalized market is guaranteed to produce the event.

See [`docs/FINDINGS.md`](docs/FINDINGS.md) for the full integration report and corrections discovered during the build.
