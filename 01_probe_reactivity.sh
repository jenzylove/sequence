#!/usr/bin/env bash
set -euo pipefail

echo ">> installing @somnia-chain/reactivity-contracts locally to inspect"
npm init -y >/dev/null 2>&1 || true
npm install @somnia-chain/reactivity-contracts@0.2.1 >/dev/null 2>&1 && echo "installed."

PKG="node_modules/@somnia-chain/reactivity-contracts"

echo ""
echo "=== package.json (name/version/main) ==="
node -e "const p=require('./$PKG/package.json'); console.log(JSON.stringify({name:p.name,version:p.version,main:p.main,files:p.files},null,2));"

echo ""
echo "=== every .sol file shipped ==="
find "$PKG" -name '*.sol' | sort

echo ""
echo "=== SomniaEventHandler.sol (full) ==="
FH=$(find "$PKG" -name 'SomniaEventHandler.sol' | head -1)
if [ -n "$FH" ]; then
  echo "path: $FH"
  echo "-----------------------------------------"
  cat "$FH"
else
  echo "!! SomniaEventHandler.sol not found. Listing all contracts so we pick the right base:"
  for f in $(find "$PKG" -name '*.sol'); do
    echo ""; echo "### $f"; grep -nE 'contract |abstract contract |interface |function |event ' "$f" | head -40
  done
fi
