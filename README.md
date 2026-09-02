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

- a per-step notional cap, checked at arm time and again at execution
- a vault-wide maximum outstanding notional
- one execution per `(marketId, questionId)`, so a resolution cannot fire twice
- only the Somnia Reactivity precompile can drive execution
- owner-only arming, pause, step cancellation, and fund recovery

## Repository

| Path | What it is |
| --- | --- |
| `src/SequenceVault.sol` | The bounded on-chain executor and its state machine |
| `src/SequenceHandler.sol` | The earlier reactivity spike that proved the event path |
| `src/IDreamDEX.sol`, `src/Verified.sol` | Interfaces and constants derived from the markets SDK |
| `test/` | 26 Foundry tests covering branches, caps, idempotency and access |
| `app/planner/` | Off-chain strategy model, simulation, and vault client |
| `app/web/` | The product frontend |
| `docs/VERIFIED.md` | Provenance for every interface fact and address |

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
```

## Current status

Live and verified:

- `SequenceVault` deployed on Shannon at `0xA9A9AA93BE8f62723D55dA5Ba100F9803325Bf62`
- live DreamDEX binary markets and settled history driving the builder
- vault reads, step reads and event decoding in the browser
- the `armStep` path simulated successfully from the real vault owner, and correctly
  rejected for a non-owner
- 26/26 contract tests, 6/6 planner tests against live chain, 21/21 browser checks

Not yet live, and labelled as such in the product:

- the vault holds no Reactivity subscription, because subscribing stakes 32 SOM from
  the vault itself
- the vault holds no test USDC collateral, so no successor order has been placed

Both are owner-signed transactions. The interface exposes them as a guided go-live
path rather than hiding them in scripts, so the remaining step is a wallet signature,
not more code.

## Deployed addresses (Shannon testnet)

| Contract | Address |
| --- | --- |
| SequenceVault | `0xA9A9AA93BE8f62723D55dA5Ba100F9803325Bf62` |
| OracleHub | `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b` |
| BinaryMarketsModule | `0x3ecC694Cef705358864a646142ac17A90E29e388` |
| Test USDC | `0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E` |

See `docs/VERIFIED.md` for how each of these was derived.
