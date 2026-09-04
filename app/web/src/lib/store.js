// Draft sequences live in the browser until the user puts one live; once live,
// the chain is the record. So drafts are stored here, and Active/Completed are
// always derived from real vault state rather than from anything kept locally.
// Scoped per wallet: one browser used by two accounts must not blend their
// drafts together.
const keyFor = (account) => `sequence.drafts.v3:${(account || "none").toLowerCase()}`;

const replacer = (_k, v) => (typeof v === "bigint" ? { __bigint: v.toString() } : v);
const reviver = (_k, v) => (v && typeof v === "object" && v.__bigint ? BigInt(v.__bigint) : v);

import { migrateStrategy } from "../strategy.js";

export function loadDrafts(account) {
  try {
    const raw = localStorage.getItem(keyFor(account));
    if (!raw) return [];
    const list = JSON.parse(raw, reviver);
    return Array.isArray(list) ? list.filter((d) => d?.steps?.length).map(migrateStrategy) : [];
  } catch { return []; }
}

export function saveDrafts(account, drafts) {
  try { localStorage.setItem(keyFor(account), JSON.stringify(drafts, replacer)); } catch { /* storage unavailable */ }
  return drafts;
}

export const newDraftId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function upsertDraft(account, draft) {
  const drafts = loadDrafts(account);
  const id = draft.id || newDraftId();
  const next = { ...draft, id, updatedAt: Date.now() };
  const index = drafts.findIndex((d) => d.id === id);
  if (index >= 0) drafts[index] = next; else drafts.unshift(next);
  saveDrafts(account, drafts);
  return next;
}

export function removeDraft(account, id) {
  const next = loadDrafts(account).filter((d) => d.id !== id);
  saveDrafts(account, next);
  return next;
}

// The draft a wallet was last working on. Used to restore the builder, so the
// working strategy is wallet-scoped like everything else rather than global.
export function latestDraft(account) {
  const drafts = loadDrafts(account);
  if (!drafts.length) return null;
  return [...drafts].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
}
