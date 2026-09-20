/** Synthetic case with known copy-move + mixed JPEG history. Labeled as generated. */

export async function buildDemoCase(): Promise<{
  buffer: ArrayBuffer;
  filename: string;
  mime: string;
}> {
  const w = 640;
  const h = 480;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#6a8aa8");
  sky.addColorStop(0.45, "#c4b49a");
  sky.addColorStop(1, "#3a4a38");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#2b3540";
  ctx.fillRect(40, 160, 260, 280);
  ctx.fillStyle = "#1c242c";
  ctx.fillRect(360, 120, 220, 320);
  ctx.fillStyle = "#c8d2c0";
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 4; col++) {
      ctx.fillRect(60 + col * 58, 180 + row * 48, 36, 28);
    }
  }
  ctx.fillStyle = "#d8c48c";
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 3; col++) {
      ctx.fillRect(380 + col * 62, 140 + row * 46, 40, 30);
    }
  }
  ctx.fillStyle = "#1a1c18";
  ctx.beginPath();
  ctx.ellipse(250, 400, 28, 70, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#3a3228";
  ctx.beginPath();
  ctx.arc(250, 338, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8e0d4";
  ctx.font = "28px sans-serif";
  ctx.fillText("TRACEBENCH", 48, 56);
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#d4c8b0";
  ctx.fillText("SYNTHETIC TEST ARTICLE — not a photograph", 48, 78);

  const src = ctx.getImageData(60, 180, 36, 28);
  ctx.putImageData(src, 470, 280);

  const blob90 = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  const bmp = await createImageBitmap(blob90);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();

  const patch = ctx.getImageData(360, 120, 220, 160);
  const pc = new OffscreenCanvas(220, 160);
  const pctx = pc.getContext("2d");
  if (!pctx) throw new Error("canvas");
  pctx.putImageData(patch, 0, 0);
  const pblob = await pc.convertToBlob({ type: "image/jpeg", quality: 0.55 });
  const pbmp = await createImageBitmap(pblob);
  ctx.drawImage(pbmp, 360, 120);
  pbmp.close();

  const out = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
  const buffer = await out.arrayBuffer();
  const rawBytes = new Uint8Array(buffer);
  if (rawBytes[0] === 0xff && rawBytes[1] === 0xd8) {
    const exifApp1 = buildSyntheticExifApp1();
    const combined = new Uint8Array(rawBytes.length + exifApp1.length);
    combined.set(rawBytes.subarray(0, 2), 0);
    combined.set(exifApp1, 2);
    combined.set(rawBytes.subarray(2), 2 + exifApp1.length);
    return { buffer: combined.buffer, filename: "tracebench-synthetic-demo.jpg", mime: "image/jpeg" };
  }
  return { buffer, filename: "tracebench-synthetic-demo.jpg", mime: "image/jpeg" };
}

function buildSyntheticExifApp1(): Uint8Array {
  // Construct TIFF body in Little Endian
  const buf: number[] = [];
  const u16 = (v: number) => { buf.push(v & 0xff, (v >> 8) & 0xff); };
  const u32 = (v: number) => { buf.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff); };

  // Header: II 0x002A offset 8
  buf.push(0x49, 0x49);
  u16(0x002a);
  u32(8);

  // We will layout:
  // IFD0 at offset 8
  // Exif IFD
  // GPS IFD
  // Values storage
  // Pre-calculate positions using a fixed layout:
  // IFD0: 9 entries -> 2 + 9*12 + 4 = 114 bytes (offsets 8..121)
  const ifd0Count = 9;
  const exifIfdOffset = 8 + 2 + ifd0Count * 12 + 4; // 122
  const exifCount = 21;
  const gpsIfdOffset = exifIfdOffset + 2 + exifCount * 12 + 4;
  const gpsCount = 6;
  const dataOffset = gpsIfdOffset + 2 + gpsCount * 12 + 4;

  // Temporary storage to write values and get their data offsets
  const dataBuf: number[] = [];
  const addData = (bytes: number[]): number => {
    const off = dataOffset + dataBuf.length;
    for (const b of bytes) dataBuf.push(b);
    return off;
  };
  const addStr = (s: string): number => {
    const bytes = [...new TextEncoder().encode(s), 0];
    return addData(bytes);
  };
  const addRat = (n: number, d: number): number => {
    const b = [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff, d & 0xff, (d >> 8) & 0xff, (d >> 16) & 0xff, (d >> 24) & 0xff];
    return addData(b);
  };
  const addRat3 = (r: [number, number][]): number => {
    const bytes: number[] = [];
    for (const [n, d] of r) {
      bytes.push(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff, d & 0xff, (d >> 8) & 0xff, (d >> 16) & 0xff, (d >> 24) & 0xff);
    }
    return addData(bytes);
  };

  // Data entries
  const offMake = addStr("NIKON CORPORATION");
  const offModel = addStr("NIKON D850");
  const offSoftware = addStr("Adobe Photoshop CC 2024 (Windows)");
  const offDate = addStr("2024:06:15 11:32:05");
  const offXRes = addRat(300, 1);
  const offYRes = addRat(300, 1);

  // IFD0 entries
  u16(ifd0Count);
  // Make (0x010f, ASCII, len)
  u16(0x010f); u16(2); u32(18); u32(offMake);
  // Model (0x0110, ASCII, len)
  u16(0x0110); u16(2); u32(11); u32(offModel);
  // Orientation (0x0112, SHORT, 1, val=1)
  u16(0x0112); u16(3); u32(1); u16(1); u16(0);
  // XResolution (0x011a, RATIONAL, 1)
  u16(0x011a); u16(5); u32(1); u32(offXRes);
  // YResolution (0x011b, RATIONAL, 1)
  u16(0x011b); u16(5); u32(1); u32(offYRes);
  // ResolutionUnit (0x0128, SHORT, 1, val=2)
  u16(0x0128); u16(3); u32(1); u16(2); u16(0);
  // Software (0x0131, ASCII)
  u16(0x0131); u16(2); u32(34); u32(offSoftware);
  // DateTime (0x0132, ASCII)
  u16(0x0132); u16(2); u32(20); u32(offDate);
  // ExifIFD pointer (0x8769, LONG, 1)
  u16(0x8769); u16(4); u32(1); u32(exifIfdOffset);
  u32(0); // next IFD

  // Exif IFD data
  const offExpTime = addRat(1, 250);
  const offFNum = addRat(28, 10);
  const offDateOrig = addStr("2024:06:14 16:20:44");
  const offDateDig = addStr("2024:06:14 16:20:44");
  const offShutter = addRat(7965, 1000);
  const offAperture = addRat(297, 100);
  const offFocal = addRat(70, 1);
  const offLensMake = addStr("NIKON");
  const offLensModel = addStr("AF-S NIKKOR 24-70mm f/2.8E ED VR");
  const offSerial = addStr("6041928");

  // Exif IFD entries
  u16(exifCount);
  // ExposureTime (0x829a)
  u16(0x829a); u16(5); u32(1); u32(offExpTime);
  // FNumber (0x829d)
  u16(0x829d); u16(5); u32(1); u32(offFNum);
  // ExposureProgram (0x8822, SHORT, 1, val=3 Aperture priority)
  u16(0x8822); u16(3); u32(1); u16(3); u16(0);
  // ISO (0x8827, SHORT, 1, val=400)
  u16(0x8827); u16(3); u32(1); u16(400); u16(0);
  // ExifVersion (0x9000, UNDEF, 4, "0231")
  u16(0x9000); u16(7); u32(4); buf.push(0x30, 0x32, 0x33, 0x31);
  // DateTimeOriginal (0x9003)
  u16(0x9003); u16(2); u32(20); u32(offDateOrig);
  // DateTimeDigitized (0x9004)
  u16(0x9004); u16(2); u32(20); u32(offDateDig);
  // ShutterSpeedValue (0x9201)
  u16(0x9201); u16(10); u32(1); u32(offShutter);
  // ApertureValue (0x9202)
  u16(0x9202); u16(5); u32(1); u32(offAperture);
  // MeteringMode (0x9207, SHORT, 1, val=5 Multi-segment)
  u16(0x9207); u16(3); u32(1); u16(5); u16(0);
  // Flash (0x9209, SHORT, 1, val=16 did not fire)
  u16(0x9209); u16(3); u32(1); u16(16); u16(0);
  // FocalLength (0x920a)
  u16(0x920a); u16(5); u32(1); u32(offFocal);
  // ColorSpace (0xa001, SHORT, 1, val=1 sRGB)
  u16(0xa001); u16(3); u32(1); u16(1); u16(0);
  // PixelXDimension (0xa002, LONG, 1, val=640)
  u16(0xa002); u16(4); u32(1); u32(640);
  // PixelYDimension (0xa003, LONG, 1, val=480)
  u16(0xa003); u16(4); u32(1); u32(480);
  // FocalLengthIn35mm (0xa405, SHORT, 1, val=70)
  u16(0xa405); u16(3); u32(1); u16(70); u16(0);
  // WhiteBalance (0xa403, SHORT, 1, val=0 Auto)
  u16(0xa403); u16(3); u32(1); u16(0); u16(0);
  // BodySerialNumber (0xa431, ASCII)
  u16(0xa431); u16(2); u32(8); u32(offSerial);
  // LensMake (0xa433, ASCII)
  u16(0xa433); u16(2); u32(6); u32(offLensMake);
  // LensModel (0xa434, ASCII)
  u16(0xa434); u16(2); u32(32); u32(offLensModel);
  // GPSIFD pointer (0x8825, LONG, 1)
  u16(0x8825); u16(4); u32(1); u32(gpsIfdOffset);
  u32(0); // next IFD

  // GPS IFD data
  const offLat = addRat3([[37, 1], [46, 1], [2980, 100]]);
  const offLon = addRat3([[122, 1], [25, 1], [1020, 100]]);
  const offAlt = addRat(85, 1);
  const offGpsDate = addStr("2024:06:14");

  // GPS IFD entries
  u16(gpsCount);
  // GPSLatitudeRef (0x0001, ASCII, 2, "N\0")
  u16(0x0001); u16(2); u32(2); buf.push(0x4e, 0x00, 0x00, 0x00);
  // GPSLatitude (0x0002, RATIONAL, 3)
  u16(0x0002); u16(5); u32(3); u32(offLat);
  // GPSLongitudeRef (0x0003, ASCII, 2, "W\0")
  u16(0x0003); u16(2); u32(2); buf.push(0x57, 0x00, 0x00, 0x00);
  // GPSLongitude (0x0004, RATIONAL, 3)
  u16(0x0004); u16(5); u32(3); u32(offLon);
  // GPSAltitude (0x0006, RATIONAL, 1)
  u16(0x0006); u16(5); u32(1); u32(offAlt);
  // GPSDateStamp (0x001d, ASCII, 11)
  u16(0x001d); u16(2); u32(11); u32(offGpsDate);
  u32(0); // next IFD

  // Append data buffer
  for (const b of dataBuf) buf.push(b);

  // Now wrap inside JPEG APP1: [0xFF, 0xE1, len_hi, len_lo, 'E', 'x', 'i', 'f', 0, 0, ...buf]
  const app1PayloadLen = 2 + 6 + buf.length;
  const app1 = new Uint8Array(2 + app1PayloadLen);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1[2] = (app1PayloadLen >> 8) & 0xff;
  app1[3] = app1PayloadLen & 0xff;
  app1[4] = 0x45; // 'E'
  app1[5] = 0x78; // 'x'
  app1[6] = 0x69; // 'i'
  app1[7] = 0x66; // 'f'
  app1[8] = 0x00;
  app1[9] = 0x00;
  app1.set(new Uint8Array(buf), 10);
  return app1;
}
