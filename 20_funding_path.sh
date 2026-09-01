#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check
PKG="node_modules/@somnia-chain/markets-sdk"

echo "=== how orders.ts funds a binary BUY (permit2 vs allowance) — context around placeBinaryOrder ==="
sed -n '1000,1120p' "$PKG/src/orders.ts" 2>/dev/null || sed -n '540,640p' "$PKG/dist/orders.js"

echo ""
echo "=== any Permit2 / permit / allowance / transferFrom branching in orders + writer ==="
grep -rniE "permit2|signPermit|permitSingle|allowance|transferFrom|approve\(|autoPull|auto-pull|erc20.*approve" "$PKG/src/orders.ts" "$PKG/src/writer.ts" 2>/dev/null | head -40

echo ""
echo "=== does placeBinaryOrder path require a signature? look for sign/permit near the call ==="
grep -rnB3 -A8 "functionName: \"placeBinaryOrder\"" "$PKG/src" 2>/dev/null | head -60

echo ""
echo "=== erc20WriteAbi / erc20VaultWriteAbi (is there a plain approve we can call?) ==="
node -e "const s=require('@somnia-chain/markets-sdk'); for(const n of ['erc20WriteAbi','erc20VaultWriteAbi']){const a=s[n]; console.log(n+':', Array.isArray(a)? a.filter(x=>x.type==='function').map(x=>x.name).join(', ') : 'n/a');}"
