import type { JpegStructure, MetaField, ParsedMedia, QuantTable } from "./types";

function u16be(b: Uint8Array, i: number): number {
  return (b[i]! << 8) | b[i + 1]!;
}
function u16le(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8);
}
function u32be(b: Uint8Array, i: number): number {
  return ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
}
function u32le(b: Uint8Array, i: number): number {
  return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;
}

const MARKER: Record<number, string> = {
  0xd8: "SOI",
  0xd9: "EOI",
  0xda: "SOS",
  0xdb: "DQT",
  0xc4: "DHT",
  0xdd: "DRI",
  0xfe: "COM",
  0xe0: "APP0",
  0xe1: "APP1",
  0xe2: "APP2",
  0xe3: "APP3",
  0xed: "APP13",
  0xee: "APP14",
  0xef: "APP15",
  0xc0: "SOF0",
  0xc1: "SOF1",
  0xc2: "SOF2",
  0xc3: "SOF3",
};

function markerName(m: number): string {
  if (m >= 0xd0 && m <= 0xd7) return `RST${m - 0xd0}`;
  return MARKER[m] ?? `FF${m.toString(16).toUpperCase()}`;
}

export function parseJpeg(bytes: Uint8Array): JpegStructure {
  const empty: JpegStructure = {
    isJpeg: false,
    progressive: false,
    width: 0,
    height: 0,
    precision: 0,
    components: 0,
    restartInterval: 0,
    fileLength: bytes.length,
    chromaSubsampling: "—",
    quantizationTables: [],
    markers: [],
    comments: [],
    hasThumbnail: false,
    app1Count: 0,
  };
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return empty;
  const info: JpegStructure = { ...empty, isJpeg: true };
  info.markers.push({ name: "SOI", offset: 0, length: 2 });
  const hSamp = [1, 1, 1, 1];
  const vSamp = [1, 1, 1, 1];
  let i = 2;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    while (i < bytes.length && bytes[i] === 0xff) i++;
    if (i >= bytes.length) break;
    const m = bytes[i]!;
    i++;
    if (m === 0x00 || m === 0xff) continue;
    if (m === 0xd9) {
      info.markers.push({ name: "EOI", offset: i - 2, length: 2 });
      break;
    }
    if (m === 0xda) {
      info.markers.push({
        name: "SOS",
        offset: i - 2,
        length: bytes.length - (i - 2),
      });
      break;
    }
    if (m >= 0xd0 && m <= 0xd7) {
      info.markers.push({ name: markerName(m), offset: i - 2, length: 2 });
      continue;
    }
    if (i + 1 >= bytes.length) break;
    const len = u16be(bytes, i);
    const start = i - 2;
    const payload = i + 2;
    const end = Math.min(i + len, bytes.length);
    info.markers.push({ name: markerName(m), offset: start, length: 2 + len });
    if (m === 0xdb) parseDqt(bytes.subarray(payload, end), info);
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      info.progressive = m === 0xc2;
      if (end - payload >= 6) {
        info.precision = bytes[payload]!;
        info.height = u16be(bytes, payload + 1);
        info.width = u16be(bytes, payload + 3);
        info.components = bytes[payload + 5]!;
        let p = payload + 6;
        for (let c = 0; c < Math.min(info.components, 4); c++) {
          if (p + 3 > end) break;
          const samp = bytes[p + 1]!;
          hSamp[c] = samp >> 4;
          vSamp[c] = samp & 0x0f;
          p += 3;
        }
      }
    }
    if (m === 0xdd && end - payload >= 2) {
      info.restartInterval = u16be(bytes, payload);
    }
    if (m === 0xfe) {
      info.comments.push(utf8(bytes.subarray(payload, end)).replace(/\0/g, "").trim());
    }
    if (m === 0xe1) {
      info.app1Count++;
      const slice = bytes.subarray(payload, end);
      if (startsWith(slice, "Exif")) {
        info.app1Kind = "Exif";
        const thumb = extractExifThumbnail(slice);
        if (thumb) {
          info.hasThumbnail = true;
        }
      } else if (utf8(slice.slice(0, 32)).includes("http") || utf8(slice.slice(0, 32)).includes("xmp")) {
        info.app1Kind = "XMP";
      } else {
        info.app1Kind = info.app1Kind ?? "APP1";
      }
      info.app1Head = [...slice.slice(0, 16)]
        .map((x) => x.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
    }
    i += len;
  }
  if (info.components < 3) info.chromaSubsampling = "grayscale";
  else if (hSamp[0] === 2 && vSamp[0] === 2 && hSamp[1] === 1 && vSamp[1] === 1)
    info.chromaSubsampling = "4:2:0";
  else if (hSamp[0] === 2 && vSamp[0] === 1 && hSamp[1] === 1 && vSamp[1] === 1)
    info.chromaSubsampling = "4:2:2";
  else if (hSamp[0] === 1 && vSamp[0] === 1) info.chromaSubsampling = "4:4:4";
  else info.chromaSubsampling = "custom";
  const qt = info.quantizationTables[0];
  if (qt) {
    const q = 100 - (qt.sum - 64) / 14;
    info.estimatedQuality = Math.max(1, Math.min(100, q));
  }
  return info;
}

