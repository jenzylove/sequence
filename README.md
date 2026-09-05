# Sequence

**Program what happens next.**

Sequence is outcome-driven execution for rolling DreamDEX Event Contracts on Somnia.

You define a bounded sequence of actions before a market settles. When the watched
DreamDEX market resolves, Somnia Reactivity delivers the resolution to the Sequence
vault, the vault evaluates the branch, and it places the next authorized order using
its own escrowed collateral, inside caps it enforces itself.

Sequence does not predict markets. It executes rules you committed to in advance.

## The loop

```
DreamDEX market resolves
  -> OracleHub emits AnswerDelivered
  -> Somnia Reactivity invokes SequenceVault
  -> the vault reads the winning outcome and picks the branch
  -> it places one bounded successor order, or records why it skipped
```

## What the vault guarantees

`SequenceVault` is the trustless executor. The planner and the frontend can be wrong
without putting the bankroll at risk:

- one vault per wallet, deployed by a factory that keeps no authority over it
- a per-outcome branch: each result independently buys YES, buys NO, or stops,
  and a stop places nothing while still consuming the resolution
- a conditional chain: later steps are queued without listening, and are armed
  only after the step before them actually places an order
- PLACED, never EXECUTED: acceptance by the pool is all the vault can observe
  from inside the callback, so it never claims a fill it cannot see
- exposure released when the market traded into resolves, so a rolling sequence
  cannot block itself against its own cap
- a per-step notional cap, checked at arm time and again at execution
- a vault-wide maximum outstanding notional
- one execution per `(marketId, questionId)`, so a resolution cannot fire twice
- Reactivity is the primary delivery path, and a permissionless `syncResolution`
  is the backstop. Neither can invent an outcome: both run the same rules against
  the market's own finalized state, share one idempotency key, and can only
  execute what the owner precommitted
- owner-only arming, pause, step cancellation, and fund recovery

## Using it

Connect a wallet and you land on your desk: what is at risk, your limit, what is
still free, live BTC and ETH context with settlement countdowns, and your
sequences split into Drafts, Live and Finished.

To create one, describe it:

> roll BTC three times, $2 a trade, $5 total

Sequence reads it back as plain rules, both outcomes spelled out, with the worst
case stated before anything is signed. The translation is deterministic and
grounded in markets that are actually open: it refuses an unknown market rather
than inventing one, and it never forecasts price. Activating takes one wallet
approval per step. Each step then watches its own market and runs on its own.

The manual builder is still there as the advanced surface, and every raw
identifier, pool address, event name and transaction hash lives behind
"Onchain details".

## Repository

| Path | What it is |
| --- | --- |
| `src/SequenceVault.sol` | The bounded on-chain executor and its state machine |
| `src/SequenceHandler.sol` | The earlier reactivity spike that proved the event path |
| `src/IDreamDEX.sol`, `src/Verified.sol` | Interfaces and constants derived from the markets SDK |
| `src/SequenceVaultFactory.sol` | One vault per wallet, so the product is multi-tenant |
| `test/` | 74 Foundry tests: branches, stops, chaining, caps, exposure, recovery, access |
| `app/planner/` | Off-chain strategy model, simulation, and vault client |
| `app/web/src/lib/` | Trader vocabulary, the command parser, draft storage |
| `app/web/src/components/` | Desk, command surface, builder, onchain details |
| `app/web/` | The product frontend |
| `docs/VERIFIED.md` | Provenance for every interface fact and address |
| `docs/FINDINGS.md` | Integration feedback for the DreamDEX and Somnia teams |
| `docs/LIVE_FIRE.json` | The recorded live-fire runs, written by the harness |
| `docs/REDEMPTION.json` | The capital cycle closing: a won position turned back into collateral |

## Where the data comes from

Nothing in the interface is invented. Markets, pools, question text, expiries and
payout vectors come from the Somnia markets indexer. Vault state, step status and
the execution timeline are contract reads and decoded contract events. Arming is a
real `armStep` transaction signed in the user's own wallet.

Simulation is the one thing computed locally, and it is labelled as such. It replays
a plan against genuinely settled markets using the same winner, branch, idempotency
and cap logic as the vault.

## Run it

```bash
forge test                       # 74 contract tests
cd app && npx tsx --test planner/live.test.ts   # planner against live Shannon
cd app/web && npm run dev        # the product
```

