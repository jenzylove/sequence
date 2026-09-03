// Draft sequences live in the browser until the user puts one live; once live,
// the chain is the record. So drafts are stored here, and Active/Completed are
// always derived from real vault state rather than from anything kept locally.
const KEY = "sequence.drafts.v2";

const replacer = (_k, v) => (typeof v === "bigint" ? { __bigint: v.toString() } : v);
const reviver = (_k, v) => (v && typeof v === "object" && v.__bigint ? BigInt(v.__bigint) : v);

import { migrateStrategy } from "../strategy.js";

export function loadDrafts() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw, reviver);
    return Array.isArray(list) ? list.filter((d) => d?.steps?.length).map(migrateStrategy) : [];
  } catch { return []; }
}

export function saveDrafts(drafts) {
  try { localStorage.setItem(KEY, JSON.stringify(drafts, replacer)); } catch { /* storage unavailable */ }
  return drafts;
}

export const newDraftId = () => `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function upsertDraft(draft) {
  const drafts = loadDrafts();
  const id = draft.id || newDraftId();
  const next = { ...draft, id, updatedAt: Date.now() };
  const index = drafts.findIndex((d) => d.id === id);
  if (index >= 0) drafts[index] = next; else drafts.unshift(next);
  saveDrafts(drafts);
  return next;
}

export function removeDraft(id) {
  const next = loadDrafts().filter((d) => d.id !== id);
  saveDrafts(next);
  return next;
}