function parseDqt(payload: Uint8Array, info: JpegStructure) {
  let p = 0;
  while (p < payload.length) {
    const pqTq = payload[p]!;
    p++;
    const prec = pqTq >> 4;
    const id = pqTq & 0x0f;
    const values: number[] = [];
    if (prec === 0) {
      if (p + 64 > payload.length) break;
      for (let i = 0; i < 64; i++) values.push(payload[p + i]!);
      p += 64;
    } else {
      if (p + 128 > payload.length) break;
      for (let i = 0; i < 64; i++) values.push(u16be(payload, p + i * 2));
      p += 128;
    }
    const table: QuantTable = {
      id,
      values,
      dc: values[0] ?? 0,
      sum: values.reduce((a, b) => a + b, 0),
    };
    info.quantizationTables.push(table);
  }
}

function startsWith(b: Uint8Array, s: string): boolean {
  for (let i = 0; i < s.length; i++) if (b[i] !== s.charCodeAt(i)) return false;
  return true;
}

function utf8(b: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(b);
  } catch {
    return "";
  }
}

const EXIF_TAGS: Record<number, string> = {
  0x0100: "ImageWidth",
  0x0101: "ImageLength",
  0x0102: "BitsPerSample",
  0x0103: "Compression",
  0x0106: "PhotometricInterpretation",
  0x010e: "ImageDescription",
  0x010f: "Make",
  0x0110: "Model",
  0x0111: "StripOffsets",
  0x0112: "Orientation",
  0x0115: "SamplesPerPixel",
  0x0116: "RowsPerStrip",
  0x0117: "StripByteCounts",
  0x011a: "XResolution",
  0x011b: "YResolution",
  0x0128: "ResolutionUnit",
  0x0131: "Software",
  0x0132: "DateTime",
  0x013b: "Artist",
  0x0211: "YCbCrCoefficients",
  0x0212: "YCbCrSubSampling",
  0x0213: "YCbCrPositioning",
  0x0214: "ReferenceBlackWhite",
  0x8298: "Copyright",
  0x8769: "ExifIFD",
  0x8825: "GPSIFD",
  0x829a: "ExposureTime",
  0x829d: "FNumber",
  0x8822: "ExposureProgram",
  0x8824: "SpectralSensitivity",
  0x8827: "ISO",
  0x8830: "SensitivityType",
  0x8832: "RecommendedExposureIndex",
  0x9000: "ExifVersion",
  0x9003: "DateTimeOriginal",
  0x9004: "DateTimeDigitized",
  0x9010: "OffsetTime",
  0x9011: "OffsetTimeOriginal",
  0x9012: "OffsetTimeDigitized",
  0x9101: "ComponentsConfiguration",
  0x9102: "CompressedBitsPerPixel",
  0x9201: "ShutterSpeedValue",
  0x9202: "ApertureValue",
  0x9203: "BrightnessValue",
  0x9204: "ExposureBiasValue",
  0x9205: "MaxApertureValue",
  0x9206: "SubjectDistance",
  0x9207: "MeteringMode",
  0x9208: "LightSource",
  0x9209: "Flash",
  0x920a: "FocalLength",
  0x9214: "SubjectArea",
  0x927c: "MakerNote",
  0x9286: "UserComment",
  0x9290: "SubSecTime",
  0x9291: "SubSecTimeOriginal",
  0x9292: "SubSecTimeDigitized",
  0xa000: "FlashpixVersion",
  0xa001: "ColorSpace",
  0xa002: "PixelXDimension",
  0xa003: "PixelYDimension",
  0xa004: "RelatedSoundFile",
  0xa005: "InteroperabilityIFD",
  0xa20e: "FocalPlaneXResolution",
  0xa20f: "FocalPlaneYResolution",
  0xa210: "FocalPlaneResolutionUnit",
  0xa217: "SensingMethod",
  0xa300: "FileSource",
  0xa301: "SceneType",
  0xa302: "CFAPattern",
  0xa401: "CustomRendered",
  0xa402: "ExposureMode",
  0xa403: "WhiteBalance",
  0xa404: "DigitalZoomRatio",
  0xa405: "FocalLengthIn35mm",
  0xa406: "SceneCaptureType",
  0xa407: "GainControl",
  0xa408: "Contrast",
  0xa409: "Saturation",
  0xa40a: "Sharpness",
  0xa40b: "DeviceSettingDescription",
  0xa40c: "SubjectDistanceRange",
  0xa420: "ImageUniqueID",
  0xa430: "CameraOwnerName",
  0xa431: "BodySerialNumber",
  0xa432: "LensSpecification",
  0xa433: "LensMake",
  0xa434: "LensModel",
  0xa435: "LensSerialNumber",
};

