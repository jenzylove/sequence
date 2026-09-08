# Integration feedback for the Somnia and DreamDEX teams

From building **Sequence** on Somnia Shannon during the Event Contracts
hackathon. Everything below came out of getting the product working against the
live testnet; nothing here is hypothetical, and where our own first conclusion
turned out to be wrong we have said so rather than quietly corrected it.

---

## Project context

Sequence lets a trader precommit a conditional chain of DreamDEX Event Contract
trades: *when this market settles, buy YES in the next window if it closed up,
buy NO if it closed down, or stop.* The trader signs once and leaves. Somnia
Reactivity wakes their account when the market settles, and the account places
the follow-on order itself.

Primitives used:

| Primitive | How Sequence uses it |
| --- | --- |
| **Somnia Reactivity** (precompile `0x…0100`) | Wakes each user's vault on `AnswerDelivered`; the whole product depends on this |
| **OracleHub** `AnswerDelivered` | The settlement signal every subscription filters on |
| **BinaryMarketsModule** | Market records, `redeem`, ERC-6909 outcome balances |
| **Binary CLOB pools** | `placeBinaryOrder`, `getOrderBookParameters` |
| **BinarySettlement** | `getSettlement`, payout vectors, the outcome-token singleton |
| **Indexer (GraphQL)** | Open/resolved markets, order books, spot context |
| **`@somnia-chain/markets-sdk`** | ABIs, `marketKey`, the testnet address book |

Contracts: `SequenceVault` (per-user, holds the trader's collateral and enforces
their risk limit), `SequenceVaultFactory`, `SequenceSubscriptionManager` (project
infrastructure, owns the subscriptions).

---

## What worked well

**Reactivity does invoke user contracts, reliably, when the event exists.** With
a validated `AnswerDelivered` in the block, the precompile called our handler and
the sequence advanced with nobody watching. In one block carrying four validated
events we counted eight `onEvent` (`0x53edf33d`) calls into the vault at depth 0,
none reverting.

**Owner and handler being separate fields is the single most valuable design
decision for us.** `SUBSCRIPTION_OWNER_MINIMUM_BALANCE` is checked against the
*subscriber's* balance, not per subscription, and the handler is an independent
parameter. That let one `SequenceSubscriptionManager` holding ~35 STT own
subscriptions whose handlers are many different user vaults. Without it, every
trader would have needed 32 STT of their own before automation was available to
them — which on a testnet faucet is not realistic, and would have made "it runs
while you sleep" a promise the product could not keep for anyone but us.

**`AnswerDelivered` is well shaped for filtering.** Indexed `questionId` and
`marketId` means an exact-market subscription is a `topics[2]` match, so a
settlement only wakes the vaults that care about it instead of every registered
contract. Subscribing per market rather than per wildcard made the shared stake
go much further.

**On-chain state is complete enough to recover from.** Because
`isResolved`/`isVoided`/`payoutNumerators` are readable and settlement is
authoritative, we could write a permissionless `syncResolution(marketId)` that
reads the outcome from the market itself and runs the identical state machine
behind the same idempotency key. That a third party can advance somebody else's
stalled sequence without being trusted with anything is a property of Somnia's
state model, and it is what makes the product safe to ship despite the delivery
gap described below.

**Docs were right about pool recycling.** The warning that a pool address is not
a stable market identity is accurate and worth keeping prominent — we hit exactly
the failure it describes.

**Deterministic addresses across testnet and mainnet** removed a whole class of
configuration branching.

---

## Pain points and issues we hit

### 1. `AnswerDelivered` is not emitted for every finalized market

**What we observed.** A sequence watching a BTC 5m market never advanced,
although that market finalized on chain with a real payout vector. The
subscription was correct — owned, funded, exact-market filter — and OracleHub had
simply never emitted `AnswerDelivered` for it. Scanning the hub directly, there
were stretches with no deliveries at all network-wide while markets continued to
finalize.

We are deliberately not publishing a list of "supported cadences". Our first
sample suggested one, a later sample contradicted it, and we do not have enough
data to claim a rule. What we can say is that **market finalization and
`AnswerDelivered` are not equivalent**, and the gap is not obvious from the
outside.

**Why it mattered.** Reactivity is the product. A rule waiting on a settlement
that never produces an event does not fail loudly — it sits `ARMED` for ever
while the interface truthfully says "waiting".

**Workaround.** `syncResolution(bytes32 marketId)` — permissionless, reads the
outcome from the market contract, same idempotency key so a late delivery cannot
double-fire. Our proof harness also reads the hub first and builds its chain only
on series it can see being answered, so the test measures Sequence rather than
the oracle's schedule.

**Suggested improvement.** Either guarantee an `AnswerDelivered` for every market
that reaches a finalized state, or publish which markets are oracle-answered so
integrators can tell the difference up front. A per-market flag on the indexer
would be enough.

### 2. A stalled resolution is indistinguishable from a healthy market

