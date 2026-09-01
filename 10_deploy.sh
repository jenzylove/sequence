#!/usr/bin/env bash
set -euo pipefail

# load .env (PRIVATE_KEY=0x...)
set -a; [ -f .env ] && . ./.env; set +a
: "${PRIVATE_KEY:?PRIVATE_KEY not set in .env}"

RPC="https://dream-rpc.somnia.network"
MODULE="0x3ecC694Cef705358864a646142ac17A90E29e388"

echo "=== preflight ==="
echo -n "chain id: "; cast chain-id --rpc-url "$RPC" || { echo "RPC unreachable"; exit 1; }

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
echo "deployer: $DEPLOYER"

BAL_WEI=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
echo "balance (wei): $BAL_WEI"
echo "balance (SOM): $(cast to-unit "$BAL_WEI" ether)"

# We need gas now, and later 32+ SOM to fund the handler for subscription.
# Warn (don't hard-fail) if under ~34 SOM so you know before proceeding.
echo ""
echo ">> NOTE: deploy needs only gas now. The SUBSCRIBE step later needs the"
echo ">>       handler contract to hold >= 32 SOM. Make sure this account can"
echo ">>       spare that when we get there."
echo ""

read -r -p "Proceed to deploy SequenceHandler to Shannon? [y/N] " ans
[ "$ans" = "y" ] || { echo "aborted."; exit 0; }

echo "=== deploying ==="
# --broadcast actually sends; constructor arg = BinaryMarketsModule address.
forge create src/SequenceHandler.sol:SequenceHandler \
  --rpc-url "$RPC" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --constructor-args "$MODULE" \
  | tee deploy.out

# extract deployed address
ADDR=$(grep -i "Deployed to:" deploy.out | awk '{print $3}')
echo ""
echo "=== verify on-chain ==="
if [ -z "$ADDR" ]; then echo "!! could not parse deployed address; check deploy.out"; exit 1; fi
echo "handler: $ADDR"
echo -n "owner() -> "; cast call "$ADDR" "owner()(address)" --rpc-url "$RPC"
echo -n "module() -> "; cast call "$ADDR" "module()(address)" --rpc-url "$RPC"
echo -n "subscriptionId() -> "; cast call "$ADDR" "subscriptionId()(uint256)" --rpc-url "$RPC"

# persist for later scripts
echo "$ADDR" > .handler_address
echo ""
echo ">> saved handler address to .handler_address"
echo ">> owner() should equal your deployer: $DEPLOYER"