const GPS_TAGS: Record<number, string> = {
  0x0000: "GPSVersionID",
  0x0001: "GPSLatitudeRef",
  0x0002: "GPSLatitude",
  0x0003: "GPSLongitudeRef",
  0x0004: "GPSLongitude",
  0x0005: "GPSAltitudeRef",
  0x0006: "GPSAltitude",
  0x0007: "GPSTimeStamp",
  0x0008: "GPSSatellites",
  0x0009: "GPSStatus",
  0x000a: "GPSMeasureMode",
  0x000b: "GPSDOP",
  0x000c: "GPSSpeedRef",
  0x000d: "GPSSpeed",
  0x000e: "GPSTrackRef",
  0x000f: "GPSTrack",
  0x0010: "GPSImgDirectionRef",
  0x0011: "GPSImgDirection",
  0x0012: "GPSMapDatum",
  0x0013: "GPSDestLatitudeRef",
  0x0014: "GPSDestLatitude",
  0x0015: "GPSDestLongitudeRef",
  0x0016: "GPSDestLongitude",
  0x0017: "GPSDestBearingRef",
  0x0018: "GPSDestBearing",
  0x0019: "GPSDestDistanceRef",
  0x001a: "GPSDestDistance",
  0x001b: "GPSProcessingMethod",
  0x001c: "GPSAreaInformation",
  0x001d: "GPSDateStamp",
  0x001e: "GPSDifferential",
};

