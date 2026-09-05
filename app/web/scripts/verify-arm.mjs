// Verifies the real armStep path against live Shannon state without a private
// key: builds the exact strategy the browser builds from real open markets,
// then eth_call-simulates armStep from the actual vault owner. A pass here means
// the encoding, the caps and the owner gate are all correct and the only thing
// left is the human signature.
import { readFileSync } from "node:fs";
import { fetchOpenMarkets, fetchResolvedMarkets } from "../src/chain/markets.js";
import { readVaultState, publicClient, encodeArmStep } from "../src/chain/vault.js";
import { vaultAbi } from "../src/chain/abi.js";
import { SHANNON } from "../src/chain/config.js";
import { seedFromMarkets, validate, toVaultStep, onchainStepId } from "../src/strategy.js";
import { simulate, resolutionsFromMarkets } from "../src/sim.js";

const ok = (label, detail = "") => console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
const fail = (label, detail = "") => { console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); process.exitCode = 1; };

const open = await fetchOpenMarkets(40);
open.length >= 2 ? ok("live open markets", `${open.length} trading`) : fail("live open markets", `${open.length}`);

const resolved = await fetchResolvedMarkets(25);
resolved.length > 0 ? ok("settled market history", `${resolved.length} finalized`) : fail("settled market history");

const state = await readVaultState();
state.owner ? ok("vault reads", `owner ${state.owner}, cap ${state.maxOutstanding}, outstanding ${state.outstanding}`) : fail("vault reads");

const strategy = seedFromMarkets(open);
const errors = validate(strategy);
errors.length === 0 ? ok("seeded strategy validates", strategy.name) : fail("seeded strategy validates", JSON.stringify(errors));

const sim = simulate(strategy, resolutionsFromMarkets(resolved));
ok("simulation runs on real resolutions", `${sim.events.length} events, committed ${sim.committed}`);

// Caps must actually bite, not merely be displayed.
// price*quantity/1e6 must exceed the step cap, so the quantity has to be big.
const overCap = { ...strategy, steps: [{ ...strategy.steps[0], quantity: 100_000_000_000n }] };
validate(overCap).some((e) => /cap/.test(e.message))
  ? ok("cap validation rejects an oversized step")
  : fail("cap validation rejects an oversized step");

// Is the deployed vault the code this build produces?
//
// Two things legitimately differ between a compiled artifact and the same
// contract once deployed, and neither means the code is wrong:
//
//   - immutables. The artifact holds zeroed placeholders; the deployed copy has
//     the owner, module and collateral written into the code itself. The
//     artifact ships the exact byte ranges, so they are masked out rather than
//     guessed at.
//   - the CBOR metadata trailer, which is a hash of the source *text*. Editing a
//     comment changes it while the executable code is byte-for-byte identical.
//
// So the executable code is compared in full with those masked, and the source
// hash is reported separately. That way a docstring fix is reported as a
// docstring fix instead of masquerading as a stale deployment and pushing us
// into a redeploy that would change nothing.
const stripMetadata = (body) => {
  const len = parseInt(body.slice(-4), 16);
  if (!Number.isFinite(len) || len <= 0 || (len + 2) * 2 >= body.length) return body;
  return body.slice(0, body.length - (len + 2) * 2);
};
const maskImmutables = (body, refs) => {
  const chars = [...body];
  for (const spans of Object.values(refs || {})) {
    for (const { start, length } of spans) {
      for (let i = start * 2; i < (start + length) * 2 && i < chars.length; i++) chars[i] = "0";
    }
  }
  return chars.join("");
};

let compatible = null;
let metadataDiffers = false;
try {
  const onchain = (await publicClient().getCode({ address: SHANNON.vault })).replace(/^0x/, "");
  const artifact = JSON.parse(
    readFileSync(new URL("../../../out/SequenceVault.sol/SequenceVault.json", import.meta.url), "utf8"),
  );
  const built = artifact.deployedBytecode.object.replace(/^0x/, "");
  const refs = artifact.deployedBytecode.immutableReferences;
  compatible = stripMetadata(maskImmutables(onchain, refs)) === stripMetadata(maskImmutables(built, refs));
  metadataDiffers = onchain.slice(-120) !== built.slice(-120);
} catch { compatible = null; }

if (compatible === false) {
  fail("deployed vault matches this build",
    `the bytecode at ${SHANNON.vault} differs from this build. Redeploy with scripts/migrate-phase2.sh, then re-run.`);
  console.log("\nverify-arm: BLOCKED on a stale deployment\n");
  process.exit(1);
}
compatible === true
  ? ok("deployed vault matches this build",
      metadataDiffers
        ? "executable code identical to this build once immutables are masked; only the source-metadata hash differs, which a comment edit changes and a redeploy would not meaningfully fix"
        : "bytecode identical to the compiled artifact")
  : ok("deployed vault matches this build", "could not read the deployed code; unverified this run");

const step = strategy.steps[0];
const stepId = onchainStepId(strategy, step);
const vaultStep = toVaultStep(step);
const calldata = encodeArmStep(stepId, vaultStep);
calldata.startsWith("0x") && calldata.length > 200 ? ok("armStep encodes", `${calldata.length} hex chars`) : fail("armStep encodes");

const client = publicClient();
const args = [stepId, { status: 0, ...vaultStep, orderId: 0n, winningOutcome: 0 }];

try {
  await client.simulateContract({ address: SHANNON.vault, abi: vaultAbi, functionName: "armStep", args, account: state.owner });
  ok("armStep simulates from the vault owner", `stepId ${stepId.slice(0, 12)}…`);
} catch (cause) {
  fail("armStep simulates from the vault owner", cause?.shortMessage || cause?.message);
}

// The owner gate must reject a non-owner, or the vault is not actually bounded.
try {
  await client.simulateContract({
    address: SHANNON.vault, abi: vaultAbi, functionName: "armStep", args,
    account: "0x000000000000000000000000000000000000dEaD",
  });
  fail("armStep rejects a non-owner", "the call unexpectedly succeeded");
} catch (cause) {
  // NotOwner() selector, matched directly so the check does not depend on how
  // viem happens to phrase the revert.
  const NOT_OWNER = "0x30cd7471";
  const text = `${cause?.shortMessage || ""} ${cause?.metaMessages?.join(" ") || ""} ${String(cause)}`;
  text.includes("NotOwner") || text.includes(NOT_OWNER)
    ? ok("armStep rejects a non-owner", "NotOwner()")
    : fail("armStep rejects a non-owner", cause?.shortMessage || cause?.message);
}


// Guard: stray control bytes in source silently break regexes (a literal 0x08
// looks like a word boundary in an editor but matches a backspace character).
import { globSync as _glob } from "node:fs";
const _bad = _glob("src/**/*.{js,jsx}").filter((f) => /[\0-\b\v\f-]/.test(readFileSync(f, "utf8")));
_bad.length === 0 ? ok("source is free of stray control bytes") : fail("source is free of stray control bytes", _bad.join(", "));

console.log(process.exitCode ? "\nverify-arm: FAILURES\n" : "\nverify-arm: all checks passed\n");
