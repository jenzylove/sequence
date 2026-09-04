// Pins that nothing a wallet does in this browser leaks to the next wallet.
//
// The regression these exist for: the builder's working strategy was persisted
// under one global key, so connecting wallet B restored wallet A's half-built
// sequence, complete with A's markets and amounts.
import test from "node:test";
import assert from "node:assert/strict";

// A localStorage good enough for the store, installed before the modules load.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { loadDrafts, upsertDraft, removeDraft, latestDraft } = await import("./lib/store.js");
const { purgeLegacyStrategy, emptyStrategy, makeStep } = await import("./strategy.js");

const ALICE = "0xAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaaAAAAaaaa";
const BOB = "0xBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbbBBBBbbbb";

const sequenceFor = (name) => {
  const s = emptyStrategy();
  s.name = name;
  s.steps = [makeStep(1)];
  return s;
};

test("a draft saved by one wallet is invisible to another", () => {
  store.clear();
  upsertDraft(ALICE, sequenceFor("alice's BTC roll"));
  assert.equal(loadDrafts(ALICE).length, 1);
  assert.equal(loadDrafts(BOB).length, 0);
});

test("the builder restores only the connected wallet's work", () => {
  store.clear();
  upsertDraft(ALICE, sequenceFor("alice's BTC roll"));
  assert.equal(latestDraft(ALICE).name, "alice's BTC roll");
  assert.equal(latestDraft(BOB), null, "wallet B must start empty, not with A's sequence");
});

test("switching wallets and back keeps each wallet's own work", () => {
  store.clear();
  upsertDraft(ALICE, sequenceFor("alice"));
  upsertDraft(BOB, sequenceFor("bob"));
  assert.equal(latestDraft(ALICE).name, "alice");
  assert.equal(latestDraft(BOB).name, "bob");
});

test("the most recent draft is the one restored", async () => {
  store.clear();
  upsertDraft(ALICE, sequenceFor("older"));
  await new Promise((r) => setTimeout(r, 2));
  upsertDraft(ALICE, sequenceFor("newer"));
  assert.equal(latestDraft(ALICE).name, "newer");
});

test("deleting a draft does not touch another wallet", () => {
  store.clear();
  const a = upsertDraft(ALICE, sequenceFor("alice"));
  upsertDraft(BOB, sequenceFor("bob"));
  removeDraft(ALICE, a.id);
  assert.equal(loadDrafts(ALICE).length, 0);
  assert.equal(loadDrafts(BOB).length, 1);
});

test("no global strategy key is written", () => {
  store.clear();
  upsertDraft(ALICE, sequenceFor("alice"));
  const globalish = [...store.keys()].filter((k) => !k.includes(ALICE.toLowerCase()));
  assert.deepEqual(globalish, [], `these keys are not wallet-scoped: ${globalish.join(", ")}`);
});

test("a legacy global strategy from an older build is cleared", () => {
  store.clear();
  store.set("sequence.strategy.v1", JSON.stringify({ name: "left behind" }));
  purgeLegacyStrategy();
  assert.equal(store.has("sequence.strategy.v1"), false);
});

test("an unconnected browser gets nothing rather than someone else's", () => {
  store.clear();
  upsertDraft(ALICE, sequenceFor("alice"));
  assert.equal(latestDraft(undefined), null);
  assert.equal(loadDrafts(undefined).length, 0);
});