export function extractExifThumbnail(app1: Uint8Array): Uint8Array | null {
  let body = app1;
  if (startsWith(app1, "Exif")) body = app1.subarray(6);
  if (body.length < 8) return null;
  const le = body[0] === 0x49 && body[1] === 0x49;
  const be = body[0] === 0x4d && body[1] === 0x4d;
  if (!le && !be) return null;
  const r16 = (o: number) => (le ? u16le(body, o) : u16be(body, o));
  const r32 = (o: number) => (le ? u32le(body, o) : u32be(body, o));
  const ifd0 = r32(4);
  if (ifd0 + 2 > body.length) return null;
  const n0 = r16(ifd0);
  const next = ifd0 + 2 + n0 * 12;
  if (next + 4 > body.length) return null;
  const ifd1 = r32(next);
  if (!ifd1 || ifd1 + 2 > body.length) return null;
  const n1 = r16(ifd1);
  let off = 0;
  let len = 0;
  for (let i = 0; i < n1; i++) {
    const e = ifd1 + 2 + i * 12;
    const tag = r16(e);
    const val = r32(e + 8);
    if (tag === 0x0201) off = val;
    if (tag === 0x0202) len = val;
  }
  if (off && len && off + len <= body.length && len > 16) {
    const t = body.subarray(off, off + len);
    if (t[0] === 0xff && t[1] === 0xd8) return t.slice();
  }
  return null;
}

