import type { ColormapName } from "./types";

type Stop = [number, number, number, number];

function lerpStops(stops: Stop[], t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (x >= a[0] && x <= b[0]) {
      const u = (x - a[0]) / (b[0] - a[0] || 1);
      return [
        (a[1] + (b[1] - a[1]) * u) | 0,
        (a[2] + (b[2] - a[2]) * u) | 0,
        (a[3] + (b[3] - a[3]) * u) | 0,
      ];
    }
  }
  const last = stops[stops.length - 1]!;
  return [last[1], last[2], last[3]];
}

const STOPS: Record<ColormapName, Stop[]> = {
  inferno: [
    [0, 0, 0, 4],
    [0.13, 44, 17, 80],
    [0.25, 98, 25, 85],
    [0.4, 158, 47, 62],
    [0.58, 208, 97, 20],
    [0.75, 237, 163, 11],
    [0.9, 245, 219, 95],
    [1, 252, 255, 164],
  ],
  magma: [
    [0, 0, 0, 4],
    [0.2, 59, 15, 112],
    [0.4, 140, 41, 129],
    [0.6, 204, 71, 120],
    [0.8, 248, 149, 103],
    [1, 252, 253, 191],
  ],
  viridis: [
    [0, 68, 1, 84],
    [0.25, 59, 82, 139],
    [0.5, 33, 145, 140],
    [0.75, 94, 201, 98],
    [1, 253, 231, 37],
  ],
  turbo: [
    [0, 48, 18, 59],
    [0.2, 34, 127, 214],
    [0.4, 20, 210, 184],
    [0.55, 164, 252, 60],
    [0.7, 251, 185, 56],
    [0.85, 245, 39, 39],
    [1, 122, 4, 3],
  ],
  gray: [
    [0, 0, 0, 0],
    [1, 255, 255, 255],
  ],
  steel: [
    [0, 8, 14, 18],
    [0.35, 24, 64, 78],
    [0.65, 80, 168, 180],
    [1, 220, 244, 246],
  ],
};

const LUTS = {} as Record<ColormapName, Uint8Array>;

export function lut(name: ColormapName): Uint8Array {
  if (LUTS[name]) return LUTS[name];
  const table = new Uint8Array(256 * 3);
  const stops = STOPS[name];
  for (let i = 0; i < 256; i++) {
    const [r, g, b] = lerpStops(stops, i / 255);
    table[i * 3] = r;
    table[i * 3 + 1] = g;
    table[i * 3 + 2] = b;
  }
  LUTS[name] = table;
  return table;
}

export function applyColormap(
  gray: Uint8Array,
  name: ColormapName,
  threshold = 0,
  opacity = 255,
): Uint8ClampedArray {
  const table = lut(name);
  const rgba = new Uint8ClampedArray(gray.length * 4);
  const a = Math.max(0, Math.min(255, opacity | 0));
  for (let i = 0; i < gray.length; i++) {
    const g = gray[i]!;
    const o = i * 4;
    if (g < threshold) {
      rgba[o + 3] = 0;
      continue;
    }
    rgba[o] = table[g * 3]!;
    rgba[o + 1] = table[g * 3 + 1]!;
    rgba[o + 2] = table[g * 3 + 2]!;
    rgba[o + 3] = a;
  }
  return rgba;
}

export function histogram256(gray: Uint8Array): Uint32Array {
  const h = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) h[gray[i]!]!++;
  return h;
}
