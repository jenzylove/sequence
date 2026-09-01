#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check

cat > surf.cjs << 'JS'
const s = require('@somnia-chain/markets-sdk');

function full(name){
  const abi = s[name];
  if(!Array.isArray(abi)){console.log(name,'-> none');return;}
  console.log('\n=== '+name+' (all functions, full signatures) ===');
  for(const f of abi.filter(x=>x.type==='function')){
    const ins=f.inputs.map(i=>i.type+' '+i.name).join(', ');
    const outs=f.outputs.map(o=>o.type+(o.name?' '+o.name:'')).join(', ');
    console.log('  '+f.stateMutability.padEnd(9)+f.name+'('+ins+') -> ('+outs+')');
  }
}

// The full binary pool + module write surface, and the operator registry read surface.
full('binaryPoolWriteAbi');
full('binaryModuleWriteAbi');
full('operatorRegistryWriteAbi');
full('spotPoolOperatorRegistryReadAbi');

// Does the SDK expose the operator registry ADDRESS anywhere (it's not on the pools)?
const a = s.SOMNIA_TESTNET_ADDRESSES;
console.log('\n=== address keys ===');
console.log(Object.keys(a).join(', '));
console.log('any operator/registry value:', JSON.stringify(
  Object.fromEntries(Object.entries(a).filter(([k])=>/oper|registr|permis/i.test(k)))
));
JS
node surf.cjs
