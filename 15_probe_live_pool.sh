#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check

cat > livepool.cjs << 'JS'
const s = require('@somnia-chain/markets-sdk');
const { createPublicClient, http } = require('viem');
const RPC = 'https://dream-rpc.somnia.network';

(async () => {
  const client = createPublicClient({ transport: http(RPC) });
  const module = s.SOMNIA_TESTNET_ADDRESSES.binaryModule;

  // Get a live Trading market + its pool via the SDK discovery.
  const ex = new s.SomniaMarkets({
    indexerUrl: 'https://dev.smk.somnia.host/v1/graphql',
    chain: { id: 50312, name: 'Somnia', nativeCurrency:{name:'SOM',symbol:'SOM',decimals:18}, rpcUrls:{default:{http:[RPC]}} },
    wsRpcUrl: 'wss://dream-rpc.somnia.network/ws',
    rpcUrl: RPC,
    addresses: s.SOMNIA_TESTNET_ADDRESSES,
  });
  const markets = Object.values(await ex.loadMarkets(true));
  const now = Date.now();
  // pick an ACTIVE market with the most time left (safely in Trading)
  const live = markets
    .filter(m => m.active && m.info && s.isBinaryMarket(m.info) && m.info.expiry && Number(m.info.expiry)*1000 - now > 5*60000)
    .sort((a,b)=>Number(b.info.expiry)-Number(a.info.expiry))[0];
  if (!live) { console.log('no comfortably-live market right now; rerun in a bit'); return; }

  const marketId = live.info.marketId;
  console.log('live market:', marketId, live.outcomes?.[0]?.symbol);

  // read markets(marketId) -> pull market + pool + yesId/noId
  const rec = await client.readContract({
    address: module,
    abi: s.binaryModuleReadAbi,
    functionName: 'markets',
    args: [marketId],
  });
  // rec is a 14-tuple; indexes: 8=market, 9=pool, 10=yesId, 11=noId
  const market = rec[8], pool = rec[9], yesId = rec[10], noId = rec[11];
  console.log('market contract:', market);
  console.log('pool          :', pool);
  console.log('yesId         :', yesId?.toString());
  console.log('noId          :', noId?.toString());

  // fetch deployed bytecode of the POOL and check for selectors
  const code = await client.getBytecode({ address: pool });
  if (!code) { console.log('!! pool has no bytecode?'); return; }
  const has = (sel) => code.includes(sel.replace('0x','')) ? 'PRESENT' : 'absent';
  console.log('\nselector presence in POOL bytecode:');
  console.log('  placeOrder      0xnn (spot sig)       :', has('0x00000000')); // placeholder, replaced below
  console.log('  placeOrderFor   0x80054449            :', has('0x80054449'));
  console.log('  setManualVaultMode                    :', has('0x' + '00')); // computed below

  // compute a couple real selectors with viem
  const { toFunctionSelector } = require('viem');
  const sels = {
    'placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)': null,
    'placeOrderFor(address,bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)': null,
    'setManualVaultMode(bool)': null,
    'deposit(address,uint256)': null,
    'getOperatorPermissionsRegistry()': null,
  };
  console.log('\ncomputed selector presence:');
  for (const sig of Object.keys(sels)) {
    const sel = toFunctionSelector(sig);
    console.log('  ' + sel + '  ' + (code.includes(sel.slice(2)) ? 'PRESENT' : 'absent') + '  ' + sig);
  }
})().catch(e=>{ console.error('probe failed:', e.message); process.exit(1); });
JS
node livepool.cjs
