/// <reference lib="webworker" />

import { buildDemoCase } from "@/lib/forensic/demo";
import {
  cfaJs,
  cloneJs,
  colorJs,
  doubleJpegJs,
  edgeJs,
  elaJs,
  frequencyJs,
  noiseJs,
  regionLumaStats,
  resampleJs,
  sharpnessJs,
  toLuma,
} from "@/lib/forensic/js-engine";
import { caseIdFromHash, evidenceIdFromHash, shaHex } from "@/lib/forensic/hash";
import { dimensionMismatch, parseMedia } from "@/lib/forensic/parse-media";
import { scaleToU8 } from "@/lib/forensic/stats";
import {
  DETECTOR_VERSIONS,
  LIMITS,
  SOFTWARE_VERSION,
  type DetectorParams,
  type Heatmap,
  type ModuleId,
} from "@/lib/forensic/types";
import { WasmEngine } from "@/lib/forensic/wasm";

type Req =
  | { id: number; type: "init" }
  | { id: number; type: "demo" }
  | { id: number; type: "load"; buffer: ArrayBuffer; name: string; mime?: string }
  | { id: number; type: "run"; module: ModuleId; params: DetectorParams }
  | { id: number; type: "run-suite"; params: DetectorParams }
  | { id: number; type: "region"; x: number; y: number; w: number; h: number }
  | { id: number; type: "pixel"; x: number; y: number };

let wasm: WasmEngine | null = null;
let engineKind: "wasm" | "js" = "js";
let generation = 0;

let rgba: Uint8Array | null = null;
let luma: Float32Array | null = null;
let width = 0;
let height = 0;
let parsed: ReturnType<typeof parseMedia> | null = null;

function post(id: number, payload: Record<string, unknown>, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage({ id, ...payload }, transfer);
}

function progress(id: number, pct: number, label: string) {
  post(id, { type: "progress", pct, label });
}

async function ensureWasm() {
  if (wasm) return;
  wasm = await WasmEngine.load("/forensic-engine.wasm");
  engineKind = wasm ? "wasm" : "js";
}

function checkLimits(bytes: ArrayBuffer, w: number, h: number) {
  if (bytes.byteLength > LIMITS.maxFileBytes) {
    throw new Error(`File exceeds ${LIMITS.maxFileBytes} byte safety limit.`);
  }
  if (w > LIMITS.maxDim || h > LIMITS.maxDim) {
    throw new Error(`Dimension ${w}×${h} exceeds ${LIMITS.maxDim}px safety limit.`);
  }
  if (w * h > LIMITS.maxPixels) {
    throw new Error(`Pixel count exceeds ${LIMITS.maxPixels} safety limit.`);
  }
}

async function decodeToRgba(buffer: ArrayBuffer): Promise<{
  rgba: Uint8Array;
  w: number;
  h: number;
  bitmap: ImageBitmap;
}> {
  const blob = new Blob([buffer]);
  const bitmap = await createImageBitmap(blob);
  const w = bitmap.width;
  const h = bitmap.height;
  checkLimits(buffer, w, h);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("2d context unavailable");
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, w, h);
  return { rgba: new Uint8Array(data.data.buffer.slice(0)), w, h, bitmap };
}

