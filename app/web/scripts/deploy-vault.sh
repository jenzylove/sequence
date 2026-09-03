#!/usr/bin/env bash
# Deploys the current SequenceVault (the one with per-outcome branch actions)
# and points the app at it.
#
# Run this from the repo root with PRIVATE_KEY set in .env. It asks before every
# transaction that spends or moves anything, and it never touches the old vault
# without telling you what it is about to recover.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
set -a; [ -f .env ] && . ./.env; set +a
: "${PRIVATE_KEY:?PRIVATE_KEY not set in .env}"

RPC="https://dream-rpc.somnia.network"
MODULE="0x3ecC694Cef705358864a646142ac17A90E29e388"
TUSDC="0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E"
MAXOUT="${MAXOUT:-5000000}"          # total risk limit, raw 6dp. Change freely later.
OLD_VAULT="0xA9A9AA93BE8f62723D55dA5Ba100F9803325Bf62"

OWNER=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "owner:        $OWNER"
echo -n "owner SOM:    "; cast to-unit "$(cast balance "$OWNER" --rpc-url "$RPC")" ether

ask() { read -r -p "$1 [y/N] " a; [ "$a" = "y" ]; }

# ---------------------------------------------------------------- 1. recover
if [ "$(cast code "$OLD_VAULT" --rpc-url "$RPC")" != "0x" ]; then
  OLD_SUB=$(cast call "$OLD_VAULT" "subscriptionId()(uint256)" --rpc-url "$RPC")
  OLD_SOM=$(cast balance "$OLD_VAULT" --rpc-url "$RPC")
  OLD_USDC=$(cast call "$TUSDC" "balanceOf(address)(uint256)" "$OLD_VAULT" --rpc-url "$RPC" | awk '{print $1}')
  echo ""
  echo "previous vault $OLD_VAULT"
  echo "  subscription: $OLD_SUB"
  echo -n "  SOM:          "; cast to-unit "$OLD_SOM" ether
  echo "  tUSDC (6dp):  $OLD_USDC"

  if [ "$OLD_SUB" != "0" ] && ask "Cancel its subscription to release the staked SOM?"; then
    cast send "$OLD_VAULT" "cancelSubscription()" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >/dev/null
    echo "  cancelled."
    OLD_SOM=$(cast balance "$OLD_VAULT" --rpc-url "$RPC")
    echo -n "  SOM now:      "; cast to-unit "$OLD_SOM" ether
  fi
  if [ "$OLD_SOM" != "0" ] && ask "Withdraw that SOM back to you?"; then
    cast send "$OLD_VAULT" "withdrawNative(uint256)" "$OLD_SOM" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >/dev/null
    echo "  withdrawn."
  fi
  if [ "$OLD_USDC" != "0" ] && ask "Withdraw its $OLD_USDC tUSDC back to you?"; then
    cast send "$OLD_VAULT" "withdrawToken(address,uint256)" "$TUSDC" "$OLD_USDC" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >/dev/null
    echo "  withdrawn."
  fi
fi

# ---------------------------------------------------------------- 2. deploy
echo ""
echo "deploying SequenceVault(module=$MODULE, collateral=tUSDC, maxOutstanding=$MAXOUT)"
ask "Deploy now (costs gas)?" || { echo "aborted."; exit 0; }

OUT=$(forge create src/SequenceVault.sol:SequenceVault \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --broadcast \
  --constructor-args "$MODULE" "$TUSDC" "$MAXOUT")
echo "$OUT"
VAULT=$(echo "$OUT" | grep -i "Deployed to:" | awk '{print $3}')
[ -n "$VAULT" ] || { echo "could not read the deployed address"; exit 1; }
echo ""
echo "new vault: $VAULT"

# ---------------------------------------------------------------- 3. point the app at it
node - "$VAULT" <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const vault = process.argv[2];
for (const file of ["app/web/src/chain/config.js", "app/planner/addresses.ts"]) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(/vault:\s*"0x[0-9a-fA-F]{40}"/, `vault: "${vault}"`);
  if (after === before) { console.log(`  ${file}: no vault field matched, update it by hand`); continue; }
  writeFileSync(file, after);
  console.log(`  ${file}: updated`);
}
NODE

echo ""
echo "next, in the app (each one is a wallet approval):"
echo "  1. Onchain details -> One-time setup -> Put up the stake   (32 SOM)"
echo "  2.                                   -> Start listening"
echo "  3. send test USDC to $VAULT, then    -> Give permission"
echo ""
echo "then re-run:  cd app/web && node scripts/verify-arm.mjs"
