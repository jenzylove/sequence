#!/usr/bin/env bash
set -euo pipefail

echo ">> sequence spike :: scaffold"

# --- guard: must be inside an empty-ish sequence dir ---
if [ -f "foundry.toml" ]; then
  echo "!! foundry.toml already exists. Refusing to overwrite. Aborting."
  exit 1
fi

# --- folders ---
mkdir -p src test script lib docs

# --- foundry config ---
cat > foundry.toml << 'TOML'
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
solc = "0.8.30"
optimizer = true
optimizer_runs = 200
# Somnia Shannon testnet
[rpc_endpoints]
shannon = "https://dream-rpc.somnia.network"
TOML

# --- verified constants, single source of truth ---
# Everything here was derived from @somnia-chain/markets-sdk ABIs + docs,
# NOT hand-typed signatures. See docs/VERIFIED.md for provenance.
cat > src/Verified.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title Verified DreamDEX / Somnia constants (Shannon testnet)
/// @notice Every value here was confirmed against the shipped
///         @somnia-chain/markets-sdk ABIs and the official dreamDEX docs.
///         Do not edit by hand without re-deriving from the SDK.
library Verified {
    // Somnia Reactivity precompile (the only permitted caller of a handler)
    address internal constant REACTIVITY_PRECOMPILE = 0x0000000000000000000000000000000000000100;

    // OracleHub is the emitter of the resolution signal on Shannon.
    address internal constant ORACLE_HUB = 0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b;

    // BinaryMarketsModule: markets(marketId) registry + user entrypoint.
    address internal constant BINARY_MODULE = 0x3ecC694Cef705358864a646142ac17A90E29e388;

    // Testnet collateral (test USDC, 6 decimals).
    address internal constant TEST_USDC = 0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E;

    // topic0 of AnswerDelivered(uint256,bytes32,uint32,uint256[],bool)
    // derived via viem toEventSelector over oracleHubEventsAbi.
    bytes32 internal constant ANSWER_DELIVERED_TOPIC0 =
        0x981074cb1e0ea7eac4cbc8c4c9ddbef8b964373e7e8cd0904c8e0951c4430541;

    // placeOrderFor selector (operator-placed order). From dreamDEX functions docs.
    bytes4 internal constant PLACE_ORDER_FOR_SELECTOR = 0x80054449;

    // Lifecycle status values read from market state (NOT events).
    uint8 internal constant STATUS_TRADING  = 1;
    uint8 internal constant STATUS_RESOLVED = 4;
    uint8 internal constant STATUS_VOIDED   = 5;
}
SOL

# --- provenance record ---
cat > docs/VERIFIED.md << 'MD'
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
MD

# --- .gitignore ---
cat > .gitignore << 'GI'
out/
cache/
lib/
.env
node_modules/
broadcast/
GI

# --- README stating the honest scope of the spike ---
cat > README.md << 'RM'
# sequence (technical spike)

Proving ONE path, not building the product:

real DreamDEX resolution on Shannon (OracleHub `AnswerDelivered`)
  -> Somnia Reactivity invokes our Solidity handler
  -> handler deterministically prepares/triggers one bounded successor DreamDEX action.

## Scope honesty
- Mechanics are proven deterministically against a controlled emitter we own that
  re-emits the EXACT verified `AnswerDelivered` signature (test/ + a local emitter).
- A live subscription script points at the REAL OracleHub + a real marketId so a
  genuine window resolution can be observed invoking the handler.
- These two are labelled separately. The controlled harness is NOT the live proof.

NOT in this spike: frontend, the full strategy engine, multi-step sequences.

See docs/VERIFIED.md for interface provenance.
RM

echo ">> installing forge-std + somnia reactivity contracts (git)"
if [ ! -d ".git" ]; then git init -q; fi

# forge-std
if [ ! -d "lib/forge-std" ]; then
  git submodule add -q https://github.com/foundry-rs/forge-std lib/forge-std || \
  forge install foundry-rs/forge-std --no-git 2>/dev/null || \
  echo "!! forge-std install needs manual: run 'forge install foundry-rs/forge-std'"
fi

echo ""
echo ">> scaffold done. Files created:"
find . -type f -not -path './lib/*' -not -path './.git/*' | sort
