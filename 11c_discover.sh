#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check

INDEXER="https://dev.smk.somnia.host/v1/graphql"

cat > discover.cjs << 'JS'
const s = require('@somnia-chain/markets-sdk');
const INDEXER = 'https://dev.smk.somnia.host/v1/graphql';
const WS = 'wss://dream-rpc.somnia.network/ws';
const RPC = 'https://dream-rpc.somnia.network';

(async () => {
  const { SomniaMarkets, isBinaryMarket } = s;
  const addresses = s.SOMNIA_TESTNET_ADDRESSES;

  // The SDK bundles viem chains; try to find a testnet chain export, else build minimal.
  let chain = s.somniaTestnet || s.shannonTestnet || s.testnet;
  if (!chain) {
    chain = { id: 50312, name: 'Somnia Shannon', nativeCurrency: { name: 'SOM', symbol: 'SOM', decimals: 18 },
      rpcUrls: { default: { http: [RPC] } } };
  }

  let exchange;
  try {
    exchange = new SomniaMarkets({ indexerUrl: INDEXER, chain, wsRpcUrl: WS, rpcUrl: RPC, addresses });
  } catch (e) {
    console.log('CTOR ERROR:', e.message);
    console.log('--- SomniaMarkets ctor source (first 1200 chars) ---');
    console.log(SomniaMarkets.toString().slice(0, 1200));
    return;
  }

  const markets = Object.values(await exchange.loadMarkets(true));
  const now = Date.now();
  const binary = markets.filter(m => m.info && isBinaryMarket(m.info));
  console.log('total:', markets.length, '| binary:', binary.length);

  const rows = binary.map(m => ({
    marketId: m.info.marketId,
    symbol: (m.outcomes && m.outcomes[0] && m.outcomes[0].symbol) || m.symbol || '?',
    active: m.active,
    minsToExpiry: m.info.expiry ? Math.round((Number(m.info.expiry)*1000 - now)/60000) : '?',
  })).sort((a,b) => (a.minsToExpiry==='?'?1e9:a.minsToExpiry) - (b.minsToExpiry==='?'?1e9:b.minsToExpiry));

  console.table(rows.slice(0, 15));

  // pick the soonest-expiring still-active market as the target
  const target = rows.find(r => r.active && typeof r.minsToExpiry==='number' && r.minsToExpiry > 1);
  if (target) {
    console.log('\nTARGET (soonest active):', target.marketId, target.symbol, target.minsToExpiry, 'min to expiry');
    require('fs').writeFileSync('/tmp/ddx-abi-check/.target_market', target.marketId + '\n');
    console.log('saved to .target_market');
  } else {
    console.log('\nNo suitable near-expiry active market right now.');
  }
})().catch(e => { console.error('DISCOVERY FAILED:', e.message); process.exit(1); });
JS

echo ">> discovering via SDK (indexer: $INDEXER)"
node discover.cjs
