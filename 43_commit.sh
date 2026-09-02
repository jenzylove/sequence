#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo ">> final gate: full forge test suite"
forge test || { echo "!! tests failing, not committing"; exit 1; }

echo ""
echo ">> gitignore hygiene (never commit env, artifacts, node_modules, deps)"
grep -qxF '.env'             .gitignore || echo '.env'             >> .gitignore
grep -qxF '.vault_address'   .gitignore || echo '.vault_address'   >> .gitignore
grep -qxF 'node_modules/'    .gitignore || echo 'node_modules/'    >> .gitignore
grep -qxF 'app/node_modules/' .gitignore || echo 'app/node_modules/' >> .gitignore
grep -qxF 'app/web/node_modules/' .gitignore || echo 'app/web/node_modules/' >> .gitignore
grep -qxF 'app/web/dist/'    .gitignore || echo 'app/web/dist/'    >> .gitignore
grep -qxF '*.out'            .gitignore || echo '*.out'            >> .gitignore

# untrack anything sensitive that slipped in before
git rm -r --cached --ignore-unmatch .env .vault_address node_modules app/node_modules app/web/node_modules app/web/dist >/dev/null 2>&1 || true

git add -A
git commit -m "Product layer: SequenceVault state machine (12/12) + off-chain wiring (live reads/arm encode 3/3 on Shannon) + web scaffold. Subscribe/live-fire gated on 32-SOM faucet."

echo ""
echo ">> secret guard before push"
git ls-files | grep -E '\.env$|_address$|\.out$|node_modules' && { echo ">> STOP: sensitive/bulky file tracked"; exit 1; } || {
  git push origin main
}

echo ""
echo ">> pushed. git log:"
git log --oneline -3