function readExifFields(app1: Uint8Array, fields: MetaField[]) {
  let body = app1;
  if (startsWith(app1, "Exif")) body = app1.subarray(6);
  if (body.length < 8) return;
  const le = body[0] === 0x49 && body[1] === 0x49;
  const be = body[0] === 0x4d && body[1] === 0x4d;
  if (!le && !be) return;
  const r16 = (o: number) => (le ? u16le(body, o) : u16be(body, o));
  const r32 = (o: number) => (le ? u32le(body, o) : u32be(body, o));
  const walk = (ifd: number, group: string, depth: number) => {
    if (depth > 3 || ifd + 2 > body.length) return;
    const n = r16(ifd);
    if (n > 256) return;
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > body.length) break;
      const tag = r16(e);
      const type = r16(e + 2);
      const count = r32(e + 4);
      const valOff = e + 8;
      if (tag === 0x8769) {
        walk(r32(valOff), "Exif", depth + 1);
        continue;
      }
      if (tag === 0x8825) {
        walk(r32(valOff), "GPS", depth + 1);
        continue;
      }
      if (tag === 0xa005) {
        walk(r32(valOff), "Interoperability", depth + 1);
        continue;
      }
      const name = group === "GPS" ? GPS_TAGS[tag] : EXIF_TAGS[tag];
      const fieldKey = name || `Tag_0x${tag.toString(16).padStart(4, "0").toUpperCase()}`;
      const unit = type === 3 ? 2 : type === 4 || type === 9 ? 4 : type === 5 || type === 10 ? 8 : 1;
      const size = unit * count;
      const dataPtr = size > 4 ? r32(valOff) : valOff;
      let value = "";
      try {
        if (type === 2) {
          const s = body.subarray(dataPtr, dataPtr + count);
          value = utf8(s).replace(/\0/g, "").trim();
        } else if (type === 3 && count === 1) {
          const v16 = r16(valOff);
          if (fieldKey === "Orientation") {
            const map: Record<number, string> = {
              1: "1 (Horizontal / Normal)",
              2: "2 (Mirror horizontal)",
              3: "3 (Rotate 180°)",
              4: "4 (Mirror vertical)",
              5: "5 (Mirror horizontal & Rotate 270° CW)",
              6: "6 (Rotate 90° CW)",
              7: "7 (Mirror horizontal & Rotate 90° CW)",
              8: "8 (Rotate 270° CW)",
            };
            value = map[v16] ?? String(v16);
          } else if (fieldKey === "ExposureProgram") {
            const map: Record<number, string> = {
              1: "Manual",
              2: "Normal program",
              3: "Aperture priority",
              4: "Shutter priority",
              5: "Creative program",
              6: "Action program",
              7: "Portrait mode",
              8: "Landscape mode",
            };
            value = map[v16] ? `${v16} (${map[v16]})` : String(v16);
          } else if (fieldKey === "MeteringMode") {
            const map: Record<number, string> = {
              1: "Average",
              2: "Center-weighted average",
              3: "Spot",
              4: "Multi-spot",
              5: "Multi-segment / Pattern",
              6: "Partial",
              255: "Other",
            };
            value = map[v16] ? `${v16} (${map[v16]})` : String(v16);
          } else if (fieldKey === "Flash") {
            const fired = (v16 & 1) !== 0;
            const mode = (v16 >> 3) & 3;
            const modeStr = mode === 1 ? "compulsory" : mode === 2 ? "suppressed" : mode === 3 ? "auto" : "standard";
            value = `${v16} (${fired ? "Fired" : "Did not fire"}, ${modeStr})`;
          } else if (fieldKey === "ColorSpace") {
            value = v16 === 1 ? "1 (sRGB)" : v16 === 2 ? "2 (Adobe RGB)" : v16 === 65535 ? "Uncalibrated" : String(v16);
          } else if (fieldKey === "ResolutionUnit") {
            value = v16 === 2 ? "2 (inches)" : v16 === 3 ? "3 (cm)" : String(v16);
          } else if (fieldKey === "WhiteBalance") {
            value = v16 === 0 ? "0 (Auto)" : v16 === 1 ? "1 (Manual)" : String(v16);
          } else {
            value = String(v16);
          }
        } else if ((type === 4 || type === 9) && count === 1) {
          value = String(r32(valOff));
        } else if ((type === 5 || type === 10) && count >= 1 && dataPtr + 8 * count <= body.length) {
          if (group === "GPS" && (fieldKey === "GPSLatitude" || fieldKey === "GPSLongitude") && count === 3) {
            const dN = r32(dataPtr);
            const dD = r32(dataPtr + 4) || 1;
            const mN = r32(dataPtr + 8);
            const mD = r32(dataPtr + 12) || 1;
            const sN = r32(dataPtr + 16);
            const sD = r32(dataPtr + 20) || 1;
            const deg = dN / dD;
            const min = mN / mD;
            const sec = sN / sD;
            value = `${deg}° ${min}' ${sec.toFixed(2)}"`;
          } else if (group === "GPS" && fieldKey === "GPSTimeStamp" && count === 3) {
            const h = Math.floor(r32(dataPtr) / (r32(dataPtr + 4) || 1));
            const m = Math.floor(r32(dataPtr + 8) / (r32(dataPtr + 12) || 1));
            const s = (r32(dataPtr + 16) / (r32(dataPtr + 20) || 1)).toFixed(0);
            value = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")} UTC`;
          } else if (count === 1) {
            const num = r32(dataPtr);
            const den = r32(dataPtr + 4) || 1;
            if (fieldKey === "ExposureTime") {
              if (num === 1 || (num > 0 && num < den)) {
                value = `1/${Math.round(den / num)} s`;
              } else {
                value = `${(num / den).toFixed(2)} s`;
              }
            } else if (fieldKey === "FNumber" || fieldKey === "ApertureValue" || fieldKey === "MaxApertureValue") {
              value = `f/${(num / den).toFixed(1).replace(/\.0$/, "")}`;
            } else if (fieldKey === "FocalLength") {
              value = `${(num / den).toFixed(1).replace(/\.0$/, "")} mm`;
            } else if (fieldKey === "ExposureBiasValue") {
              const ev = num / den;
              value = `${ev >= 0 ? "+" : ""}${ev.toFixed(2)} EV`;
            } else if (fieldKey === "GPSAltitude") {
              value = `${(num / den).toFixed(1)} m`;
            } else {
              value = den === 1 ? String(num) : `${num}/${den}`;
            }
          } else {
            const items: string[] = [];
            for (let c = 0; c < Math.min(count, 4); c++) {
              const num = r32(dataPtr + c * 8);
              const den = r32(dataPtr + c * 8 + 4) || 1;
              items.push(den === 1 ? String(num) : `${num}/${den}`);
            }
            value = items.join(", ") + (count > 4 ? ` (+${count - 4} more)` : "");
          }
        } else if (type === 7 && count <= 16) {
          if (fieldKey === "ExifVersion" || fieldKey === "FlashpixVersion") {
            value = [...body.subarray(dataPtr, dataPtr + count)]
              .map((x) => String.fromCharCode(x))
              .join("");
          } else {
            value = [...body.subarray(dataPtr, dataPtr + count)]
              .map((x) => String.fromCharCode(x))
              .join("");
          }
        } else {
          value = `${count}×type${type}`;
        }
      } catch {
        value = "(unreadable)";
      }
      if (value) fields.push({ key: fieldKey, value, group });
    }
  };
  walk(r32(4), "IFD0", 0);
}

