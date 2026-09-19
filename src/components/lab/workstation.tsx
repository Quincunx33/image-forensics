import {
  Activity,
  Aperture,
  Box,
  Copy,
  Download,
  FileSearch,
  Fingerprint,
  FolderOpen,
  Grid2x2,
  Image as ImageIcon,
  Layers,
  LayoutGrid,
  Menu,
  Scan,
  Square,
  Waves,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Workspace } from "@/components/lab/viewers";
import { histogram256 } from "@/lib/forensic/colormap";
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
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setNavOpen(true)} aria-label="Open modules">
        <Menu />
      </Button>
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-semibold tracking-tight">Tracebench</span>
        <span className="hidden font-mono text-2xs uppercase tracking-widest text-subtle sm:inline">
          Forensic laboratory
        </span>
      </div>
      <Separator vertical className="mx-1 hidden h-5 sm:block" />
      <span className="hidden font-mono text-micro tabular-nums text-muted lg:inline">
        {rec ? rec.caseId : "NO CASE"}
      </span>
      {rec?.synthetic ? <Badge tone="warn">synthetic</Badge> : null}
      <div className="ml-auto flex items-center gap-1.5">
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
        <Button variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          <FolderOpen /> Open
        </Button>
        <Button variant="subtle" size="sm" onClick={loadDemo}>
          Demo case
        </Button>
        <ViewToggle value={viewMode} onChange={setViewMode} />
        <Badge tone={engine === "wasm" ? "accent" : "muted"}>{engine} {engineVersion}</Badge>
        <Badge tone={gpu ? "ok" : "muted"}>{gpu ? "webgpu" : "cpu"}</Badge>
        <a
          href="/pack"
          className="inline-flex h-7 items-center rounded-sm border border-line px-2 font-mono text-2xs text-muted hover:text-fg"
        >
          Source
        </a>
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
    { id: "multi", icon: LayoutGrid, label: "Multi-panel" },
    { id: "dual", icon: Square, label: "Dual" },
    { id: "single", icon: ImageIcon, label: "Single" },
  ];
  return (
    <div className="hidden items-center rounded-sm border border-line md:flex">
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
                  "grid size-7 place-items-center text-muted",
                  value === it.id && "bg-elevated text-accent",
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
    <nav className="hidden w-44 shrink-0 flex-col border-r border-line bg-surface md:flex">
      <div className="px-3 py-2 font-mono text-2xs uppercase tracking-widest text-subtle">Analysis</div>
      <ScrollArea className="flex-1">
        <ModuleList />
      </ScrollArea>
    </nav>
  );
}

function MobileNav() {
  const open = useLab((s) => s.navOpen);
  const setNavOpen = useLab((s) => s.setNavOpen);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <button type="button" className="absolute inset-0 bg-bg/70" aria-label="Close" onClick={() => setNavOpen(false)} />
      <div className="relative h-full w-64 bg-surface p-3 shadow-panel">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-2xs uppercase tracking-widest text-subtle">Analysis</span>
          <Button variant="ghost" size="icon-sm" onClick={() => setNavOpen(false)} aria-label="Close modules">
            <X />
          </Button>
        </div>
        <ModuleList />
      </div>
    </div>
  );
}

