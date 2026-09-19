/** CPU fallback — same detectors as the Rust engine, used if WASM is unavailable. */

import { luma, scaleToU8, statsF32 } from "./stats";
import type { Stats } from "./types";

export function toLuma(rgba: Uint8Array, n: number): Float32Array {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) y[i] = luma(rgba[i * 4]!, rgba[i * 4 + 1]!, rgba[i * 4 + 2]!);
  return y;
}

export async function elaJs(
  rgba: Uint8Array,
  w: number,
  h: number,
  quality: number,
  gain: number,
  percentile: number,
): Promise<{ gray: Uint8Array; stats: Stats }> {
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("OffscreenCanvas 2d unavailable");
  const img = new ImageData(new Uint8ClampedArray(rgba), w, h);
  ctx.putImageData(img, 0, 0);
  const blob = await canvas.convertToBlob({
    type: "image/jpeg",
    quality: Math.max(0.01, Math.min(1, quality / 100)),
  });
  const bmp = await createImageBitmap(blob);
  const c2 = new OffscreenCanvas(w, h);
  const ctx2 = c2.getContext("2d", { willReadFrequently: true });
  if (!ctx2) throw new Error("OffscreenCanvas 2d unavailable");
  ctx2.drawImage(bmp, 0, 0);
  bmp.close();
  const rec = ctx2.getImageData(0, 0, w, h).data;
  const n = w * h;
  const residual = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const dr = Math.abs(rgba[i * 4]! - rec[i * 4]!);
    const dg = Math.abs(rgba[i * 4 + 1]! - rec[i * 4 + 1]!);
    const db = Math.abs(rgba[i * 4 + 2]! - rec[i * 4 + 2]!);
    residual[i] = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
  }
  return scaleToU8(residual, gain, percentile);
}

export function noiseJs(
  y: Float32Array,
  w: number,
  h: number,
  method: number,
  window: number,
  gain: number,
  percentile: number,
): { gray: Uint8Array; stats: Stats } {
  const n = w * h;
  const r = new Float32Array(n);
  const radius = Math.min(15, Math.max(1, Math.floor(Math.max(3, window) / 2)));
  if (method === 1 || method === 2) {
    const iw = w + 1;
    const sum = new Float64Array(iw * (h + 1));
    const sq = new Float64Array(iw * (h + 1));
    for (let yy = 0; yy < h; yy++) {
      let rs = 0;
      let rq = 0;
      for (let xx = 0; xx < w; xx++) {
        const v = y[yy * w + xx]!;
        rs += v;
        rq += v * v;
        sum[(yy + 1) * iw + (xx + 1)] = sum[yy * iw + (xx + 1)]! + rs;
        sq[(yy + 1) * iw + (xx + 1)] = sq[yy * iw + (xx + 1)]! + rq;
      }
    }
    const rect = (int: Float64Array, x0: number, y0: number, x1: number, y1: number) => {
      const idx = (x: number, y: number) => y * iw + x;
      return int[idx(x1, y1)]! + int[idx(x0, y0)]! - int[idx(x1, y0)]! - int[idx(x0, y1)]!;
    };
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const x0 = Math.max(0, xx - radius);
        const y0 = Math.max(0, yy - radius);
        const x1 = Math.min(w, xx + radius + 1);
        const y1 = Math.min(h, yy + radius + 1);
        const area = Math.max(1, (x1 - x0) * (y1 - y0));
        const s = rect(sum, x0, y0, x1, y1);
        const q = rect(sq, x0, y0, x1, y1);
        const mean = s / area;
        const v = Math.max(0, q / area - mean * mean);
        r[yy * w + xx] = method === 2 ? Math.sqrt(v) : v;
      }
    }
  } else if (method === 3) {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const c = y[yy * w + xx]!;
        const l = y[yy * w + Math.max(0, xx - 1)]!;
        const ri = y[yy * w + Math.min(w - 1, xx + 1)]!;
        const u = y[Math.max(0, yy - 1) * w + xx]!;
        const d = y[Math.min(h - 1, yy + 1) * w + xx]!;
        r[yy * w + xx] = Math.abs(4 * c - l - ri - u - d);
      }
    }
  } else {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        let s = 0;
        let c = 0;
        const y0 = Math.max(0, yy - radius);
        const y1 = Math.min(h - 1, yy + radius);
        const x0 = Math.max(0, xx - radius);
        const x1 = Math.min(w - 1, xx + radius);
        for (let yv = y0; yv <= y1; yv++) {
          for (let x = x0; x <= x1; x++) {
            s += y[yv * w + x]!;
            c++;
          }
        }
        r[yy * w + xx] = Math.abs(y[yy * w + xx]! - s / c);
      }
    }
  }
  return scaleToU8(r, gain, percentile);
}

