import {
  Activity,
  AlertOctagon,
  Aperture,
  Box,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileSearch,
  Fingerprint,
  FolderOpen,
  Grid2x2,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Maximize2,
  Menu,
  Minimize2,
  Scan,
  Square,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Workspace } from "@/components/lab/viewers";
import { ExifPanel } from "@/components/lab/exif-panel";
import { applyColormap, histogram256 } from "@/lib/forensic/colormap";
import { downloadBlob, reportCsv, reportHtml, reportJson, reportPdf } from "@/lib/forensic/report";
import { fmt, fmtBytes } from "@/lib/forensic/stats";
import { MODULES, type ColormapName, type ModuleId, type ViewMode } from "@/lib/forensic/types";
import { useLab } from "@/store/lab-store";
import { cn } from "@/lib/utils";

const ICONS: Partial<Record<ModuleId, typeof FileSearch>> = {
  file: FolderOpen,
  metadata: FileSearch,
  jpeg: ImageIcon,
  ela: Aperture,
  noise: Waves,
  dct: Grid2x2,
  frequency: Activity,
  resampling: Scan,
  clone: Copy,
  edge: Box,
  sharpness: Layers,
  color: Aperture,
  thumbnail: ImageIcon,
  cfa: Fingerprint,
  prnu: Fingerprint,
};

function strengthTone(s: string): "muted" | "ok" | "warn" | "danger" | "accent" {
  if (s === "inconsistency") return "danger";
  if (s === "indicator") return "warn";
  if (s === "weak") return "accent";
  if (s === "experimental" || s === "insufficient") return "muted";
  return "ok";
}

