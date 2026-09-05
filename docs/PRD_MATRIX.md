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
| **Automatic Reactivity delivery.** A settlement invokes the vault with no human in the loop. | `SequenceVault.onEvent` (selector `0x53edf33d`), subscription created by `subscribeAllMarkets()`; live subscription `16077958`. | Subscription reads back correct from the precompile. The handler has **never** been observed to be invoked. `docs/REACTIVITY_EXPERIMENT.json`. | **FAIL (external)** | Delivery does not happen on Shannon. Ruled out: filter, owner balance, priority fee, gas limit, handler revert, and `isGuaranteed: false` — the last by subscribing raw with `isGuaranteed: true` from a funded EOA (`16072852`). The resolving block `479937799` held 10 txs, none to the vault and none from the precompile. Classified as a platform limitation, not a Sequence defect. Mitigated by the row below. |
| **Permissionless recovery.** A stalled sequence must be recoverable by anyone, without privileged access. | `syncResolution(bytes32 marketId)` — reads `isVoided`/`isResolved`/`payoutNumerators` from the market contract and runs the identical state machine behind the same idempotency key. | On chain: `ResolutionSynced -> Triggered -> Placed` (`0x07adeb99…`). 18 tests in `SequenceSync.t.sol` covering replay, late delivery, pause, cap, void and stop. | **PASS** | None. This is why the Reactivity row is survivable rather than fatal. |
| **Successor trade.** The outcome of one market decides which side of the next market is bought. | `_applyResolution` reads the winning outcome from chain and dispatches `actionOnWin0` / `actionOnWin1` into `placeBinaryOrder`. | Order id `110680464442257315396` placed into BTC 1h off a BTC 5m settlement. `docs/LIVE_FIRE.json` run 2. | **PASS** | None. |
| **Per-outcome stop.** Either side can independently be Buy YES, Buy NO, or Stop. | `ACT_STOP = 255` honoured on both branches. | `test_stop_on_win0_places_nothing`, `test_stop_on_win1_places_nothing`, `test_stop_still_consumes_the_resolution`, `test_sync_honours_a_stop_branch`. | **PASS** | None. |
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
| **Markets SDK integration.** The official SDK must be genuinely used, not merely installed. | `src/chain/positions.js` reads the module's market record (`binaryModuleReadAbi`), settlement (`binarySettlementAbi`), outcome balances (`erc6909Abi`), the settlement key (`marketKey`) and addresses (`SOMNIA_TESTNET_ADDRESSES`). Runtime dependency. The Dashboard renders the result and offers redemption. | The SDK address book cross-checks our independently verified constants (module, oracle hub, collateral all identical). Live reads returned correct settlement and balances for two vaults. | **PASS** | Order placement still goes through the vault's own calls rather than the SDK's write helpers, because the vault must place orders itself — an SDK client cannot sign for it. |
| **Order sizing against real pool rules.** Orders must respect tick, lot and minimum quantity, and cost must be computed correctly. | `sizeOrder` / `orderCost` against `getOrderBookParameters()`; cost is `price × quantity / 1e6`. | 23 unit tests; the live order sized to `4366000 @ $0.4580 = $1.9996` against a `$2.0000` cap. | **PASS** | None. |

---

## Summary

| Verdict | Count |
| --- | --- |
| PASS | 11 |
| PARTIAL | 0 |
| FAIL | 1 (Reactivity delivery, external) |

The single FAIL is a platform behaviour we can demonstrate but cannot fix from
inside the product: the precompile does not invoke the handler on Shannon, under
any configuration the platform documents, including the one its own tooling does
not expose. Sequence keeps Reactivity as the primary path, says plainly that it
has not been seen to deliver, and closes the hole with a permissionless recovery
that is proven on chain. Every other core requirement passes with a transaction
or a test behind it.
