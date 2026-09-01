#!/usr/bin/env bash
set -euo pipefail
cd /tmp/ddx-abi-check

echo "=== SDK exports mentioning url/indexer/endpoint/testnet ==="
node -e "const s=require('@somnia-chain/markets-sdk'); console.log(Object.keys(s).filter(k=>/url|indexer|endpoint|testnet|rpc|graph/i.test(k)).join('\n')||'(none by name)');"

echo ""
echo "=== any string values in exports that look like a URL ==="
node -e "const s=require('@somnia-chain/markets-sdk'); for(const k of Object.keys(s)){const v=s[k]; if(typeof v==='string' && /^https?:|^wss?:/.test(v)) console.log(k,'=',v); if(v && typeof v==='object'){for(const kk of Object.keys(v)){const vv=v[kk]; if(typeof vv==='string' && /^https?:|^wss?:/.test(vv)) console.log(k+'.'+kk,'=',vv);}}}"

echo ""
echo "=== grep the package source/readme for an indexer host ==="
grep -rhoE 'https?://[a-zA-Z0-9./_-]*(indexer|graph|somnia)[a-zA-Z0-9./_-]*' node_modules/@somnia-chain/markets-sdk 2>/dev/null | sort -u | head -20 || echo "(no matches in package)"