export function Workstation() {
  const init = useLab((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-bg text-fg">
        <Header />
        <div className="flex min-h-0 flex-1">
          <DesktopNav />
          <MobileNav />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <MainStage />
            <BottomDock />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

function Header() {
  const rec = useLab((s) => s.caseRecord);
  const engine = useLab((s) => s.engine);
  const engineVersion = useLab((s) => s.engineVersion);
  const gpu = useLab((s) => s.gpu);
  const progress = useLab((s) => s.progress);
  const loadFile = useLab((s) => s.loadFile);
  const loadDemo = useLab((s) => s.loadDemo);
  const setNavOpen = useLab((s) => s.setNavOpen);
  const inputRef = useRef<HTMLInputElement>(null);
  const viewMode = useLab((s) => s.viewMode);
  const setViewMode = useLab((s) => s.setViewMode);

  return (
    <header className="relative flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 md:px-3">
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        onClick={() => setNavOpen(true)}
        aria-label="Open modules"
      >
        <Menu className="size-4" />
      </Button>
      <div className="flex items-baseline gap-1.5 sm:gap-2">
        <span className="text-sm font-semibold tracking-tight">Tracebench</span>
        <span className="hidden font-mono text-2xs uppercase tracking-widest text-subtle md:inline">
          Forensic laboratory
        </span>
      </div>
      <Separator vertical className="mx-1 hidden h-5 md:block" />
      <span className="hidden font-mono text-micro tabular-nums text-muted lg:inline">
        {rec ? rec.caseId : "NO CASE"}
      </span>
      {rec?.synthetic ? (
        <Badge tone="warn" className="shrink-0 font-mono text-micro uppercase tracking-wider">
          synthetic test
        </Badge>
      ) : null}
      <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/tiff,.jpg,.jpeg,.png,.webp,.tif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = "";
          }}
        />
        {/* Open button is always accessible on mobile, tablet, and PC */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5"
          title="Open image file"
          aria-label="Open image file"
        >
          <FolderOpen className="size-3.5 shrink-0" />
          <span className="hidden sm:inline">Open</span>
        </Button>
        <Button variant="subtle" size="sm" onClick={loadDemo}>
          <span className="hidden sm:inline">Demo case</span>
          <span className="sm:hidden">Demo</span>
        </Button>
        <ViewToggle value={viewMode} onChange={setViewMode} />
        <Badge tone={engine === "wasm" ? "accent" : "muted"} className="hidden xl:inline-flex">
          {engine} {engineVersion}
        </Badge>
        <Badge tone={gpu ? "ok" : "muted"} className="hidden lg:inline-flex">
          {gpu ? "webgpu" : "cpu"}
        </Badge>
      </div>
      {progress ? (
        <div className="absolute inset-x-0 bottom-0">
          <Progress value={progress.pct} />
        </div>
      ) : null}
    </header>
  );
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  const items: { id: ViewMode; icon: typeof LayoutGrid; label: string }[] = [
    { id: "multi", icon: LayoutGrid, label: "Multi-panel (all 8 layers)" },
    { id: "dual", icon: Square, label: "Dual view (compare side-by-side)" },
    { id: "single", icon: ImageIcon, label: "Single view (focused layer)" },
  ];
  return (
    <div className="flex items-center rounded-sm border border-line bg-surface">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <Tooltip key={it.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={it.label}
                onClick={() => onChange(it.id)}
                className={cn(
                  "grid size-7 place-items-center text-muted transition-colors hover:text-fg",
                  value === it.id && "bg-elevated text-accent font-semibold",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{it.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

function DesktopNav() {
  return (
    <nav className="hidden w-14 shrink-0 flex-col border-r border-line bg-surface md:flex lg:w-44 transition-all duration-200">
      <div className="hidden px-3 py-2 font-mono text-2xs uppercase tracking-widest text-subtle lg:block">Analysis</div>
      <div className="block px-1 py-2 text-center font-mono text-3xs uppercase tracking-widest text-subtle lg:hidden">Anls</div>
      <ScrollArea className="flex-1">
        <ModuleList />
      </ScrollArea>
    </nav>
  );
}

function MobileNav() {
  const open = useLab((s) => s.navOpen);
  const setNavOpen = useLab((s) => s.setNavOpen);
  const viewMode = useLab((s) => s.viewMode);
  const setViewMode = useLab((s) => s.setViewMode);
  const loadDemo = useLab((s) => s.loadDemo);
  const loadFile = useLab((s) => s.loadFile);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-bg/80 backdrop-blur-xs"
        aria-label="Close"
        onClick={() => setNavOpen(false)}
      />
      <div className="relative flex h-full w-72 max-w-[85vw] flex-col bg-surface p-3 shadow-panel">
        <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-fg">Tracebench</span>
            <span className="font-mono text-2xs uppercase tracking-widest text-subtle">Modules</span>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => setNavOpen(false)} aria-label="Close modules">
            <X className="size-4" />
          </Button>
        </div>

        {/* Quick action shortcuts on mobile/tablet */}
        <div className="mb-3 flex gap-1.5">
          <input
            ref={mobileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/tiff,.jpg,.jpeg,.png,.webp,.tif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
              e.target.value = "";
              setNavOpen(false);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="flex-1 text-2xs"
            onClick={() => mobileInputRef.current?.click()}
          >
            <FolderOpen className="size-3.5" />
            <span>Open image</span>
          </Button>
          <Button
            variant="subtle"
            size="sm"
            className="flex-1 text-2xs"
            onClick={() => {
              loadDemo();
              setNavOpen(false);
            }}
          >
            <span>Demo case</span>
          </Button>
        </div>

        {/* Layout mode buttons */}
        <div className="mb-3 rounded-sm border border-line bg-elevated/40 p-2">
          <span className="mb-1.5 block font-mono text-micro uppercase tracking-wider text-muted">
            Layout Mode
          </span>
          <div className="grid grid-cols-3 gap-1">
            <button
              type="button"
              onClick={() => {
                setViewMode("multi");
                setNavOpen(false);
              }}
              className={cn(
                "flex flex-col items-center gap-1 rounded py-1.5 text-2xs font-medium transition-colors",
                viewMode === "multi"
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:bg-elevated",
              )}
            >
              <LayoutGrid className="size-4" />
              <span>Multi</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("dual");
                setNavOpen(false);
              }}
              className={cn(
                "flex flex-col items-center gap-1 rounded py-1.5 text-2xs font-medium transition-colors",
                viewMode === "dual"
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:bg-elevated",
              )}
            >
              <Square className="size-4" />
              <span>Dual</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setViewMode("single");
                setNavOpen(false);
              }}
              className={cn(
                "flex flex-col items-center gap-1 rounded py-1.5 text-2xs font-medium transition-colors",
                viewMode === "single"
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:bg-elevated",
              )}
            >
              <ImageIcon className="size-4" />
              <span>Single</span>
            </button>
          </div>
        </div>

        {/* Module list */}
        <div className="flex-1 overflow-y-auto lab-scroll">
          <ModuleList isMobile />
        </div>
      </div>
    </div>
  );
}

function ModuleList({ isMobile = false }: { isMobile?: boolean }) {
  const active = useLab((s) => s.active);
  const setActive = useLab((s) => s.setActive);
  const maps = useLab((s) => s.maps);
  const evidence = useLab((s) => s.evidence);
  const setViewMode = useLab((s) => s.setViewMode);
  return (
    <ul className="flex flex-col pb-4">
      {MODULES.map((m) => {
        const Icon = ICONS[m.id] ?? Scan;
        const ev = evidence.find((e) => e.module === m.id);
        const has = Boolean(maps[m.id]);
        return (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => {
                setActive(m.id);
                if (m.id !== "file" && m.id !== "metadata" && m.id !== "jpeg") setViewMode("dual");
              }}
              className={cn(
                "flex h-10 w-full items-center gap-2.5 px-3 text-left text-sm transition-colors active:bg-elevated cursor-pointer",
                isMobile ? "justify-start" : "justify-center lg:justify-start",
                active === m.id ? "bg-elevated text-fg font-medium" : "text-muted hover:bg-elevated/70 hover:text-fg",
              )}
              title={m.label}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className={cn("flex-1 truncate", isMobile ? "inline" : "hidden lg:inline")}>
                {m.label}
              </span>
              {ev ? (
                <span
                  className={cn(
                    "size-2 rounded-full shrink-0",
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
          </li>
        );
      })}
    </ul>
  );
}

function MainStage() {
  const original = useLab((s) => s.original);
  const error = useLab((s) => s.error);
  const progress = useLab((s) => s.progress);
  const loadFile = useLab((s) => s.loadFile);

  if (!original) {
    return (
      <EmptyState
        error={error}
        busy={Boolean(progress)}
        onFiles={(files) => {
          const f = files[0];
          if (f) void loadFile(f);
        }}
      />
    );
  }
  return (
    <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden lab-scroll bg-bg">
      {error && (
        <div className="absolute top-3 left-3 right-3 z-30 flex items-start gap-3 rounded border border-danger/60 bg-danger/10 p-3 shadow-panel backdrop-blur-md">
          <AlertOctagon className="size-5 shrink-0 text-danger mt-0.5" />
          <div className="flex-1 min-w-0">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-danger">Forensic Engine Notice</h4>
            <p className="mt-1 text-xs leading-relaxed text-fg/90 break-words">{error}</p>
          </div>
          <button
            type="button"
            onClick={() => useLab.setState({ error: null })}
            className="rounded p-1 text-muted hover:bg-danger/15 hover:text-danger transition-colors cursor-pointer"
            aria-label="Dismiss message"
          >
            <X className="size-4" />
          </button>
        </div>
      )}
      <Workspace />
    </div>
  );
}

function EmptyState({
  error,
  busy,
  onFiles,
}: {
  error: string | null;
  busy: boolean;
  onFiles: (files: File[]) => void;
}) {
  const loadDemo = useLab((s) => s.loadDemo);
  const engine = useLab((s) => s.engine);
  const ready = useLab((s) => s.ready);
  return (
    <div
      className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-line bg-surface p-5 shadow-panel sm:p-6 md:p-8">
        <p className="font-mono text-2xs uppercase tracking-widest text-accent">Local forensic laboratory</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
          Open an image to start analysis
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          All decoding and detectors run inside this browser. Works smoothly across phone, tablet, and PC.
          The original bytes are hashed and never sent to a cloud server.
        </p>
        <div className="mt-5 flex flex-col sm:flex-row flex-wrap gap-2">
          <Button onClick={loadDemo} disabled={busy} className="h-10 sm:h-9">
            Load demonstration case
          </Button>
          <label className="cursor-pointer">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) onFiles([...e.target.files]);
              }}
            />
            <span className="flex h-10 sm:h-9 items-center justify-center rounded-sm border border-line px-3 text-sm hover:bg-elevated transition-colors">
              Choose file from device
            </span>
          </label>
        </div>
        <p className="mt-4 font-mono text-micro text-subtle">
          Engine {ready ? engine : "starting…"} · JPEG ELA · noise · DCT · clone · EXIF · SHA-256/512
        </p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {busy ? <p className="mt-3 text-sm text-muted">Processing image…</p> : null}
      </div>
    </div>
  );
}

function BottomDock() {
  const tab = useLab((s) => s.bottomTab);
  const setTab = useLab((s) => s.setBottomTab);
  const setActive = useLab((s) => s.setActive);
  const original = useLab((s) => s.original);
  const [collapsed, setCollapsed] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [customHeight, setCustomHeight] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const dockRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ y: number; height: number; didMove: boolean }>({
    y: 0,
    height: 0,
    didMove: false,
  });

  const handlePointerDown = (e: React.PointerEvent) => {
    const currentHeight = dockRef.current?.getBoundingClientRect().height ?? 240;
    dragStartRef.current = { y: e.clientY, height: currentHeight, didMove: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const delta = dragStartRef.current.y - e.clientY;
    if (Math.abs(delta) > 5) {
      dragStartRef.current.didMove = true;
    }
    const next = dragStartRef.current.height + delta;
    if (next < 65) {
      setCollapsed(true);
      setCustomHeight(null);
    } else {
      setCollapsed(false);
      setMaximized(false);
      setCustomHeight(Math.min(window.innerHeight * 0.88, Math.max(80, next)));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture might have ended or is not supported
    }
  };

  const handleHandleClick = () => {
    if (!dragStartRef.current.didMove) {
      setCollapsed((c) => !c);
      setCustomHeight(null);
    }
  };

  const tabs = [
    { id: "evidence" as const, label: "Evidence" },
    { id: "exif" as const, label: "EXIF Data" },
    { id: "pixel" as const, label: "Pixel" },
    { id: "histogram" as const, label: "Histogram" },
    { id: "params" as const, label: "Parameters" },
    { id: "structure" as const, label: "Structure" },
    { id: "methods" as const, label: "Methods" },
  ];

  if (!original) return null;

  return (
    <div
      ref={dockRef}
      style={
        !collapsed && customHeight && !maximized
          ? { height: `${customHeight}px` }
          : undefined
      }
      className={cn(
        "relative z-20 flex shrink-0 flex-col border-t border-line bg-surface transition-[height] duration-150",
        collapsed
          ? "h-12"
          : maximized
            ? "h-[min(88vh,46rem)]"
            : customHeight
              ? ""
              : tab === "exif"
                ? "h-[min(65vh,30rem)]"
                : "h-[min(45vh,20rem)] sm:h-56",
      )}
    >
      {/* Top Touch & Mouse Draggable Handle Bar */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleHandleClick}
        className={cn(
          "group flex h-3.5 shrink-0 items-center justify-center cursor-row-resize bg-surface/95 hover:bg-elevated transition-colors border-b border-line/40 touch-none select-none",
          isDragging && "bg-elevated/90",
        )}
        title="Pull down to collapse, pull up to expand, or tap to toggle"
      >
        <div className="h-1 w-12 rounded-full bg-line-hover group-hover:bg-accent transition-colors" />
      </div>

      {/* Tab Navigation + Permanently Pinned Right Actions */}
      <div className="flex h-9 shrink-0 items-center border-b border-line bg-surface">
        {/* Left: Horizontally scrollable tabs */}
        <div className="flex flex-1 items-center gap-0 overflow-x-auto min-w-0 lab-scroll px-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                if (tab === t.id && !collapsed) {
                  setCollapsed(true);
                } else {
                  setTab(t.id);
                  setCollapsed(false);
                }
              }}
              className={cn(
                "h-9 shrink-0 px-2.5 sm:px-3 font-mono text-2xs uppercase tracking-wider sm:tracking-widest transition-colors whitespace-nowrap cursor-pointer",
                tab === t.id && !collapsed
                  ? "border-b-2 border-accent text-fg font-semibold"
                  : "text-muted hover:text-fg",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Right: Pinned controls (Never pushed off-screen!) */}
        <div className="flex shrink-0 items-center gap-1 px-1.5 border-l border-line/60 bg-surface shadow-[-4px_0_10px_rgba(0,0,0,0.15)]">
          {tab === "exif" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActive("metadata")}
              className="hidden h-7 gap-1 px-2 font-mono text-3xs text-accent hover:text-fg sm:inline-flex"
              title="Open full EXIF inspector on main stage"
            >
              <span>Main Stage</span>
              <Layers className="size-3" />
            </Button>
          )}

          <ExportMenu />

          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              if (collapsed) {
                setCollapsed(false);
                setMaximized(false);
              } else {
                setMaximized(!maximized);
              }
              setCustomHeight(null);
            }}
            aria-label={maximized ? "Restore dock size" : "Maximize dock"}
            className="text-muted hover:text-fg"
            title={maximized ? "Restore dock size" : "Maximize dock"}
          >
            {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </Button>

          {/* Dedicated Down / Up button */}
          <Button
            variant={collapsed ? "subtle" : "ghost"}
            size="sm"
            onClick={() => {
              setCollapsed(!collapsed);
              if (collapsed) setMaximized(false);
              setCustomHeight(null);
            }}
            aria-label={collapsed ? "Expand dock up" : "Collapse dock down"}
            className={cn(
              "h-7 gap-1 px-2 font-mono text-3xs font-medium transition-colors cursor-pointer",
              collapsed
                ? "text-accent bg-accent/15 hover:bg-accent/25"
                : "text-muted hover:text-fg hover:bg-elevated",
            )}
            title={collapsed ? "Expand dock up" : "Collapse dock down"}
          >
            {collapsed ? (
              <>
                <ChevronUp className="size-3.5 text-accent" />
                <span>Up</span>
              </>
            ) : (
              <>
                <ChevronDown className="size-3.5" />
                <span>Down</span>
              </>
            )}
          </Button>
        </div>
      </div>
      {!collapsed && (
        <div
          className={cn(
            "min-h-0 flex-1",
            tab === "exif" ? "flex flex-col overflow-hidden" : "overflow-auto lab-scroll p-3",
          )}
        >
          {tab === "evidence" && <EvidenceTab />}
          {tab === "exif" && <ExifPanel isDocked={true} />}
          {tab === "pixel" && <PixelTab />}
          {tab === "histogram" && <HistogramTab />}
          {tab === "params" && <ParamsTab />}
          {tab === "structure" && <StructureTab />}
          {tab === "methods" && <MethodsTab />}
        </div>
      )}
    </div>
  );
}

