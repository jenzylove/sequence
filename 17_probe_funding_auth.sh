#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check

cat > fa.cjs << 'JS'
const s = require('@somnia-chain/markets-sdk');
const { createPublicClient, http, toFunctionSelector } = require('viem');
const RPC = 'https://dream-rpc.somnia.network';

(async () => {
  const client = createPublicClient({ transport: http(RPC) });
  const a = s.SOMNIA_TESTNET_ADDRESSES;

  // 1) What funding/approval selectors DOES the binary pool impl expose?
  const implCode = await client.getBytecode({ address: a.binaryPoolImpl });
  const candidates = [
    'setApprovedContractToPlaceOrders(address,bool)',
    'updateIsApprovedContractToPlaceOrders(address,bool)',
    'isApprovedContractToPlaceOrders(address)',
    'approve(address,uint256)',
    'operatorRegistry()',
    'permissionsRegistry()',
    'getWithdrawableBalance(address,address)',
    'vaultBalance(address,address)',
    'getManualVaultMode(address)',
  ];
  console.log('=== binary pool impl funding/approval selectors ===');
  for (const sig of candidates) {
    const sel = toFunctionSelector(sig);
    console.log('  ' + (implCode.includes(sel.slice(2)) ? 'PRESENT' : 'absent') + '  ' + sig);
  }

  // 2) Registry accessor on module / core?
  for (const [name, addr] of [['binaryModule',a.binaryModule],['marketsCore',a.marketsCore],['collateralRouter',a.collateralRouter]]) {
    const code = await client.getBytecode({ address: addr });
    if (!code) { console.log(name, 'no code'); continue; }
    console.log('\n=== ' + name + ' (' + addr + ') registry accessors ===');
    for (const sig of ['operatorPermissionsRegistry()','getOperatorPermissionsRegistry()','operatorRegistry()','registry()']) {
      const sel = toFunctionSelector(sig);
      console.log('  ' + (code.includes(sel.slice(2)) ? 'PRESENT' : 'absent') + '  ' + sig);
    }
  }

  // 3) The operator registry write-ABI referenced setOperatorApprovalForPool.
  //    Find the registry ADDRESS: try calling the accessor that IS present.
  //    Also dump the full spotPoolWriteAbi + any *approve* fns we haven't seen.
  console.log('\n=== all fns in binaryModuleWriteAbi mentioning approve/operator/contract ===');
  for (const f of (s.binaryModuleWriteAbi||[]).filter(x=>x.type==='function' && /approv|operator|contract/i.test(x.name))) {
    console.log('  ' + f.name + '(' + f.inputs.map(i=>i.type).join(',') + ')');
  }
  console.log('\n=== all fns in binaryPoolWriteAbi (full) ===');
  for (const f of (s.binaryPoolWriteAbi||[]).filter(x=>x.type==='function')) {
    console.log('  ' + f.name + '(' + f.inputs.map(i=>i.type).join(',') + ')');
  }
})().catch(e=>{ console.error('failed:', e.message); process.exit(1); });
JS
node fa.cjs