function ModuleList() {
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
                "flex h-9 w-full items-center gap-2 px-3 text-left text-sm",
                active === m.id ? "bg-elevated text-fg" : "text-muted hover:bg-elevated/70 hover:text-fg",
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="flex-1">{m.label}</span>
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
  const rec = useLab((s) => s.caseRecord);

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
    <div className="relative min-h-0 flex-1">
      {rec?.synthetic ? (
        <div className="pointer-events-none absolute left-3 top-3 z-10 rounded-sm border border-warn/40 bg-bg/80 px-2 py-1 font-mono text-2xs uppercase tracking-wider text-warn">
          Synthetic test article — known clone + mixed JPEG history
        </div>
      ) : null}
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
      className="flex min-h-0 flex-1 items-center justify-center p-4"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onFiles([...e.dataTransfer.files]);
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-line bg-surface p-6 shadow-panel md:p-8">
        <p className="font-mono text-2xs uppercase tracking-widest text-accent">Local workstation</p>
        <h1 className="mt-2 text-xl font-semibold tracking-tight md:text-2xl">Drop an image to open a case</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          All decoding and detectors run in this browser. The original bytes are hashed and never
          overwritten. Outputs are measurements with limitations — not authenticity scores.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={loadDemo} disabled={busy}>
            Load demonstration case
          </Button>
          <label>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) onFiles([...e.target.files]);
              }}
            />
            <span className="inline-flex h-9 items-center rounded-sm border border-line px-3 text-sm hover:bg-elevated">
              Choose file
            </span>
          </label>
        </div>
        <p className="mt-4 font-mono text-micro text-subtle">
          Engine {ready ? engine : "starting…"} · JPEG ELA · noise · DCT · clone · EXIF · SHA-256/512
        </p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        {busy ? <p className="mt-3 text-sm text-muted">Working…</p> : null}
      </div>
    </div>
  );
}

