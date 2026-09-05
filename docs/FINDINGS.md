# Integration findings: DreamDEX Event Contracts on Somnia

Notes from building **Sequence**, an outcome-driven execution product for rolling
Event Contracts. Sequence arms a bounded rule before a market settles; Somnia
Reactivity delivers the resolution to a vault, which places or declines the next
order on its own.

That shape leans on three things at once: the resolution event, the market
lifecycle, and the CLOB. Everything below was hit while making those work, and
each item lists what we actually observed rather than what we expected.

Surface used: the Somnia markets indexer (GraphQL) for discovery, `viem` against
Shannon for reads and writes, `@somnia-chain/reactivity-contracts` for the
handler base. Addresses and the event signature were derived from
`@somnia-chain/markets-sdk` and are recorded in `docs/VERIFIED.md`.

---

## 1. A resolution outage is indistinguishable from a healthy market

**Observed.** Binary markets normally finalize within 0–2 seconds of expiry. We
measured six consecutive resolutions at 0s, 0s, 0s, 1s, 2s, 2s after expiry.

Then resolutions stopped. Twenty-seven minutes later, **60 binary markets were
past expiry and unfinalized**, and every one of them still reported:

```
clobStatus: "Trading"
finalized: false
resolvedAtTimestamp: null
```

The oldest unresolved market in that set was **3,863,311 seconds — about 45 days —
past its expiry**, still labelled `Trading`.

A correction to an earlier draft of this note: we first read that backlog as an
oracle outage. It was not. Markets we later checked individually had resolved
within about two seconds of expiry, and the indexer's `finalized` flag was
simply stale for them. The reporting gap is the finding; the oracle was working.

**Why it matters.** `clobStatus` is the field an integrator naturally treats as
"can I trade this". It never transitions for a market that expired and was never
resolved, so a stalled or abandoned market is indistinguishable from a live one
by status alone. Every consumer has to reimplement `expiry < now && !finalized`
to get a truthful answer, and nothing signals the difference between "resolving
shortly" and "never resolved, 45 days ago".

**Suggestion.** Either transition `clobStatus` away from `Trading` once `expiry`
has passed, or expose a resolution-health field (last oracle answer per series,
or an explicit `Expired` / `AwaitingResolution` state). A queryable "oracle last
delivered at" would let applications tell users the truth instead of showing a
countdown that has already finished.

**Impact on us.** Our live-fire proof is currently blocked on this. The vault is
armed correctly, the subscription is live, and the step is sitting in `ARMED`
waiting for a resolution the venue has not published. Nothing on our side can
make progress, and nothing in the API says so.

---

## 1b. Reactivity does deliver. Our evidence harness was wrong.

**Withdrawn.** This section previously reported that a Reactivity subscription
never delivered, on four vaults, with the obvious causes ruled out. That report
was wrong and is retracted in full. Reactivity delivers, and it drove a real
Sequence execution end to end.

**What actually happened.** The harness that produced the original finding
queried logs like this:

```js
pub.getLogs({ address: ORACLE_HUB, fromBlock, toBlock,
              topics: [ANSWER_DELIVERED_TOPIC0, null, marketId] });
```

viem's `getLogs` builds its topic filter from `event` and `args`. It does not
accept a raw `topics` array, and it does not complain about one — it silently
returns every log from the address in the range. The harness then took the first
result and treated it as our `AnswerDelivered`.

Demonstrated directly over blocks 479937700-479937899: filtering on an
*impossible* market id, the raw-topics query still returned a log, while the
ABI-aware query returned nothing. The window held exactly one OracleHub log and
it was a `DrainContinuation(uint256,uint256)`. So the block we cited as proof
that "the event fired and the handler did not" never contained the event at all.
The same evidence file recorded `matchesSubscriptionFilter: false` beside a
hard-coded sentence claiming it matched.

**What the corrected harness shows.** Querying with `parseAbiItem` and indexed
`args`, validating emitter, topic0, market id and decoding, then reading the
block's full call tree with `debug_traceBlockByNumber` and `callTracer`:

> Block `480220742` carried 4 validated `AnswerDelivered` events. The Reactivity
> precompile `0x…0100` made **8 calls to the vault**, every one with selector
> `0x53edf33d` (`onEvent`), at depth 0, **none reverting**.

One of those markets, `0x…13fc7`, was our own armed trigger. The vault went
`StepArmed -> Triggered -> Placed` in tx `0xdbff2003deb11bb3…` with **no
`ResolutionSynced`** anywhere in the timeline. The sequence executed on its own.

**`isGuaranteed` was not the cause either.** Four events produced eight
dispatches — two per event — because both subscriptions delivered: the EOA-owned
one with `isGuaranteed: true` *and* the vault-owned one created through
`subscribeAllMarkets()` with `isGuaranteed: false`. The flag hypothesis is
withdrawn along with the rest.

**The lesson worth keeping.** Three of them:

