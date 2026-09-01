#!/usr/bin/env bash
set -euo pipefail
PKG="node_modules/@somnia-chain/reactivity-contracts/contracts"

echo "=== does the package ship a README with a usage example? ==="
find node_modules/@somnia-chain/reactivity-contracts -iname 'README*' -exec sed -n '1,120p' {} \;

echo ""
echo "=== SubscriptionFilter + subscribe signature (from SomniaExtensions) ==="
grep -nA12 'struct SubscriptionFilter' "$PKG/interfaces/SomniaExtensions.sol"
echo "---"
grep -nA8 'function subscribe' "$PKG/interfaces/SomniaExtensions.sol"
echo "---"
grep -nA8 'function defaultSubscriptionOptions' "$PKG/interfaces/SomniaExtensions.sol"