export function edgeJs(
  y: Float32Array,
  w: number,
  h: number,
  method: number,
  gain: number,
  percentile: number,
): { gray: Uint8Array; stats: Stats } {
  const n = w * h;
  const mag = new Float32Array(n);
  const kx =
    method === 1
      ? [-3, 0, 3, -10, 0, 10, -3, 0, 3]
      : [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const ky =
    method === 1
      ? [-3, -10, -3, 0, 0, 0, 3, 10, 3]
      : [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  if (method === 2) {
    for (let yy = 1; yy < h - 1; yy++) {
      for (let xx = 1; xx < w - 1; xx++) {
        const c = y[yy * w + xx]!;
        mag[yy * w + xx] = Math.abs(
          4 * c - y[yy * w + xx - 1]! - y[yy * w + xx + 1]! - y[(yy - 1) * w + xx]! - y[(yy + 1) * w + xx]!,
        );
      }
    }
    return scaleToU8(mag, gain, percentile);
  }
  for (let yy = 1; yy < h - 1; yy++) {
    for (let xx = 1; xx < w - 1; xx++) {
      let sx = 0;
      let sy = 0;
      let k = 0;
      for (let dy = 0; dy < 3; dy++) {
        for (let dx = 0; dx < 3; dx++) {
          const v = y[(yy + dy - 1) * w + (xx + dx - 1)]!;
          sx += v * kx[k]!;
          sy += v * ky[k]!;
          k++;
        }
      }
      mag[yy * w + xx] = Math.hypot(sx, sy);
    }
  }
  return scaleToU8(mag, gain, percentile);
}

export function sharpnessJs(
  y: Float32Array,
  w: number,
  h: number,
  window: number,
  gain: number,
  percentile: number,
): { gray: Uint8Array; stats: Stats } {
  const n = w * h;
  const lap = new Float32Array(n);
  for (let yy = 1; yy < h - 1; yy++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const c = y[yy * w + xx]!;
      lap[yy * w + xx] =
        4 * c - y[yy * w + xx - 1]! - y[yy * w + xx + 1]! - y[(yy - 1) * w + xx]! - y[(yy + 1) * w + xx]!;
    }
  }
  const radius = Math.min(11, Math.max(2, Math.floor(Math.max(5, window) / 2)));
  const r = new Float32Array(n);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      let s = 0;
      let sq = 0;
      let g = 0;
      let c = 0;
      const y0 = Math.max(0, yy - radius);
      const y1 = Math.min(h - 1, yy + radius);
      const x0 = Math.max(0, xx - radius);
      const x1 = Math.min(w - 1, xx + radius);
      for (let yv = y0; yv <= y1; yv++) {
        for (let x = x0; x <= x1; x++) {
          const v = lap[yv * w + x]!;
          s += v;
          sq += v * v;
          c++;
          if (x < w - 1) {
            const dx = y[yv * w + x]! - y[yv * w + x + 1]!;
            g += dx * dx;
          }
        }
      }
      const mean = s / c;
      r[yy * w + xx] = Math.max(0, sq / c - mean * mean) + 0.15 * (g / c);
    }
  }
  return scaleToU8(r, gain, percentile);
}

