import { create } from "zustand";
import { ForensicClient, type LoadedPayload, type WorkerMsg } from "@/lib/forensic/client";
import { evidenceFor, jpegEvidence, metadataEvidence } from "@/lib/forensic/evidence";
import {
  DEFAULT_PARAMS,
  type AutoRegion,
  type CaseRecord,
  type CustodyEvent,
  type DetectorParams,
  type EngineKind,
  type EvidenceEntry,
  type Heatmap,
  type ModuleId,
  type ParsedMedia,
  type PixelSample,
  type Roi,
  type Stats,
  type ViewMode,
} from "@/lib/forensic/types";

const client = new ForensicClient();

type MediaState = ParsedMedia & { hasThumbnail?: boolean; warnings: string[] };

interface LabState {
  ready: boolean;
  engine: EngineKind;
  engineVersion: string;
  gpu: boolean;
  error: string | null;
  progress: { pct: number; label: string } | null;
  caseRecord: CaseRecord | null;
  media: MediaState | null;
  original: ImageBitmap | null;
  thumbnail: ImageBitmap | null;
  fileBase64: string | null;
  maps: Partial<Record<ModuleId, Heatmap>>;
  evidence: EvidenceEntry[];
  params: DetectorParams;
  active: ModuleId;
  viewMode: ViewMode;
  overlay: boolean;
  camera: { scale: number; x: number; y: number };
  pixel: PixelSample | null;
  rois: Roi[];
  activeRoi: string | null;
  regions: AutoRegion[];
  custody: CustodyEvent[];
  bottomTab: "histogram" | "pixel" | "evidence" | "params" | "structure" | "methods" | "exif";
  navOpen: boolean;
  init: () => Promise<void>;
  loadFile: (file: File) => Promise<void>;
  loadDemo: () => void;
  runSuite: () => void;
  rerun: (module: ModuleId) => void;
  setActive: (m: ModuleId) => void;
  setViewMode: (m: ViewMode) => void;
  setParams: (p: Partial<DetectorParams>) => void;
  setCamera: (c: Partial<LabState["camera"]>) => void;
  setPixel: (p: PixelSample | null) => void;
  setOverlay: (v: boolean) => void;
  setBottomTab: (t: LabState["bottomTab"]) => void;
  setNavOpen: (v: boolean) => void;
  addRoi: (roi: Roi) => void;
  clearRois: () => void;
  resetCase: () => void;
}

function custody(op: string, hash: string, parameters: Record<string, unknown>, engine: string): CustodyEvent {
  return {
    ts: new Date().toISOString(),
    operation: op,
    parameters,
    hashSha256: hash,
    softwareVersion: "1.0.0",
    engine,
  };
}

function regionsFromMaps(maps: Partial<Record<ModuleId, Heatmap>>): AutoRegion[] {
  const src = maps.ela ?? maps.noise;
  if (!src) return [];
  const { gray, width, height } = src;
  const cell = 32;
  type Seed = { x: number; y: number; e: number };
  const seeds: Seed[] = [];
  for (let cy = 0; cy < Math.floor(height / cell); cy++) {
    for (let cx = 0; cx < Math.floor(width / cell); cx++) {
      let s = 0;
      let n = 0;
      for (let j = 0; j < cell; j++) {
        for (let i = 0; i < cell; i++) {
          s += gray[(cy * cell + j) * width + (cx * cell + i)] ?? 0;
          n++;
        }
      }
      const e = s / n;
      if (e > 48) seeds.push({ x: cx * cell, y: cy * cell, e });
    }
  }
  seeds.sort((a, b) => b.e - a.e);
  const out: AutoRegion[] = [];
  for (const s of seeds) {
    if (out.length >= 12) break;
    const overlaps = out.some(
      (r) => Math.abs(r.x - s.x) < cell * 2 && Math.abs(r.y - s.y) < cell * 2,
    );
    if (overlaps) continue;
    out.push({
      id: `R${String(out.length + 1).padStart(2, "0")}`,
      label: `Region ${String(out.length + 1).padStart(2, "0")}`,
      x: s.x,
      y: s.y,
      w: cell * 2,
      h: cell * 2,
      score: s.e,
    });
  }
  return out;
}

