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
  return { buffer, filename: "tracebench-synthetic-demo.jpg", mime: "image/jpeg" };
}
