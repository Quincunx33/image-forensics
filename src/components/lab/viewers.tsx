import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyColormap } from "@/lib/forensic/colormap";
import type { AutoRegion, CloneMatch, Heatmap, Roi } from "@/lib/forensic/types";
import { requestPixel, useLab } from "@/store/lab-store";

type Camera = { scale: number; x: number; y: number };

function drawFrame(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap | HTMLCanvasElement | null,
  overlay: ImageBitmap | null,
  camera: Camera,
  overlayOpacity: number,
  rois: Roi[],
  regions: AutoRegion[],
  matches: CloneMatch[] | undefined,
  inspect: { x: number; y: number } | null,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#090b0e";
  ctx.fillRect(0, 0, w, h);
  if (!bitmap) return;
  ctx.imageSmoothingEnabled = camera.scale < 2;
  ctx.save();
  ctx.translate(-camera.x * camera.scale, -camera.y * camera.scale);
  ctx.scale(camera.scale, camera.scale);
  ctx.drawImage(bitmap, 0, 0);
  if (overlay) {
    ctx.globalAlpha = overlayOpacity;
    ctx.drawImage(overlay, 0, 0, (bitmap as ImageBitmap).width, (bitmap as ImageBitmap).height);
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = 1.25 / camera.scale;
  for (const r of regions) {
    ctx.strokeStyle = "rgba(110,200,212,0.85)";
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
    ctx.fillStyle = "rgba(110,200,212,0.9)";
    ctx.font = `${11 / camera.scale}px "IBM Plex Mono", monospace`;
    ctx.fillText(r.id, r.x + 4, r.y + 12 / camera.scale);
  }
  for (const r of rois) {
    ctx.strokeStyle = "rgba(196,165,116,0.95)";
    ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h);
  }
  if (matches) {
    ctx.strokeStyle = "rgba(196,122,118,0.9)";
    for (const m of matches.slice(0, 40)) {
      ctx.beginPath();
      ctx.moveTo(m.ax, m.ay);
      ctx.lineTo(m.bx, m.by);
      ctx.stroke();
    }
  }
  if (inspect) {
    ctx.strokeStyle = "rgba(220,227,236,0.9)";
    ctx.beginPath();
    ctx.moveTo(inspect.x + 0.5, 0);
    ctx.lineTo(inspect.x + 0.5, (bitmap as ImageBitmap).height);
    ctx.moveTo(0, inspect.y + 0.5);
    ctx.lineTo((bitmap as ImageBitmap).width, inspect.y + 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

function PanelCanvas({
  title,
  bitmap,
  heatmap,
  showOverlay,
  matches,
}: {
  title: string;
  bitmap: ImageBitmap | null;
  heatmap?: Heatmap | null;
  showOverlay?: boolean;
  matches?: CloneMatch[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camera = useLab((s) => s.camera);
  const setCamera = useLab((s) => s.setCamera);
  const overlayOpacity = useLab((s) => s.params.overlayOpacity);
  const colormap = useLab((s) => s.params.colormap);
  const threshold = useLab((s) => s.params.threshold);
  const overlayOn = useLab((s) => s.overlay);
  const rois = useLab((s) => s.rois);
  const regions = useLab((s) => s.regions);
  const pixel = useLab((s) => s.pixel);
  const addRoi = useLab((s) => s.addRoi);
  const [heatBmp, setHeatBmp] = useState<ImageBitmap | null>(null);
  const drag = useRef<{
    mode: "pan" | "roi";
    x: number;
    y: number;
    cx: number;
    cy: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!heatmap) {
      setHeatBmp(null);
      return;
    }
    const rgba = applyColormap(heatmap.gray, colormap, threshold, 255);
    const img = new ImageData(rgba, heatmap.width, heatmap.height);
    createImageBitmap(img).then((b) => {
      if (cancelled) b.close();
      else setHeatBmp((prev) => {
        prev?.close();
        return b;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [heatmap, colormap, threshold]);

  const paint = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const overlay = showOverlay && overlayOn ? heatBmp : !bitmap ? heatBmp : null;
    drawFrame(
      c,
      bitmap ?? heatBmp,
      showOverlay && overlayOn && bitmap ? heatBmp : overlay && bitmap ? heatBmp : null,
      camera,
      overlayOpacity,
      rois,
      regions,
      matches,
      pixel ? { x: pixel.x, y: pixel.y } : null,
    );
  }, [bitmap, heatBmp, camera, overlayOpacity, overlayOn, showOverlay, rois, regions, matches, pixel]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => paint());
    ro.observe(c);
    return () => ro.disconnect();
  }, [paint]);

  const toImage = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return { x: px / camera.scale + camera.x, y: py / camera.scale + camera.y };
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-2 py-1">
        <span className="font-mono text-2xs uppercase tracking-widest text-muted">{title}</span>
        {heatmap ? (
          <span className="font-mono text-2xs tabular-nums text-subtle">
            μ {heatmap.stats.mean.toFixed(1)} · p99 {heatmap.stats.p99.toFixed(1)}
          </span>
        ) : (
          <span className="font-mono text-2xs text-subtle">source</span>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="heatmap-canvas min-h-32 w-full flex-1 touch-none"
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          const p = toImage(e);
          if (e.shiftKey) {
            drag.current = { mode: "roi", x: p.x, y: p.y, cx: camera.x, cy: camera.y };
          } else {
            drag.current = { mode: "pan", x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };
          }
        }}
        onPointerMove={(e) => {
          const p = toImage(e);
          if (bitmap) requestPixel(p.x | 0, p.y | 0);
          const d = drag.current;
          if (!d) return;
          if (d.mode === "pan") {
            const dx = (e.clientX - d.x) / camera.scale;
            const dy = (e.clientY - d.y) / camera.scale;
            setCamera({ x: d.cx - dx, y: d.cy - dy });
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d?.mode === "roi") {
            const p = toImage(e);
            const x = Math.min(d.x, p.x);
            const y = Math.min(d.y, p.y);
            const w = Math.abs(p.x - d.x);
            const h = Math.abs(p.y - d.y);
            if (w > 4 && h > 4) {
              addRoi({
                id: `ROI-${Date.now().toString(36)}`,
                kind: "rect",
                x,
                y,
                w,
                h,
                label: "ROI",
              });
            }
          }
        }}
        onWheel={(e) => {
          e.preventDefault();
          const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
          const px = e.clientX - rect.left;
          const py = e.clientY - rect.top;
          const imgX = px / camera.scale + camera.x;
          const imgY = py / camera.scale + camera.y;
          const next = Math.max(0.1, Math.min(32, camera.scale * (e.deltaY < 0 ? 1.12 : 0.9)));
          setCamera({
            scale: next,
            x: imgX - px / next,
            y: imgY - py / next,
          });
        }}
      />
    </div>
  );
}

export function Workspace() {
  const original = useLab((s) => s.original);
  const maps = useLab((s) => s.maps);
  const viewMode = useLab((s) => s.viewMode);
  const active = useLab((s) => s.active);
  const setActive = useLab((s) => s.setActive);
  const cloneMatches = (maps.clone?.extra?.matches as CloneMatch[] | undefined) ?? undefined;

  const panels = useMemo(
    () =>
      [
        { id: "file" as const, title: "Original", bitmap: original, map: null, overlay: false },
        { id: "ela" as const, title: "ELA", bitmap: original, map: maps.ela, overlay: true },
        { id: "noise" as const, title: "Local noise", bitmap: original, map: maps.noise, overlay: true },
        { id: "edge" as const, title: "Edge", bitmap: original, map: maps.edge, overlay: true },
        { id: "sharpness" as const, title: "Sharpness", bitmap: original, map: maps.sharpness, overlay: true },
        { id: "dct" as const, title: "DCT / frequency", bitmap: original, map: maps.dct ?? maps.frequency, overlay: true },
        { id: "resampling" as const, title: "Resampling", bitmap: original, map: maps.resampling, overlay: true },
        { id: "clone" as const, title: "Copy-move", bitmap: original, map: maps.clone, overlay: true, matches: cloneMatches },
      ] as const,
    [original, maps, cloneMatches],
  );

  if (!original) return null;

  if (viewMode === "single") {
    const focused = panels.find((p) => p.id === active) ?? panels[1];
    return (
      <div className="grid h-full min-h-0 grid-cols-1">
        <PanelCanvas
          title={focused.title}
          bitmap={original}
          heatmap={focused.map}
          showOverlay={focused.overlay}
          matches={"matches" in focused ? focused.matches : undefined}
        />
      </div>
    );
  }

  if (viewMode === "dual") {
    const focused = panels.find((p) => p.id === active && p.id !== "file") ?? panels[1];
    return (
      <div className="grid h-full min-h-0 grid-cols-1 gap-px bg-line md:grid-cols-2">
        <PanelCanvas title="Original" bitmap={original} showOverlay={false} />
        <PanelCanvas
          title={focused.title}
          bitmap={original}
          heatmap={focused.map}
          showOverlay
          matches={"matches" in focused ? focused.matches : undefined}
        />
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-4">
      {panels.map((p) => (
        <div
          key={p.id}
          className="flex min-h-40 flex-col"
          onDoubleClick={() => {
            setActive(p.id === "file" ? "ela" : p.id);
            useLab.getState().setViewMode("dual");
          }}
        >
          <PanelCanvas
            title={p.title}
            bitmap={p.bitmap}
            heatmap={p.map}
            showOverlay={p.overlay}
            matches={"matches" in p ? p.matches : undefined}
          />
        </div>
      ))}
    </div>
  );
}