function BottomDock() {
  const tab = useLab((s) => s.bottomTab);
  const setTab = useLab((s) => s.setBottomTab);
  const original = useLab((s) => s.original);
  const tabs = [
    { id: "evidence" as const, label: "Evidence" },
    { id: "pixel" as const, label: "Pixel" },
    { id: "histogram" as const, label: "Histogram" },
    { id: "params" as const, label: "Parameters" },
    { id: "structure" as const, label: "Structure" },
    { id: "methods" as const, label: "Methods" },
  ];
  if (!original) return null;
  return (
    <div className="flex h-[min(38vh,20rem)] shrink-0 flex-col border-t border-line bg-surface md:h-56">
      <div className="flex shrink-0 gap-0 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "h-9 shrink-0 px-3 font-mono text-2xs uppercase tracking-widest",
              tab === t.id ? "border-b-2 border-accent text-fg" : "text-muted",
            )}
          >
            {t.label}
          </button>
        ))}
        <div className="ml-auto flex items-center pr-2">
          <ExportMenu />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto lab-scroll p-3">
        {tab === "evidence" && <EvidenceTab />}
        {tab === "pixel" && <PixelTab />}
        {tab === "histogram" && <HistogramTab />}
        {tab === "params" && <ParamsTab />}
        {tab === "structure" && <StructureTab />}
        {tab === "methods" && <MethodsTab />}
      </div>
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
      <div className="grid gap-2 md:grid-cols-2">
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
        <p className="mt-1 text-2xs text-subtle">Statistical hotspots from ELA/noise — not semantic labels.</p>
        <ul className="mt-2 space-y-1">
          {regions.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-micro hover:bg-panel"
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
    return <p className="text-sm text-muted">Move the pointer over a panel to inspect a pixel.</p>;
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
    <dl className="grid max-w-xl grid-cols-2 gap-x-6 gap-y-1 font-mono text-micro tabular-nums sm:grid-cols-4">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-line/70 py-1">
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
      <div className="flex h-28 items-end gap-px rounded-sm border border-line bg-bg px-1 py-1">
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
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Field label={`ELA quality ${params.elaQuality}`}>
        <Slider min={40} max={100} step={1} value={[params.elaQuality]} onValueChange={([v]) => setParams({ elaQuality: v ?? 90 })} />
      </Field>
      <Field label={`ELA gain ${params.elaGain}`}>
        <Slider min={1} max={40} step={1} value={[params.elaGain]} onValueChange={([v]) => setParams({ elaGain: v ?? 12 })} />
      </Field>
      <Field label={`Percentile clip ${params.percentile}`}>
        <Slider min={80} max={100} step={1} value={[params.percentile]} onValueChange={([v]) => setParams({ percentile: v ?? 98, elaPercentile: v ?? 98 })} />
      </Field>
      <Field label={`Noise window ${params.noiseWindow}`}>
        <Slider min={3} max={15} step={2} value={[params.noiseWindow]} onValueChange={([v]) => setParams({ noiseWindow: v ?? 7 })} />
      </Field>
      <Field label={`Clone block ${params.cloneBlock}`}>
        <Slider min={8} max={32} step={4} value={[params.cloneBlock]} onValueChange={([v]) => setParams({ cloneBlock: v ?? 16 })} />
      </Field>
      <Field label={`Overlay ${Math.round(params.overlayOpacity * 100)}%`}>
        <Slider min={0} max={1} step={0.02} value={[params.overlayOpacity]} onValueChange={([v]) => setParams({ overlayOpacity: v ?? 0.72 })} />
      </Field>
      <Field label="Colormap">
        <div className="flex flex-wrap gap-1">
          {(["inferno", "magma", "viridis", "turbo", "gray", "steel"] as ColormapName[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setParams({ colormap: c })}
              className={cn(
                "rounded-sm border px-2 py-1 font-mono text-2xs uppercase",
                params.colormap === c ? "border-accent text-accent" : "border-line text-muted",
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </Field>
      <div className="flex flex-wrap items-end gap-2">
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
          <div className="mt-2 grid grid-cols-8 gap-px font-mono text-2xs tabular-nums">
            {jpeg.quantizationTables[0].values.map((v, i) => (
              <div key={i} className="bg-panel px-1 py-0.5 text-center">
                {v}
              </div>
            ))}
          </div>
        ) : null}
      </section>
      <section className="lg:col-span-2">
        <h3 className="font-mono text-2xs uppercase tracking-widest text-subtle">Metadata</h3>
        <div className="mt-2 max-h-40 overflow-auto lab-scroll">
          <table className="w-full text-micro">
            <tbody>
              {media.fields.map((f, i) => (
                <tr key={`${f.key}-${i}`} className="border-b border-line/60">
                  <td className="w-48 py-1 font-mono text-subtle">{f.group}.{f.key}</td>
                  <td className="py-1">{f.value}</td>
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
        <div key={k} className="grid grid-cols-[7rem_1fr] gap-2 text-micro">
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
      <ul className="list-disc space-y-1 pl-4">
        <li>ELA — JPEG re-encode at a chosen quality; absolute residual; percentile scaling.</li>
        <li>Noise — high-pass / local variance via integral images / Laplacian / median residual.</li>
        <li>DCT — 8×8 DCT-II band energy and blocking discontinuity.</li>
        <li>Double JPEG — DCT coefficient histogram periodicity (not proof of editing).</li>
        <li>Resampling — second-derivative even/odd lag energy (Gallagher-style).</li>
        <li>Copy-move — overlapping block descriptors, neighbor search, displacement clustering.</li>
        <li>CFA / PRNU — experimental; PRNU has no reference fingerprint enrolled.</li>
      </ul>
      <p>
        Semantic region names (face, hands, …) are <strong className="text-fg">not invented</strong>. Auto
        regions are residual hotspots labeled Region 01…. Shift-drag to mark an ROI.
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
  if (!rec || !media) return null;
  const model = () => ({
    caseRecord: rec,
    media,
    evidence,
    maps: Object.fromEntries(
      Object.entries(maps).map(([k, v]) => [k, v ? { stats: v.stats, extra: v.extra, note: v.note } : null]),
    ),
    params,
    custody,
    engine: `${engine}/${engineVersion}`,
  });
  return (
    <div className="flex gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => downloadBlob(`${rec.caseId}.json`, "application/json", reportJson(model()))}
      >
        <Download /> JSON
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => downloadBlob(`${rec.caseId}.csv`, "text/csv", reportCsv(model()))}
      >
        CSV
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => downloadBlob(`${rec.caseId}.html`, "text/html", reportHtml(model()))}
      >
        HTML
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => downloadBlob(`${rec.caseId}.pdf`, "application/pdf", reportPdf(model()) as BlobPart)}
      >
        PDF
      </Button>
    </div>
  );
}