- A negative result about someone else's platform deserves more scrutiny than a
  positive one about your own code, not less. This one survived four vaults and
  six ruled-out causes because every test used the same broken observer.
- An evidence file that disagrees with itself is telling you something. Ours
  printed `matchesSubscriptionFilter: false` next to a conclusion that it
  matched, and that contradiction sat in the repository unexamined.
- A library that ignores an unrecognised option is a hazard. `getLogs` accepted
  `topics`, returned plausible-looking data, and never signalled anything.

The harness now refuses to write any verdict without a validated event, records
the caller and selector of every dispatch frame rather than a count, and a
readiness check (`#19`) blocks the build if an evidence file contradicts itself.

**What still stands as a genuine platform observation.** Neither
`SomniaExtensions` nor the SDK's `subscribe()` exposes `isGuaranteed`; only the
precompile's raw entry does. And `getSubscriptionInfo` reports the owner of every
contract-created subscription as the zero address, which makes the 32 SOM owner
minimum impossible to reason about from inside a contract. A readable
subscription health view — last delivery, missed count, attributed owner — would
have made this entire investigation unnecessary.

## 2. Indexer schema drift broke a working query silently

**Observed.** Our resolution fetcher was written against fields like
`market_id` and `oracle_question_id`. Later the same query failed with:

```
field 'market_id' not found in type: 'Market'
```

The schema had moved to camelCase (`marketId`, `oracleQuestionId`).

**Why it matters.** The failure mode is a hard error if you check for it and an
empty result set if you do not. A strategy engine that reads "no resolutions"
and a strategy engine that reads "the schema changed" behave very differently.

**Suggestion.** A versioned endpoint, or a deprecation window serving both
spellings, would let integrators migrate without a silent behavioural change.

---

## 3. `intervalSec` is not canonical, so windows cannot be grouped on it

**Observed.** The nominal cadences are 1m / 5m / 15m / 1h / 4h / 1d, but the
indexer reports the measured span. In one snapshot we saw:

```
298, 300, 898, 900, 3163, 3164, 3600, 45, 47, 56, 60, 89, 92
```

**Why it matters.** "Roll BTC 15m into the next BTC 15m" is the product. Grouping
markets by `(asset, intervalSec)` looks like the obvious way to find the next
window, and it silently produces zero matches when one window reports 898 and the
next reports 900. We shipped a bug from exactly this: our builder dead-ended on
"Loading live markets" forever because no two windows agreed on a cadence. We now
snap to the nearest standard bucket, which is a workaround, not a fix.

**Suggestion.** Expose the *nominal* cadence as its own field (or a `series` key
that is stable across windows) separately from the measured span. `series_id`
exists on the type but was `null` on every row we saw.

---

## 4. Only one window per series is open at a time

**Observed.** At any moment, each `(asset, cadence)` series has exactly one
market open. The next window is created after the current one settles.

**Why it matters.** A sequence has to name the market it will trade into *at arm
time*, minutes before it fires. If the successor window does not exist yet, there
is nothing to point at. We work around this by chaining into the next open window
of the same asset at a different cadence, which is honest but is not what the
user asked for when they said "roll BTC 15m".

**Suggestion.** Pre-create the next window while the current one is trading, or
expose a deterministic successor identifier (series + index) that can be
referenced before the market exists. This is the single change that would most
improve rolling-strategy products.

---

## 5. The binary book is quoted in YES terms only

**Observed.** Every resting order we sampled was `BUY_YES` or `SELL_YES`. Across
200 open orders: 100 `BUY_YES`, 95 `SELL_YES`, 5 with a null side. No `BUY_NO` or
`SELL_NO` rows exist.

**Why it matters.** Buying NO is not a lookup, it is a derivation: the best NO ask
is the complement of the best YES bid, `1 - bestBidYes`. An integrator who reads
"best ask" and uses it for a NO order will price the order on the wrong side of
the book. We shipped this bug: a fixed $0.60 limit crossed fine for YES and
**never crossed at all for NO**, because on a live market the best YES bid was
$0.330, making the NO ask $0.670.

**Suggestion.** Document the complement relationship next to the order side enum,
or expose a derived NO book. The `kind` enum (`0 BUY_YES, 1 SELL_YES, 2 BUY_NO,
3 SELL_NO`) implies four sides of a book that is actually quoted on two.

---

## 5b. Quantity units and pool minimums are easy to get wrong, and the pool reverts

**Observed.** `placeBinaryOrder` takes a price and a quantity, and we assumed
whole contracts. The pool's `getOrderBookParameters()` returns
`tickSize 1000, minQuantity 1000, lotSize 1000`, and an order of quantity 2
reverts `QuantityBelowMinimum(2, 1000)` rather than returning `false`.

Quantities are base units in 6 decimals and prices are 6-decimal fractions of one
collateral unit, so an order costs `price * quantity / 1e6`. We had been
computing `price * quantity`, which overstates the commitment by a factor of a
million and made every risk cap unreachable.

