export function computeRiskReward(input: { entry: number; stop: number; target: number }): number | null {
  const risk = input.entry - input.stop;
  if (risk === 0) return null;
  const reward = input.target - input.entry;
  return reward / risk;
}

export function computeMaxDrawdownPct(input: { entry: number; stop: number }): number {
  return ((input.entry - input.stop) / input.entry) * 100;
}

export function computeCashAtRisk(input: {
  portfolioValue: number;
  positionSizePct: number;
  entry: number;
  stop: number;
}): number {
  const positionValue = input.portfolioValue * (input.positionSizePct / 100);
  const drawdownPct = computeMaxDrawdownPct({ entry: input.entry, stop: input.stop });
  return positionValue * (drawdownPct / 100);
}
