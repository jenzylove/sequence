# Integration findings — DreamDEX Event Contracts on Somnia

This is Sequence's hackathon feedback report: concrete issues and useful platform observations discovered while building a rolling Event Contract product against real Shannon state.

Sequence depends on three things at once: DreamDEX market lifecycle, OracleHub resolution delivery and order placement from a user-owned vault. The findings below are intentionally limited to behaviour we actually observed.

## 1. Market lifecycle state can lag reality

We observed expired markets that still appeared as `Trading` through the indexer while direct chain reads later showed that they had finalized normally.

Why it matters: an integrator cannot treat `clobStatus` alone as truthful lifecycle state. A frontend must also reason about expiry and finalized state or it can show a market as tradeable after its window has ended.

Suggestion: expose a first-class `Expired` / `AwaitingResolution` state, or a reliable resolution-health field that makes lifecycle transitions explicit.

## 2. Reactivity works — but evidence tooling must filter events correctly

Our first Reactivity investigation was wrong. We passed a raw `topics` array to viem's `getLogs`; viem ignored that option and returned unrelated OracleHub logs. The harness then interpreted those logs as failed `AnswerDelivered` deliveries.

After switching to ABI-aware event filtering and validating emitter, topic0, indexed market id and decoded payload, we observed Reactivity dispatch successfully.

In block `480220742`, four validated `AnswerDelivered` events produced eight `onEvent` calls from the Reactivity precompile, none reverting. One armed Sequence vault advanced `StepArmed -> Triggered -> Placed` with no manual `ResolutionSynced` event.

Why it matters: negative claims about delivery need independently validated event evidence. Silent acceptance of unsupported client options can create very convincing false diagnoses.

Suggestion: SDK examples should show the canonical viem event-filtering pattern and discourage raw topic options where the client API does not support them.

## 3. Reactivity can only deliver an event OracleHub actually emits

A finalized market does not always receive a corresponding `AnswerDelivered` event. We observed delivery become quiet for stretches and the set of answered market cadences vary over time.

An early sample made it look as if only 1h/4h markets were supported. A broader later sample included roughly 120s, 3600s, 14400s and 86400s intervals. The correct conclusion is not a fixed supported-cadence list; delivery is intermittent by market series over time.

Why it matters: a correct Reactivity subscription cannot advance a market for which OracleHub never emitted the watched event.

What Sequence does: Reactivity is primary, while permissionless `syncResolution` is a recovery path that reads the same finalized market state and shares the same idempotency boundary.

Suggestion: expose a queryable OracleHub delivery-health surface: recent answered series, last delivery per series, or an explicit guarantee for which market families emit `AnswerDelivered`.

## 4. Indexer schema drift can turn a working integration into an empty one

We built against snake_case fields such as `market_id` / `oracle_question_id`; later the live schema used camelCase names such as `marketId` / `oracleQuestionId`.

Why it matters: depending on error handling, schema drift can look like "no markets" rather than "the API changed."

Suggestion: version the schema or provide a deprecation window when renaming fields.

## 5. `intervalSec` is measured, not a stable cadence identity

Nominal 1m / 5m / 15m / 1h windows can report slightly different measured spans. We observed values such as 298/300 and 898/900.

Why it matters: grouping rolling markets by exact `(asset, intervalSec)` silently fails even when the markets are obviously the same product cadence.

What Sequence does: snap measured durations to a small set of nominal cadence buckets.

Suggestion: expose a canonical cadence or stable series identifier separate from measured duration.

## 6. The next same-series market may not exist yet

At a given time we typically observed only one open window for an `(asset, cadence)` series. The next window is created after the current one settles.

Why it matters: a rolling strategy wants to precommit "after BTC 15m settles, trade the next BTC 15m," but there may be no successor market id to store when the strategy is armed.

What Sequence does: only offers successors that already exist and clearly labels cadence substitution when the next trade must use another open window.

Suggestion: pre-create the next window, or expose a deterministic successor reference that can be stored before the market is instantiated.

## 7. The binary order book is naturally quoted in YES terms

Across sampled open orders, the useful visible sides were YES bids/asks. Buying NO therefore requires using the complement of the YES side rather than naively reading the same ask.

Why it matters: treating the YES ask as the NO price creates systematically wrong orders.

Suggestion: document the complement relationship next to the binary order-side API, or expose derived NO-side book helpers.

## 8. Quantity units and minimums are easy to misread

Measured Shannon pool parameters included:

```text
tickSize    1000
minQuantity 1000
lotSize     1000
```

Price and quantity use 6-decimal units, so notional is `price * quantity / 1e6`.

We initially treated quantity as whole contracts, producing a one-million-times notional error. Orders below the pool minimum revert rather than returning a simple refusal.

Suggestion: add one worked order example showing price, quantity, minimum and resulting collateral notional.

## 9. Order acceptance is not fill evidence

`placeBinaryOrder` can return success and an order id when the pool accepts the order. That does not prove how much filled.

Why it matters: a callback-driven product should not show "executed" when the contract can only observe acceptance.

What Sequence does: records `PLACED`, never `EXECUTED`, and only claims the evidence available to the vault.

Suggestion: expose filled quantity in the return surface, or document a reliable post-placement mechanism for a handler to learn its own fill.

## 10. Log-range limits are tight relative to Somnia block speed

We hit an `eth_getLogs` maximum range of roughly 1000 blocks. On Shannon's block cadence that is a very small wall-clock window.

Why it matters: reconstructing long-lived user history directly from logs requires aggressive pagination or an application index.

Suggestion: allow larger ranges for a single contract address, or provide an indexer-backed event-history endpoint.

## 11. Reactivity ownership/stake ergonomics are difficult for per-user products

The native Reactivity owner minimum is 32 tokens. Requiring every user vault to carry that stake would make a consumer product unrealistic.

Somnia's separation between subscription owner and handler is powerful and let us solve this cleanly: Sequence's shared `SequenceSubscriptionManager` owns subscriptions/stake while each user's own vault remains the handler.

What still hurts: subscription ownership/health is not easy to reason about from contract-created subscriptions. During development, the absence of a clear health surface made it hard to tell whether a subscription was funded, active and delivering.

Suggestion: expose subscription owner attribution, current funded balance, last successful delivery and missed/failed delivery counters.

## What worked well

- The canonical OracleHub event is deterministic and rich enough to drive a bounded branch decision.
- Reactivity did successfully invoke user vaults and support unattended execution once observed with a correct harness.
- The owner/handler separation is flexible enough to support a shared-stake product architecture without giving shared infrastructure custody of user funds.
- DreamDEX's onchain market state gave us enough deterministic truth to implement a safe `syncResolution` recovery path.
- Stable core contract addresses make it practical to build strongly verified interfaces around the protocol.

## Final product proof

The corrected architecture completed the product's core thesis on Shannon:

```text
one activation
-> one shared-manager registration
-> Step 1 Triggered -> Placed
-> Step 2 armed automatically
-> two hours later Step 2 Triggered -> Placed
-> zero manual syncResolution calls
```

Full evidence is in `docs/CHAINED_REACTIVITY_LIVE.json`. Two-user shared-stake evidence is in `docs/SHARED_REACTIVITY_LIVE.json`.