function EvidenceTab() {
  const evidence = useLab((s) => s.evidence);
  const regions = useLab((s) => s.regions);
  const setCamera = useLab((s) => s.setCamera);
  if (!evidence.length) return <p className="text-sm text-muted">No measurements yet.</p>;
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_14rem]">
      <div className="grid gap-2 sm:grid-cols-2">
        {evidence.map((e) => (
          <article key={e.detector} className="rounded-md border border-line bg-elevated p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{e.detector}</h3>
              <Badge tone={strengthTone(e.strength)}>{e.strength}</Badge>
            </div>
            <p className="mt-1 text-micro text-muted">{e.observation}</p>
            <p className="mt-1 font-mono text-2xs tabular-nums text-subtle">{e.measurement}</p>
            <p className="mt-1 text-2xs text-subtle">{e.limitations[0]}</p>
          </article>
        ))}
      </div>
      <aside>
        <h3 className="font-mono text-2xs uppercase tracking-widest text-subtle">Auto regions</h3>
        <p className="mt-1 text-2xs text-subtle">Statistical hotspots from ELA/noise — tap to pan view.</p>
        <ul className="mt-2 space-y-1">
          {regions.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex min-h-8 w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-micro hover:bg-panel active:bg-elevated transition-colors"
                onClick={() => setCamera({ x: r.x - 20, y: r.y - 20, scale: 2 })}
              >
                <span>{r.label}</span>
                <span className="font-mono tabular-nums text-subtle">{r.score.toFixed(0)}</span>
              </button>
            </li>
          ))}
          {!regions.length ? <li className="text-micro text-subtle">None at current threshold</li> : null}
        </ul>
      </aside>
    </div>
  );
}

