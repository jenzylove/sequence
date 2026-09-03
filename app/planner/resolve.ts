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

// Mirror of the vault's per-outcome branch lookup. Returns null when there is
// no clean result, and 255 (STOP) when that outcome is configured to do nothing.
export function kindFor(win: number, step: { actionOnWin0: number; actionOnWin1: number }): number | null {
  if (win === 255) return null;
  return win === 0 ? step.actionOnWin0 : step.actionOnWin1;
}