Verification:

```bash
cd app/web
node scripts/gen-abi.mjs         # regenerate the ABI from the compiled artifact
node scripts/verify-arm.mjs      # the real armStep path against live chain state
npm run build && node scripts/e2e.mjs   # browser run of the whole journey
node scripts/verify-clean-clone.mjs     # build HEAD in a fresh clone, as a deploy does
node scripts/verify-readiness.mjs       # what is actually blocking a demo, read from chain
node scripts/live-fire.mjs --watch      # watch an armed run through to settlement
```

The last one matters: a local build only proves the working tree compiles, not
that everything it needs was committed. It clones HEAD into a temp directory and
builds there, which is what a deployment actually sees.

## Current status

Live and verified on Shannon:

- `SequenceVaultFactory` deployed, and the owner's vault created **by** it, so a
  visiting wallet resolves to its own account or is offered one. A stranger
  address resolves to none, which is what makes provisioning honest
- subscription `16022724` open, so DreamDEX resolutions reach the vault
- $200 of test collateral, with a $5 total risk limit the contract enforces
- orders priced against the live book, with NO derived as the complement of the
  YES side, and the successor market re-checked against the module before
  anything is signed
- 86 contract tests, 23 unit tests for sizing and wallet scoping, 6 planner
  tests against live chain, and a browser suite including a wallet that owns nothing

Proven on chain:

- a real settlement drove a real bounded order. Recorded in `docs/LIVE_FIRE.json`
  with the receipt broken out in `docs/FILL_EVIDENCE.json`:
  `ResolutionSynced -> Triggered -> Placed`, order id `110680464442257339085`,
  $2.0000 of collateral out and $1.9200 returned, so $0.0800 net was consumed.
  The pool accepted the bounded order; the vault cannot observe fill size from
  inside the callback, so no fill quantity is claimed beyond that delta
- a genuinely new wallet completed the journey signing for itself, in
  `docs/FRESH_WALLET.json`: it started with no account, created its own vault
  through the factory, was confirmed isolated from the author's, and activated a
  sequence
- **the capital cycle closes.** One settlement drove a real order, the market that
  order bought into settled in turn, and the winning position was redeemed back
  into spendable collateral. On the deployed vault, in `docs/REDEMPTION.json`:
  `StepArmed -> ResolutionSynced -> Triggered -> Placed -> ExposureReleased -> Redeemed`.
  4,366,000 outcome tokens became $4.3660 of collateral against a $2.0000 order,
  the balance moved $198.0732 -> $202.4392, and the position went to zero
  (`0xb7cc85e283b290886e83f242e123a599ca68804c588a0148fb785bada4823e34`)

Also proven on chain:

- **Reactivity delivers, and drove a sequence with nobody watching.** In block
  `480220742`, carrying 4 validated `AnswerDelivered` events, the Reactivity
  precompile called `onEvent` on the vault 8 times, none reverting. One of those
  markets was our armed trigger, and the vault went `StepArmed -> Triggered ->
  Placed` with no `ResolutionSynced` in the timeline. Recorded in
  `docs/REACTIVITY_EXPERIMENT.json` and `docs/LIVE_FIRE.json` run 3

Previously claimed here, now withdrawn:

- This README used to say Reactivity had never been seen to deliver. That was
  wrong. The evidence harness passed a raw `topics` array to viem's `getLogs`,
  which ignores it, so it matched an unrelated `DrainContinuation` event and drew
  a conclusion from a block that never carried an `AnswerDelivered`. The
  `isGuaranteed` hypothesis is withdrawn too: both the guaranteed EOA-owned
  subscription and the ordinary vault-owned one delivered in the same block. See
  `docs/FINDINGS.md` §1b for the full retraction and the corrected method

Deliberately not built yet:

- automatic redemption inside the resolution callback. Redemption is a separate
  permissionless call on purpose: a settlement service having a bad day must
  never be able to stop a sequence from trading

## Deployed addresses (Shannon testnet)

| Contract | Address |
| --- | --- |
| SequenceVaultFactory | `0xF492234a4b522D19dd76dBB435ad9471a652f950` |
| SequenceVault (owner's) | `0x0185CA254C9e7b184b566e7037160334519cC9f6` |
| OracleHub | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| BinaryMarketsModule | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| Test USDC | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |

See `docs/VERIFIED.md` for how each of these was derived.