function parsePng(bytes: Uint8Array, fields: MetaField[], warnings: string[]) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return;
  let p = 8;
  while (p + 12 <= bytes.length) {
    const len = u32be(bytes, p);
    if (len > 32 * 1024 * 1024) {
      warnings.push("PNG chunk length exceeds safety limit; parse stopped.");
      break;
    }
    const type = utf8(bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === "IHDR" && data.length >= 13) {
      fields.push({ key: "PNG.Width", value: String(u32be(data, 0)), group: "PNG" });
      fields.push({ key: "PNG.Height", value: String(u32be(data, 4)), group: "PNG" });
      fields.push({ key: "PNG.BitDepth", value: String(data[8]), group: "PNG" });
      fields.push({
        key: "PNG.ColorType",
        value: String(data[9]),
        group: "PNG",
      });
      fields.push({ key: "PNG.Interlace", value: String(data[12]), group: "PNG" });
    } else if (type === "tEXt" || type === "iTXt") {
      const txt = utf8(data);
      const z = txt.indexOf("\0");
      const k = z >= 0 ? txt.slice(0, z) : "text";
      const v = z >= 0 ? txt.slice(z + 1).slice(0, 240) : txt.slice(0, 240);
      fields.push({ key: `PNG.${k}`, value: v.replace(/\0/g, " ").trim(), group: "PNG" });
    } else if (type === "tIME" && data.length >= 7) {
      fields.push({
        key: "PNG.tIME",
        value: `${u16be(data, 0)}-${String(data[2]).padStart(2, "0")}-${String(data[3]).padStart(2, "0")} ${String(data[4]).padStart(2, "0")}:${String(data[5]).padStart(2, "0")}:${String(data[6]).padStart(2, "0")}`,
        group: "PNG",
      });
    } else if (type === "pHYs" && data.length >= 9) {
      fields.push({
        key: "PNG.pHYs",
        value: `${u32be(data, 0)}×${u32be(data, 4)} unit=${data[8]}`,
        group: "PNG",
      });
    } else if (type === "iCCP") {
      fields.push({ key: "PNG.iCCP", value: "embedded ICC profile present", group: "PNG" });
    } else if (type === "eXIf") {
      fields.push({ key: "PNG.eXIf", value: `embedded EXIF (${data.length} bytes)`, group: "PNG" });
      readExifFields(data, fields);
    }
    if (type === "IEND") break;
    p += 12 + len;
  }
}

