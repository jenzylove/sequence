// Mirror of SequenceVault._winner. If these diverge, sim lies. Keep identical.
export function winner(payoutNumerators: bigint[], voided: boolean): number {
  if (voided || payoutNumerators.length === 0 || payoutNumerators.length > 2) return 255;
  let maxv = 0n;
  for (const n of payoutNumerators) if (n > maxv) maxv = n;
  if (maxv === 0n) return 255;
  let idx = 255, count = 0;
  payoutNumerators.forEach((n, i) => { if (n === maxv) { count++; idx = i; } });
  return count === 1 ? idx : 255;
}

// Mirror of the vault's win->kind branch.
export function kindFor(win: number, buyYesOnWin0: boolean): number | null {
  if (win === 255) return null;
  if (win === 0) return buyYesOnWin0 ? 0 : 2;
  return buyYesOnWin0 ? 2 : 0;
}
