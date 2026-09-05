# PRD conformance matrix

Every row states what the PRD asks for, what actually implements it, the evidence
that it works, and what is still missing. "Proof" means a transaction, a recorded
evidence file or a test — never an assertion in prose.

Deployed at the time of writing: factory `0xF492234a4b522D19dd76dBB435ad9471a652f950`,
vault `0x0185CA254C9e7b184b566e7037160334519cC9f6`, Shannon testnet (50312).

---

## Core execution

| Requirement | Implementation | Proof | Verdict | Gap |
| --- | --- | --- | --- | --- |
| **Automatic Reactivity delivery.** A settlement invokes the vault with no human in the loop. | `SequenceVault.onEvent` (selector `0x53edf33d`). Two live subscriptions: vault-owned `16077958`, and EOA-owned `16154782` with `isGuaranteed: true` created through the precompile's raw `subscribe`, which is the only entry that exposes the flag. | Both subscriptions read back correct on every field (11/11 checks). No validated matching `AnswerDelivered` has yet been captured while a subscription was live, so dispatch has not been measured either way. `docs/REACTIVITY_EXPERIMENT.json`, status `INCONCLUSIVE`. | **UNRESOLVED** | An earlier **FAIL (external)** verdict here has been withdrawn: it rested on a log that was a `DrainContinuation`, not an `AnswerDelivered`, because the harness used a topic filter viem silently ignores. Nothing is claimed until a validated event is captured and the block's full call trace is inspected. Mitigated meanwhile by permissionless recovery, below. |
| **Permissionless recovery.** A stalled sequence must be recoverable by anyone, without privileged access. | `syncResolution(bytes32 marketId)` — reads `isVoided`/`isResolved`/`payoutNumerators` from the market contract and runs the identical state machine behind the same idempotency key. | On chain: `ResolutionSynced -> Triggered -> Placed` (`0x07adeb99…`). 18 tests in `SequenceSync.t.sol` covering replay, late delivery, pause, cap, void and stop. | **PASS** | None. This is why the Reactivity row is survivable rather than fatal. |
| **Successor trade.** The outcome of one market decides which side of the next market is bought. | `_applyResolution` reads the winning outcome from chain and dispatches `actionOnWin0` / `actionOnWin1` into `placeBinaryOrder`. | Order id `110680464442257315396` placed into BTC 1h off a BTC 5m settlement. `docs/LIVE_FIRE.json` run 2. | **PASS** | None. |
| **Per-outcome stop.** Either side can independently be Buy YES, Buy NO, or Stop. | `ACT_STOP = 255` honoured on both branches. | `test_stop_on_win0_places_nothing`, `test_stop_on_win1_places_nothing`, `test_stop_still_consumes_the_resolution`, `test_sync_honours_a_stop_branch`. | **PASS** | None. |
| **Evidence integrity.** No verdict may rest on an unvalidated observation, and evidence files must not contradict themselves. | The Reactivity harness validates emitter, topic0, topic2 and decoding before a verdict is permitted, and writes `INCONCLUSIVE` with no verdict when validation fails. Redemption evidence derives its summary from the proof. Readiness check `#19` blocks on any contradiction. | `#19` passes; a deliberate scan with an impossible market id returns nothing under the corrected query. | **PASS** | Added after independent review found a verdict written beside `matchesSubscriptionFilter: false`. |
| **Truthful status.** The interface must not claim an order that the pool rejected. | `placeBinaryOrder` wrapped in try/catch, emitting `PlacementRejected` and `Skipped("order-rejected")`. | Observed on chain during an earlier run, and covered by tests. | **PASS** | None. |

## Capital

