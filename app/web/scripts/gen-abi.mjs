// Generates src/chain/abi.js from the compiled SequenceVault artifact so the
// frontend ABI can never drift from src/SequenceVault.sol. Run after forge build.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const artifact = JSON.parse(readFileSync(resolve(root, "out/SequenceVault.sol/SequenceVault.json"), "utf8"));

const header = `// GENERATED FILE - do not edit by hand.
// Produced by scripts/gen-abi.mjs from out/SequenceVault.sol/SequenceVault.json,
// so this ABI is exactly the compiled src/SequenceVault.sol interface.
`;
writeFileSync(
  resolve(here, "../src/chain/abi.js"),
  `${header}export const vaultAbi = ${JSON.stringify(artifact.abi, null, 2)};\n`,
);
const factory = JSON.parse(readFileSync(resolve(root, "out/SequenceVaultFactory.sol/SequenceVaultFactory.json"), "utf8"));
writeFileSync(
  resolve(here, "../src/chain/factoryAbi.js"),
  `// GENERATED from out/SequenceVaultFactory.sol/SequenceVaultFactory.json.
// Do not edit by hand; run scripts/gen-abi.mjs after forge build.
export const factoryAbi = ${JSON.stringify(factory.abi, null, 2)};
`,
);
console.log(`abi.js regenerated: ${artifact.abi.length} entries`);
console.log(`factoryAbi.js regenerated: ${factory.abi.length} entries`);
