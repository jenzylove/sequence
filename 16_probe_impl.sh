#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check

cat > impl.cjs << 'JS'
const s = require('@somnia-chain/markets-sdk');
const { createPublicClient, http, toFunctionSelector } = require('viem');
const RPC = 'https://dream-rpc.somnia.network';

(async () => {
  const client = createPublicClient({ transport: http(RPC) });
  const a = s.SOMNIA_TESTNET_ADDRESSES;
  const impl = a.binaryPoolImpl;
  console.log('binaryPoolImpl:', impl);

  const code = await client.getBytecode({ address: impl });
  if (!code) { console.log('!! impl has no bytecode'); return; }
  console.log('impl bytecode length:', code.length);

  const sigs = [
    'placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)',
    'placeOrderFor(address,bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)',
    'setManualVaultMode(bool)',
    'getManualVaultMode(address)',
    'deposit(address,uint256)',
    'depositNative()',
    'withdraw(address,uint256)',
    'getOperatorPermissionsRegistry()',
    'getWithdrawableBalance(address,address)',
    'isOperatorAuthorized(address,address,bytes4)',
  ];
  console.log('\nselector presence in IMPL bytecode:');
  for (const sig of sigs) {
    const sel = toFunctionSelector(sig);
    console.log('  ' + sel + '  ' + (code.includes(sel.slice(2)) ? 'PRESENT' : 'absent') + '  ' + sig);
  }
})().catch(e=>{ console.error('failed:', e.message); process.exit(1); });
JS
node impl.cjs