async function ingest(
  id: number,
  buffer: ArrayBuffer,
  name: string,
  mime: string | undefined,
  synthetic = false,
) {
  progress(id, 4, "Hashing");
  const sha256 = await shaHex(buffer, "SHA-256");
  const sha512 = await shaHex(buffer, "SHA-512");
  progress(id, 12, "Parsing container");
  const bytes = new Uint8Array(buffer);
  parsed = parseMedia(bytes, mime);
  progress(id, 22, "Decoding raster");
  const decoded = await decodeToRgba(buffer);
  rgba = decoded.rgba;
  width = decoded.w;
  height = decoded.h;
  luma = toLuma(rgba, width * height);
  if (wasm) {
    try {
      wasm.setImage(rgba, width, height);
      wasm.setFile(bytes);
    } catch (err) {
      engineKind = "js";
      wasm = null;
      console.warn("wasm ingest failed, using JS engine", err);
    }
  }
  const warnings = [...(parsed.warnings ?? []), ...dimensionMismatch(width, height, parsed.fields)];
  const now = new Date();
  const orig = new ImageData(new Uint8ClampedArray(rgba), width, height);
  const bmp = await createImageBitmap(orig);
  decoded.bitmap.close();
  const thumb = parsed.thumbnailJpeg ? new Uint8Array(parsed.thumbnailJpeg) : null;
  const msg = {
    id,
    type: "loaded" as const,
    engine: engineKind,
    engineVersion: wasm?.version() ?? "js-1.0.0",
    caseRecord: {
      caseId: caseIdFromHash(sha256, now),
      evidenceId: evidenceIdFromHash(sha256),
      originalFilename: name,
      mime: parsed.mime,
      size: buffer.byteLength,
      width,
      height,
      format: parsed.kind,
      sha256,
      sha512,
      analyzedAt: now.toISOString(),
      softwareVersion: SOFTWARE_VERSION,
      detectorVersions: DETECTOR_VERSIONS,
      synthetic,
    },
    media: {
      kind: parsed.kind,
      mime: parsed.mime,
      jpeg: parsed.jpeg,
      fields: parsed.fields,
      warnings,
      hasThumbnail: Boolean(parsed.thumbnailJpeg?.length),
    },
    thumbnail: thumb,
    original: bmp,
  };
  const transfer: Transferable[] = [bmp];
  if (thumb) transfer.push(thumb.buffer);
  (self as unknown as Worker).postMessage(msg, transfer);
}

function heatmap(
  module: ModuleId,
  gray: Uint8Array,
  stats: Heatmap["stats"],
  extra?: Record<string, unknown>,
  note?: string,
  experimental?: boolean,
  appropriate?: boolean,
): Heatmap {
  return { module, width, height, gray, stats, extra, note, experimental, appropriate };
}

