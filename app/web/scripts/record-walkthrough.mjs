// Record the app actually being used.
//
// Not screenshots with captions over them: a real session, driven at human pace,
// with a visible cursor so a viewer can follow what is being clicked. Playwright
// records the tab to webm; the film is cut from that.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outDir = process.env.OUT_DIR || join(repo, "docs", "video", "raw");
mkdirSync(outDir, { recursive: true });
const base = process.env.BASE_URL || "http://localhost:4173";
const wallet = readFileSync(join(repo, "docs", "SHOWCASE_KEY.txt"), "utf8").trim().split("\n")[0];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1120, height: 630 },
  recordVideo: { dir: outDir, size: { width: 1120, height: 630 } },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

// A cursor the recording can actually see, plus a click pulse.
await page.addInitScript(() => {
  const style = document.createElement("style");
  style.textContent = `
    #__cur { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -11px 0 0 -11px;
      border-radius: 999px; background: rgba(111,88,194,.92); box-shadow: 0 0 0 6px rgba(111,88,194,.22), 0 6px 18px rgba(0,0,0,.28);
      pointer-events: none; left: -100px; top: -100px; }
    #__ring { position: fixed; z-index: 2147483646; width: 22px; height: 22px; margin: -11px 0 0 -11px;
      border-radius: 999px; border: 3px solid rgba(111,88,194,.8); pointer-events: none; opacity: 0;
      left: -100px; top: -100px; }`;
  document.head.appendChild(style);
  const cur = document.createElement("div"); cur.id = "__cur";
  const ring = document.createElement("div"); ring.id = "__ring";
  document.body.appendChild(cur); document.body.appendChild(ring);
  window.__moveCur = (x, y) => { cur.style.left = x + "px"; cur.style.top = y + "px"; };
  window.__clickCur = (x, y) => {
    ring.style.left = x + "px"; ring.style.top = y + "px";
    ring.animate(
      [{ opacity: .9, scale: "1" }, { opacity: 0, scale: "2.6" }],
      { duration: 520, easing: "cubic-bezier(.16,1,.3,1)" },
    );
  };
});

// Injected wallet: connects, reports Shannon, and declines to sign — the film
// stops at the wallet boundary, which is the honest place to stop.
await page.addInitScript((a) => {
  const provider = {
    request: async ({ method }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [a];
      if (method === "eth_chainId") return "0xc488";
      throw Object.assign(new Error("The recording does not sign."), { code: 4200 });
    },
    on() {}, removeListener() {},
  };
  window.addEventListener("eip6963:requestProvider", () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", {
      detail: { info: { uuid: "rec", name: "Rabby Wallet", icon: "" }, provider },
    })));
}, wallet);

const wait = (ms) => page.waitForTimeout(ms);

// Glide the cursor rather than teleporting it, so the eye can follow.
let cx = 800, cy = 700;
async function glide(x, y, steps = 26) {
  const sx = cx, sy = cy;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // easeInOutQuad
    const nx = sx + (x - sx) * e, ny = sy + (y - sy) * e;
    await page.evaluate(([px, py]) => window.__moveCur?.(px, py), [nx, ny]);
    await page.mouse.move(nx, ny);
    await wait(16);
  }
  cx = x; cy = y;
}

async function clickOn(locator, { settle = 900 } = {}) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await glide(x, y);
  await wait(260);
  await page.evaluate(([px, py]) => window.__clickCur?.(px, py), [x, y]);
  await wait(120);
  await locator.click({ force: true });
  await wait(settle);
}

const mark = (label) => console.log(`${(Date.now() - t0) / 1000}s  ${label}`);
const t0 = Date.now();

// ---- 1. arrive ------------------------------------------------------------
await page.goto(base, { waitUntil: "domcontentloaded" });
await wait(2600);
mark("landing");

