// Verifies the real armStep path against live Shannon state without a private
// key: builds the exact strategy the browser builds from real open markets,
// then eth_call-simulates armStep from the actual vault owner. A pass here means
// the encoding, the caps and the owner gate are all correct and the only thing
// left is the human signature.
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
const overCap = { ...strategy, steps: [{ ...strategy.steps[0], quantity: 100000n }] };
validate(overCap).some((e) => /cap/.test(e.message))
  ? ok("cap validation rejects an oversized step")
  : fail("cap validation rejects an oversized step");

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

console.log(process.exitCode ? "\nverify-arm: FAILURES\n" : "\nverify-arm: all checks passed\n");
