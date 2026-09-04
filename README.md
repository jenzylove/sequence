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
| `src/SequenceVaultFactory.sol` | One vault per wallet, so the product is multi-tenant |
| `test/` | 53 Foundry tests: branches, stops, chaining, caps, exposure, access |
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
forge test                       # 53 contract tests
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
- subscription `15952225` open, so DreamDEX resolutions reach the vault
- $200 of test collateral, with a $5 total risk limit the contract enforces
- orders priced against the live book, with NO derived as the complement of the
  YES side, and the successor market re-checked against the module before
  anything is signed
- 53 contract tests, 6 planner tests against live chain, 63 browser checks
  including a pass for a wallet that owns nothing

Armed and waiting:

- a live-fire run is armed on a real BTC market
  (`docs/LIVE_FIRE.json`, `StepArmed 0x600dc906…b93193`). The step sits in
  `ARMED` and the vault is listening. What has not happened is the settlement:
  DreamDEX's oracle has published no resolution for some time, and dozens of
  binary markets are past expiry while still reporting `clobStatus: Trading`.
  That is a venue-side stall, written up in `docs/FINDINGS.md`. Until the chain
  shows `Triggered` and then `Placed` or a truthful `Skipped`, the loop is not
  claimed as proven.

Deliberately not built yet:

- redemption of settled positions, so won collateral is not yet recycled
- the markets SDK; discovery goes to the indexer directly

## Deployed addresses (Shannon testnet)

| Contract | Address |
| --- | --- |
| SequenceVaultFactory | `0x5d2d9862E1B442b303b64fDB677f6e041425dB3c` |
| SequenceVault (owner's) | `0xf908D5e59d38dF8Fb0739dbE759B373D83aF20Ed` |
| OracleHub | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| BinaryMarketsModule | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| Test USDC | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |

See `docs/VERIFIED.md` for how each of these was derived.
