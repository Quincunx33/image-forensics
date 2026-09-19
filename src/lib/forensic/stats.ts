import type { Stats } from "./types";

export function statsF32(data: ArrayLike<number>): Stats {
  const n = data.length;
  if (n === 0) {
    return {
      mean: 0, median: 0, std: 0, min: 0, max: 0,
      p05: 0, p95: 0, p99: 0, energy: 0, entropy: 0,
    };
  }
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const x = data[i]!;
    if (x < min) min = x;
    if (x > max) max = x;
    sum += x;
    energy += x * x;
  }
  const mean = sum / n;
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    const d = data[i]! - mean;
    varSum += d * d;
  }
  const sorted = Float32Array.from({ length: n }, (_, i) => data[i]!);
  sorted.sort();
  const pct = (p: number) => {
    const idx = Math.round((p / 100) * (n - 1));
    return sorted[Math.min(n - 1, Math.max(0, idx))] ?? 0;
  };
  const range = Math.max(max - min, 1e-8);
  const bins = new Uint32Array(64);
  for (let i = 0; i < n; i++) {
    const b = Math.min(63, Math.floor(((data[i]! - min) / range) * 63));
    bins[b]!++;
  }
  let entropy = 0;
  for (let i = 0; i < 64; i++) {
    const c = bins[i]!;
    if (!c) continue;
    const p = c / n;
    entropy -= p * Math.log2(p);
  }
  return {
    mean,
    median: pct(50),
    std: Math.sqrt(varSum / n),
    min,
    max,
    p05: pct(5),
    p95: pct(95),
    p99: pct(99),
    energy: energy / n,
    entropy,
  };
}

export function scaleToU8(
  src: ArrayLike<number>,
  gain: number,
  percentile: number,
): { gray: Uint8Array; stats: Stats } {
  const stats = statsF32(src);
  const n = src.length;
  const gray = new Uint8Array(n);
  if (n === 0) return { gray, stats };
  const sorted = Float32Array.from({ length: n }, (_, i) => src[i]!);
  sorted.sort();
  const p = Math.min(100, Math.max(50, percentile));
  const idx = Math.round((p / 100) * (n - 1));
  const clip = Math.max(sorted[idx] ?? 1, 1e-8);
  const g = Math.max(gain, 0.01);
  for (let i = 0; i < n; i++) {
    gray[i] = Math.max(0, Math.min(255, ((src[i]! / clip) * 255 * g) | 0));
  }
  return { gray, stats };
}

export function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function fmt(n: number, d = 3): string {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toFixed(1);
  if (Math.abs(n) >= 10) return n.toFixed(Math.min(d, 2));
  return n.toFixed(d);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
