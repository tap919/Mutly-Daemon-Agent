export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeTo100(value: number, min: number, max: number): number {
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

export function weightedAverage(values: number[], weights: number[]): number {
  if (values.length !== weights.length) {
    throw new Error('Values and weights arrays must have the same length');
  }
  const sum = values.reduce((acc, v, i) => acc + v * weights[i], 0);
  const weightSum = weights.reduce((acc, w) => acc + w, 0);
  return weightSum > 0 ? sum / weightSum : 0;
}

export function percentile(value: number, data: number[]): number {
  const sorted = [...data].sort((a, b) => a - b);
  const index = sorted.findIndex(v => v >= value);
  if (index === -1) return 100;
  return (index / sorted.length) * 100;
}