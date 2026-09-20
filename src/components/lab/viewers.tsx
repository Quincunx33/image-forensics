import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Aperture,
  Box,
  Camera as CameraIcon,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Grid2x2,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Maximize2,
  Scan,
  Square,
  Waves,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { applyColormap } from "@/lib/forensic/colormap";
import type { AutoRegion, CloneMatch, Heatmap, ModuleId, Roi } from "@/lib/forensic/types";
import { requestPixel, useLab } from "@/store/lab-store";
import { cn } from "@/lib/utils";
import { ExifPanel } from "@/components/lab/exif-panel";

type Camera = { scale: number; x: number; y: number };

const MODULE_ICONS: Record<string, typeof ImageIcon> = {
  file: ImageIcon,
  ela: Aperture,
  noise: Waves,
  edge: Box,
  sharpness: Layers,
  dct: Grid2x2,
  resampling: Scan,
  clone: Copy,
  frequency: Activity,
};

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
  if (w <= 0 || h <= 0) return;
  const targetW = Math.floor(w * dpr);
  const targetH = Math.floor(h * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
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
  onSelect,
  isSelected,
}: {
  title: string;
  bitmap: ImageBitmap | null;
  heatmap?: Heatmap | null;
  showOverlay?: boolean;
  matches?: CloneMatch[];
  onSelect?: () => void;
  isSelected?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const camera = useLab((s) => s.camera);
  const setCamera = useLab((s) => s.setCamera);
  const overlayOpacity = useLab((s) => s.params.overlayOpacity);
  const colormap = useLab((s) => s.params.colormap);
  const threshold = useLab((s) => s.params.threshold);
  const overlayOn = useLab((s) => s.overlay);
  const setOverlayOn = useLab((s) => s.setOverlay);
  const rois = useLab((s) => s.rois);
  const regions = useLab((s) => s.regions);
  const pixel = useLab((s) => s.pixel);
  const addRoi = useLab((s) => s.addRoi);

  const [heatBmp, setHeatBmp] = useState<ImageBitmap | null>(null);
  const [roiMode, setRoiMode] = useState(false); // Touch-friendly ROI drawing mode toggle

  // Tracking pointers for multi-touch pinch to zoom & pan
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{
    dist: number;
    scale: number;
    centerImg: { x: number; y: number };
    centerClient: { x: number; y: number };
  } | null>(null);

  const drag = useRef<{
    mode: "pan" | "roi";
    x: number;
    y: number;
    cx: number;
    cy: number;
  } | null>(null);

  // Auto-fit on first load of an image
  const initialFitDone = useRef<ImageBitmap | null>(null);
  const fitToScreen = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !bitmap) return;
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    const iw = bitmap.width;
    const ih = bitmap.height;
    if (cw <= 0 || ch <= 0 || iw <= 0 || ih <= 0) return;
    const scale = Math.min(cw / iw, ch / ih) * 0.95;
    const x = (iw - cw / scale) / 2;
    const y = (ih - ch / scale) / 2;
    setCamera({ scale, x, y });
  }, [bitmap, setCamera]);

  useEffect(() => {
    if (bitmap && initialFitDone.current !== bitmap) {
      initialFitDone.current = bitmap;
      const t = setTimeout(() => {
        fitToScreen();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [bitmap, fitToScreen]);

  const zoomBy = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const c = canvasRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const px = clientX !== undefined ? clientX - rect.left : rect.width / 2;
      const py = clientY !== undefined ? clientY - rect.top : rect.height / 2;
      const imgX = px / camera.scale + camera.x;
      const imgY = py / camera.scale + camera.y;
      const next = Math.max(0.05, Math.min(32, camera.scale * factor));
      setCamera({
        scale: next,
        x: imgX - px / next,
        y: imgY - py / next,
      });
    },
    [camera, setCamera],
  );

  const resetToActual = useCallback(() => {
    const c = canvasRef.current;
    if (!c || !bitmap) return;
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    const iw = bitmap.width;
    const ih = bitmap.height;
    setCamera({
      scale: 1,
      x: (iw - cw) / 2,
      y: (ih - ch) / 2,
    });
  }, [bitmap, setCamera]);

  useEffect(() => {
    let cancelled = false;
    if (!heatmap) {
      setHeatBmp(null);
      return;
    }
    const rgba = applyColormap(heatmap.gray, colormap, threshold, 255);
    const img = new ImageData(rgba as any, heatmap.width, heatmap.height);
    createImageBitmap(img).then((b) => {
      if (cancelled) b.close();
      else
        setHeatBmp((prev) => {
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
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      paint();
    });
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [paint]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => {
        paint();
      });
    });
    ro.observe(el);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
      ro.disconnect();
    };
  }, [paint]);

  const toImage = (e: { clientX: number; clientY: number }, targetCanvas?: HTMLCanvasElement) => {
    const canvas = targetCanvas || canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return { x: px / camera.scale + camera.x, y: py / camera.scale + camera.y };
  };

  return (
    <div
      className={cn(
        "group relative flex h-full min-h-0 min-w-0 flex-col border border-line bg-surface select-none",
        isSelected && "ring-1 ring-accent",
      )}
      onClick={onSelect}
    >
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-line bg-surface/90 px-2 py-1.5 backdrop-blur-sm sm:px-2.5 sm:py-1">
        <div className="flex items-center gap-1.5 overflow-hidden">
          <span className="truncate font-mono text-2xs font-semibold uppercase tracking-wider text-fg/90">
            {title}
          </span>
          {showOverlay && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOverlayOn(!overlayOn);
              }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro font-mono text-subtle transition-colors hover:bg-elevated hover:text-fg"
              title={overlayOn ? "Turn overlay off" : "Turn overlay on"}
            >
              {overlayOn ? <Eye className="size-3 text-accent" /> : <EyeOff className="size-3 text-muted" />}
              <span className="hidden sm:inline">{overlayOn ? "Overlay" : "Base"}</span>
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 font-mono text-2xs tabular-nums text-subtle">
          {heatmap ? (
            <span>
              μ {heatmap.stats.mean.toFixed(1)} <span className="hidden sm:inline">· p99 {heatmap.stats.p99.toFixed(1)}</span>
            </span>
          ) : (
            <span>source</span>
          )}
        </div>
      </div>

      {/* Canvas container */}
      <div ref={containerRef} className="relative min-h-36 w-full flex-1 min-h-0 overflow-hidden bg-bg">
        <canvas
          ref={canvasRef}
          className="heatmap-canvas absolute inset-0 block h-full w-full touch-none cursor-crosshair"
          onPointerDown={(e) => {
            const canvas = e.currentTarget;
            canvas.setPointerCapture(e.pointerId);
            activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (activePointers.current.size === 1) {
              const p = toImage(e, canvas);
              if (e.shiftKey || roiMode) {
                drag.current = { mode: "roi", x: p.x, y: p.y, cx: camera.x, cy: camera.y };
              } else {
                drag.current = { mode: "pan", x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };
              }
            } else if (activePointers.current.size === 2) {
              // Start 2-finger multi-touch pinch to zoom & pan
              const pts = Array.from(activePointers.current.values());
              const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
              const midClient = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
              const rect = canvas.getBoundingClientRect();
              const px = midClient.x - rect.left;
              const py = midClient.y - rect.top;
              const centerImg = {
                x: px / camera.scale + camera.x,
                y: py / camera.scale + camera.y,
              };
              pinchStart.current = {
                dist,
                scale: camera.scale,
                centerImg,
                centerClient: midClient,
              };
              drag.current = null;
            }
          }}
          onPointerMove={(e) => {
            const canvas = e.currentTarget;
            activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

            // Handle multi-touch pinch
            if (activePointers.current.size === 2 && pinchStart.current) {
              const pts = Array.from(activePointers.current.values());
              const curDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
              if (pinchStart.current.dist > 5) {
                const scaleFactor = curDist / pinchStart.current.dist;
                const newScale = Math.max(0.05, Math.min(32, pinchStart.current.scale * scaleFactor));
                const curMidClient = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
                const rect = canvas.getBoundingClientRect();
                const px = curMidClient.x - rect.left;
                const py = curMidClient.y - rect.top;
                setCamera({
                  scale: newScale,
                  x: pinchStart.current.centerImg.x - px / newScale,
                  y: pinchStart.current.centerImg.y - py / newScale,
                });
              }
              return;
            }

            // Handle single finger / mouse pan & ROI
            const p = toImage(e, canvas);
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
            activePointers.current.delete(e.pointerId);
            if (activePointers.current.size < 2) {
              pinchStart.current = null;
            }

            const d = drag.current;
            drag.current = null;
            if (d?.mode === "roi") {
              const p = toImage(e, e.currentTarget);
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
          onPointerCancel={(e) => {
            activePointers.current.delete(e.pointerId);
            if (activePointers.current.size < 2) pinchStart.current = null;
            drag.current = null;
          }}
          onWheel={(e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const imgX = px / camera.scale + camera.x;
            const imgY = py / camera.scale + camera.y;
            const next = Math.max(0.05, Math.min(32, camera.scale * (e.deltaY < 0 ? 1.15 : 0.88)));
            setCamera({
              scale: next,
              x: imgX - px / next,
              y: imgY - py / next,
            });
          }}
        />

        {/* Floating Mobile & PC Canvas Controls (Zoom In, Zoom Out, Fit, 1:1, ROI Toggle) */}
        <div className="pointer-events-none absolute bottom-2 right-2 z-20 flex items-center gap-1 rounded-md border border-line bg-surface/90 p-1 shadow-panel backdrop-blur-sm transition-opacity duration-150 sm:opacity-90 sm:hover:opacity-100">
          <button
            type="button"
            className="pointer-events-auto flex size-7 items-center justify-center rounded text-muted transition-colors hover:bg-elevated hover:text-fg active:scale-95"
            onClick={(e) => {
              e.stopPropagation();
              zoomBy(1.25);
            }}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn className="size-3.5" />
          </button>
          <button
            type="button"
            className="pointer-events-auto flex size-7 items-center justify-center rounded text-muted transition-colors hover:bg-elevated hover:text-fg active:scale-95"
            onClick={(e) => {
              e.stopPropagation();
              zoomBy(0.8);
            }}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut className="size-3.5" />
          </button>
          <button
            type="button"
            className="pointer-events-auto flex size-7 items-center justify-center rounded text-muted transition-colors hover:bg-elevated hover:text-fg active:scale-95"
            onClick={(e) => {
              e.stopPropagation();
              fitToScreen();
            }}
            title="Fit to view"
            aria-label="Fit to view"
          >
            <Maximize2 className="size-3.5" />
          </button>
          <button
            type="button"
            className="pointer-events-auto hidden px-1 font-mono text-micro text-subtle transition-colors hover:bg-elevated hover:text-fg sm:flex sm:items-center sm:rounded"
            onClick={(e) => {
              e.stopPropagation();
              resetToActual();
            }}
            title="Actual 1:1 size"
          >
            {(camera.scale * 100).toFixed(0)}%
          </button>
          {/* ROI draw toggle for phones & tablets that lack a physical Shift key */}
          <button
            type="button"
            className={cn(
              "pointer-events-auto flex size-7 items-center justify-center rounded transition-colors active:scale-95",
              roiMode
                ? "bg-accent/20 text-accent font-semibold"
                : "text-muted hover:bg-elevated hover:text-fg",
            )}
            onClick={(e) => {
              e.stopPropagation();
              setRoiMode(!roiMode);
            }}
            title={roiMode ? "Switch to Pan mode" : "Switch to Draw ROI mode"}
            aria-label="Toggle ROI draw mode"
          >
            {roiMode ? <Crosshair className="size-3.5 text-accent" /> : <Square className="size-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Workspace() {
  const original = useLab((s) => s.original);
  const maps = useLab((s) => s.maps);
  const viewMode = useLab((s) => s.viewMode);
  const setViewMode = useLab((s) => s.setViewMode);
  const active = useLab((s) => s.active);
  const setActive = useLab((s) => s.setActive);
  const evidence = useLab((s) => s.evidence);
  const cloneMatches = (maps.clone?.extra?.matches as CloneMatch[] | undefined) ?? undefined;

  const panels = useMemo(
    () =>
      [
        { id: "file" as const, title: "Original", bitmap: original, map: null, overlay: false },
        { id: "ela" as const, title: "ELA", bitmap: original, map: maps.ela, overlay: true },
        { id: "noise" as const, title: "Local noise", bitmap: original, map: maps.noise, overlay: true },
        { id: "edge" as const, title: "Edge", bitmap: original, map: maps.edge, overlay: true },
        { id: "sharpness" as const, title: "Sharpness", bitmap: original, map: maps.sharpness, overlay: true },
        {
          id: "dct" as const,
          title: "DCT / frequency",
          bitmap: original,
          map: maps.dct ?? maps.frequency,
          overlay: true,
        },
        { id: "resampling" as const, title: "Resampling", bitmap: original, map: maps.resampling, overlay: true },
        {
          id: "clone" as const,
          title: "Copy-move",
          bitmap: original,
          map: maps.clone,
          overlay: true,
          matches: cloneMatches,
        },
      ] as const,
    [original, maps, cloneMatches],
  );

  if (!original) return null;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* Quick module selection pill bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-line bg-surface/60 px-2 py-1">
        <div className="flex items-center gap-1 overflow-x-auto lab-scroll">
          <span className="hidden font-mono text-2xs uppercase tracking-wider text-subtle lg:inline">
            Layers:
          </span>
          {panels.map((p) => {
            const Icon = MODULE_ICONS[p.id] || Scan;
            const isCurrent = active === p.id;
            const ev = evidence.find((e) => e.module === p.id);
            const has = Boolean(maps[p.id as ModuleId]);

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActive(p.id as ModuleId);
                  if (viewMode === "single") {
                    // stay single
                  } else if (p.id !== "file" && viewMode !== "multi") {
                    setViewMode("dual");
                  }
                }}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 font-mono text-2xs transition-colors",
                  isCurrent
                    ? "bg-elevated text-accent font-semibold shadow-xs"
                    : "text-muted hover:bg-elevated/70 hover:text-fg",
                )}
              >
                <Icon className="size-3" />
                <span>{p.title}</span>
                {ev ? (
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      ev.strength === "inconsistency"
                        ? "bg-danger"
                        : ev.strength === "indicator"
                          ? "bg-warn"
                          : has
                            ? "bg-ok"
                            : "bg-subtle",
                    )}
                  />
                ) : null}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => setActive("metadata")}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-1 font-mono text-2xs transition-colors",
              active === "metadata"
                ? "bg-elevated text-accent font-semibold shadow-xs"
                : "text-muted hover:bg-elevated/70 hover:text-fg",
            )}
            title="Inspect full EXIF & metadata tags"
          >
            <CameraIcon className="size-3" />
            <span>EXIF Data</span>
          </button>
        </div>

        {viewMode !== "multi" && (
          <button
            type="button"
            onClick={() => {
              if (active === "metadata") setActive("ela");
              setViewMode("multi");
            }}
            className="ml-2 inline-flex shrink-0 items-center gap-1.5 rounded border border-line bg-surface px-2 py-1 font-mono text-2xs text-muted hover:bg-elevated hover:text-accent transition-colors"
            title="Switch to all 8 panels grid view"
          >
            <LayoutGrid className="size-3 text-accent" />
            <span className="hidden sm:inline">All 8 panels</span>
            <span className="sm:hidden">Grid</span>
          </button>
        )}
      </div>

      {/* Main viewer stage */}
      <div className="relative min-h-0 flex-1">
        {active === "metadata" ? (
          <ExifPanel />
        ) : (
          <>
            {viewMode === "single" && (
              <div className="h-full min-h-0">
                {(() => {
                  const focused = panels.find((p) => p.id === active) ?? panels[1];
                  return (
                    <PanelCanvas
                      title={focused.title}
                      bitmap={original}
                      heatmap={focused.map}
                      showOverlay={focused.overlay}
                      matches={"matches" in focused ? focused.matches : undefined}
                    />
                  );
                })()}
              </div>
            )}

            {viewMode === "dual" && (
              <div className="grid h-full min-h-0 grid-cols-1 gap-px bg-line md:grid-cols-2">
                <div className="flex h-1/2 min-h-40 flex-col md:h-full">
                  <PanelCanvas title="Original" bitmap={original} showOverlay={false} />
                </div>
                <div className="flex h-1/2 min-h-40 flex-col md:h-full">
                  {(() => {
                    const focused = panels.find((p) => p.id === active && p.id !== "file") ?? panels[1];
                    return (
                      <PanelCanvas
                        title={focused.title}
                        bitmap={original}
                        heatmap={focused.map}
                        showOverlay
                        matches={"matches" in focused ? focused.matches : undefined}
                      />
                    );
                  })()}
                </div>
              </div>
            )}

            {viewMode === "multi" && (
              <div className="grid min-h-full grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:h-full xl:grid-cols-4 xl:grid-rows-2">
                {panels.map((p) => (
                  <div
                    key={p.id}
                    className="flex min-h-52 flex-col sm:min-h-44"
                    onDoubleClick={() => {
                      setActive(p.id === "file" ? "ela" : (p.id as ModuleId));
                      setViewMode("dual");
                    }}
                  >
                    <PanelCanvas
                      title={p.title}
                      bitmap={p.bitmap}
                      heatmap={p.map}
                      showOverlay={p.overlay}
                      matches={"matches" in p ? p.matches : undefined}
                      isSelected={active === p.id}
                      onSelect={() => setActive(p.id as ModuleId)}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