function PixelTab() {
  const pixel = useLab((s) => s.pixel);
  if (!pixel) {
    return (
      <p className="text-sm text-muted">
        Move pointer or tap on image to inspect pixel coordinates and forensics.
      </p>
    );
  }
  const rows: [string, string][] = [
    ["X", String(pixel.x)],
    ["Y", String(pixel.y)],
    ["R", String(pixel.r)],
    ["G", String(pixel.g)],
    ["B", String(pixel.b)],
    ["A", String(pixel.a)],
    ["Luma", fmt(pixel.luma, 2)],
    ["ELA", pixel.ela == null ? "—" : String(pixel.ela)],
    ["Noise", pixel.noise == null ? "—" : String(pixel.noise)],
    ["Local var", pixel.localVar == null ? "—" : fmt(pixel.localVar, 2)],
    ["Gradient", pixel.gradient == null ? "—" : fmt(pixel.gradient, 2)],
  ];
  return (
    <dl className="grid max-w-xl grid-cols-2 gap-x-4 gap-y-1 font-mono text-micro tabular-nums sm:grid-cols-4 sm:gap-x-6">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-2 border-b border-line/70 py-1">
          <dt className="text-subtle">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function HistogramTab() {
  const maps = useLab((s) => s.maps);
  const active = useLab((s) => s.active);
  const map = maps[active] ?? maps.ela ?? maps.noise;
  const hist = useMemo(() => (map ? histogram256(map.gray) : null), [map]);
  if (!hist) return <p className="text-sm text-muted">Run a detector to plot its residual histogram.</p>;
  const max = Math.max(...hist, 1);
  return (
    <div>
      <p className="mb-2 font-mono text-2xs uppercase tracking-widest text-subtle">
        {map?.module} residual histogram (256 bins)
      </p>
      <div className="flex h-24 sm:h-28 items-end gap-px rounded-sm border border-line bg-bg px-1 py-1">
        {Array.from(hist).map((v, i) => (
          <div
            key={i}
            className="flex-1 bg-accent/80"
            style={{ height: `${(v / max) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}

function ParamsTab() {
  const params = useLab((s) => s.params);
  const setParams = useLab((s) => s.setParams);
  const rerun = useLab((s) => s.rerun);
  const runSuite = useLab((s) => s.runSuite);
  const overlay = useLab((s) => s.overlay);
  const setOverlay = useLab((s) => s.setOverlay);
  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={`ELA quality ${params.elaQuality}`}>
        <Slider
          min={40}
          max={100}
          step={1}
          value={[params.elaQuality]}
          onValueChange={([v]) => setParams({ elaQuality: v ?? 90 })}
        />
      </Field>
      <Field label={`ELA gain ${params.elaGain}`}>
        <Slider
          min={1}
          max={40}
          step={1}
          value={[params.elaGain]}
          onValueChange={([v]) => setParams({ elaGain: v ?? 12 })}
        />
      </Field>
      <Field label={`Percentile clip ${params.percentile}`}>
        <Slider
          min={80}
          max={100}
          step={1}
          value={[params.percentile]}
          onValueChange={([v]) => setParams({ percentile: v ?? 98, elaPercentile: v ?? 98 })}
        />
      </Field>
      <Field label={`Noise window ${params.noiseWindow}`}>
        <Slider
          min={3}
          max={15}
          step={2}
          value={[params.noiseWindow]}
          onValueChange={([v]) => setParams({ noiseWindow: v ?? 7 })}
        />
      </Field>
      <Field label={`Clone block ${params.cloneBlock}`}>
        <Slider
          min={8}
          max={32}
          step={4}
          value={[params.cloneBlock]}
          onValueChange={([v]) => setParams({ cloneBlock: v ?? 16 })}
        />
      </Field>
      <Field label={`Overlay ${Math.round(params.overlayOpacity * 100)}%`}>
        <Slider
          min={0}
          max={1}
          step={0.02}
          value={[params.overlayOpacity]}
          onValueChange={([v]) => setParams({ overlayOpacity: v ?? 0.72 })}
        />
      </Field>
      <Field label="Colormap">
        <div className="flex flex-wrap gap-1">
          {(["inferno", "magma", "viridis", "turbo", "gray", "steel"] as ColormapName[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setParams({ colormap: c })}
              className={cn(
                "rounded-sm border px-2 py-1 font-mono text-2xs uppercase transition-colors",
                params.colormap === c ? "border-accent text-accent bg-accent/10" : "border-line text-muted hover:text-fg",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </Field>
      <div className="flex flex-wrap items-end gap-2 pt-1 sm:pt-0">
        <Button size="sm" variant="outline" onClick={() => setOverlay(!overlay)}>
          Overlay {overlay ? "on" : "off"}
        </Button>
        <Button size="sm" variant="subtle" onClick={() => rerun("ela")}>
          Re-run ELA
        </Button>
        <Button size="sm" onClick={runSuite}>
          Re-run suite
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-2xs uppercase tracking-widest text-subtle">{label}</span>
      {children}
    </label>
  );
}

function StructureTab() {
  const rec = useLab((s) => s.caseRecord);
  const media = useLab((s) => s.media);
  const thumbnail = useLab((s) => s.thumbnail);
  const setTab = useLab((s) => s.setBottomTab);
  if (!rec || !media) return null;
  const jpeg = media.jpeg;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section>
        <h3 className="font-mono text-2xs uppercase tracking-widest text-subtle">File</h3>
        <KeyVals
          rows={[
            ["Name", rec.originalFilename],
            ["Size", fmtBytes(rec.size)],
            ["Raster", `${rec.width}×${rec.height}`],
            ["Format", rec.format],
            ["SHA-256", rec.sha256],
            ["SHA-512", rec.sha512],
            ["Evidence", rec.evidenceId],
          ]}
        />
      </section>
      <section>
        <h3 className="font-mono text-2xs uppercase tracking-widest text-subtle">JPEG</h3>
        {jpeg?.isJpeg ? (
          <KeyVals
            rows={[
              ["Coding", jpeg.progressive ? "progressive" : "baseline"],
              ["Chroma", jpeg.chromaSubsampling],
              ["Components", String(jpeg.components)],
              ["SOF", `${jpeg.width}×${jpeg.height}`],
              ["Q tables", String(jpeg.quantizationTables.length)],
              ["Est. quality", jpeg.estimatedQuality?.toFixed(1) ?? "—"],
              ["Markers", jpeg.markers.map((m) => m.name).join(" · ")],
            ]}
          />
        ) : (
          <p className="text-sm text-muted">Not a JPEG bitstream.</p>
        )}
        {jpeg?.quantizationTables[0] ? (
          <div className="mt-2 overflow-x-auto lab-scroll pb-1">
            <div className="min-w-[240px] grid grid-cols-8 gap-px font-mono text-2xs tabular-nums">
              {jpeg.quantizationTables[0].values.map((v, i) => (
                <div key={i} className="bg-panel px-1 py-0.5 text-center">
                  {v}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      <section className="lg:col-span-2">
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-2xs uppercase tracking-widest text-subtle">
            Extracted Metadata ({media.fields.length} tags)
          </h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTab("exif")}
            className="h-6 gap-1 font-mono text-2xs text-accent hover:text-fg"
          >
            Open Dedicated EXIF Panel →
          </Button>
        </div>
        <div className="mt-2 max-h-40 overflow-auto lab-scroll">
          <table className="w-full text-micro">
            <tbody>
              {media.fields.map((f, i) => (
                <tr key={`${f.key}-${i}`} className="border-b border-line/60">
                  <td className="w-36 sm:w-48 py-1 font-mono text-subtle break-all">{f.group}.{f.key}</td>
                  <td className="py-1 break-all">{f.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {thumbnail ? <ThumbnailPreview bitmap={thumbnail} /> : null}
      </section>
    </div>
  );
}

function KeyVals({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-2 space-y-1">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[5.5rem_1fr] sm:grid-cols-[7rem_1fr] gap-2 text-micro">
          <dt className="text-subtle">{k}</dt>
          <dd className="break-all font-mono tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function MethodsTab() {
  return (
    <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-muted">
      <p>
        Tracebench reports <strong className="font-medium text-fg">observations and statistics</strong>, never
        a fake/real score. Every map is a derived buffer from the immutable original.
      </p>
      <ul className="list-disc space-y-1 pl-4 text-xs sm:text-sm">
        <li>ELA — JPEG re-encode at a chosen quality; absolute residual; percentile scaling.</li>
        <li>Noise — high-pass / local variance via integral images / Laplacian / median residual.</li>
        <li>DCT — 8×8 DCT-II band energy and blocking discontinuity.</li>
        <li>Double JPEG — DCT coefficient histogram periodicity (not proof of editing).</li>
        <li>Resampling — second-derivative even/odd lag energy (Gallagher-style).</li>
        <li>Copy-move — overlapping block descriptors, neighbor search, displacement clustering.</li>
        <li>CFA / PRNU — experimental; PRNU has no reference fingerprint enrolled.</li>
      </ul>
      <p className="text-xs sm:text-sm">
        Semantic region names (face, hands, …) are <strong className="text-fg">not invented</strong>. Auto
        regions are residual hotspots labeled Region 01…. Tap or click any region to inspect.
      </p>
    </div>
  );
}

function ThumbnailPreview({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext("2d");
    ctx?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  return (
    <div className="mt-3">
      <p className="font-mono text-2xs uppercase tracking-widest text-subtle">Embedded thumbnail</p>
      <canvas
        ref={ref}
        className="mt-1 max-h-24 w-auto outline outline-1 -outline-offset-1 outline-fg/10"
      />
    </div>
  );
}

function ExportMenu() {
  const rec = useLab((s) => s.caseRecord);
  const media = useLab((s) => s.media);
  const evidence = useLab((s) => s.evidence);
  const maps = useLab((s) => s.maps);
  const params = useLab((s) => s.params);
  const custody = useLab((s) => s.custody);
  const engine = useLab((s) => s.engine);
  const engineVersion = useLab((s) => s.engineVersion);
  const fileBase64 = useLab((s) => s.fileBase64);
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onDocClick);
      return () => document.removeEventListener("mousedown", onDocClick);
    }
  }, [open]);

  if (!rec || !media) return null;

  const getReportModel = async () => {
    // 100% reliable original image base64 directly from Zustand state
    const originalImageBase64 = fileBase64 || undefined;

    const analysisImages: Array<{ title: string; base64: string }> = [];
    
    // Generate high-quality forensic analysis heatmap images directly from our state
    if (maps) {
      for (const [id, m] of Object.entries(maps)) {
        if (m) {
          try {
            const rgba = applyColormap(m.gray, params.colormap, params.threshold, 255);
            const canvas = document.createElement("canvas");
            canvas.width = m.width;
            canvas.height = m.height;
            const ctx = canvas.getContext("2d");
            if (ctx) {
              const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer), m.width, m.height);
              ctx.putImageData(imgData, 0, 0);
              analysisImages.push({
                title: id.toUpperCase(),
                base64: canvas.toDataURL("image/png"),
              });
            }
          } catch (e) {
            console.error(`Failed to generate heatmap base64 for ${id}`, e);
          }
        }
      }
    }

    return {
      caseRecord: rec,
      media,
      evidence,
      maps: Object.fromEntries(
        Object.entries(maps)
          .filter(([_, v]) => v != null)
          .map(([k, v]) => [k, { stats: v!.stats, extra: v!.extra, note: v!.note }]),
      ),
      params,
      custody,
      engine: `${engine}/${engineVersion}`,
      originalImageBase64,
      analysisImages,
    };
  };

  const handleDownload = async (format: "json" | "csv" | "html" | "pdf") => {
    setExporting(true);
    try {
      const fullModel = await getReportModel();
      if (format === "json") {
        downloadBlob(`${rec.caseId}.json`, "application/json", reportJson(fullModel));
      } else if (format === "csv") {
        downloadBlob(`${rec.caseId}.csv`, "text/csv", reportCsv(fullModel));
      } else if (format === "html") {
        downloadBlob(`${rec.caseId}.html`, "text/html", reportHtml(fullModel));
      } else if (format === "pdf") {
        downloadBlob(`${rec.caseId}.pdf`, "application/pdf", reportPdf(fullModel) as BlobPart);
      }
    } catch (err) {
      console.error("Export failed", err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex items-center">
      {/* Desktop direct buttons */}
      <div className="hidden md:flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={exporting}
          onClick={() => handleDownload("json")}
        >
          <Download className="size-3.5" /> {exporting ? "..." : "JSON"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={exporting}
          onClick={() => handleDownload("csv")}
        >
          {exporting ? "..." : "CSV"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={exporting}
          onClick={() => handleDownload("html")}
        >
          {exporting ? "..." : "HTML"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={exporting}
          onClick={() => handleDownload("pdf")}
        >
          {exporting ? "..." : "PDF"}
        </Button>
      </div>

      {/* Mobile / Tablet compact export dropdown */}
      <div ref={menuRef} className="relative md:hidden">
        <Button
          variant="ghost"
          size="sm"
          disabled={exporting}
          onClick={() => setOpen(!open)}
          className="gap-1 font-mono text-2xs uppercase"
          aria-label="Export report"
        >
          <Download className="size-3.5" />
          <span>{exporting ? "..." : "Export"}</span>
          <ChevronDown className="size-3" />
        </Button>
        {open && (
          <div className="absolute right-0 bottom-full mb-1 z-50 flex min-w-[130px] flex-col rounded border border-line bg-surface p-1 shadow-panel">
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                void handleDownload("json");
                setOpen(false);
              }}
              className="flex items-center px-2 py-1.5 text-xs text-left font-mono hover:bg-elevated rounded disabled:opacity-50"
            >
              Export JSON
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                void handleDownload("csv");
                setOpen(false);
              }}
              className="flex items-center px-2 py-1.5 text-xs text-left font-mono hover:bg-elevated rounded disabled:opacity-50"
            >
              Export CSV
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                void handleDownload("html");
                setOpen(false);
              }}
              className="flex items-center px-2 py-1.5 text-xs text-left font-mono hover:bg-elevated rounded disabled:opacity-50"
            >
              Export HTML
            </button>
            <button
              type="button"
              disabled={exporting}
              onClick={() => {
                void handleDownload("pdf");
                setOpen(false);
              }}
              className="flex items-center px-2 py-1.5 text-xs text-left font-mono hover:bg-elevated rounded disabled:opacity-50"
            >
              Export PDF
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