export const useLab = create<LabState>((set, get) => ({
  ready: false,
  engine: "js",
  engineVersion: "",
  gpu: false,
  error: null,
  progress: null,
  caseRecord: null,
  media: null,
  original: null,
  thumbnail: null,
  fileBase64: null,
  maps: {},
  evidence: [],
  params: { ...DEFAULT_PARAMS },
  active: "ela",
  viewMode: "multi",
  overlay: true,
  camera: { scale: 1, x: 0, y: 0 },
  pixel: null,
  rois: [],
  activeRoi: null,
  regions: [],
  custody: [],
  bottomTab: "evidence",
  navOpen: false,

  init: async () => {
    client.onMessage = (msg) => handle(msg, get, set);
    try {
      const ready = await client.init();
      const gpu = typeof navigator !== "undefined" && "gpu" in navigator;
      set({
        ready: true,
        engine: ready.engine,
        engineVersion: ready.version,
        gpu,
        error: null,
      });
    } catch (err) {
      set({
        ready: true,
        engine: "js",
        engineVersion: "js-1.0.0",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  loadFile: async (file) => {
    get().resetCase();
    if (!file) {
      set({ error: "No file was selected for analysis." });
      return;
    }
    
    // Safety size threshold to prevent tab crash on giant images
    const maxSizeBytes = 35 * 1024 * 1024; // 35MB cap
    if (file.size > maxSizeBytes) {
      set({
        error: `File size limit exceeded: Selected file is ${fmtBytes(file.size)}. Maximum supported image size for in-memory WASM analysis is 35 MB.`,
      });
      return;
    }

    // MIME type and file extension verification
    const validMimes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/bmp", "image/x-tiff"];
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const validExts = ["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "bmp"];
    
    if (!validMimes.includes(file.type) && !validExts.includes(ext)) {
      set({
        error: `Unsupported file type: "${file.name}" (${file.type || "unknown"}). Please load a standard raster image (JPEG, PNG, WebP, TIFF, BMP, or GIF).`,
      });
      return;
    }

    // Read the file as Base64 for reporting
    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          set({ fileBase64: e.target.result as string });
        }
      };
      reader.readAsDataURL(file);
    } catch (e) {
      console.error("Failed to read file as DataURL", e);
    }

    try {
      set({ progress: { pct: 5, label: "Reading binary payload..." }, error: null });
      const buffer = await file.arrayBuffer();
      if (!buffer || buffer.byteLength === 0) {
        throw new Error("File array buffer is empty or corrupted (0 bytes read).");
      }
      set({ progress: { pct: 15, label: "Allocating WASM memory buffers..." } });
      client.load(buffer, file.name, file.type);
    } catch (err) {
      set({
        error: `Forensic Ingestion Error: ${err instanceof Error ? err.message : "Failed to load file. It might be corrupted or in an unrecognized format."}`,
        progress: null,
      });
    }
  },

  loadDemo: () => {
    try {
      get().resetCase();
      set({ progress: { pct: 5, label: "Synthesizing test raster structure..." }, error: null });
      client.demo();
    } catch (err) {
      set({
        error: `Demo Generation Error: ${err instanceof Error ? err.message : "Failed to instantiate simulation demo workspace."}`,
        progress: null,
      });
    }
  },

  runSuite: () => {
    const { params, caseRecord } = get();
    if (!caseRecord) return;
    set({ progress: { pct: 1, label: "Analyzing" } });
    client.runSuite(params);
  },

  rerun: (module) => {
    const { params } = get();
    set({ progress: { pct: 1, label: module } });
    client.run(module, params);
  },

  setActive: (m) => set({ active: m, navOpen: false }),
  setViewMode: (m) => set({ viewMode: m }),
  setParams: (p) => set({ params: { ...get().params, ...p } }),
  setCamera: (c) => set({ camera: { ...get().camera, ...c } }),
  setPixel: (p) => set({ pixel: p }),
  setOverlay: (v) => set({ overlay: v }),
  setBottomTab: (t) => set({ bottomTab: t }),
  setNavOpen: (v) => set({ navOpen: v }),
  addRoi: (roi) => set({ rois: [...get().rois, roi], activeRoi: roi.id }),
  clearRois: () => set({ rois: [], activeRoi: null }),
  resetCase: () => {
    const prev = get().original;
    prev?.close();
    get().thumbnail?.close();
    set({
      caseRecord: null,
      media: null,
      original: null,
      thumbnail: null,
      fileBase64: null,
      maps: {},
      evidence: [],
      pixel: null,
      rois: [],
      regions: [],
      camera: { scale: 1, x: 0, y: 0 },
      progress: null,
      error: null,
    });
  },
}));

function handle(
  msg: WorkerMsg,
  get: () => LabState,
  set: (p: Partial<LabState>) => void,
) {
  if (msg.type === "progress") {
    set({ progress: { pct: msg.pct, label: msg.label } });
    return;
  }
  if (msg.type === "error") {
    set({ error: msg.error, progress: null });
    return;
  }
  if (msg.type === "loaded") {
    const m = msg as LoadedPayload & { id: number; type: "loaded" };
    const thumbBmp: ImageBitmap | null = null;
    const ev = [
      metadataEvidence(m.media, m.media.warnings),
      jpegEvidence(m.media),
    ];
    
    // Generate fileBase64 from the loaded ImageBitmap if not already set (e.g. for Demo mode)
    if (!get().fileBase64 && m.original) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = m.original.width;
        canvas.height = m.original.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(m.original, 0, 0);
          const base64 = canvas.toDataURL("image/jpeg", 0.85);
          set({ fileBase64: base64 });
        }
      } catch (e) {
        console.error("Failed to generate demo image base64", e);
      }
    }

    set({
      caseRecord: m.caseRecord,
      media: m.media,
      original: m.original,
      maps: {},
      evidence: ev,
      camera: { scale: 1, x: 0, y: 0 },
      custody: [
        custody("ingest", m.caseRecord.sha256, { filename: m.caseRecord.originalFilename }, m.engine),
      ],
      engine: m.engine,
      engineVersion: m.engineVersion,
      progress: { pct: 30, label: "Running detectors" },
      thumbnail: thumbBmp,
    });
    if (m.thumbnail && m.thumbnail.length) {
      const blob = new Blob([m.thumbnail as BlobPart], { type: "image/jpeg" });
      createImageBitmap(blob).then((bmp) => set({ thumbnail: bmp })).catch(() => {});
    }
    client.runSuite(get().params);
    return;
  }
  if (msg.type === "map") {
    const maps = { ...get().maps, [msg.map.module]: msg.map };
    const media = get().media;
    const params = get().params;
    const entry = evidenceFor(msg.map, media, params);
    const evidence = [
      ...get().evidence.filter((e) => e.module !== msg.map.module),
      entry,
    ];
    const regions = regionsFromMaps(maps);
    const log = get().caseRecord
      ? [
          ...get().custody,
          custody(`analyze:${msg.map.module}`, get().caseRecord!.sha256, entry.parameters, get().engine),
        ]
      : get().custody;
    set({
      maps,
      evidence,
      regions,
      custody: log,
      progress: msg.suiteTotal
        ? { pct: Math.round(((msg.suiteIndex ?? 0) / msg.suiteTotal) * 100), label: msg.map.module }
        : null,
    });
    return;
  }
  if (msg.type === "suite-done") {
    set({ progress: null });
    return;
  }
  if (msg.type === "pixel") {
    const maps = get().maps;
    const i = (x: number, y: number, m?: Heatmap) => {
      if (!m) return null;
      if (x < 0 || y < 0 || x >= m.width || y >= m.height) return null;
      return m.gray[y * m.width + x] ?? null;
    };
    const s = msg.sample;
    set({
      pixel: {
        ...s,
        ela: i(s.x, s.y, maps.ela),
        noise: i(s.x, s.y, maps.noise),
      },
    });
  }
}

export function requestPixel(x: number, y: number) {
  client.pixel(x, y);
}

export function requestRegion(x: number, y: number, w: number, h: number) {
  client.region(x, y, w, h);
}

export type { Stats };
