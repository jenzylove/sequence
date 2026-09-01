#!/usr/bin/env bash
set -euo pipefail
set -a; [ -f .env ] && . ./.env; set +a
: "${PRIVATE_KEY:?PRIVATE_KEY not set}"
RPC="https://dream-rpc.somnia.network"
MODULE="0x3ecC694Cef705358864a646142ac17A90E29e388"
TUSDC="0x70a86D8842FB63C4Ad2b7cdddF530eBf1BB25d8E"
DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
OLD_HANDLER=$(cat .handler_address)

echo "deployer: $DEPLOYER"
echo -n "deployer SOM: "; cast to-unit "$(cast balance "$DEPLOYER" --rpc-url "$RPC")" ether
echo -n "deployer tUSDC: "; cast call "$TUSDC" "balanceOf(address)(uint256)" "$DEPLOYER" --rpc-url "$RPC" | awk '{print $1}'
echo "old handler: $OLD_HANDLER (holds ~33 SOM in a live subscription)"

echo ""
echo ">> STEP 0: reclaim SOM from old handler (cancel its subscription first)"
echo "   NOTE: the old handler has no withdraw fn, so SOM sent to it is stranded"
echo "   unless we cancel the subscription (refunds nothing) - the 33 SOM is in"
echo "   the handler contract with no way out. This is a real cost of the first run."
read -r -p "Cancel old subscription to stop its spend? [y/N] " a0
if [ "$a0" = "y" ]; then
  cast send "$OLD_HANDLER" "cancelSubscription()" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >/dev/null && echo "old subscription cancelled."
fi

echo ""
echo -n ">> deployer SOM now: "; cast to-unit "$(cast balance "$DEPLOYER" --rpc-url "$RPC")" ether
echo "   If under ~34 SOM, you need more from the faucet before continuing."
read -r -p "Continue to deploy the vault handler? [y/N] " a1
[ "$a1" = "y" ] || { echo "stopped."; exit 0; }

echo ""
echo ">> STEP 1: deploy vault SequenceHandler(module, tUSDC)"
forge create src/SequenceHandler.sol:SequenceHandler \
  --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --broadcast \
  --constructor-args "$MODULE" "$TUSDC" | tee deploy2.out
NEW=$(grep -i "Deployed to:" deploy2.out | awk '{print $3}')
[ -z "$NEW" ] && { echo "deploy parse failed"; exit 1; }
echo "$NEW" > .handler_address
echo "new handler: $NEW"

echo ""
echo ">> STEP 2: fund handler with 33 SOM (subscription) + send it tUSDC bankroll"
read -r -p "Send 33 SOM to handler? [y/N] " a2
[ "$a2" = "y" ] || { echo "stopped."; exit 0; }
cast send "$NEW" --value 33ether --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >/dev/null
echo -n "handler SOM: "; cast to-unit "$(cast balance "$NEW" --rpc-url "$RPC")" ether

echo ""
echo ">> STEP 3: send bounded tUSDC bankroll to the handler (10 tUSDC = 10_000000, 6dp)"
read -r -p "Send 10 tUSDC to handler? [y/N] " a3
[ "$a3" = "y" ] || { echo "stopped."; exit 0; }
cast send "$TUSDC" "transfer(address,uint256)(bool)" "$NEW" 10000000 --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >/dev/null
echo -n "handler tUSDC: "; cast call "$TUSDC" "balanceOf(address)(uint256)" "$NEW" --rpc-url "$RPC" | awk '{print $1}'

echo ""
echo ">> STEP 4: subscribe wildcard to OracleHub AnswerDelivered"
cast send "$NEW" "subscribeAllMarkets()" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" >/dev/null
SUBID=$(cast call "$NEW" "subscriptionId()(uint256)" --rpc-url "$RPC" | awk '{print $1}')
echo "subscriptionId: $SUBID"
[ "$SUBID" = "0" ] && { echo "subscribe failed"; exit 1; }

echo ""
echo ">> handler live and subscribed. Next: pick a live market, approve its pool, arm."
echo ">> saved: .handler_address = $NEW"