async function runModule(module: ModuleId, params: DetectorParams): Promise<Heatmap> {
  if (!rgba || !luma) throw new Error("No image loaded");
  const g = params.gain;
  const p = params.percentile;
  const useWasm = engineKind === "wasm" && wasm;

  const wrap = (
    mod: ModuleId,
    r: { gray: Uint8Array; stats: Heatmap["stats"]; extra?: Record<string, unknown> | null },
    experimental = false,
    appropriate = true,
    note?: string,
  ) => heatmap(mod, r.gray, r.stats, r.extra ?? undefined, note, experimental, appropriate);

  switch (module) {
    case "ela": {
      const appropriate = parsed?.kind === "jpeg";
      const note = appropriate
        ? "ELA residual after JPEG re-encode."
        : "ELA is designed for JPEG. This file does not appear to be JPEG.";
      if (useWasm) {
        const r = wasm!.ela(params.elaQuality, params.elaGain, params.elaPercentile);
        return wrap("ela", r, false, appropriate, (r.extra?.note as string) ?? note);
      }
      const r = await elaJs(rgba, width, height, params.elaQuality, params.elaGain, params.elaPercentile);
      return wrap("ela", r, false, appropriate, note);
    }
    case "noise":
      return wrap(
        "noise",
        useWasm
          ? wasm!.noise(params.noiseMethod, params.noiseWindow, g, p)
          : noiseJs(luma, width, height, params.noiseMethod, params.noiseWindow, g, p),
      );
    case "edge":
      return wrap(
        "edge",
        useWasm ? wasm!.edge(params.edgeMethod, g, p) : edgeJs(luma, width, height, params.edgeMethod, g, p),
      );
    case "sharpness":
      return wrap(
        "sharpness",
        useWasm
          ? wasm!.sharpness(params.sharpnessWindow, g, p)
          : sharpnessJs(luma, width, height, params.sharpnessWindow, g, p),
      );
    case "color":
      return wrap("color", useWasm ? wasm!.color(g, p) : colorJs(rgba, width, height, g, p));
    case "cfa":
      return wrap(
        "cfa",
        useWasm ? wasm!.cfa(g, p) : cfaJs(rgba, width, height, g, p),
        true,
        true,
        "Experimental CFA residual.",
      );
    case "resampling":
      return wrap("resampling", useWasm ? wasm!.resample(g, p) : resampleJs(luma, width, height, g, p));
    case "dct": {
      const freq = useWasm
        ? wasm!.frequency(params.dctBand, g, p)
        : frequencyJs(luma, width, height, params.dctBand, g, p);
      const dj = useWasm ? wasm!.doubleJpeg(g, p) : doubleJpegJs(luma, width, height, g, p);
      return wrap("dct", {
        gray: freq.gray,
        stats: freq.stats,
        extra: { ...((freq as any).extra ?? {}), doubleJpeg: dj.extra ?? { periodicityScore: (dj as { extra?: { periodicityScore: number } }).extra } },
      });
    }
    case "frequency":
      return wrap("frequency", useWasm ? wasm!.frequency(4, g, p) : frequencyJs(luma, width, height, 4, g, p));
    case "clone":
      return wrap(
        "clone",
        useWasm
          ? wasm!.clone(params.cloneBlock, params.cloneStride, params.cloneThreshold, params.cloneMinRegion, 4, 99)
          : cloneJs(
              luma,
              width,
              height,
              params.cloneBlock,
              params.cloneStride,
              params.cloneThreshold,
              params.cloneMinRegion,
              4,
              99,
            ),
      );
    case "prnu":
      return wrap(
        "prnu",
        useWasm ? wasm!.prnu(g, p) : noiseJs(luma, width, height, 4, 5, g, p),
        true,
        true,
        "Residual only — no reference fingerprint.",
      );
    case "jpeg": {
      const extra = useWasm ? wasm!.jpegJson() : (parsed?.jpeg ?? null);
      return heatmap("jpeg", new Uint8Array(width * height), {
        mean: 0, median: 0, std: 0, min: 0, max: 0, p05: 0, p95: 0, p99: 0, energy: 0, entropy: 0,
      }, (extra as Record<string, unknown>) ?? undefined);
    }
    case "thumbnail": {
      const thumbBytes = parsed?.thumbnailJpeg;
      if (!thumbBytes) {
        return heatmap(
          "thumbnail",
          new Uint8Array(width * height),
          { mean: 0, median: 0, std: 0, min: 0, max: 0, p05: 0, p95: 0, p99: 0, energy: 0, entropy: 0 },
          { available: false },
        );
      }
      const blob = new Blob([thumbBytes as BlobPart], { type: "image/jpeg" });
      const tb = await createImageBitmap(blob);
      const tw = tb.width;
      const th = tb.height;
      const c = new OffscreenCanvas(tw, th);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("2d");
      ctx.drawImage(tb, 0, 0);
      const tdata = ctx.getImageData(0, 0, tw, th).data;
      const mainBmp = await createImageBitmap(new ImageData(new Uint8ClampedArray(rgba), width, height), {
        resizeWidth: tw,
        resizeHeight: th,
      });
      ctx.clearRect(0, 0, tw, th);
      ctx.drawImage(mainBmp, 0, 0, tw, th);
      const mdata = ctx.getImageData(0, 0, tw, th).data;
      tb.close();
      mainBmp.close();
      const residual = new Float32Array(tw * th);
      for (let i = 0; i < tw * th; i++) {
        const dr = Math.abs(tdata[i * 4]! - mdata[i * 4]!);
        const dg = Math.abs(tdata[i * 4 + 1]! - mdata[i * 4 + 1]!);
        const db = Math.abs(tdata[i * 4 + 2]! - mdata[i * 4 + 2]!);
        residual[i] = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
      }
      const scaled = scaleToU8(residual, 8, 98);
      const gray = new Uint8Array(width * height);
      for (let yy = 0; yy < height; yy++) {
        const sy = Math.min(th - 1, Math.floor((yy / height) * th));
        for (let xx = 0; xx < width; xx++) {
          const sx = Math.min(tw - 1, Math.floor((xx / width) * tw));
          gray[yy * width + xx] = scaled.gray[sy * tw + sx]!;
        }
      }
      return heatmap("thumbnail", gray, scaled.stats, { available: true, thumbWidth: tw, thumbHeight: th });
    }
    default:
      throw new Error(`Module ${module} is a viewer, not a detector`);
  }
}