**Why it matters.** Two compounding traps. The units error is silent — the
arithmetic works, it is just wrong by 1e6 — and the minimum-quantity error
*reverts*, which for a contract acting inside a callback aborts the whole frame
and leaves it with no record of why. We now catch the revert and record a skip.

**Suggestion.** A worked example in the docs showing cost for a given price and
quantity would remove the units ambiguity entirely. Returning `false` rather than
reverting for order-validation failures would let callback-driven integrations
record a refusal instead of losing the frame.

---

## 6. Order acceptance is visible; fills are not

**Observed.** `placeBinaryOrder` returns `(bool success, uint128 id)`. That
boolean reports acceptance, not execution. An IOC can be accepted and fill zero.

**Why it matters.** Inside a Reactivity callback there is no practical way to
observe the fill: `OrderFilled` is emitted after our frame, and reading balances
before and after is not available for an order that rests. We initially wrote
`status = EXECUTED` on `success`, which would have shown a trader "trade placed"
when nothing had traded. We now record `PLACED` and say "the order was accepted",
which is all we can honestly claim.

**Suggestion.** A return value carrying filled quantity, or a documented pattern
for a handler to learn its own fill, would let reactive products report economic
truth rather than transaction truth. This is the single biggest correctness gap
for anything that automates trading from a callback.

---

## 7. `eth_getLogs` is capped at 1000 blocks on a sub-second chain

**Observed.** Any wider range returns `block range exceeds 1000`. Shannon was at block
~479,579,000 during this work, having advanced roughly 1.6 million blocks over a
single working session.

**Why it matters.** 1000 blocks is a very short wall-clock window at Somnia's
block time. Reconstructing a contract's own history from logs means either
thousands of paginated calls or keeping an off-chain index. We ended up storing
the block number at arm time and scanning forward from it, which means a user who
opens the app on a second device cannot see their own history.

**Suggestion.** A larger cap for single-address queries, or an indexer-backed log
endpoint scoped to a contract, would remove the need for every application to
keep its own pointer.

---

## 8. A Reactivity subscription is per-contract and does not survive a redeploy

**Observed.** Subscribing stakes 32 SOM from the subscribing contract. The
subscription belongs to that address, so any contract change means redeploy,
re-stake, re-subscribe.

**Why it matters.** During development the contract changed several times. Each
iteration costs a fresh 32 SOM stake and a manual re-subscription, which is
enough friction to discourage exactly the iteration a hackathon expects. It also
makes it easy to ship a product whose vault is silently not listening — we hit
this: a migrated vault held collateral and looked healthy while having no
subscription at all, and nothing in the contract surface flagged it.

**Suggestion.** Allow a subscription to be transferred or re-pointed to a new
implementation, or support an upgradeable handler address behind the
subscription. Failing that, a `isSubscribed()` style helper that products can
surface would reduce the chance of a dead deployment looking alive.

---

## 9. Pool addresses are recycled between windows (the docs are right)

**Observed.** We confirmed the warning in the developer docs: a pool address is
not a stable identity for a market. We now re-read the market from
`BinaryMarketsModule.markets()` immediately before arming and compare the pool,
which correctly detects a moved pool.

**Noting it because** it is easy to cache a pool address from the indexer at
build time and use it minutes later at execution time, which is precisely the
shape of a delayed-execution product. The warning deserves to be louder than a
gotchas page — perhaps a note on the pool field in the indexer schema itself.

---

## What worked well

- **`AnswerDelivered` is the right event.** Indexed `oracleQuestionId` and
  `marketId`, the payout vector and an explicit `voided` bool in the payload.
  Everything needed to decide an outcome arrives in one event, with no follow-up
  read required for the common case.
- **Atomic event-and-state delivery** from Reactivity meant we could cross-check
  the event's `questionId` against the module's record inside the same frame, and
  reject a mismatch. That check is cheap and made the vault meaningfully safer.
- **The indexer is genuinely rich.** Candles, fills, orders, resolution events and
  redemption records are all queryable. Most of what we needed was one query away
  once the field names were right.
- **CREATE3 address parity** between testnet and mainnet removed a whole class of
  configuration branching.

---

## Reproducing the main finding

```bash
# Binary markets past expiry that are still labelled Trading
curl -s -X POST https://dev.smk.somnia.host/v1/graphql \
  -H 'content-type: application/json' \
  -d '{"query":"{ Market(where:{marketType:{_eq:\"BINARY\"}, finalized:{_eq:false}}) { asset intervalSec expiry clobStatus } }"}'
```

Filter client-side for `expiry < now`. At the time of writing this returns 60
rows, all `clobStatus: "Trading"`, the oldest ~45 days past expiry.

---

*Filed from the Sequence build. Contract, tests and the live-fire harness are at
`github.com/jenzylove/sequence`; the armed run these notes refer to is recorded
in `docs/LIVE_FIRE.json`.*
