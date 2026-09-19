import { fmt } from "./stats";
import type {
  DetectorParams,
  EvidenceEntry,
  EvidenceStrength,
  Heatmap,
  ModuleId,
  ParsedMedia,
} from "./types";

function strengthFromResidual(stats: Heatmap["stats"], clustered: boolean): EvidenceStrength {
  const spread = stats.p99 - stats.median;
  if (stats.max <= 1 && stats.mean < 1) return "none";
  if (clustered && spread > 40 && stats.p99 > 80) return "inconsistency";
  if (spread > 28 && stats.p99 > 60) return "indicator";
  if (spread > 12) return "weak";
  return "none";
}

function statusLabel(s: EvidenceStrength): EvidenceEntry["status"] {
  if (s === "none") return "analyzed";
  if (s === "insufficient") return "analyzed";
  return "analyzed";
}

const LIMIT_COMMON = [
  "A single detector is not a conclusion about editing, generation, or authenticity.",
  "Camera JPEG engines, social-network recompression, and resizing routinely create residuals.",
];

export function evidenceFor(
  map: Heatmap,
  media: ParsedMedia | null,
  params: DetectorParams,
): EvidenceEntry {
  const clustered = (map.stats.p99 - map.stats.median) > 24 && map.stats.entropy > 3;
  const base = {
    detector: map.module,
    module: map.module,
    parameters: snapshotParams(map.module, params),
    measurement: `mean=${fmt(map.stats.mean)} median=${fmt(map.stats.median)} std=${fmt(map.stats.std)} p95=${fmt(map.stats.p95)} p99=${fmt(map.stats.p99)} max=${fmt(map.stats.max)}`,
    region: "full frame (see heatmap for spatial distribution)",
  };

  switch (map.module) {
    case "ela": {
      const appropriate = map.appropriate !== false && media?.kind === "jpeg";
      const s = appropriate ? strengthFromResidual(map.stats, clustered) : "insufficient";
      return {
        ...base,
        detector: "Error Level Analysis",
        status: appropriate ? statusLabel(s) : "not-applicable",
        strength: s,
        observation: appropriate
          ? s === "none"
            ? "No significant ELA residual clustering detected at the current quality/gain."
            : "Local JPEG re-encode residual is spatially uneven."
          : "ELA is not an appropriate test for this container. Residual reflects a first-time JPEG encode of decoded pixels.",
        uncertainty: "ELA magnitude depends on quality, encoder, and prior compression. It is not a probability of manipulation.",
        explanations: appropriate
          ? [
              "Different local compression history (splice, edit, screenshot-of-photo).",
              "Content with high texture or saturated edges that encode poorly.",
              "Aligned double JPEG or platform recompression.",
            ]
          : ["Non-JPEG source (PNG/WebP/TIFF) re-encoded for ELA."],
        limitations: [
          "ELA does not identify generative models.",
          "High residual ≠ 'fake'. Low residual ≠ 'original camera file'.",
          ...LIMIT_COMMON,
        ],
      };
    }
    case "noise": {
      const s = strengthFromResidual(map.stats, clustered);
      return {
        ...base,
        detector: "Local noise residual",
        status: "analyzed",
        strength: s,
        observation:
          s === "none"
            ? "Local noise energy is relatively homogeneous at the selected window."
            : "Regional noise energy varies; possible denoising, splice, or texture change.",
        uncertainty: "Window size and scene texture dominate this measurement.",
        explanations: [
          "Natural texture variation (sky vs foliage).",
          "Local denoising, sharpening, or paint-over.",
          "Spliced regions from a different ISO/camera.",
        ],
        limitations: LIMIT_COMMON,
      };
    }
    case "clone": {
      const extra = map.extra ?? {};
      const clusters = Number(extra.clusters ?? 0);
      const s: EvidenceStrength = clusters >= 2 ? "indicator" : clusters === 1 ? "weak" : "none";
      return {
        ...base,
        detector: "Copy-move / clone (block match)",
        status: "analyzed",
        strength: s,
        observation:
          clusters === 0
            ? "No geometrically consistent cloned block cluster at current parameters."
            : `Offset clustering found ${clusters} candidate displacement group(s).`,
        uncertainty: "Repeating textures (windows, bricks, fabric) produce false matches. Geometric consistency reduces but does not eliminate them.",
        explanations: [
          "Copy-move concealment.",
          "Periodic architecture / textile.",
          "Block size too small/large for the duplicated object.",
        ],
        limitations: [
          "Does not detect copy-move after heavy resampling unless features still match.",
          "Not a deep-learning clone detector.",
          ...LIMIT_COMMON,
        ],
      };
    }
    case "resampling": {
      const s = strengthFromResidual(map.stats, clustered);
      return {
        ...base,
        detector: "Interpolation / resampling periodicity",
        status: "analyzed",
        strength: s,
        observation:
          s === "none"
            ? "No strong second-derivative periodicity at the tested lags."
            : "Second-derivative periodicity is locally elevated — possible resize, rotation, or interpolation.",
        uncertainty: "JPEG blocking and CFA interpolation also create periodic signals.",
        explanations: ["Resize/rotate/warp", "Camera demosaic", "JPEG 8×8 lattice"],
        limitations: LIMIT_COMMON,
      };
    }
    case "dct":
    case "frequency": {
      return {
        ...base,
        detector: map.module === "dct" ? "8×8 DCT band energy" : "Frequency / blocking",
        status: "analyzed",
        strength: strengthFromResidual(map.stats, clustered),
        observation: "Block-wise frequency energy mapped. Peaks may indicate compression or local filtering.",
        uncertainty: "Content (text, edges) concentrates high-frequency energy without any edit.",
        explanations: ["Compression lattice", "Sharpening", "Local blur"],
        limitations: LIMIT_COMMON,
      };
    }
    case "edge":
      return {
        ...base,
        detector: "Edge / boundary map",
        status: "analyzed",
        strength: "none",
        observation: "Edge strength extracted. Use it comparatively across regions, not as a binary edit flag.",
        uncertainty: "Optical blur, DOF, and downscale all weaken edges.",
        explanations: ["Depth of field", "Motion blur", "Composite boundary"],
        limitations: LIMIT_COMMON,
      };
    case "sharpness":
      return {
        ...base,
        detector: "Local sharpness (variance of Laplacian)",
        status: "analyzed",
        strength: strengthFromResidual(map.stats, clustered),
        observation: "Local focus/sharpness energy. Inconsistent sharpness can be optical or editorial.",
        uncertainty: "Cannot separate lens bokeh from synthetic blur without scene context.",
        explanations: ["Lens DOF", "Selective blur", "Mixed-resolution splice"],
        limitations: LIMIT_COMMON,
      };
    case "color":
      return {
        ...base,
        detector: "Color / illumination discontinuity",
        status: "analyzed",
        strength: strengthFromResidual(map.stats, clustered),
        observation: "Opponent-color gradient excess relative to luminance.",
        uncertainty: "Strongly scene-dependent (neon signs, clothing, makeup).",
        explanations: ["Illuminant mismatch", "Color grade", "Natural chroma edges"],
        limitations: LIMIT_COMMON,
      };
    case "cfa":
      return {
        ...base,
        detector: "CFA / demosaic residual",
        status: "experimental",
        strength: "insufficient",
        observation: "Experimental 2×2 periodic residual on the green channel. Camera-pipeline dependent.",
        uncertainty: "Many computational cameras and all screenshots lack a Bayer CFA.",
        explanations: ["Source is a camera RAW/JPEG pipeline", "Source is a render/screenshot", "Strong denoise"],
        limitations: [
          "Experimental. Do not use for camera attribution.",
          ...LIMIT_COMMON,
        ],
      };
    case "prnu":
      return {
        ...base,
        detector: "PRNU residual (no reference set)",
        status: "experimental",
        strength: "insufficient",
        observation: "Median-based noise residual only. No camera fingerprint was enrolled.",
        uncertainty: "Without a reference set this is not PRNU attribution.",
        explanations: ["Sensor pattern (unverified)", "Generic high-frequency noise"],
        limitations: [
          "Not implemented as a reference-based correlator until a fingerprint set is provided.",
          "Do not claim camera identity.",
          ...LIMIT_COMMON,
        ],
      };
    case "thumbnail":
      return {
        ...base,
        detector: "Embedded thumbnail vs main image",
        status: map.extra && map.extra.available === false ? "not-applicable" : "analyzed",
        strength: map.stats.mean > 8 ? "indicator" : map.stats.mean > 3 ? "weak" : "none",
        observation:
          map.extra && map.extra.available === false
            ? "No embedded JPEG thumbnail was found."
            : "Thumbnail/main difference computed by scaling the main raster to the thumbnail size.",
        uncertainty: "Cameras often store an older or differently processed thumbnail.",
        explanations: ["Edited main image after thumbnail was written", "Normal camera pipeline", "Orientation mismatch"],
        limitations: LIMIT_COMMON,
      };
    default:
      return {
        ...base,
        detector: map.module,
        status: "analyzed",
        strength: "none",
        observation: "Measurement recorded.",
        uncertainty: "See methods.",
        explanations: [],
        limitations: LIMIT_COMMON,
      };
  }
}

