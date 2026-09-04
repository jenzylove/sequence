# Verified interface facts (Shannon)

Source of truth: `@somnia-chain/markets-sdk` (installed locally, 0.25.0+) + official
dreamDEX developer docs. Nothing here is a hand-supplied signature or hash.

## Resolution event (the load-bearing fact)
- Signature: `AnswerDelivered(uint256 oracleQuestionId, bytes32 marketId, uint32 payoutDenominator, uint256[] payoutNumerators, bool voided)`
- Canonical: `AnswerDelivered(uint256,bytes32,uint32,uint256[],bool)`
- Indexed: `oracleQuestionId` (topic1), `marketId` (topic2). Non-anonymous.
- topic0: `0x981074cb1e0ea7eac4cbc8c4c9ddbef8b964373e7e8cd0904c8e0951c4430541`
- Emitter: OracleHub `0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b`
- Derived via: `viem.toEventSelector(oracleHubEventsAbi.AnswerDelivered)`

## Why not `Resolved(uint8)`
No `Resolved`/`Voided` event exists in any shipped ABI. Market Resolved(4)/Voided(5)
are STATUS values read from market state, not filterable events. The real reactive
signal is the OracleHub `AnswerDelivered`. Outcome comes from the payout vector
(`payoutNumerators`/`payoutDenominator`), and `voided` is an explicit bool.

## Addresses (testnet == mainnet via CREATE3, except collateral)
- OracleHub:          0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b
- BinaryMarketsModule:0x3ecC694Cef705358864a646142ac17A90E29e388
- MarketsCore:        0x2802504314685D89bF6C992CA5a8e7cC78bc0294
- BinarySettlement:   0xbF4a49e0Dfd092e5FBE8E5761064C49533e6Ed23
- OutcomeToken6909:   0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9
- Test USDC (6dp):    0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E

## Reactivity
- Precompile / caller: 0x0000000000000000000000000000000000000100
- Handler base: SomniaEventHandler (@somnia-chain/reactivity-contracts)
- Filter: emitter + eventTopics (topic0, optionally topic2=marketId)
- Guarantee: event + state delivered atomically from the same block.

## Successor action constraints (from functions docs)
- Use `placeOrderFor(owner, ...)` selector 0x80054449; owner grants it via operator registry.
- Owner should be in MANUAL VAULT MODE with pre-deposited collateral (handler can't send msg.value).
- Testnet builder cap = 0 -> builder = address(0), builderFeeBpsTimes1k = 0.
- expireTimestampNs is NANOSECONDS and strictly future.


## Sequence deployment (current)

| What | Address / value |
| --- | --- |
| SequenceVaultFactory | `0x43c7ce4E7eFAAa5D7452334Cc3FB973CEe1611cc` |
| SequenceVault (author's, created by the factory) | `0x78dcAD22f904AE1cE156f4409D312C1438C93ef2` |
| Reactivity subscription | `16022724` |
| Outcome token singleton (ERC-6909) | `0xB52c5934113Af5c0Bb20eb3C72290C8215f755b9` |

Subscription options in use, read back from the precompile via
`getSubscriptionInfo`: topic0 `AnswerDelivered`, emitter OracleHub, handler the
vault, selector `0x53edf33d`, priorityFeePerGas 1 gwei, maxFeePerGas 40 gwei,
gasLimit 10,000,000, isGuaranteed false.

`SomniaExtensions.SUBSCRIPTION_OWNER_MINIMUM_BALANCE` is 32 ether and the
subscribing contract's balance drifts down over time, so the vault is funded to
35 SOM rather than exactly 32. Falling under the minimum is silent.

## Order units (measured, not assumed)

`BinaryPool.getOrderBookParameters()` on Shannon binary pools returns
`tickSize 1000, minQuantity 1000, lotSize 1000`. Prices are 6dp fractions of one
collateral unit and quantities are 6dp base units, so an order costs
`price * quantity / 1e6`. An order below `minQuantity` REVERTS
(`QuantityBelowMinimum(given, minimum)`) rather than returning false.