**What we observed.** Markets sit past expiry with `clobStatus: "Trading"` and
`finalized: false`. In one snapshot, 60 binary markets were past expiry and still
labelled Trading, the oldest by about 45 days.

**Why it mattered.** An integrator cannot tell "this window has not settled yet"
from "this window is stuck", so a product cannot honestly tell a user which one
they are looking at.

**Workaround.** We treat expiry plus a grace period as the point where we offer
the recovery path, rather than trusting status alone.

**Suggested improvement.** A distinct status for "expired, awaiting resolution",
or an `expectedResolutionBy` field.

### 3. Order acceptance is visible; fills are not

**What we observed.** `placeBinaryOrder` returns `(bool success, uint128 id)`.
That boolean is *acceptance*, not execution — an IOC can be accepted and fill
nothing. Inside a Reactivity callback there is no practical way to observe the
fill: `OrderFilled` is emitted after our frame.

**Why it mattered.** We initially wrote `EXECUTED` on `success`, which would have
told a trader their trade happened when it may not have. We now record `PLACED`
and never claim a fill we did not observe, and the interface says "order placed"
rather than "traded".

**Suggested improvement.** Return filled quantity from `placeBinaryOrder`, or
emit a fill summary in the same transaction, so a callback can record what
actually happened rather than what was accepted.

### 4. Quantity units and pool minimums revert rather than reporting

**What we observed.** Prices are 6-decimal fractions and quantities are 6-decimal
base units, so an order costs `price * quantity / 1e6`. We had assumed whole
contracts and were off by a factor of a million. Separately,
`getOrderBookParameters()` returns `tickSize 1000, minQuantity 1000,
lotSize 1000`, and an order below the minimum **reverts**
`QuantityBelowMinimum(2, 1000)` rather than returning `false`.

**Why it mattered.** A revert inside a Reactivity callback is a failed callback,
not a handled rejection, so getting this wrong costs the delivery rather than
producing a skip.

**Workaround.** We read `getOrderBookParameters()` per pool, size every order to
the lot grid, and wrap `placeBinaryOrder` in try/catch so a rejection becomes a
recorded `Skipped("order-rejected")` instead of a lost callback.

**Suggested improvement.** Document the unit convention next to the function
signature, and prefer returning `false` over reverting for bounds that an
integrator is expected to handle.

### 5. The book is quoted in YES terms only

**What we observed.** Across 200 sampled open orders: 100 `BUY_YES`, 95
`SELL_YES`, 5 null side. No `BUY_NO`/`SELL_NO` rows exist.

**Why it mattered.** Buying NO is a derivation, not a lookup — the best NO ask is
`1 - bestBidYes`. Reading "best ask" and using it for a NO order prices it on the
wrong side of the book.

**Suggested improvement.** One line in the Event Contracts docs stating that the
book is YES-quoted and how to derive the NO side.

### 6. `intervalSec` is not canonical

**What we observed.** Nominal cadences are 1m/5m/15m/1h/4h/1d, but the indexer
reports the measured span. One snapshot contained `298, 300, 898, 900, 3163,
3164, 3600, 45, 47, 56, 60, 89, 92`.

**Why it mattered.** We group markets into series to find "the next window of the
same kind". Grouping on the raw value splits one series into several.

**Workaround.** We snap to the nearest nominal bucket before grouping.

**Suggested improvement.** Expose the nominal cadence as its own field alongside
the measured one.

### 7. Only one window per series is open at a time

**What we observed.** For a given asset and cadence there is generally a single
open window; the next one is created after the current settles.

**Why it mattered.** This one shaped the product more than any other. A rolling
sequence wants "the next window of the same kind", and that market usually does
not exist yet at the moment the trader is building. We cannot arm against a
market id that has not been created.

**Workaround.** The follow-on trade goes into the next open window of the same
asset, which is often a different cadence, and the interface names that market
and its settlement time before anything is signed.

**Suggested improvement.** Pre-creating the next window, or exposing a
deterministic future market id, would let integrators build genuinely
same-cadence chains. This is the single change that would most improve what
Sequence can offer.

### 8. `eth_getLogs` is capped at 1000 blocks on a sub-second chain

**What we observed.** Wider ranges return `block range exceeds 1000`. Shannon
advanced roughly 1.6 million blocks during one working session.

**Why it mattered.** Reconstructing a contract's own history means thousands of
paginated calls. It also means a user's sequences cannot be recovered from logs
alone on a fresh browser — we read current state from the contract instead and
treat logs as recent history only.

**Suggested improvement.** A higher cap for a single address filter, or an
indexed events endpoint for arbitrary contracts.

### 9. Indexer schema drift broke a working query silently

**What we observed.** Field names changed under us (`market_id` →
`marketId`-style differences), and a previously working query began returning
errors rather than degrading.

**Why it mattered.** A schema change is indistinguishable from an outage at the
call site.

**Suggested improvement.** Versioning, or a deprecation window on field renames.

