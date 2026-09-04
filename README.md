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

- a per-outcome branch: each result independently buys YES, buys NO, or stops,
  and a stop places nothing while still consuming the resolution
- a per-step notional cap, checked at arm time and again at execution
- a vault-wide maximum outstanding notional
- one execution per `(marketId, questionId)`, so a resolution cannot fire twice
- only the Somnia Reactivity precompile can drive execution
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
| `test/` | 34 Foundry tests covering branches, stops, caps, idempotency and access |
| `app/planner/` | Off-chain strategy model, simulation, and vault client |
| `app/web/src/lib/` | Trader vocabulary, the command parser, draft storage |
| `app/web/src/components/` | Desk, command surface, builder, onchain details |
| `app/web/` | The product frontend |
| `docs/VERIFIED.md` | Provenance for every interface fact and address |
| `docs/FINDINGS.md` | Integration feedback for the DreamDEX and Somnia teams |
| `docs/LIVE_FIRE.json` | The recorded live-fire run, written by the harness |

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
forge test                       # 26 contract tests
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
```

The last one matters: a local build only proves the working tree compiles, not
that everything it needs was committed. It clones HEAD into a temp directory and
builds there, which is what a deployment actually sees.

## Current status

Live and verified:

- `SequenceVault` deployed on Shannon at `0xA9A9AA93BE8f62723D55dA5Ba100F9803325Bf62`
- live DreamDEX binary markets and settled history driving the builder
- vault reads, step reads and event decoding in the browser
- the `armStep` path simulated successfully from the real vault owner, and correctly
  rejected for a non-owner
- the account is subscribed to market results (subscription `15531756`) and
  funded, so settlements now reach it automatically
- 34/34 contract tests, 6/6 planner tests against live chain, 49/49 browser
  checks including comprehension checks that fail the build if contract
  vocabulary leaks into the primary interface

Pending a redeploy:

- the per-outcome stop changed the `Step` struct, so the vault at
  `0xA9A9…Bf62` is now a version behind. `app/web/scripts/deploy-vault.sh`
  recovers the old vault's stake and collateral, deploys the current contract
  and repoints the app. `verify-arm.mjs` detects a stale deployment explicitly
  rather than failing with a bare revert.

Remaining:

- no follow-on order has been placed on a real settlement yet. That needs a live
  sequence and one of its watched markets to settle, which is a wallet signature
  away rather than more code. Until it happens the product says so plainly
  instead of implying otherwise.

## Deployed addresses (Shannon testnet)

| Contract | Address |
| --- | --- |
| SequenceVault | `0xA9A9AA93BE8f62723D55dA5Ba100F9803325Bf62` |
| OracleHub | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| BinaryMarketsModule | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| Test USDC | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |

See `docs/VERIFIED.md` for how each of these was derived.
