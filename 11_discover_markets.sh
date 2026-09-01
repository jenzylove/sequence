#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check

cat > discover.cjs << 'JS'
const s = require('@somnia-chain/markets-sdk');

(async () => {
  // Print the SDK surface for market discovery so we use the real entrypoint.
  const ctorNames = Object.keys(s).filter(k => /Markets|Client|SomniaMarkets/.test(k));
  console.log('SDK entrypoints:', ctorNames.join(', ') || '(none matched)');

  // Try the documented SomniaMarkets client. We only READ.
  const { SomniaMarkets, isBinaryMarket } = s;
  if (!SomniaMarkets) { console.log('No SomniaMarkets export; keys:', Object.keys(s).slice(0,40).join(', ')); return; }

  // Addresses come from the SDK; RPC is the public Shannon endpoint.
  const addresses = s.SOMNIA_TESTNET_ADDRESSES;
  const chain = s.somniaTestnet || s.shannon || undefined;

  let exchange;
  try {
    exchange = new SomniaMarkets({
      indexerUrl: s.TESTNET_INDEXER_URL || undefined,
      chain,
      wsRpcUrl: 'wss://dream-rpc.somnia.network/ws',
      addresses,
    });
  } catch (e) {
    console.log('constructor needs different args. Signature hint below.');
    console.log('SomniaMarkets.length (ctor arity):', SomniaMarkets.length);
    console.log('error:', e.message);
    return;
  }

  const markets = Object.values(await exchange.loadMarkets(true));
  const now = Date.now();
  const binary = markets.filter(m => m.info && isBinaryMarket && isBinaryMarket(m.info));
  console.log('total markets:', markets.length, '| binary:', binary.length);

  // Show a few binary markets with their id, symbol, active flag, expiry.
  const rows = binary.slice(0, 12).map(m => ({
    marketId: m.info.marketId,
    symbol: m.symbol || (m.outcomes && m.outcomes[0] && m.outcomes[0].symbol) || '?',
    active: m.active,
    expiry: m.info.expiry ? new Date(Number(m.info.expiry) * 1000).toISOString() : '?',
    minsToExpiry: m.info.expiry ? Math.round((Number(m.info.expiry) * 1000 - now) / 60000) : '?',
  }));
  console.table(rows);
})().catch(e => { console.error('discovery failed:', e.message); process.exit(1); });
JS
node discover.cjs
