#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check

cat > watch.cjs << 'JS'
const { ethers } = require('ethers');

const WS = 'wss://dream-rpc.somnia.network/ws';
const ORACLE_HUB = '0xe40db387cC98601Dd11bd634fF2f3AD5686dE32b';
const HANDLER = require('fs').readFileSync('sequence/.handler_address','utf8').trim();

const ANSWER_DELIVERED = '0x981074cb1e0ea7eac4cbc8c4c9ddbef8b964373e7e8cd0904c8e0951c4430541';
// keccak topic0s of our handler events:
const iface = new ethers.Interface([
  'event Detected(bytes32 indexed marketId, uint256 indexed oracleQuestionId, bool voided, uint8 winningOutcome)',
  'event SkippedNotArmed(bytes32 indexed marketId)',
  'event SuccessorFired(bytes32 indexed marketId, address indexed pool, bool success, uint128 orderId)',
  'event AlreadyHandled(bytes32 indexed marketId, uint256 indexed oracleQuestionId)'
]);
const hubIface = new ethers.Interface([
  'event AnswerDelivered(uint256 indexed oracleQuestionId, bytes32 indexed marketId, uint32 payoutDenominator, uint256[] payoutNumerators, bool voided)'
]);

(async () => {
  const provider = new ethers.WebSocketProvider(WS);
  await provider._waitUntilReady?.();
  console.log('watching...');
  console.log('  OracleHub :', ORACLE_HUB, '(AnswerDelivered)');
  console.log('  Handler   :', HANDLER, '(Detected/Skipped/Fired)');
  console.log('  (Ctrl+C to stop)\n');

  // 1) real resolutions from the hub
  provider.on({ address: ORACLE_HUB, topics: [ANSWER_DELIVERED] }, (log) => {
    try {
      const p = hubIface.parseLog(log);
      console.log(`\n[${new Date().toISOString()}] ANSWER_DELIVERED  block ${parseInt(log.blockNumber,16)||log.blockNumber}`);
      console.log('   marketId  :', p.args.marketId);
      console.log('   questionId:', p.args.oracleQuestionId.toString());
      console.log('   voided    :', p.args.voided);
      console.log('   payouts   :', p.args.payoutNumerators.map(x=>x.toString()).join(','), '/', p.args.payoutDenominator.toString());
      console.log('   >> our handler should fire in this same block. Watching handler logs...');
    } catch (e) { console.log('hub log parse err', e.message); }
  });

  // 2) our handler's reaction
  provider.on({ address: HANDLER }, (log) => {
    try {
      const p = iface.parseLog(log);
      console.log(`   [HANDLER] ${p.name}  ${p.args.marketId ? 'market='+p.args.marketId : ''}`);
      if (p.name === 'Detected') {
        console.log('   *** GATE CLOSED: real AnswerDelivered -> our handler _onEvent ran ***');
        console.log('       voided=', p.args.voided, ' winningOutcome=', p.args.winningOutcome);
      }
    } catch (e) { /* non-matching event from handler, ignore */ }
  });

  // keepalive ping so the WS doesn't idle out
  setInterval(async () => { try { await provider.getBlockNumber(); } catch {} }, 20000);
})().catch(e => { console.error('watch failed:', e.message); process.exit(1); });
JS

# ethers is needed; install locally if missing
node -e "require('ethers')" 2>/dev/null || npm install ethers >/dev/null 2>&1
echo ">> starting watcher (leave running; a new 15m window resolves soon)"
node watch.cjs