| Requirement | Implementation | Proof | Verdict | Gap |
| --- | --- | --- | --- | --- |
| **Settlement handling.** A settled market must be read correctly, including voids and non-unique payouts. | `readSettlement` via the SDK's `binarySettlementAbi.getSettlement(marketKey)`; winner is the argmax of the payout vector and only when unique. Contract side reads the market directly. | Read live: market `0x13bc6` returned `finalized=true, voided=false, payouts=[0, 10000000]`, winner 1. | **PASS** | None. |
| **Exposure release.** Committed notional must be freed when a position settles, or a rolling strategy blocks itself. | `releaseExposure`, and automatic release inside `_applyResolution`. | `ExposureReleased` for `0x13bc6`, amount `1999628`, in the same run. Outstanding returned to `$0.00` against the `$5.00` limit. | **PASS** | None. |
| **Redemption / capital recycle.** A won position must become collateral the strategy can spend again. | `redeemPosition(bytes32)` — permissionless, sets the module as ERC-6909 operator once, redeems the winning side (or both on a void), reverts `NothingToRedeem` rather than silently succeeding. | On chain `0xb7cc85e283b290886e83f242e123a599ca68804c588a0148fb785bada4823e34`: 4,366,000 outcome tokens → $4.3660 collateral, balance $198.0732 → $202.4392, position to zero. 12 tests in `SequenceRedeem.t.sol`. | **PASS** | Redemption is a separate call, not automatic inside the callback. Deliberate: a settlement service having a bad day must not be able to block trading (`test_a_broken_redemption_cannot_block_execution`). |
| **Risk limits.** No sequence may commit more than its account limit. | `notionalCap` per step, `maxOutstanding` per vault, `outstandingNotional` accounting. | `test_vault_cap_blocks`, `test_sync_honours_the_vault_cap`; readiness reports committed against limit. | **PASS** | None. |

## Product

| Requirement | Implementation | Proof | Verdict | Gap |
| --- | --- | --- | --- | --- |
| **Per-wallet account.** Every wallet gets its own vault; nothing is shared and nothing is hardcoded. | `SequenceVaultFactory.createVault` / `vaultFor`; drafts and working strategy keyed per wallet in `lib/store.js`. | `docs/FRESH_WALLET.json`: wallet `0x71bFaf08…` started with no account, created vault `0x98c5Fba6…`, was confirmed isolated from the author's, set its own `$3.00` limit and activated a sequence signing for itself. | **PASS** | None. |
| **Markets SDK integration.** The official SDK must be genuinely used, not merely installed. | `src/chain/positions.js` reads the module's market record (`binaryModuleReadAbi`), settlement (`binarySettlementAbi`), outcome balances (`erc6909Abi`), the settlement key (`marketKey`) and addresses (`SOMNIA_TESTNET_ADDRESSES`). Runtime dependency. The Dashboard renders the result and offers redemption. | The SDK address book cross-checks our independently verified constants (module, oracle hub, collateral all identical). Live reads returned correct settlement and balances. | **PASS** | Order placement still goes through the vault's own calls rather than the SDK's write helpers, because the vault must place orders itself — an SDK client cannot sign for it. |
| **Claimable position discovery.** The Finished tab must look for outcome tokens in the market they are actually held in. | `tradedMarketIds` resolves each `Placed` event to its stored step and takes `successorMarketId`, and also reads the market ids carried directly by `ExposureReleased` and `Redeemed`. It never infers a held market from `Triggered.marketId`. | Real chain: for the deployed vault it returns the successor `0x…13bc6` and never the trigger `0x…13c18`. 4 unit tests in `src/positions.test.mjs` pin trigger-vs-successor, discovery, the argument `Collect` passes, and that a losing side is shown rather than hidden. | **PASS** | An earlier version read `Triggered.marketId`, which is the *watched* market and can never hold outcome tokens; it would have hidden a genuinely redeemable position. Fixed. |
| **Order sizing against real pool rules.** Orders must respect tick, lot and minimum quantity, and cost must be computed correctly. | `sizeOrder` / `orderCost` against `getOrderBookParameters()`; cost is `price × quantity / 1e6`. | 23 unit tests; the live order sized to `4366000 @ $0.4580 = $1.9996` against a `$2.0000` cap. | **PASS** | None. |

---

## Summary

| Verdict | Count |
| --- | --- |
| PASS | 12 |
| PARTIAL | 0 |
| UNRESOLVED | 1 (Reactivity delivery — measurement pending) |
| FAIL | 0 |

The single unresolved row is Reactivity delivery. It is not called a failure,
because the evidence that previously supported that call did not survive review:
the harness had matched the wrong log entirely. The corrected harness refuses to
write any verdict without a validated `AnswerDelivered` — emitter, topic0, market
id and decoding all checked — and establishes dispatch from a full call trace
rather than from top-level block transactions, since a reactive callback need not
be one. Until such an event is captured under a live guaranteed subscription, the
honest state is "not measured", and that is what the product and this matrix say.

Every other requirement passes with a transaction or a test behind it, and the
permissionless recovery path means an undelivered callback costs a sequence
nothing but time.
