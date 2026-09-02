#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
set -a; [ -f .env ] && . ./.env; set +a
: "${PRIVATE_KEY:?PRIVATE_KEY not set in .env}"

RPC="https://dream-rpc.somnia.network"
MODULE="0x3ecC694Cef705358864a646142ac17A90E29e388"
TUSDC="0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E"
MAXOUT="5000000"   # 5 tUSDC vault-wide cap (raw, 6dp)
DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")

echo "deployer: $DEPLOYER"
echo -n "SOM balance: "; cast to-unit "$(cast balance "$DEPLOYER" --rpc-url "$RPC")" ether

echo ""
echo ">> deploying SequenceVault(module, tUSDC, maxOutstanding=5 tUSDC)"
read -r -p "Deploy now (~1 SOM gas)? [y/N] " a
[ "$a" = "y" ] || { echo "aborted."; exit 0; }

forge create src/SequenceVault.sol:SequenceVault \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --broadcast \
  --constructor-args "$MODULE" "$TUSDC" "$MAXOUT" | tee deploy_vault.out

VAULT=$(grep -i "Deployed to:" deploy_vault.out | awk '{print $3}')
[ -z "$VAULT" ] && { echo "deploy parse failed; check deploy_vault.out"; exit 1; }
echo "$VAULT" > .vault_address
echo "SequenceVault: $VAULT"

echo ""
echo ">> verify live reads (the exact fns the wiring test calls)"
echo -n "owner()                 -> "; cast call "$VAULT" "owner()(address)" --rpc-url "$RPC"
echo -n "paused()                -> "; cast call "$VAULT" "paused()(bool)" --rpc-url "$RPC"
echo -n "outstandingNotional()   -> "; cast call "$VAULT" "outstandingNotional()(uint256)" --rpc-url "$RPC" | awk '{print $1}'
echo -n "maxOutstandingNotional()-> "; cast call "$VAULT" "maxOutstandingNotional()(uint256)" --rpc-url "$RPC" | awk '{print $1}'

echo ""
echo ">> updating app/planner/addresses.ts vault -> $VAULT"
node -e "const fs=require('fs');const p='app/planner/addresses.ts';let s=fs.readFileSync(p,'utf8');s=s.replace(/vault: \"0x[0-9a-fA-F]+\"/, 'vault: \"$VAULT\"');fs.writeFileSync(p,s);console.log('addresses.ts updated');"

echo ""
echo ">> done. vault deployed, verified, wiring repointed."
echo ">> NOTE: subscribe still needs the 32-SOM bond (faucet). Deploy+read+arm are live now."