export function parseMedia(bytes: Uint8Array, mimeHint?: string): ParsedMedia {
  const fields: MetaField[] = [];
  const warnings: string[] = [];
  let kind: ParsedMedia["kind"] = "unknown";
  let mime = mimeHint || "application/octet-stream";
  let jpeg: JpegStructure | undefined;
  let thumbnailJpeg: Uint8Array | undefined;

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    kind = "jpeg";
    mime = "image/jpeg";
    jpeg = parseJpeg(bytes);
    fields.push({ key: "Format", value: jpeg.progressive ? "JPEG (progressive)" : "JPEG (baseline)", group: "File" });
    fields.push({ key: "SOF.Width", value: String(jpeg.width), group: "JPEG" });
    fields.push({ key: "SOF.Height", value: String(jpeg.height), group: "JPEG" });
    fields.push({ key: "Chroma", value: jpeg.chromaSubsampling, group: "JPEG" });
    fields.push({ key: "Components", value: String(jpeg.components), group: "JPEG" });
    if (jpeg.estimatedQuality)
      fields.push({
        key: "QTable.EstimatedQuality",
        value: jpeg.estimatedQuality.toFixed(1),
        group: "JPEG",
      });
    if (jpeg.comments.length)
      fields.push({ key: "COM", value: jpeg.comments.join(" | "), group: "JPEG" });
    // EXIF from APP1
    let i = 2;
    while (i + 4 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      while (i < bytes.length && bytes[i] === 0xff) i++;
      const m = bytes[i++]!;
      if (m === 0xda || m === 0xd9) break;
      if (m >= 0xd0 && m <= 0xd7) continue;
      const len = u16be(bytes, i);
      const payload = bytes.subarray(i + 2, i + len);
      if (m === 0xe1 && startsWith(payload, "Exif")) {
        readExifFields(payload, fields);
        const th = extractExifThumbnail(payload);
        if (th) {
          thumbnailJpeg = th;
          jpeg.hasThumbnail = true;
        }
      } else if (m === 0xe1) {
        const head = utf8(payload.subarray(0, 80));
        if (head.includes("xmp") || head.includes("XMP") || head.includes("http://")) {
          fields.push({ key: "XMP", value: "XMP packet present in APP1", group: "Metadata" });
        }
      } else if (m === 0xed) {
        fields.push({ key: "APP13", value: "Photoshop IRB / IPTC segment present", group: "Metadata" });
      } else if (m === 0xe2) {
        fields.push({ key: "APP2", value: `APP2 ${payload.length} bytes (ICC or FPXR)`, group: "Metadata" });
      }
      i += len;
    }
  } else if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    kind = "png";
    mime = "image/png";
    fields.push({ key: "Format", value: "PNG", group: "File" });
    parsePng(bytes, fields, warnings);
    warnings.push("ELA is not appropriate for PNG. Any ELA residual is a first-time JPEG encode of the pixels.");
  } else if (bytes[0] === 0x47 && bytes[1] === 0x49) {
    kind = "gif";
    mime = "image/gif";
    fields.push({ key: "Format", value: "GIF", group: "File" });
  } else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) {
    kind = "webp";
    mime = "image/webp";
    fields.push({ key: "Format", value: "WebP", group: "File" });
    // Scan WebP RIFF chunks for EXIF
    let p = 12;
    while (p + 8 <= bytes.length) {
      const fourcc = utf8(bytes.subarray(p, p + 4));
      const chunkLen = u32le(bytes, p + 4);
      if (fourcc === "EXIF" && p + 8 + chunkLen <= bytes.length) {
        readExifFields(bytes.subarray(p + 8, p + 8 + chunkLen), fields);
      }
      p += 8 + chunkLen + (chunkLen % 2);
    }
  } else if (
    (bytes[0] === 0x49 && bytes[1] === 0x49) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d)
  ) {
    kind = "tiff";
    mime = "image/tiff";
    fields.push({ key: "Format", value: "TIFF", group: "File" });
    readExifFields(bytes, fields);
  } else {
    fields.push({ key: "Format", value: "Unknown / decoded via browser", group: "File" });
  }

  return { kind, mime, jpeg, fields, thumbnailJpeg, warnings };
}

export function dimensionMismatch(
  actualW: number,
  actualH: number,
  fields: MetaField[],
): string[] {
  const out: string[] = [];
  const w = Number(fields.find((f) => f.key === "PixelXDimension" || f.key === "ImageWidth" || f.key === "SOF.Width" || f.key === "PNG.Width")?.value);
  const h = Number(fields.find((f) => f.key === "PixelYDimension" || f.key === "ImageLength" || f.key === "SOF.Height" || f.key === "PNG.Height")?.value);
  if (w && h && (w !== actualW || h !== actualH)) {
    out.push(
      `Metadata dimensions ${w}×${h} differ from decoded raster ${actualW}×${actualH}. Possible explanations include cropping after EXIF write, thumbnail tags, or orientation transforms.`,
    );
  }
  return out;
}
