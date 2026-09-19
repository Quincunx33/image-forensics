/**
 * Tracebench forensic-engine WASM glue (C ABI, no wasm-bindgen).
 *
 *   import { WasmEngine } from "./forensic-engine.js";
 *   const eng = await WasmEngine.load("./forensic-engine.wasm");
 *   eng.setImage(rgba, width, height);  // RGBA Uint8Array
 *   eng.setFile(fileBytes);             // original JPEG/PNG bytes
 *   const { gray, stats, extra } = eng.ela(90, 12, 98);
 *
 * gray is a Uint8Array of length width*height (heatmap).
 * stats: { mean, median, std, min, max, p05, p95, p99, energy, entropy }
 */

const DEFAULT_LIMITS = {
  maxPixels: 16_000_000,
  maxDim: 8192,
  maxFileBytes: 48 * 1024 * 1024,
};

function statsFromF64(a, o = 0) {
  return {
    mean: a[o] ?? 0,
    median: a[o + 1] ?? 0,
    std: a[o + 2] ?? 0,
    min: a[o + 3] ?? 0,
    max: a[o + 4] ?? 0,
    p05: a[o + 5] ?? 0,
    p95: a[o + 6] ?? 0,
    p99: a[o + 7] ?? 0,
    energy: a[o + 8] ?? 0,
    entropy: a[o + 9] ?? 0,
  };
}

export class WasmEngine {
  constructor(e) {
    this.e = e;
    this.imgPtr = 0;
    this.imgBytes = 0;
    this.filePtr = 0;
    this.fileBytes = 0;
    this.outPtr = 0;
    this.outBytes = 0;
    this.width = 0;
    this.height = 0;
    this.statsPtr = e.tb_alloc(20 * 8);
    e.tb_set_limits(
      DEFAULT_LIMITS.maxPixels,
      DEFAULT_LIMITS.maxDim,
      DEFAULT_LIMITS.maxFileBytes,
    );
  }

  static async load(url = "./forensic-engine.wasm") {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`wasm fetch ${res.status}`);
    const buf = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(buf, {});
    const e = instance.exports;
    if (!e.memory || !e.tb_ela) throw new Error("not a tracebench forensic-engine wasm");
    return new WasmEngine(e);
  }

  version() {
    return this.readCString(this.e.tb_version()) || "1.0.0";
  }

  engineId() {
    return this.readCString(this.e.tb_engine_id());
  }

  mem() {
    return new Uint8Array(this.e.memory.buffer);
  }

  readCString(ptr) {
    if (!ptr) return "";
    const m = this.mem();
    let end = ptr;
    while (end < m.length && m[end] !== 0) end++;
    return new TextDecoder().decode(m.subarray(ptr, end));
  }

  lastError() {
    return this.readCString(this.e.tb_last_error());
  }

  lastJson() {
    const len = this.e.tb_last_json_len();
    const ptr = this.e.tb_last_json();
    if (!ptr || !len) return null;
    const m = this.mem();
    try {
      return JSON.parse(new TextDecoder().decode(m.subarray(ptr, ptr + len)));
    } catch {
      return null;
    }
  }

  ensure(ptr, have, need) {
    if (have >= need && ptr) return ptr;
    if (ptr) this.e.tb_free(ptr, have);
    return this.e.tb_alloc(need);
  }

  setImage(rgba, w, h) {
    const n = w * h * 4;
    this.imgPtr = this.ensure(this.imgPtr, this.imgBytes, n);
    this.imgBytes = Math.max(n, this.imgBytes);
    this.mem().set(rgba, this.imgPtr);
    const rc = this.e.tb_set_image(this.imgPtr, w, h);
    if (rc !== 0) throw new Error(this.lastError() || `set_image ${rc}`);
    this.width = w;
    this.height = h;
    const outN = w * h;
    this.outPtr = this.ensure(this.outPtr, this.outBytes, outN);
    this.outBytes = Math.max(outN, this.outBytes);
  }

  setFile(bytes) {
    const n = bytes.length;
    this.filePtr = this.ensure(this.filePtr, this.fileBytes, n || 1);
    this.fileBytes = Math.max(n || 1, this.fileBytes);
    if (n) this.mem().set(bytes, this.filePtr);
    this.e.tb_set_file(this.filePtr, n);
  }

  copyOut() {
    const n = this.width * this.height;
    return this.mem().slice(this.outPtr, this.outPtr + n);
  }

  stats() {
    return statsFromF64(new Float64Array(this.e.memory.buffer, this.statsPtr, 10));
  }

  run(rc) {
    if (rc !== 0) throw new Error(this.lastError() || `engine ${rc}`);
    return { gray: this.copyOut(), stats: this.stats(), extra: this.lastJson() };
  }

  g(gain, percentile) {
    return [Math.round(gain * 100), Math.round(percentile * 100)];
  }

  ela(quality, gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(this.e.tb_ela(quality, G, P, this.outPtr, this.statsPtr));
  }
  noise(method, window, gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(this.e.tb_noise(method, window, G, P, this.outPtr, this.statsPtr));
  }
  edge(method, gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(this.e.tb_edge(method, G, P, this.outPtr, this.statsPtr));
  }
  sharpness(window, gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(this.e.tb_sharpness(window, G, P, this.outPtr, this.statsPtr));
  }
  color(gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(this.e.tb_color(G, P, this.outPtr, this.statsPtr));
  }
  cfa(gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(this.e.tb_cfa(G, P, this.outPtr, this.statsPtr));
  }
  resample(gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(this.e.tb_resample(G, P, this.outPtr, this.statsPtr));
  }
  frequency(band, gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(this.e.tb_frequency(band, G, P, this.outPtr, this.statsPtr));
  }
  doubleJpeg(gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(this.e.tb_double_jpeg(G, P, this.outPtr, this.statsPtr));
  }
  clone(block, stride, thr, minR, gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(
      this.e.tb_clone(block, stride, thr, minR, G, P, this.outPtr, this.statsPtr),
    );
  }
  prnu(gain, percentile) {
    const [G, P] = this.g(gain, percentile);
    return this.run(this.e.tb_prnu_residual(G, P, this.outPtr, this.statsPtr));
  }
  jpegJson() {
    this.e.tb_jpeg_json();
    return this.lastJson();
  }
  thumbnail() {
    const n = this.e.tb_thumbnail_len();
    const p = this.e.tb_thumbnail_ptr();
    if (!n || !p) return null;
    return this.mem().slice(p, p + n);
  }
  regionLumaStats(x, y, w, h) {
    const rc = this.e.tb_region_luma_stats(x, y, w, h, this.statsPtr);
    if (rc !== 0) throw new Error(this.lastError() || `region ${rc}`);
    return this.stats();
  }
}

export default WasmEngine;
