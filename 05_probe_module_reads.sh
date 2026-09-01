#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check
cat > modreads.cjs << 'JS'
const s = require('@somnia-chain/markets-sdk');
function dump(name){
  const abi = s[name];
  if (!Array.isArray(abi)) { console.log(name, '-> not an array'); return; }
  const fns = abi.filter(x => x.type === 'function');
  console.log('\n### ' + name + ' (' + fns.length + ' fns)');
  for (const f of fns){
    const ins  = f.inputs.map(i => i.type + ' ' + i.name).join(', ');
    const outs = f.outputs.map(o => o.type + (o.name ? ' ' + o.name : '')).join(', ');
    console.log('  ' + f.stateMutability.padEnd(10) + f.name + '(' + ins + ') -> (' + outs + ')');
  }
}
dump('binaryModuleReadAbi');
JS
node modreads.cjs
