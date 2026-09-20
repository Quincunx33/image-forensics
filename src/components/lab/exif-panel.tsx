import { useState, useMemo } from "react";
import { useLab } from "@/store/lab-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Camera,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  Copy,
  Check,
  Download,
  Search,
  ExternalLink,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Clock,
  Layers,
} from "lucide-react";

type ExifCategory = "all" | "camera" | "exposure" | "chronology" | "gps" | "integrity" | "raw";

interface ParsedGps {
  latDms?: string;
  lonDms?: string;
  latDec?: number;
  lonDec?: number;
  alt?: string;
  timestamp?: string;
  mapUrl?: string;
}

const TAG_DESCRIPTIONS: Record<string, string> = {
  Make: "Camera manufacturer",
  Model: "Camera body model name",
  LensMake: "Lens manufacturer",
  LensModel: "Camera lens optics model",
  LensSpecification: "Focal range and maximum aperture specification",
  BodySerialNumber: "Camera body hardware serial number",
  LensSerialNumber: "Camera lens hardware serial number",
  Software: "Firmware or editing suite that last saved this file",
  DateTime: "File modification timestamp recorded in header",
  DateTimeOriginal: "Original shutter release / capture timestamp",
  DateTimeDigitized: "Sensor capture-to-digital timestamp",
  OffsetTime: "Timezone offset of camera clock",
  OffsetTimeOriginal: "Timezone offset at time of capture",
  OffsetTimeDigitized: "Timezone offset when digitized",
  ExposureTime: "Shutter duration (seconds)",
  FNumber: "Aperture f-stop setting",
  ISO: "Sensor ISO light sensitivity speed rating",
  ShutterSpeedValue: "APEX representation of exposure time",
  ApertureValue: "APEX representation of lens aperture",
  ExposureBiasValue: "Exposure compensation in EV stops",
  ExposureProgram: "Shooting mode (Manual, Aperture-priority, etc.)",
  ExposureMode: "Auto or manual exposure mode",
  MeteringMode: "Light measurement method (Matrix, Spot, Center)",
  Flash: "Strobe flash trigger status and return light",
  FocalLength: "Physical focal length of optics",
  FocalLengthIn35mm: "Full-frame 35mm equivalent focal length",
  WhiteBalance: "White balance setting (Auto or Manual)",
  ColorSpace: "Color profile space (sRGB, Adobe RGB, etc.)",
  PixelXDimension: "Recorded EXIF image width in pixels",
  PixelYDimension: "Recorded EXIF image height in pixels",
  Orientation: "Sensor orientation relative to horizontal",
  GPSLatitude: "Geographic latitude coordinate",
  GPSLatitudeRef: "Latitude hemisphere (N=North, S=South)",
  GPSLongitude: "Geographic longitude coordinate",
  GPSLongitudeRef: "Longitude hemisphere (E=East, W=West)",
  GPSAltitude: "Height above or below sea level reference",
  GPSAltitudeRef: "Altitude reference indicator",
  GPSDateStamp: "UTC date recorded by GPS satellite fix",
  GPSTimeStamp: "UTC time recorded by GPS satellite fix",
  XResolution: "Horizontal pixel density",
  YResolution: "Vertical pixel density",
  ResolutionUnit: "Measurement unit for resolution",
  Artist: "Camera operator / photographer attribution",
  Copyright: "Copyright owner notice recorded in camera",
};