const SUITE: ModuleId[] = [
  "ela",
  "noise",
  "edge",
  "sharpness",
  "dct",
  "frequency",
  "resampling",
  "clone",
  "color",
  "cfa",
  "prnu",
  "thumbnail",
];

self.onmessage = async (ev: MessageEvent<Req>) => {
  const msg = ev.data;
  const id = msg.id;
  try {
    if (msg.type === "init") {
      await ensureWasm();
      post(id, { type: "ready", engine: engineKind, version: wasm?.version() ?? "js-1.0.0", simd: engineKind === "wasm" });
      return;
    }
    if (msg.type === "demo") {
      await ensureWasm();
      const demo = await buildDemoCase();
      await ingest(id, demo.buffer, demo.filename, demo.mime, true);
      return;
    }
    if (msg.type === "load") {
      await ensureWasm();
      await ingest(id, msg.buffer, msg.name, msg.mime, false);
      return;
    }
    if (msg.type === "run") {
      const gen = ++generation;
      const map = await runModule(msg.module, msg.params);
      if (gen !== generation) return;
      post(id, { type: "map", map }, [map.gray.buffer]);
      return;
    }
    if (msg.type === "run-suite") {
      const gen = ++generation;
      for (let i = 0; i < SUITE.length; i++) {
        if (gen !== generation) return;
        const mod = SUITE[i]!;
        progress(id, Math.round(((i + 0.2) / SUITE.length) * 100), mod);
        try {
          const map = await runModule(mod, msg.params);
          post(id, { type: "map", map, suiteIndex: i, suiteTotal: SUITE.length }, [map.gray.buffer]);
        } catch (err) {
          post(id, {
            type: "map-error",
            module: mod,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        await new Promise((r) => setTimeout(r, 0));
      }
      post(id, { type: "suite-done" });
      return;
    }
    if (msg.type === "region") {
      if (!luma) throw new Error("No image");
      const stats = regionLumaStats(luma, width, height, msg.x, msg.y, msg.w, msg.h);
      post(id, { type: "region-stats", stats });
      return;
    }
    if (msg.type === "pixel") {
      if (!rgba || !luma) throw new Error("No image");
      const x = Math.max(0, Math.min(width - 1, msg.x | 0));
      const y = Math.max(0, Math.min(height - 1, msg.y | 0));
      const i = y * width + x;
      const r = rgba[i * 4]!;
      const g = rgba[i * 4 + 1]!;
      const b = rgba[i * 4 + 2]!;
      const a = rgba[i * 4 + 3]!;
      let localVar = 0;
      let gradient = 0;
      if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
        const c = luma[i]!;
        const samples = [luma[i - 1]!, luma[i + 1]!, luma[i - width]!, luma[i + width]!];
        const mean = (c + samples.reduce((s, v) => s + v, 0)) / 5;
        localVar = [c, ...samples].reduce((s, v) => s + (v - mean) ** 2, 0) / 5;
        gradient = Math.hypot(luma[i + 1]! - luma[i - 1]!, luma[i + width]! - luma[i - width]!);
      }
      post(id, {
        type: "pixel",
        sample: { x, y, r, g, b, a, luma: luma[i], localVar, gradient },
      });
    }
  } catch (err) {
    post(id, { type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};

self.onerror = (message, source, lineno, colno, error) => {
  console.error("Forensic worker unhandled error:", message, error);
  return true; // Prevent propagation
};