export function colorJs(
  rgba: Uint8Array,
  w: number,
  h: number,
  gain: number,
  percentile: number,
): { gray: Uint8Array; stats: Stats } {
  const n = w * h;
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const bl = rgba[i * 4 + 2]!;
    y[i] = luma(r, g, bl);
    a[i] = r - g;
    b[i] = 0.5 * (r + g) - bl;
  }
  const rmap = new Float32Array(n);
  for (let yy = 1; yy < h - 1; yy++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = yy * w + xx;
      const gy = Math.abs(y[i + 1]! - y[i - 1]!) + Math.abs(y[i + w]! - y[i - w]!);
      const ga = Math.abs(a[i + 1]! - a[i - 1]!) + Math.abs(a[i + w]! - a[i - w]!);
      const gb = Math.abs(b[i + 1]! - b[i - 1]!) + Math.abs(b[i + w]! - b[i - w]!);
      rmap[i] = Math.max(0, ga + gb - 0.85 * gy);
    }
  }
  return scaleToU8(rmap, gain, percentile);
}

export function cfaJs(
  rgba: Uint8Array,
  w: number,
  h: number,
  gain: number,
  percentile: number,
): { gray: Uint8Array; stats: Stats } {
  const n = w * h;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = rgba[i * 4 + 1]!;
  const r = new Float32Array(n);
  for (let yy = 2; yy < h - 2; yy++) {
    for (let xx = 2; xx < w - 2; xx++) {
      const c = g[yy * w + xx]!;
      const hp =
        c -
        0.25 *
          (g[yy * w + xx - 1]! + g[yy * w + xx + 1]! + g[(yy - 1) * w + xx]! + g[(yy + 1) * w + xx]!);
      const even = ((xx + yy) & 1) * 2 - 1;
      r[yy * w + xx] = Math.abs(hp * even);
    }
  }
  return scaleToU8(r, gain, percentile);
}

export function resampleJs(
  y: Float32Array,
  w: number,
  h: number,
  gain: number,
  percentile: number,
): { gray: Uint8Array; stats: Stats } {
  const n = w * h;
  const d2 = new Float32Array(n);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 1; xx < w - 1; xx++) {
      const i = yy * w + xx;
      d2[i] = Math.abs(y[i - 1]! - 2 * y[i]! + y[i + 1]!);
    }
  }
  const r = new Float32Array(n);
  for (let yy = 2; yy < h - 2; yy++) {
    for (let xx = 4; xx < w - 4; xx++) {
      const i = yy * w + xx;
      let even = 0;
      let odd = 0;
      for (let k = 0; k < 8; k++) {
        const v = d2[i - 4 + k]!;
        if (k % 2 === 0) even += v;
        else odd += v;
      }
      r[i] = Math.abs(even - odd);
    }
  }
  return scaleToU8(r, gain, percentile);
}

function dct1d(x: Float32Array, off: number, stride: number, y: Float32Array) {
  for (let k = 0; k < 8; k++) {
    let s = 0;
    for (let n = 0; n < 8; n++) {
      s += x[off + n * stride]! * Math.cos((Math.PI / 8) * k * (n + 0.5));
    }
    y[k] = s * (k === 0 ? 0.70710678 : 0.5);
  }
}

function dct2(block: Float32Array, out: Float32Array) {
  const tmp = new Float32Array(64);
  const row = new Float32Array(8);
  const drow = new Float32Array(8);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) row[c] = block[r * 8 + c]!;
    dct1d(row, 0, 1, drow);
    for (let c = 0; c < 8; c++) tmp[r * 8 + c] = drow[c]!;
  }
  const col = new Float32Array(8);
  const dcol = new Float32Array(8);
  for (let c = 0; c < 8; c++) {
    for (let r = 0; r < 8; r++) col[r] = tmp[r * 8 + c]!;
    dct1d(col, 0, 1, dcol);
    for (let r = 0; r < 8; r++) out[r * 8 + c] = dcol[r]!;
  }
}

