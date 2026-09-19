export const SOFTWARE_VERSION = "1.0.0";
export const ENGINE_NAME = "tracebench-forensic-engine";

export const LIMITS = {
  maxFileBytes: 48 * 1024 * 1024,
  maxDim: 8192,
  maxPixels: 16_000_000,
} as const;

export type ModuleId =
  | "file"
  | "metadata"
  | "jpeg"
  | "ela"
  | "noise"
  | "dct"
  | "frequency"
  | "resampling"
  | "clone"
  | "edge"
  | "sharpness"
  | "color"
  | "thumbnail"
  | "cfa"
  | "prnu";

export const MODULES: { id: ModuleId; label: string; group: string }[] = [
  { id: "file", label: "File", group: "case" },
  { id: "metadata", label: "Metadata", group: "case" },
  { id: "jpeg", label: "JPEG", group: "case" },
  { id: "ela", label: "ELA", group: "compression" },
  { id: "noise", label: "Noise", group: "spatial" },
  { id: "dct", label: "DCT", group: "frequency" },
  { id: "frequency", label: "Frequency", group: "frequency" },
  { id: "resampling", label: "Resampling", group: "geometric" },
  { id: "clone", label: "Clone", group: "geometric" },
  { id: "edge", label: "Edge", group: "spatial" },
  { id: "sharpness", label: "Sharpness", group: "spatial" },
  { id: "color", label: "Color", group: "spatial" },
  { id: "thumbnail", label: "Thumbnail", group: "case" },
  { id: "cfa", label: "CFA", group: "sensor" },
  { id: "prnu", label: "PRNU", group: "sensor" },
];

export const DETECTOR_VERSIONS: Record<string, string> = {
  ela: "1.0.0-jpeg-reencode",
  noise: "1.0.0-integral-var",
  edge: "1.0.0-sobel-scharr",
  sharpness: "1.0.0-var-laplacian",
  dct: "1.0.0-dct2-8x8",
  frequency: "1.0.0-band-energy",
  resampling: "1.0.0-d2-periodicity",
  clone: "1.0.0-block-nn-cluster",
  color: "1.0.0-opponent-grad",
  cfa: "1.0.0-experimental-bayer",
  prnu: "1.0.0-experimental-residual",
  doubleJpeg: "1.0.0-hist-periodicity",
  thumbnail: "1.0.0-exif-extract",
  metadata: "1.0.0-jpeg-png-exif",
};

export type EvidenceStrength =
  | "none"
  | "weak"
  | "indicator"
  | "inconsistency"
  | "insufficient";

export type EvidenceStatus =
  | "idle"
  | "running"
  | "analyzed"
  | "not-applicable"
  | "experimental"
  | "not-implemented";

export interface Stats {
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  p05: number;
  p95: number;
  p99: number;
  energy: number;
  entropy: number;
}

export interface Heatmap {
  module: ModuleId;
  width: number;
  height: number;
  gray: Uint8Array;
  stats: Stats;
  extra?: Record<string, unknown>;
  note?: string;
  experimental?: boolean;
  appropriate?: boolean;
}

export interface EvidenceEntry {
  detector: string;
  module: ModuleId;
  status: EvidenceStatus;
  strength: EvidenceStrength;
  observation: string;
  measurement: string;
  region: string;
  uncertainty: string;
  explanations: string[];
  limitations: string[];
  parameters: Record<string, unknown>;
}

export interface CustodyEvent {
  ts: string;
  operation: string;
  parameters: Record<string, unknown>;
  hashSha256: string;
  softwareVersion: string;
  engine: string;
}

export interface Roi {
  id: string;
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface AutoRegion {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  stats?: Stats;
}

export interface CloneMatch {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  dx: number;
  dy: number;
  distance: number;
}

export interface JpegMarker {
  name: string;
  offset: number;
  length: number;
}

export interface QuantTable {
  id: number;
  sum: number;
  dc: number;
  values: number[];
}

export interface JpegStructure {
  isJpeg: boolean;
  progressive: boolean;
  width: number;
  height: number;
  precision: number;
  components: number;
  restartInterval: number;
  fileLength: number;
  chromaSubsampling: string;
  samplingHint?: string;
  estimatedQuality?: number;
  quantizationTables: QuantTable[];
  markers: JpegMarker[];
  comments: string[];
  hasThumbnail: boolean;
  app1Count: number;
  app1Kind?: string;
  app1Head?: string;
}

export interface MetaField {
  key: string;
  value: string;
  group: string;
}

export interface ParsedMedia {
  kind: "jpeg" | "png" | "webp" | "gif" | "tiff" | "unknown";
  mime: string;
  jpeg?: JpegStructure;
  fields: MetaField[];
  thumbnailJpeg?: Uint8Array;
  warnings: string[];
}

export interface CaseRecord {
  caseId: string;
  evidenceId: string;
  originalFilename: string;
  mime: string;
  size: number;
  width: number;
  height: number;
  format: string;
  sha256: string;
  sha512: string;
  analyzedAt: string;
  softwareVersion: string;
  detectorVersions: Record<string, string>;
  synthetic?: boolean;
}

export interface PixelSample {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
  luma: number;
  ela: number | null;
  noise: number | null;
  gradient: number | null;
  localVar: number | null;
}

export interface DetectorParams {
  elaQuality: number;
  elaGain: number;
  elaPercentile: number;
  noiseMethod: number;
  noiseWindow: number;
  edgeMethod: number;
  sharpnessWindow: number;
  dctBand: number;
  cloneBlock: number;
  cloneStride: number;
  cloneThreshold: number;
  cloneMinRegion: number;
  gain: number;
  percentile: number;
  colormap: ColormapName;
  overlayOpacity: number;
  threshold: number;
  channel: "luma" | "r" | "g" | "b";
}

export type ColormapName =
  | "inferno"
  | "magma"
  | "viridis"
  | "turbo"
  | "gray"
  | "steel";

export const DEFAULT_PARAMS: DetectorParams = {
  elaQuality: 90,
  elaGain: 12,
  elaPercentile: 98,
  noiseMethod: 1,
  noiseWindow: 7,
  edgeMethod: 0,
  sharpnessWindow: 7,
  dctBand: 2,
  cloneBlock: 16,
  cloneStride: 8,
  cloneThreshold: 48,
  cloneMinRegion: 4,
  gain: 8,
  percentile: 98,
  colormap: "inferno",
  overlayOpacity: 0.72,
  threshold: 0,
  channel: "luma",
};

export type ViewMode = "multi" | "dual" | "single";
export type EngineKind = "wasm" | "js";

export function emptyStats(): Stats {
  return {
    mean: 0,
    median: 0,
    std: 0,
    min: 0,
    max: 0,
    p05: 0,
    p95: 0,
    p99: 0,
    energy: 0,
    entropy: 0,
  };
}

export function statsFromF64(a: ArrayLike<number>, o = 0): Stats {
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