// ---- 2. start building ----------------------------------------------------
await clickOn(page.getByRole("button", { name: /Build your sequence/ }).first(), { settle: 1100 });
mark("clicked build");

// ---- 3. choose the wallet -------------------------------------------------
await clickOn(page.getByRole("button", { name: /Rabby Wallet/ }).first(), { settle: 1400 });
mark("connected");

await page.waitForSelector("#build", { timeout: 60000 });
await page.getByRole("button", { name: /Activate sequence/ }).waitFor({ timeout: 120000 }).catch(() => {});
await wait(2600);
mark("builder ready");

// ---- 4. read the market ---------------------------------------------------
// Start at the top so the market panel is whole: odds, book, clock.
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await wait(1400);
const panel = page.locator(".market-panel").first();
if (await panel.count()) {
  const box = await panel.boundingBox();
  if (box) { await glide(box.x + box.width * 0.42, box.y + box.height * 0.5); await wait(3200); }
}
mark("market panel");

// ---- 5. the branch that stops ---------------------------------------------
// Leave "if yes" alone — buying the side that won is the sensible default. Set
// "if no" to stop, which is the rule people ask about most.
await page.evaluate(() => window.scrollBy({ top: 420, behavior: "smooth" }));
await wait(1500);
const selects = page.locator("#build select");
if (await selects.count() >= 3) {
  const ifNo = selects.nth(2);
  await clickOn(ifNo, { settle: 500 });
  await ifNo.selectOption({ label: /Stop/i }).catch(async () => {
    const opts = await ifNo.locator("option").allTextContents();
    const i = opts.findIndex((o) => /stop/i.test(o));
    if (i >= 0) await ifNo.selectOption({ index: i });
  });
  await wait(2200);
}
mark("stop branch set");

// ---- 6. size the trade ----------------------------------------------------
const amount = page.locator("#build input[type=number]").first();
if (await amount.count()) {
  await clickOn(amount, { settle: 400 });
  await amount.fill("");
  await wait(300);
  for (const ch of "2") { await page.keyboard.type(ch); await wait(320); }
  // Let the book price it and the summary catch up before moving on.
  await wait(3000);
}
mark("amount typed");

// ---- 7. what it will actually do, in plain words --------------------------
const summary = page.locator("text=/What will happen/i").first();
if (await summary.count()) {
  const box = await summary.boundingBox();
  if (box) { await glide(box.x + 200, box.y + 150); await wait(3600); }
}
mark("summary");

// ---- 8. how far it should roll -------------------------------------------
await page.evaluate(() => window.scrollBy({ top: 460, behavior: "smooth" }));
await wait(1600);
const roll = page.getByRole("button", { name: /Keep rolling . 2 settlements/i }).first();
if (await roll.count()) {
  await clickOn(roll, { settle: 2600 });
  mark("rolling chosen");
}

// ---- 9. read the risk back ------------------------------------------------
await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
await wait(1600);
const rail = page.locator("text=/Most at risk at once/i").first();
if (await rail.count()) {
  const box = await rail.boundingBox();
  if (box) { await glide(box.x + 120, box.y + 40); await wait(2800); }
}
mark("risk read");

// ---- 10. activate ---------------------------------------------------------
// The account is created here, at the end, from the sequence already built.
const activate = page.getByRole("button", { name: /Activate sequence/ }).first();
if (await activate.count() && await activate.isEnabled()) {
  await clickOn(activate, { settle: 3000 });
  mark("activation dialog");
  const create = page.getByRole("button", { name: /Create account and continue/ }).first();
  if (await create.count()) {
    const box = await create.boundingBox();
    if (box) { await glide(box.x + box.width / 2, box.y + box.height / 2); await wait(2600); }
  }
}

const close = page.getByRole("button", { name: "×" }).first();
if (await close.count()) await clickOn(close, { settle: 900 });
await wait(1200);
mark("done");

await ctx.close();
await browser.close();
console.log(`recording written to ${outDir}`);