function snapshotParams(module: ModuleId, p: DetectorParams): Record<string, unknown> {
  switch (module) {
    case "ela":
      return { quality: p.elaQuality, gain: p.elaGain, percentile: p.elaPercentile };
    case "noise":
      return { method: p.noiseMethod, window: p.noiseWindow, gain: p.gain, percentile: p.percentile };
    case "edge":
      return { method: p.edgeMethod, gain: p.gain, percentile: p.percentile };
    case "sharpness":
      return { window: p.sharpnessWindow, gain: p.gain, percentile: p.percentile };
    case "dct":
    case "frequency":
      return { band: p.dctBand, gain: p.gain, percentile: p.percentile };
    case "clone":
      return {
        block: p.cloneBlock,
        stride: p.cloneStride,
        threshold: p.cloneThreshold,
        minRegion: p.cloneMinRegion,
      };
    default:
      return { gain: p.gain, percentile: p.percentile };
  }
}

export function jpegEvidence(media: ParsedMedia | null): EvidenceEntry {
  const jpeg = media?.jpeg;
  return {
    detector: "JPEG structure",
    module: "jpeg",
    status: jpeg?.isJpeg ? "analyzed" : "not-applicable",
    strength: "none",
    observation: jpeg?.isJpeg
      ? `JPEG ${jpeg.progressive ? "progressive" : "baseline"}, ${jpeg.chromaSubsampling}, ${jpeg.quantizationTables.length} quantization table(s).`
      : "Not a JPEG bitstream — marker-level JPEG forensics do not apply.",
    measurement: jpeg?.isJpeg
      ? `markers=${jpeg.markers.length} estimatedQ=${jpeg.estimatedQuality?.toFixed(1) ?? "—"} restart=${jpeg.restartInterval}`
      : "n/a",
    region: "container",
    uncertainty: "Quantization-table quality estimates are encoder-specific approximations.",
    explanations: [],
    limitations: ["Structure describes the file as stored, not the semantic content."],
    parameters: {},
  };
}

export function metadataEvidence(media: ParsedMedia | null, warnings: string[]): EvidenceEntry {
  const n = media?.fields.length ?? 0;
  return {
    detector: "Metadata (EXIF/XMP/PNG/APP)",
    module: "metadata",
    status: "analyzed",
    strength: warnings.length ? "inconsistency" : n ? "none" : "insufficient",
    observation:
      n === 0
        ? "No descriptive metadata fields were parsed."
        : `${n} field(s) parsed.${warnings.length ? " Dimension/container warnings recorded." : ""}`,
    measurement: `fields=${n} warnings=${warnings.length}`,
    region: "container",
    uncertainty: "Metadata is trivially editable and trivially stripped. Presence is not authenticity; absence is not editing.",
    explanations: warnings,
    limitations: ["Never treat Software=… as proof of a specific editor."],
    parameters: {},
  };
}
