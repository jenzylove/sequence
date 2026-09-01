#!/usr/bin/env bash
set -euo pipefail
PKG="node_modules/@somnia-chain/reactivity-contracts/contracts/interfaces"

for f in SomniaExtensions.sol ISomniaEventHandler.sol ISomniaReactivityPrecompile.sol; do
  echo "==================================================="
  echo "=== $f ==="
  echo "==================================================="
  if [ -f "$PKG/$f" ]; then
    cat "$PKG/$f"
  else
    echo "!! not at $PKG/$f — searching:"
    find node_modules/@somnia-chain/reactivity-contracts -name "$f" -exec cat {} \;
  fi
  echo ""
done
