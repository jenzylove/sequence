#!/usr/bin/env bash
# Phase 2: deploy the factory, provision the owner's vault through it, move the
# collateral across, stake, and subscribe.
#
# Everything here is recoverable by the vault owner: collateral and native
# balance can be withdrawn, and the subscription can be cancelled to release the
# stake. Nothing grants anyone else authority over the funds.
#
# Run from the repo root with PRIVATE_KEY in .env.
#   DRY_RUN=1 bash app/web/scripts/migrate-phase2.sh   # show the plan, spend nothing
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
set -a; [ -f .env ] && . ./.env; set +a
: "${PRIVATE_KEY:?PRIVATE_KEY not set in .env}"

RPC="${RPC_URL:-https://dream-rpc.somnia.network}"
MODULE="0x3ecC694Cef705358864a646142ac17A90E29e388"
TUSDC="0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E"
MAXOUT="${MAXOUT:-5000000}"
STAKE="35000000000000000000"          # 32 SOM minimum plus headroom: the owner
                                     # balance drifts down and falling under the
                                     # minimum is silent
OLD_VAULT="$(grep -oE 'vault: "0x[0-9a-fA-F]{40}"' app/web/src/chain/config.js | grep -oE '0x[0-9a-fA-F]{40}')"
DRY="${DRY_RUN:-0}"

OWNER=$(cast wallet address --private-key "$PRIVATE_KEY")
send() { if [ "$DRY" = "1" ]; then echo "    [dry-run] $*"; else cast send --rpc-url "$RPC" --private-key "$PRIVATE_KEY" "$@" >/dev/null; fi; }

echo "owner:      $OWNER"
echo -n "owner SOM:  "; cast to-unit "$(cast balance "$OWNER" --rpc-url "$RPC")" ether
echo "old vault:  $OLD_VAULT"
OLD_USDC=$(cast call "$TUSDC" "balanceOf(address)(uint256)" "$OLD_VAULT" --rpc-url "$RPC" | awk '{print $1}')
echo "  holds:    $OLD_USDC tUSDC (6dp)"
echo ""

# ---------------------------------------------------------------- 1. factory
echo "1. deploying SequenceVaultFactory(module, tUSDC, defaultMaxOutstanding=$MAXOUT)"
if [ "$DRY" = "1" ]; then
  FACTORY="0xDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYRUNDRYR"
else
  OUT=$(forge create src/SequenceVaultFactory.sol:SequenceVaultFactory \
    --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --broadcast \
    --constructor-args "$MODULE" "$TUSDC" "$MAXOUT")
  FACTORY=$(echo "$OUT" | grep -i "Deployed to:" | awk '{print $3}')
  [ -n "$FACTORY" ] || { echo "could not read the factory address"; exit 1; }
fi
echo "   factory:  $FACTORY"

# ---------------------------------------------------------------- 2. vault
echo "2. provisioning the owner's vault through the factory"
if [ "$DRY" = "1" ]; then
  VAULT="0xDRYRUNVAULTDRYRUNVAULTDRYRUNVAULTDRYRUNV"
else
  send "$FACTORY" "createVault(uint256)" "$MAXOUT"
  VAULT=$(cast call "$FACTORY" "vaultFor(address)(address)" "$OWNER" --rpc-url "$RPC")
  [ "$VAULT" != "0x0000000000000000000000000000000000000000" ] || { echo "factory did not record a vault"; exit 1; }
fi
echo "   vault:    $VAULT"

# ---------------------------------------------------------------- 2b. recover
# The previous vault's stake is locked in its subscription. Releasing it is the
# only way to fund the new one without fresh SOM, so it happens before staking.
if [ "$OLD_VAULT" != "$VAULT" ]; then
  OLD_SUB=$(cast call "$OLD_VAULT" "subscriptionId()(uint256)" --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')
  if [ -n "$OLD_SUB" ] && [ "$OLD_SUB" != "0" ]; then
    echo "2b. cancelling the previous subscription ($OLD_SUB) to release its stake"
    send "$OLD_VAULT" "cancelSubscription()"
  fi
  OLD_SOM=$(cast balance "$OLD_VAULT" --rpc-url "$RPC")
  if [ "$OLD_SOM" != "0" ]; then
    echo -n "    recovering "; cast to-unit "$OLD_SOM" ether
    send "$OLD_VAULT" "withdrawNative(uint256)" "$OLD_SOM"
  fi
fi

# ---------------------------------------------------------------- 3. collateral
if [ "$OLD_USDC" != "0" ] && [ "$OLD_VAULT" != "$VAULT" ]; then
  echo "3. moving $OLD_USDC tUSDC from the previous vault"
  send "$OLD_VAULT" "withdrawToken(address,uint256)" "$TUSDC" "$OLD_USDC"
  send "$TUSDC" "transfer(address,uint256)" "$VAULT" "$OLD_USDC"
else
  echo "3. no collateral to move"
fi

# ---------------------------------------------------------------- 4. stake
echo "4. staking $STAKE wei so the vault stays above the 32 SOM owner minimum"
send --value "$STAKE" "$VAULT"

# ---------------------------------------------------------------- 5. subscribe
echo "5. subscribing to OracleHub resolutions"
send "$VAULT" "subscribeAllMarkets()"

# ---------------------------------------------------------------- 6. wire up
echo "6. pointing the app at the new factory and vault"
if [ "$DRY" = "1" ]; then
  echo "    [dry-run] would rewrite config.js and addresses.ts"
else
  node - "$VAULT" "$FACTORY" <<'NODE'
const { readFileSync, writeFileSync } = require("node:fs");
const [, , vault, factory] = process.argv;
for (const file of ["app/web/src/chain/config.js", "app/planner/addresses.ts"]) {
  let text = readFileSync(file, "utf8");
  text = text.replace(/vault:\s*"0x[0-9a-fA-F]{40}"/, `vault: "${vault}"`);
  if (/factory:\s*"0x[0-9a-fA-F]{40}"/.test(text)) {
    text = text.replace(/factory:\s*"0x[0-9a-fA-F]{40}"/, `factory: "${factory}"`);
  } else {
    text = text.replace(/(vault:\s*"0x[0-9a-fA-F]{40}",)/, `$1\n  factory: "${factory}",`);
  }
  writeFileSync(file, text);
  console.log(`   ${file} updated`);
}
NODE
fi

echo ""
echo "final state"
if [ "$DRY" != "1" ]; then
  echo -n "  owner:        "; cast call "$VAULT" "owner()(address)" --rpc-url "$RPC"
  echo -n "  subscription: "; cast call "$VAULT" "subscriptionId()(uint256)" --rpc-url "$RPC"
  echo -n "  SOM:          "; cast to-unit "$(cast balance "$VAULT" --rpc-url "$RPC")" ether
  echo -n "  tUSDC:        "; cast call "$TUSDC" "balanceOf(address)(uint256)" "$VAULT" --rpc-url "$RPC"
  echo ""
  echo "  factory: $FACTORY"
  echo "  vault:   $VAULT"
fi