### 10. A subscription is per-contract and does not survive a redeploy

**What we observed.** Subscriptions bind to a handler address, so redeploying a
vault silently leaves the old contract subscribed and the new one deaf.

**Why it mattered.** Easy to miss, and the symptom is "automation stopped
working" with nothing in the new contract's state to explain it.

**Suggested improvement.** Worth a line in the Reactivity docs under redeploys.

### 11. `getSubscriptionInfo` reports a contract-created subscription's owner as the zero address

**What we observed.** Every subscription we created from inside a contract reads
back with `owner = 0x0`, though it behaves as owned and funded.

**Why it mattered.** It makes the owner-minimum-balance requirement impossible to
reason about from inside a contract, and cost us time while diagnosing a delivery
problem that turned out to be our own instrumentation.

**Suggested improvement.** Report the real owner, and consider exposing
subscription health — last delivery, missed count — so an application can notice
and say so.

---

## A correction worth recording

We spent significant time concluding that **Reactivity never delivered to us**.
That conclusion was wrong, and the cause was our own instrumentation: our
evidence harness passed a raw `topics` array to viem's `getLogs`, which builds
its filter from `event`/`args` and ignores that field. It therefore returned
every OracleHub log in range, and we took the first — a `DrainContinuation`, not
an `AnswerDelivered`. We had been reasoning about a block that never contained
the event we thought we were measuring.

Corrected — ABI-aware queries, validation of emitter, `topic0`, exact market id
and decoding before any verdict, and dispatch established from
`debug_traceBlockByNumber` with `callTracer` rather than from top-level
transactions — **Reactivity worked**. The `isGuaranteed` flag was not the cause
either: four events produced eight dispatches, meaning both a guaranteed
EOA-owned subscription and an ordinary vault-owned one delivered.

We record this because a negative result about someone else's platform deserves
more scrutiny than a positive one about your own code, and ours did not get it
until late. The genuine reliability issue is the one in point 1 — that
finalization does not guarantee an event — not Reactivity's dispatch.

---

## Highest-priority improvements

1. **Guarantee, or expose, `AnswerDelivered` coverage.** Reactivity-based
   products stand or fall on whether the settlement signal exists for the market
   being watched. Today an integrator cannot tell in advance.
2. **Pre-create the next window, or make future market ids derivable.** This is
   what stops a rolling sequence from being genuinely same-cadence, and it
   affects any product built on chained windows.
3. **Return fill information from `placeBinaryOrder`.** Without it, an automated
   integrator can only honestly report "placed", never "traded".
4. **Distinguish "expired, awaiting resolution" from "trading".** One status
   field would let every integrator tell a stalled market from a healthy one.
5. **Report the true subscription owner, and expose subscription health.** Last
   delivery and missed count would have saved us the entire investigation above.

---

## Final real-world proof

The architecture described here completed a **two-step dependent sequence across
two real DreamDEX settlements two hours apart, with zero manual `syncResolution`
calls**, from a single user activation:

```
10:00:01Z   Triggered → Placed → StepArmed → ChainAdvanced     (step 1)
12:00:02Z   ExposureReleased → Triggered → Placed              (step 2)
```

- Vault `0x34E1583Fc4753C2fCB3E2a818c020167A0b7A8Bc`, trader
  `0x8c2E517fC6409EddE58b4D5875e13251E492bB84`
- One `register` transaction created **both** subscriptions (`16421932`,
  `16421933`), owned by `SequenceSubscriptionManager`
  `0x88a3b51437c959ec80123f8cd12be3ae817bf529`, handler in both cases the
  trader's own vault
- The trader held **3.71 STT** throughout — no 32 STT stake
- `manualResolutionCalls: 0`

Separately, two unrelated wallets with their own vaults and rules both advanced
automatically from that one shared stake, neither holding one.

*Both steps reached `PLACED`, meaning the pool accepted the order. Sequence does
not claim a fill it did not observe — see point 3.*

Evidence in this repository:

| File | What it holds |
| --- | --- |
| [`docs/CHAINED_REACTIVITY_LIVE.json`](docs/CHAINED_REACTIVITY_LIVE.json) | The two-step unattended run above, read back from chain |
| [`docs/SHARED_REACTIVITY_LIVE.json`](docs/SHARED_REACTIVITY_LIVE.json) | Two unrelated wallets, one shared stake, both automatic |
| [`docs/SHARED_REACTIVITY.json`](docs/SHARED_REACTIVITY.json) | The owner/handler separation spike |
| [`docs/REACTIVITY_EXPERIMENT.json`](docs/REACTIVITY_EXPERIMENT.json) | The validated dispatch evidence and the retracted verdict |
| [`docs/FINDINGS.md`](docs/FINDINGS.md) | Full working notes behind this summary |
| [`docs/VERIFIED.md`](docs/VERIFIED.md) | Every address and constant, measured rather than assumed |

Happy to go deeper on any of this — the harnesses that produced each file are in
`app/web/scripts/`.