export function frequencyJs(
  y: Float32Array,
  w: number,
  h: number,
  band: number,
  gain: number,
  percentile: number,
): { gray: Uint8Array; stats: Stats } {
  const n = w * h;
  const r = new Float32Array(n);
  if (band === 4) {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        let e = 0;
        if (xx > 0 && xx % 8 === 0) e += Math.abs(y[yy * w + xx]! - y[yy * w + xx - 1]!);
        if (yy > 0 && yy % 8 === 0) e += Math.abs(y[yy * w + xx]! - y[(yy - 1) * w + xx]!);
        r[yy * w + xx] = e;
      }
    }
    return scaleToU8(r, gain, percentile);
  }
  const block = new Float32Array(64);
  const coeff = new Float32Array(64);
  const bw = Math.floor(w / 8);
  const bh = Math.floor(h / 8);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) block[j * 8 + i] = y[(by * 8 + j) * w + (bx * 8 + i)]!;
      }
      dct2(block, coeff);
      let e = 0;
      for (let v = 0; v < 8; v++) {
        for (let u = 0; u < 8; u++) {
          if (u === 0 && v === 0) continue;
          const s = u + v;
          const include = band === 0 ? s <= 2 : band === 1 ? s > 2 && s < 8 : band === 2 ? s >= 8 : true;
          if (include) e += coeff[v * 8 + u]! * coeff[v * 8 + u]!;
        }
      }
      e = Math.sqrt(e);
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) r[(by * 8 + j) * w + (bx * 8 + i)] = e;
      }
    }
  }
  return scaleToU8(r, gain, percentile);
}

export function doubleJpegJs(
  y: Float32Array,
  w: number,
  h: number,
  gain: number,
  percentile: number,
): { gray: Uint8Array; stats: Stats; extra: { periodicityScore: number } } {
  const bw = Math.floor(w / 8);
  const bh = Math.floor(h / 8);
  const hist = new Uint32Array(512);
  const ac: number[] = [];
  const block = new Float32Array(64);
  const coeff = new Float32Array(64);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++)
          block[j * 8 + i] = y[(by * 8 + j) * w + (bx * 8 + i)]! - 128;
      }
      dct2(block, coeff);
      const c = Math.round(coeff[1]!);
      ac.push(c);
      hist[Math.max(0, Math.min(511, c + 256))]!++;
    }
  }
  let mean = 0;
  for (let i = 0; i < 512; i++) mean += hist[i]!;
  mean /= 512;
  let best = 0;
  let bestLag = 2;
  for (let lag = 2; lag < 17; lag++) {
    let acc = 0;
    let c = 0;
    for (let i = 0; i < 512 - lag; i++) {
      acc += (hist[i]! - mean) * (hist[i + lag]! - mean);
      c++;
    }
    const v = acc / c;
    if (v > best) {
      best = v;
      bestLag = lag;
    }
  }
  let energy = 0;
  for (let i = 0; i < 512; i++) {
    const d = hist[i]! - mean;
    energy += d * d;
  }
  energy /= 512;
  const score = energy > 1 ? best / energy : 0;
  const n = w * h;
  const r = new Float32Array(n);
  const period = Math.max(2, bestLag);
  let idx = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const c = ac[idx++]!;
      const nearest = Math.round(c / period) * period;
      const dist = Math.abs(c - nearest);
      const v = Math.max(0, 1 - dist / (period * 0.5));
      for (let j = 0; j < 8; j++) {
        for (let i = 0; i < 8; i++) r[(by * 8 + j) * w + (bx * 8 + i)] = v;
      }
    }
  }
  const scaled = scaleToU8(r, gain, percentile);
  return { ...scaled, extra: { periodicityScore: score } };
}

