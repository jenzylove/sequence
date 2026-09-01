#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check

cat > probe_ops.cjs << 'JS'
const s = require('@somnia-chain/markets-sdk');

// 1) operator registry: address + approve fn
const addrs = s.SOMNIA_TESTNET_ADDRESSES;
console.log('=== testnet addresses (operator-ish keys) ===');
for (const k of Object.keys(addrs)) {
  if (/oper|registry|permission/i.test(k)) console.log(' ', k, '=', addrs[k]);
}
console.log('  (full key list):', Object.keys(addrs).join(', '));

function dumpFns(name, filterRe) {
  const abi = s[name];
  if (!Array.isArray(abi)) { console.log('\n' + name, '-> not array/none'); return; }
  console.log('\n=== ' + name + ' ===');
  for (const f of abi.filter(x=>x.type==='function')) {
    if (filterRe && !filterRe.test(f.name)) continue;
    const ins = f.inputs.map(i=>i.type+' '+i.name).join(', ');
    console.log('  ' + f.stateMutability.padEnd(10) + f.name + '(' + ins + ')');
  }
}

// 2) any operator-registry ABI
for (const k of Object.keys(s)) {
  if (/operator/i.test(k) && /abi/i.test(k)) dumpFns(k);
}

// 3) pool write fns we need: manual vault, deposit, placeOrderFor, approve
dumpFns('spotPoolWriteAbi', /manual|deposit|placeOrder|approv|operator/i);
dumpFns('binaryPoolWriteAbi', /manual|deposit|placeOrder|approv|operator/i);

// 4) collateral / faucet hints
console.log('\n=== collateral address (testnet) ===');
console.log('  testUsdc =', addrs.testUsdc || addrs.collateral);
JS
node probe_ops.cjs