function parseDmsToDecimal(dmsStr: string, ref: string): number | undefined {
  const match = dmsStr.match(/([\d.]+)[°\s]+([\d.]+)'?\s*([\d.]+)"?/);
  if (!match) return undefined;
  const deg = parseFloat(match[1] || "0");
  const min = parseFloat(match[2] || "0");
  const sec = parseFloat(match[3] || "0");
  let dec = deg + min / 60 + sec / 3600;
  if (ref.toUpperCase() === "S" || ref.toUpperCase() === "W") {
    dec = -dec;
  }
  return Number(dec.toFixed(6));
}

export function ExifPanel({
  className,
  compact = false,
  isDocked = false,
}: {
  className?: string;
  compact?: boolean;
  isDocked?: boolean;
}) {
  const media = useLab((s) => s.media);
  const original = useLab((s) => s.original);
  const thumbnail = useLab((s) => s.thumbnail);
  const caseRecord = useLab((s) => s.caseRecord);
  const setActive = useLab((s) => s.setActive);

  const [category, setCategory] = useState<ExifCategory>("all");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState<"json" | "report" | string | null>(null);
  // Default summary expanded when on main stage; compact toggleable when in bottom dock
  const [summaryExpanded, setSummaryExpanded] = useState(!isDocked);

  const fields = useMemo(() => media?.fields ?? [], [media?.fields]);

  // Categorize tags
  const categorized = useMemo(() => {
    const cameraKeys = new Set([
      "Make",
      "Model",
      "LensMake",
      "LensModel",
      "LensSpecification",
      "BodySerialNumber",
      "LensSerialNumber",
      "CameraOwnerName",
      "Artist",
      "Copyright",
      "Software",
      "DeviceSettingDescription",
      "HostComputer",
    ]);

    const exposureKeys = new Set([
      "ExposureTime",
      "FNumber",
      "ISO",
      "ShutterSpeedValue",
      "ApertureValue",
      "MaxApertureValue",
      "ExposureBiasValue",
      "ExposureProgram",
      "ExposureMode",
      "MeteringMode",
      "Flash",
      "FocalLength",
      "FocalLengthIn35mm",
      "WhiteBalance",
      "LightSource",
      "ColorSpace",
      "SensingMethod",
      "SceneCaptureType",
      "SubjectDistance",
      "SubjectDistanceRange",
      "DigitalZoomRatio",
      "GainControl",
      "Contrast",
      "Saturation",
      "Sharpness",
      "BrightnessValue",
    ]);

    const chronologyKeys = new Set([
      "DateTime",
      "DateTimeOriginal",
      "DateTimeDigitized",
      "OffsetTime",
      "OffsetTimeOriginal",
      "OffsetTimeDigitized",
      "SubSecTime",
      "SubSecTimeOriginal",
      "SubSecTimeDigitized",
      "GPSDateStamp",
      "GPSTimeStamp",
      "PNG.tIME",
      "ModifyDate",
      "CreateDate",
    ]);

    const geometryKeys = new Set([
      "ImageWidth",
      "ImageLength",
      "PixelXDimension",
      "PixelYDimension",
      "XResolution",
      "YResolution",
      "ResolutionUnit",
      "Orientation",
      "SOF.Width",
      "SOF.Height",
      "Chroma",
      "Components",
      "BitsPerSample",
      "PNG.Width",
      "PNG.Height",
      "PNG.BitDepth",
      "PNG.ColorType",
      "PNG.Interlace",
      "PNG.pHYs",
    ]);

    const integrityKeys = new Set([
      "Software",
      "PixelXDimension",
      "PixelYDimension",
      "DateTime",
      "DateTimeOriginal",
      "DateTimeDigitized",
      "ImageWidth",
      "ImageLength",
      "XMP",
      "APP13",
      "Photoshop",
      "Orientation",
    ]);

    const camera: typeof fields = [];
    const exposure: typeof fields = [];
    const chronology: typeof fields = [];
    const gps: typeof fields = [];
    const geometry: typeof fields = [];
    const integrity: typeof fields = [];
    const others: typeof fields = [];

    for (const f of fields) {
      const isGps = f.group === "GPS" || f.key.startsWith("GPS");
      if (isGps) gps.push(f);
      if (cameraKeys.has(f.key)) camera.push(f);
      if (exposureKeys.has(f.key)) exposure.push(f);
      if (chronologyKeys.has(f.key) || f.key.includes("Date") || f.key.includes("Time")) chronology.push(f);
      if (geometryKeys.has(f.key)) geometry.push(f);
      if (integrityKeys.has(f.key) || f.group === "Integrity") integrity.push(f);

      if (
        !isGps &&
        !cameraKeys.has(f.key) &&
        !exposureKeys.has(f.key) &&
        !chronologyKeys.has(f.key) &&
        !geometryKeys.has(f.key)
      ) {
        others.push(f);
      }
    }

    return { camera, exposure, chronology, gps, geometry, integrity, others };
  }, [fields]);

  // Extract key summary metrics
  const summary = useMemo(() => {
    const getVal = (k: string) => fields.find((f) => f.key === k)?.value;
    const make = getVal("Make");
    const model = getVal("Model");
    const lens = getVal("LensModel") || getVal("LensSpecification");
    const software = getVal("Software");
    const expTime = getVal("ExposureTime") || getVal("ShutterSpeedValue");
    const fnum = getVal("FNumber") || getVal("ApertureValue");
    const iso = getVal("ISO");
    const focal = getVal("FocalLength");
    const focal35 = getVal("FocalLengthIn35mm");
    const dateOrig = getVal("DateTimeOriginal");
    const dateDig = getVal("DateTimeDigitized");
    const dateMod = getVal("DateTime");
    const orientation = getVal("Orientation");
    const flash = getVal("Flash");
    const colorSpace = getVal("ColorSpace");

    // Dimensions check
    const exifW = Number(getVal("PixelXDimension") || getVal("ImageWidth"));
    const exifH = Number(getVal("PixelYDimension") || getVal("ImageLength"));
    const rasterW = original?.width ?? 0;
    const rasterH = original?.height ?? 0;
    const hasExifDims = !isNaN(exifW) && exifW > 0 && !isNaN(exifH) && exifH > 0;
    const dimMismatch = hasExifDims && rasterW > 0 && (exifW !== rasterW || exifH !== rasterH);

    // Software fingerprint check
    const isEditedSoftware =
      software &&
      /photoshop|lightroom|gimp|canva|snapseed|midjourney|dall-e|paint|pixlr|affinity|vsco/i.test(software);

    // Date consistency check
    const hasDateMismatch = Boolean(dateOrig && dateMod && dateOrig !== dateMod);

    // GPS parsing
    const latVal = getVal("GPSLatitude");
    const latRef = getVal("GPSLatitudeRef") || "N";
    const lonVal = getVal("GPSLongitude");
    const lonRef = getVal("GPSLongitudeRef") || "W";
    const alt = getVal("GPSAltitude");
    const gpsTime = getVal("GPSTimeStamp");
    const gpsDate = getVal("GPSDateStamp");

    let parsedGps: ParsedGps | null = null;
    if (latVal && lonVal) {
      const latDec = parseDmsToDecimal(latVal, latRef);
      const lonDec = parseDmsToDecimal(lonVal, lonRef);
      if (latDec !== undefined && lonDec !== undefined) {
        parsedGps = {
          latDms: `${latVal} ${latRef}`,
          lonDms: `${lonVal} ${lonRef}`,
          latDec,
          lonDec,
          alt,
          timestamp: gpsDate && gpsTime ? `${gpsDate} ${gpsTime}` : gpsTime || gpsDate,
          mapUrl: `https://www.openstreetmap.org/?mlat=${latDec}&mlon=${lonDec}#map=15/${latDec}/${lonDec}`,
        };
      }
    }

    const hasExif = fields.some((f) => f.group === "Exif" || f.group === "IFD0" || f.group === "GPS");

    return {
      make,
      model,
      lens,
      software,
      expTime,
      fnum,
      iso,
      focal,
      focal35,
      dateOrig,
      dateDig,
      dateMod,
      hasDateMismatch,
      orientation,
      flash,
      colorSpace,
      hasExifDims,
      exifW,
      exifH,
      rasterW,
      rasterH,
      dimMismatch,
      isEditedSoftware,
      parsedGps,
      hasExif,
    };
  }, [fields, original]);

  // Filtered tag list according to category and search query
  const displayedFields = useMemo(() => {
    let list: typeof fields = [];
    if (category === "all" || category === "raw") {
      list = fields;
    } else if (category === "camera") {
      list = categorized.camera;
    } else if (category === "exposure") {
      list = categorized.exposure;
    } else if (category === "chronology") {
      list = categorized.chronology;
    } else if (category === "gps") {
      list = categorized.gps;
    } else if (category === "integrity") {
      list = categorized.integrity;
    }

    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (f) =>
        f.key.toLowerCase().includes(q) ||
        f.value.toLowerCase().includes(q) ||
        f.group.toLowerCase().includes(q) ||
        (TAG_DESCRIPTIONS[f.key] && TAG_DESCRIPTIONS[f.key].toLowerCase().includes(q)),
    );
  }, [fields, categorized, category, search]);

  const copySingleTag = (tagKey: string, val: string) => {
    navigator.clipboard.writeText(`${tagKey}: ${val}`);
    setCopied(tagKey);
    setTimeout(() => setCopied(null), 1800);
  };

  const copyAsJson = () => {
    const obj: Record<string, string> = {};
    for (const f of fields) {
      obj[`${f.group}.${f.key}`] = f.value;
    }
    navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
    setCopied("json");
    setTimeout(() => setCopied(null), 2000);
  };

  const copyAsReport = () => {
    const lines = [
      `TRACEBENCH FORENSIC EXIF METADATA REPORT`,
      `=========================================`,
      `File: ${caseRecord?.originalFilename ?? "Unknown"}`,
      `Case ID: ${caseRecord?.caseId ?? "N/A"}`,
      `Raster Dimensions: ${original?.width ?? 0} × ${original?.height ?? 0} px`,
      ``,
      `--- EQUIPMENT & SHOOTING ---`,
      `Camera Make:     ${summary.make ?? "Not recorded"}`,
      `Camera Model:    ${summary.model ?? "Not recorded"}`,
      `Lens Model:      ${summary.lens ?? "Not recorded"}`,
      `Software:        ${summary.software ?? "Not recorded"}`,
      `Exposure Time:   ${summary.expTime ?? "Not recorded"}`,
      `Aperture:        ${summary.fnum ?? "Not recorded"}`,
      `ISO Sensitivity: ${summary.iso ?? "Not recorded"}`,
      `Focal Length:    ${summary.focal ?? "Not recorded"}`,
      `Original Capture:${summary.dateOrig ?? "Not recorded"}`,
      `Digitized Time:  ${summary.dateDig ?? "Not recorded"}`,
      `Modification Time:${summary.dateMod ?? "Not recorded"}`,
      ``,
      summary.parsedGps
        ? `--- GEOLOCATION ---\nLatitude:  ${summary.parsedGps.latDms} (${summary.parsedGps.latDec})\nLongitude: ${summary.parsedGps.lonDms} (${summary.parsedGps.lonDec})\nAltitude:  ${summary.parsedGps.alt ?? "N/A"}\n`
        : `--- GEOLOCATION ---\nNo GPS coordinates recorded in EXIF header.\n`,
      `--- INTEGRITY FINDINGS ---`,
      summary.dimMismatch
        ? `[!] WARNING: Dimension discrepancy detected (EXIF: ${summary.exifW}x${summary.exifH} vs Decoded: ${summary.rasterW}x${summary.rasterH})`
        : `[OK] Raster dimensions match or no contradictory EXIF dimensions found.`,
      summary.isEditedSoftware
        ? `[!] NOTICE: Post-processing software fingerprint detected (${summary.software})`
        : `[-] No known editing suite string explicitly identified in Software tag.`,
      summary.hasDateMismatch
        ? `[!] NOTICE: Shutter timestamp (${summary.dateOrig}) differs from file modification (${summary.dateMod}).`
        : `[OK] Timestamp chronology consistent.`,
      ``,
      `--- COMPLETE TAG DUMP (${fields.length} entries) ---`,
      ...fields.map((f) => `${f.group.padEnd(8)} | ${f.key.padEnd(26)} | ${f.value}`),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    setCopied("report");
    setTimeout(() => setCopied(null), 2000);
  };

  const exportJsonFile = () => {
    const data = {
      filename: caseRecord?.originalFilename,
      caseId: caseRecord?.caseId,
      analyzedAt: new Date().toISOString(),
      raster: { width: original?.width, height: original?.height },
      exifSummary: summary,
      tags: fields,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${caseRecord?.originalFilename || "case"}-exif-metadata.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!fields.length) {
    return (
      <div className={cn("flex flex-col items-center justify-center p-8 text-center", className)}>
        <div className="rounded-full bg-elevated p-4 text-muted">
          <Camera className="size-8 stroke-[1.5]" />
        </div>
        <h3 className="mt-3 text-base font-semibold">No Metadata Found</h3>
        <p className="mt-1.5 max-w-md text-xs text-muted">
          This image container does not include EXIF headers, or the metadata was stripped during web publishing or compression.
        </p>
      </div>
    );
  }

  const categoryTabs = [
    { id: "all" as const, label: "All Tags", count: fields.length },
    { id: "camera" as const, label: "Camera", count: categorized.camera.length },
    { id: "exposure" as const, label: "Exposure", count: categorized.exposure.length },
    { id: "chronology" as const, label: "Dates", count: categorized.chronology.length },
    { id: "gps" as const, label: "GPS", count: categorized.gps.length },
    { id: "integrity" as const, label: "Forensic", count: categorized.integrity.length },
    { id: "raw" as const, label: "Raw", count: fields.length },
  ];

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-bg text-fg", className)}>
      {/* Header bar: Title, Badge, Action Buttons, and Summary Toggle */}
      {!compact && (
        <div className="shrink-0 border-b border-line bg-surface/90 px-3 py-2 sm:px-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-sm bg-accent/10 text-accent">
                <Camera className="size-3.5" />
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-semibold tracking-tight text-fg sm:text-sm">
                  {summary.make || summary.model
                    ? `${summary.make ?? ""} ${summary.model ?? ""}`.trim()
                    : "EXIF & Metadata Inspector"}
                </h2>
                {summary.hasExif ? (
                  <Badge tone="ok" className="gap-1 text-3xs">
                    <ShieldCheck className="size-2.5" /> EXIF present
                  </Badge>
                ) : (
                  <Badge tone="warn" className="gap-1 text-3xs">
                    Container only
                  </Badge>
                )}
                <span className="hidden font-mono text-2xs text-muted md:inline">
                  ({fields.length} tags extracted)
                </span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-1.5">
              {isDocked && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setActive("metadata")}
                  className="h-7 gap-1 px-2 text-micro text-accent hover:text-fg"
                  title="Open metadata inspector in full-screen main stage"
                >
                  <Layers className="size-3" />
                  <span className="hidden sm:inline">Main Stage</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSummaryExpanded(!summaryExpanded)}
                className="h-7 gap-1 px-2 text-micro"
                title={summaryExpanded ? "Collapse highlights" : "Expand highlights"}
              >
                <span>{summaryExpanded ? "Hide Highlights" : "Highlights"}</span>
                {summaryExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={copyAsJson}
                className="h-7 gap-1 px-2 text-micro"
                title="Copy all tags as JSON"
              >
                {copied === "json" ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
                <span className="hidden sm:inline">{copied === "json" ? "Copied" : "JSON"}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={copyAsReport}
                className="hidden h-7 gap-1 px-2 text-micro sm:inline-flex"
                title="Copy formatted forensic text report"
              >
                {copied === "report" ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
                <span>{copied === "report" ? "Copied" : "Report"}</span>
              </Button>
              <Button
                variant="subtle"
                size="sm"
                onClick={exportJsonFile}
                className="h-7 gap-1 px-2 text-micro"
                title="Download JSON report"
              >
                <Download className="size-3" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            </div>
          </div>

          {/* Quick Metrics Bar: Expanded (cards) or Compact (1-line badge strip) */}
          {summaryExpanded ? (
            <div className="mt-2.5 space-y-2 border-t border-line/60 pt-2">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                <div className="rounded-sm border border-line/70 bg-panel/60 px-2 py-1">
                  <span className="block font-mono text-3xs uppercase tracking-wider text-subtle">Shutter Speed</span>
                  <span className="font-mono text-xs font-medium tabular-nums text-fg">{summary.expTime ?? "—"}</span>
                </div>
                <div className="rounded-sm border border-line/70 bg-panel/60 px-2 py-1">
                  <span className="block font-mono text-3xs uppercase tracking-wider text-subtle">Aperture</span>
                  <span className="font-mono text-xs font-medium tabular-nums text-fg">{summary.fnum ?? "—"}</span>
                </div>
                <div className="rounded-sm border border-line/70 bg-panel/60 px-2 py-1">
                  <span className="block font-mono text-3xs uppercase tracking-wider text-subtle">ISO</span>
                  <span className="font-mono text-xs font-medium tabular-nums text-fg">{summary.iso ?? "—"}</span>
                </div>
                <div className="rounded-sm border border-line/70 bg-panel/60 px-2 py-1">
                  <span className="block font-mono text-3xs uppercase tracking-wider text-subtle">Focal Length</span>
                  <span className="font-mono text-xs font-medium tabular-nums text-fg">
                    {summary.focal ? `${summary.focal}${summary.focal35 ? ` (${summary.focal35}mm eq)` : ""}` : "—"}
                  </span>
                </div>
                <div className="rounded-sm border border-line/70 bg-panel/60 px-2 py-1">
                  <span className="block font-mono text-3xs uppercase tracking-wider text-subtle">Capture Date</span>
                  <span
                    className="block truncate font-mono text-xs font-medium tabular-nums text-fg"
                    title={summary.dateOrig}
                  >
                    {summary.dateOrig ? summary.dateOrig.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") : "—"}
                  </span>
                </div>
                <div className="rounded-sm border border-line/70 bg-panel/60 px-2 py-1">
                  <span className="block font-mono text-3xs uppercase tracking-wider text-subtle">Software</span>
                  <span
                    className="block truncate font-mono text-xs font-medium text-fg"
                    title={summary.software}
                  >
                    {summary.software ?? "Camera firmware"}
                  </span>
                </div>
              </div>

              {/* Integrity notifications */}
              {(summary.dimMismatch || summary.isEditedSoftware || summary.parsedGps) && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {summary.dimMismatch && (
                    <div className="flex items-center gap-1.5 rounded-sm border border-warn/40 bg-warn/10 px-2 py-0.5 text-2xs text-warn">
                      <ShieldAlert className="size-3 shrink-0" />
                      <span>
                        <strong>Dimension Mismatch:</strong> EXIF {summary.exifW}×{summary.exifH} vs Decoded {summary.rasterW}×{summary.rasterH}
                      </span>
                    </div>
                  )}
                  {summary.isEditedSoftware && (
                    <div className="flex items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2 py-0.5 text-2xs text-accent">
                      <Sparkles className="size-3 shrink-0" />
                      <span>
                        <strong>Editor Signature:</strong> &ldquo;{summary.software}&rdquo; detected.
                      </span>
                    </div>
                  )}
                  {summary.parsedGps && (
                    <a
                      href={summary.parsedGps.mapUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 rounded-sm border border-ok/40 bg-ok/10 px-2 py-0.5 text-2xs text-ok hover:bg-ok/20 transition-colors"
                      title="Open in OpenStreetMap"
                    >
                      <MapPin className="size-3 shrink-0" />
                      <span>
                        GPS: {summary.parsedGps.latDec?.toFixed(4)}°, {summary.parsedGps.lonDec?.toFixed(4)}°
                      </span>
                      <ExternalLink className="size-2.5 ml-0.5" />
                    </a>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Compact 1-line highlights strip when collapsed */
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line/40 pt-1 font-mono text-3xs text-muted">
              {summary.model && (
                <span className="text-fg font-medium">📷 {summary.model}</span>
              )}
              {summary.expTime && <span>⏱ {summary.expTime}</span>}
              {summary.fnum && <span>⭕ {summary.fnum}</span>}
              {summary.iso && <span>⚡ ISO {summary.iso}</span>}
              {summary.focal && <span>🔍 {summary.focal}</span>}
              {summary.dateOrig && (
                <span>📅 {summary.dateOrig.slice(0, 10).replace(/:/g, "-")}</span>
              )}
              {summary.software && (
                <span className="truncate max-w-[200px]" title={summary.software}>
                  💻 {summary.software}
                </span>
              )}
              {summary.parsedGps && (
                <span className="text-ok font-medium">
                  📍 {summary.parsedGps.latDec?.toFixed(3)}°, {summary.parsedGps.lonDec?.toFixed(3)}°
                </span>
              )}
              {summary.dimMismatch && (
                <span className="text-warn font-semibold">⚠ Dim Mismatch</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Filter and Search Bar: Always prominent and accessible */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/60 px-3 py-1.5">
        <div className="flex items-center gap-1 overflow-x-auto lab-scroll pb-0.5">
          {categoryTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setCategory(t.id)}
              className={cn(
                "inline-flex items-center gap-1 rounded-sm px-2.5 py-1 font-mono text-2xs transition-all whitespace-nowrap cursor-pointer",
                category === t.id
                  ? "bg-accent text-accent-foreground font-semibold shadow-xs"
                  : "bg-panel/60 text-muted hover:bg-elevated hover:text-fg",
              )}
            >
              <span>{t.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-3xs font-semibold",
                  category === t.id ? "bg-accent-foreground/20 text-accent-foreground" : "bg-panel text-subtle",
                )}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative min-w-[150px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-subtle" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tags, values, groups..."
            className="h-7 w-full rounded border border-line bg-panel pl-7 pr-6 font-mono text-2xs placeholder:text-subtle focus:border-accent focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-subtle hover:text-fg text-2xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Active Filter Header Indicator */}
      <div className="flex shrink-0 items-center justify-between border-b border-line/40 bg-surface/30 px-3 py-1 text-3xs font-mono text-subtle">
        <span>
          Showing <strong className="text-fg">{displayedFields.length}</strong> {category === "all" ? "total" : category} tag{displayedFields.length === 1 ? "" : "s"}
          {search && <span> matching &ldquo;{search}&rdquo;</span>}
        </span>
        {copied && typeof copied === "string" && copied !== "json" && copied !== "report" && (
          <span className="text-ok font-semibold">✓ Copied {copied}</span>
        )}
      </div>

      {/* Main Tag Display Area: Fully scrollable, no nested overflow traps */}
      <div className="min-h-0 flex-1 overflow-auto lab-scroll p-2.5 sm:p-3">
        {displayedFields.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted">
            <Search className="size-6 text-subtle" />
            <p className="mt-2 text-xs">No tags found matching &ldquo;{search}&rdquo;</p>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setCategory("all");
              }}
              className="mt-2 text-2xs text-accent hover:underline cursor-pointer"
            >
              Clear filter and show all tags
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Contextual Card: Chronology Timeline when "Dates" tab is active */}
            {category === "chronology" && !search && (
              <div className="rounded-md border border-line bg-elevated/70 p-3">
                <div className="flex items-center justify-between pb-2 border-b border-line/60">
                  <div className="flex items-center gap-1.5">
                    <Clock className="size-4 text-accent" />
                    <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-fg">
                      Chronological Timeline Analysis
                    </h4>
                  </div>
                  {summary.hasDateMismatch ? (
                    <Badge tone="warn" className="gap-1 text-3xs">
                      <ShieldAlert className="size-3" /> Modified Post-Capture
                    </Badge>
                  ) : summary.dateOrig ? (
                    <Badge tone="ok" className="gap-1 text-3xs">
                      <ShieldCheck className="size-3" /> Timestamps Synchronized
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3 font-mono text-2xs">
                  <div className="rounded border border-line/60 bg-panel px-2.5 py-1.5">
                    <span className="text-subtle block text-3xs uppercase">1. Shutter Release (Original)</span>
                    <span className="text-fg font-medium">
                      {summary.dateOrig ? summary.dateOrig.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") : "Not recorded"}
                    </span>
                  </div>
                  <div className="rounded border border-line/60 bg-panel px-2.5 py-1.5">
                    <span className="text-subtle block text-3xs uppercase">2. Sensor Digitized</span>
                    <span className="text-fg font-medium">
                      {summary.dateDig ? summary.dateDig.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") : summary.dateOrig ? summary.dateOrig.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") : "Not recorded"}
                    </span>
                  </div>
                  <div className="rounded border border-line/60 bg-panel px-2.5 py-1.5">
                    <span className="text-subtle block text-3xs uppercase">3. File Container Modified</span>
                    <span className="text-fg font-medium">
                      {summary.dateMod ? summary.dateMod.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3") : "Not recorded"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Contextual Card: GPS Geolocation when "GPS" tab is active */}
            {category === "gps" && summary.parsedGps && !search && (
              <div className="rounded-md border border-line bg-elevated/70 p-3">
                <div className="flex items-center justify-between pb-2 border-b border-line/60">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="size-4 text-accent" />
                    <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-fg">
                      Geographic Location Fix
                    </h4>
                  </div>
                  <a
                    href={summary.parsedGps.mapUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-2xs text-accent hover:underline"
                  >
                    Open in Map <ExternalLink className="size-3" />
                  </a>
                </div>
                <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3 font-mono text-2xs">
                  <div className="rounded border border-line/60 bg-panel px-2.5 py-1.5">
                    <span className="text-subtle block text-3xs uppercase">Latitude</span>
                    <span className="text-fg font-medium">{summary.parsedGps.latDms}</span>
                    <span className="text-muted text-3xs block">({summary.parsedGps.latDec?.toFixed(6)})</span>
                  </div>
                  <div className="rounded border border-line/60 bg-panel px-2.5 py-1.5">
                    <span className="text-subtle block text-3xs uppercase">Longitude</span>
                    <span className="text-fg font-medium">{summary.parsedGps.lonDms}</span>
                    <span className="text-muted text-3xs block">({summary.parsedGps.lonDec?.toFixed(6)})</span>
                  </div>
                  <div className="rounded border border-line/60 bg-panel px-2.5 py-1.5">
                    <span className="text-subtle block text-3xs uppercase">Altitude & Sat Fix</span>
                    <span className="text-fg font-medium">{summary.parsedGps.alt ?? "N/A"}</span>
                    <span className="text-muted text-3xs block">{summary.parsedGps.timestamp ?? "—"}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Contextual Card: Forensic Integrity Summary when "Forensic" tab is active */}
            {category === "integrity" && !search && (
              <div className="rounded-md border border-line bg-elevated/70 p-3 space-y-2">
                <div className="flex items-center gap-1.5 pb-1 border-b border-line/60">
                  <ShieldCheck className="size-4 text-accent" />
                  <h4 className="font-mono text-xs font-semibold uppercase tracking-wider text-fg">
                    Forensic Integrity Indicators
                  </h4>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 font-mono text-2xs">
                  <div className="rounded border border-line/60 bg-panel p-2">
                    <span className="text-subtle block text-3xs uppercase">Dimension Check</span>
                    {summary.dimMismatch ? (
                      <span className="text-warn font-semibold">
                        Discrepancy: EXIF {summary.exifW}×{summary.exifH} vs Decoded {summary.rasterW}×{summary.rasterH}
                      </span>
                    ) : (
                      <span className="text-ok font-medium">✓ Dimensions verify consistently ({summary.rasterW}×{summary.rasterH} px)</span>
                    )}
                  </div>
                  <div className="rounded border border-line/60 bg-panel p-2">
                    <span className="text-subtle block text-3xs uppercase">Software Signature</span>
                    {summary.isEditedSoftware ? (
                      <span className="text-accent font-semibold">
                        Post-processed with &ldquo;{summary.software}&rdquo;
                      </span>
                    ) : (
                      <span className="text-muted">No external editing suite string identified</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Embedded Thumbnail Card */}
            {thumbnail && (category === "all" || category === "integrity") && !search && (
              <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-elevated/60 p-2.5">
                <div className="size-14 shrink-0 overflow-hidden rounded border border-line bg-panel flex items-center justify-center">
                  <ThumbnailCanvas bitmap={thumbnail} />
                </div>
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <h4 className="font-mono text-xs font-semibold text-fg">
                      Embedded EXIF Thumbnail
                    </h4>
                    <Badge tone="ok" className="text-3xs">Extracted</Badge>
                  </div>
                  <p className="text-2xs text-muted max-w-md">
                    Extracted JPEG preview ({thumbnail.width}×{thumbnail.height} px) stored inside the EXIF header.
                  </p>
                </div>
              </div>
            )}

            {/* Tag List Table: Clear, clean, and highly readable */}
            <div className="overflow-hidden rounded-md border border-line bg-surface shadow-xs">
              <table className="w-full text-left text-micro">
                <thead className="border-b border-line bg-panel/80 font-mono text-3xs uppercase tracking-wider text-subtle">
                  <tr>
                    <th className="w-20 px-3 py-2">Group</th>
                    <th className="w-48 sm:w-60 px-3 py-2">Tag Name</th>
                    <th className="px-3 py-2">Decoded Value</th>
                    <th className="w-12 px-2 py-2 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/40">
                  {displayedFields.map((f, i) => {
                    const desc = TAG_DESCRIPTIONS[f.key];
                    const isCopied = copied === f.key;
                    return (
                      <tr
                        key={`${f.group}-${f.key}-${i}`}
                        className="hover:bg-elevated/60 transition-colors group"
                      >
                        <td className="px-3 py-2 font-mono text-subtle align-top">
                          <span className="inline-block rounded bg-panel px-1.5 py-0.5 text-3xs font-medium">
                            {f.group}
                          </span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="font-mono font-semibold text-fg break-all">
                            {f.key}
                          </div>
                          {desc && (
                            <div className="text-3xs text-subtle mt-0.5 leading-tight">
                              {desc}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-fg/90 break-all align-top selection:bg-accent/30 selection:text-fg">
                          <span className="font-medium text-fg">{f.value}</span>
                        </td>
                        <td className="px-2 py-2 text-right align-top">
                          <button
                            type="button"
                            onClick={() => copySingleTag(f.key, f.value)}
                            className="inline-flex items-center justify-center size-6 rounded hover:bg-elevated text-subtle hover:text-fg transition-colors"
                            title={`Copy ${f.key}: ${f.value}`}
                          >
                            {isCopied ? (
                              <Check className="size-3 text-ok" />
                            ) : (
                              <Copy className="size-3 opacity-60 group-hover:opacity-100" />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ThumbnailCanvas({ bitmap }: { bitmap: ImageBitmap }) {
  return (
    <canvas
      ref={(canvas) => {
        if (!canvas) return;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
        }
      }}
      className="max-h-full max-w-full object-contain"
    />
  );
}
