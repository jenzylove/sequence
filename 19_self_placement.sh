#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check
PKG="node_modules/@somnia-chain/markets-sdk"

echo "=== find Trader / placeOrder routing in SDK source ==="
grep -rl "placeBinaryOrder" "$PKG" 2>/dev/null | head -20

echo ""
echo "=== how the SDK calls placeBinaryOrder (context lines) ==="
grep -rn "placeBinaryOrder" "$PKG" 2>/dev/null | grep -v '.d.ts' | head -30

echo ""
echo "=== does the SDK deposit to vault, or approve+auto-pull, before placing? ==="
grep -rniE "manualVault|deposit\(|approve\(|allowance|transferFrom|autoPull|vault" "$PKG"/dist 2>/dev/null | grep -viE '.d.ts|sourcemap' | head -40

echo ""
echo "=== placeBinaryOrder self signature (from installed ABI) ==="
node -e "const s=require('@somnia-chain/markets-sdk'); const f=s.binaryPoolWriteAbi.find(x=>x.name==='placeBinaryOrder'); console.log(JSON.stringify(f,null,1));"

echo ""
echo "=== binary pool funding fns actually present ==="
node -e "const s=require('@somnia-chain/markets-sdk'); console.log(s.binaryPoolWriteAbi.filter(x=>x.type==='function'&&/deposit|withdraw|approve|vault|mint|burn/i.test(x.name)).map(x=>x.name).join(', '));"