export function cloneJs(
  y: Float32Array,
  w: number,
  h: number,
  block: number,
  stride: number,
  threshold: number,
  minRegion: number,
  gain: number,
  percentile: number,
): { gray: Uint8Array; stats: Stats; extra: Record<string, unknown> } {
  const bs = Math.max(8, Math.min(32, block));
  const st = Math.max(4, Math.min(32, stride));
  const thr = Math.max(4, Math.min(400, threshold));
  const minR = Math.max(2, Math.min(200, minRegion));
  const n = w * h;
  const mask = new Float32Array(n);
  type Feat = { x: number; y: number; d: Uint8Array };
  const feats: Feat[] = [];
  const sub = Math.floor(bs / 4);
  for (let yy = 0; yy + bs <= h; yy += st) {
    for (let xx = 0; xx + bs <= w; xx += st) {
      const d = new Uint8Array(16);
      let k = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          let s = 0;
          let c = 0;
          for (let j = 0; j < sub; j++) {
            for (let i = 0; i < sub; i++) {
              s += y[(yy + sy * sub + j) * w + (xx + sx * sub + i)]!;
              c++;
            }
          }
          d[k++] = Math.max(0, Math.min(255, s / c));
        }
      }
      feats.push({ x: xx, y: yy, d });
      if (feats.length > 48000) break;
    }
    if (feats.length > 48000) break;
  }
  feats.sort((a, b) => a.d[0]! - b.d[0]! || a.d[1]! - b.d[1]!);
  type Hit = { ax: number; ay: number; bx: number; by: number; dx: number; dy: number; distance: number };
  const hits: Hit[] = [];
  const minDist2 = (bs * 2) ** 2;
  const dist = (a: Uint8Array, b: Uint8Array) => {
    let s = 0;
    for (let i = 0; i < 16; i++) s += Math.abs(a[i]! - b[i]!);
    return s;
  };
  for (let i = 0; i < feats.length; i++) {
    const a = feats[i]!;
    const lim = Math.min(feats.length, i + 12);
    for (let j = i + 1; j < lim; j++) {
      const b = feats[j]!;
      const d = dist(a.d, b.d);
      if (d > thr) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy < minDist2) continue;
      const left = a.y < b.y || (a.y === b.y && a.x < b.x);
      hits.push(
        left
          ? { ax: a.x, ay: a.y, bx: b.x, by: b.y, dx: b.x - a.x, dy: b.y - a.y, distance: d }
          : { ax: b.x, ay: b.y, bx: a.x, by: a.y, dx: a.x - b.x, dy: a.y - b.y, distance: d },
      );
      if (hits.length > 8000) break;
    }
    if (hits.length > 8000) break;
  }
  const buckets = new Map<string, number[]>();
  hits.forEach((h, i) => {
    const k = `${(h.dx / 4 | 0) * 4},${(h.dy / 4 | 0) * 4}`;
    const arr = buckets.get(k) ?? [];
    arr.push(i);
    buckets.set(k, arr);
  });
  let clusters = 0;
  const matches: Hit[] = [];
  const paint = (x: number, y: number) => {
    for (let j = 0; j < bs; j++) {
      const yy = y + j;
      if (yy >= h) break;
      for (let i = 0; i < bs; i++) {
        const xx = x + i;
        if (xx >= w) break;
        mask[yy * w + xx] = 1;
      }
    }
  };
  for (const idxs of buckets.values()) {
    if (idxs.length < minR) continue;
    clusters++;
    for (const i of idxs) {
      const h = hits[i]!;
      paint(h.ax, h.ay);
      paint(h.bx, h.by);
      if (matches.length < 80) matches.push(h);
    }
  }
  const scaled = scaleToU8(mask, gain, percentile);
  return {
    ...scaled,
    extra: {
      clusters,
      hits: hits.length,
      blocks: feats.length,
      status: clusters === 0 ? "no significant match" : "potential indicator",
      matches,
    },
  };
}

export function regionLumaStats(
  y: Float32Array,
  w: number,
  h: number,
  x: number,
  yy: number,
  rw: number,
  rh: number,
): Stats {
  const x0 = Math.max(0, Math.min(w, x | 0));
  const y0 = Math.max(0, Math.min(h, yy | 0));
  const x1 = Math.max(x0 + 1, Math.min(w, x0 + rw));
  const y1 = Math.max(y0 + 1, Math.min(h, y0 + rh));
  const buf: number[] = [];
  for (let j = y0; j < y1; j++) {
    for (let i = x0; i < x1; i++) buf.push(y[j * w + i]!);
  }
  return statsF32(buf);
}
