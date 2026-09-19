import { LIMITS, statsFromF64, type Stats } from "./types";

export type WasmExports = {
  memory: WebAssembly.Memory;
  tb_alloc: (n: number) => number;
  tb_free: (p: number, n: number) => void;
  tb_set_limits: (px: number, dim: number, file: number) => void;
  tb_set_image: (p: number, w: number, h: number) => number;
  tb_set_file: (p: number, n: number) => number;
  tb_width: () => number;
  tb_height: () => number;
  tb_last_error: () => number;
  tb_last_json: () => number;
  tb_last_json_len: () => number;
  tb_ela: (q: number, g: number, p: number, out: number, st: number) => number;
  tb_noise: (m: number, w: number, g: number, p: number, out: number, st: number) => number;
  tb_edge: (m: number, g: number, p: number, out: number, st: number) => number;
  tb_sharpness: (w: number, g: number, p: number, out: number, st: number) => number;
  tb_color: (g: number, p: number, out: number, st: number) => number;
  tb_cfa: (g: number, p: number, out: number, st: number) => number;
  tb_resample: (g: number, p: number, out: number, st: number) => number;
  tb_frequency: (b: number, g: number, p: number, out: number, st: number) => number;
  tb_double_jpeg: (g: number, p: number, out: number, st: number) => number;
  tb_clone: (
    b: number, s: number, t: number, m: number, g: number, p: number, out: number, st: number,
  ) => number;
  tb_prnu_residual: (g: number, p: number, out: number, st: number) => number;
  tb_jpeg_json: () => number;
  tb_thumbnail_ptr: () => number;
  tb_thumbnail_len: () => number;
  tb_region_luma_stats: (x: number, y: number, w: number, h: number, st: number) => number;
  tb_region_compare: (
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number, st: number,
  ) => number;
  tb_version: () => number;
  tb_engine_id: () => number;
};

export class WasmEngine {
  private e: WasmExports;
  private imgPtr = 0;
  private imgBytes = 0;
  private filePtr = 0;
  private fileBytes = 0;
  private outPtr = 0;
  private outBytes = 0;
  private statsPtr = 0;
  width = 0;
  height = 0;

  constructor(e: WasmExports) {
    this.e = e;
    this.statsPtr = e.tb_alloc(20 * 8);
    e.tb_set_limits(LIMITS.maxPixels, LIMITS.maxDim, LIMITS.maxFileBytes);
  }

  static async load(url = "/forensic-engine.wasm"): Promise<WasmEngine | null> {
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const buf = await res.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(buf, {});
      const e = instance.exports as unknown as WasmExports;
      if (!e.memory || !e.tb_ela) return null;
      return new WasmEngine(e);
    } catch {
      return null;
    }
  }

  version(): string {
    return this.readCString(this.e.tb_version()) || "1.0.0";
  }

  private mem(): Uint8Array {
    return new Uint8Array(this.e.memory.buffer);
  }

  private readCString(ptr: number): string {
    if (!ptr) return "";
    const m = this.mem();
    let end = ptr;
    while (end < m.length && m[end] !== 0) end++;
    return new TextDecoder().decode(m.subarray(ptr, end));
  }

  lastError(): string {
    return this.readCString(this.e.tb_last_error());
  }

  lastJson<T = Record<string, unknown>>(): T | null {
    const len = this.e.tb_last_json_len();
    const ptr = this.e.tb_last_json();
    if (!ptr || !len) return null;
    const m = this.mem();
    try {
      return JSON.parse(new TextDecoder().decode(m.subarray(ptr, ptr + len))) as T;
    } catch {
      return null;
    }
  }

  private ensure(ptr: number, have: number, need: number, alloc: (p: number) => void): number {
    if (have >= need && ptr) return ptr;
    if (ptr) this.e.tb_free(ptr, have);
    const p = this.e.tb_alloc(need);
    alloc(p);
    return p;
  }

  setImage(rgba: Uint8Array, w: number, h: number): void {
    const n = w * h * 4;
    this.imgPtr = this.ensure(this.imgPtr, this.imgBytes, n, (p) => {
      this.imgPtr = p;
      this.imgBytes = n;
    });
    this.imgBytes = Math.max(this.imgBytes, n);
    this.mem().set(rgba, this.imgPtr);
    const rc = this.e.tb_set_image(this.imgPtr, w, h);
    if (rc !== 0) throw new Error(this.lastError() || `set_image ${rc}`);
    this.width = w;
    this.height = h;
    const outN = w * h;
    this.outPtr = this.ensure(this.outPtr, this.outBytes, outN, (p) => {
      this.outPtr = p;
      this.outBytes = outN;
    });
    this.outBytes = Math.max(this.outBytes, outN);
  }

  setFile(bytes: Uint8Array): void {
    const n = bytes.length;
    this.filePtr = this.ensure(this.filePtr, this.fileBytes, n || 1, (p) => {
      this.filePtr = p;
      this.fileBytes = n || 1;
    });
    this.fileBytes = Math.max(this.fileBytes, n || 1);
    if (n) this.mem().set(bytes, this.filePtr);
    this.e.tb_set_file(this.filePtr, n);
  }

  private copyOut(): Uint8Array {
    const n = this.width * this.height;
    return this.mem().slice(this.outPtr, this.outPtr + n);
  }

  private stats(): Stats {
    const view = new Float64Array(this.e.memory.buffer, this.statsPtr, 10);
    return statsFromF64(view);
  }

  private run(rc: number): { gray: Uint8Array; stats: Stats; extra: Record<string, unknown> | null } {
    if (rc !== 0) throw new Error(this.lastError() || `engine ${rc}`);
    return { gray: this.copyOut(), stats: this.stats(), extra: this.lastJson() };
  }

  ela(quality: number, gain: number, percentile: number) {
    return this.run(this.e.tb_ela(quality, Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr));
  }
  noise(method: number, window: number, gain: number, percentile: number) {
    return this.run(this.e.tb_noise(method, window, Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr));
  }
  edge(method: number, gain: number, percentile: number) {
    return this.run(this.e.tb_edge(method, Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr));
  }
  sharpness(window: number, gain: number, percentile: number) {
    return this.run(this.e.tb_sharpness(window, Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr));
  }
  color(gain: number, percentile: number) {
    return this.run(this.e.tb_color(Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr));
  }
  cfa(gain: number, percentile: number) {
    return this.run(this.e.tb_cfa(Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr));
  }
  resample(gain: number, percentile: number) {
    return this.run(this.e.tb_resample(Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr));
  }
  frequency(band: number, gain: number, percentile: number) {
    return this.run(this.e.tb_frequency(band, Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr));
  }
  doubleJpeg(gain: number, percentile: number) {
    return this.run(this.e.tb_double_jpeg(Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr));
  }
  clone(block: number, stride: number, thr: number, minR: number, gain: number, percentile: number) {
    return this.run(
      this.e.tb_clone(block, stride, thr, minR, Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr),
    );
  }
  prnu(gain: number, percentile: number) {
    return this.run(this.e.tb_prnu_residual(Math.round(gain * 100), Math.round(percentile * 100), this.outPtr, this.statsPtr));
  }
  jpegJson(): Record<string, unknown> | null {
    this.e.tb_jpeg_json();
    return this.lastJson();
  }
  thumbnail(): Uint8Array | null {
    const n = this.e.tb_thumbnail_len();
    const p = this.e.tb_thumbnail_ptr();
    if (!n || !p) return null;
    return this.mem().slice(p, p + n);
  }
}
