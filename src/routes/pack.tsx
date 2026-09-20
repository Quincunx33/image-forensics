import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/forensic/report";
import {
  ArrowLeft,
  Archive,
  Cpu,
  FileCode,
  FileText,
  Settings,
  Search,
  Download,
  Copy,
  Check,
  Code2,
  Terminal,
  Smartphone,
  WrapText,
} from "lucide-react";

export const Route = createFileRoute("/pack")({ component: PackPage });

type FileCategory = "all" | "bundle" | "wasm" | "rust" | "example";

interface PackFile {
  path: string;
  name: string;
  category: "bundle" | "wasm" | "rust" | "example";
  description: string;
  sizeStr: string;
  mime: string;
  lang: string;
  exports?: string[];
}

const FILES: PackFile[] = [
  {
    path: "/pack/rust-wasm-engine.zip",
    name: "rust-wasm-engine.zip",
    category: "bundle",
    description: "Complete crate source tree, tests & build configuration",
    sizeStr: "132 KB",
    mime: "application/zip",
    lang: "ZIP Archive",
  },
  {
    path: "/pack/ALL_RUST.txt",
    name: "ALL_RUST.txt",
    category: "bundle",
    description: "Consolidated single-file bundle containing all 9 Rust source modules",
    sizeStr: "67 KB",
    mime: "text/plain",
    lang: "Rust / Text",
  },
  {
    path: "/pack/forensic-engine.wasm",
    name: "forensic-engine.wasm",
    category: "wasm",
    description: "Production WebAssembly binary compiled with opt-level 3 and LTO",
    sizeStr: "306 KB",
    mime: "application/wasm",
    lang: "WASM Binary",
    exports: [
      "tb_version",
      "tb_engine_id",
      "tb_alloc",
      "tb_free",
      "tb_run_ela",
      "tb_run_dct",
      "tb_run_clone",
      "tb_run_spatial",
      "tb_run_stats",
      "tb_last_error",
    ],
  },
  {
    path: "/pack/forensic-engine.js",
    name: "forensic-engine.js",
    category: "wasm",
    description: "TypeScript/JavaScript WebAssembly loader, memory arena and bridge",
    sizeStr: "6.2 KB",
    mime: "text/javascript",
    lang: "JavaScript Glue",
  },
  {
    path: "/pack/Cargo.toml",
    name: "Cargo.toml",
    category: "rust",
    description: "Crate manifest, no_std flags, compiler optimizations and dependencies",
    sizeStr: "397 B",
    mime: "text/plain",
    lang: "TOML Config",
  },
  {
    path: "/pack/src/lib.rs",
    name: "src/lib.rs",
    category: "rust",
    description: "C-ABI exports, thread-local Session arena and memory allocator",
    sizeStr: "6.3 KB",
    mime: "text/plain",
    lang: "Rust Core",
  },
  {
    path: "/pack/src/ela.rs",
    name: "src/ela.rs",
    category: "rust",
    description: "Error Level Analysis recompression differential forensic engine",
    sizeStr: "5.1 KB",
    mime: "text/plain",
    lang: "Rust Module",
  },
  {
    path: "/pack/src/dct.rs",
    name: "src/dct.rs",
    category: "rust",
    description: "8×8 2D Discrete Cosine Transform & Quantization coefficient analyzer",
    sizeStr: "7.8 KB",
    mime: "text/plain",
    lang: "Rust Module",
  },
  {
    path: "/pack/src/jpeg.rs",
    name: "src/jpeg.rs",
    category: "rust",
    description: "JPEG SOF/SOS marker parser, DQT table extractor and ghost grid alignment",
    sizeStr: "4.2 KB",
    mime: "text/plain",
    lang: "Rust Module",
  },
  {
    path: "/pack/src/clone.rs",
    name: "src/clone.rs",
    category: "rust",
    description: "Copy-move spatial hashing block descriptor forgery detector",
    sizeStr: "9.1 KB",
    mime: "text/plain",
    lang: "Rust Module",
  },
  {
    path: "/pack/src/spatial.rs",
    name: "src/spatial.rs",
    category: "rust",
    description: "High-pass spatial filters, Laplacian kernel and noise gradient extraction",
    sizeStr: "5.4 KB",
    mime: "text/plain",
    lang: "Rust Module",
  },
  {
    path: "/pack/src/stats.rs",
    name: "src/stats.rs",
    category: "rust",
    description: "Pixel luminance statistics, skewness, kurtosis & histogram moments",
    sizeStr: "3.8 KB",
    mime: "text/plain",
    lang: "Rust Module",
  },
  {
    path: "/pack/src/json.rs",
    name: "src/json.rs",
    category: "rust",
    description: "Zero-allocation JSON telemetry serializer for WASM C-ABI",
    sizeStr: "2.9 KB",
    mime: "text/plain",
    lang: "Rust Module",
  },
  {
    path: "/pack/examples/bench.rs",
    name: "examples/bench.rs",
    category: "example",
    description: "Native throughput benchmark harness and verification test suite",
    sizeStr: "2.4 KB",
    mime: "text/plain",
    lang: "Rust Example",
  },
];

async function saveFile(path: string, filename: string, mime: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
  const buf = await res.arrayBuffer();
  downloadBlob(filename, mime, buf);
}

function getFileIcon(f: PackFile) {
  if (f.category === "bundle") return <Archive className="size-4 text-warn" />;
  if (f.category === "wasm" && f.path.endsWith(".wasm")) return <Cpu className="size-4 text-accent" />;
  if (f.name === "Cargo.toml") return <Settings className="size-4 text-subtle" />;
  if (f.name.endsWith(".rs")) return <Code2 className="size-4 text-ok" />;
  if (f.name.endsWith(".js")) return <FileCode className="size-4 text-accent" />;
  return <FileText className="size-4 text-muted" />;
}

// Lightweight syntax colorizer for Rust / TOML / JS
function highlightLine(line: string) {
  if (!line) return " ";
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("#")) {
    return <span className="text-subtle italic">{line}</span>;
  }

  const tokenRegex =
    /(\/\/[^\n]*|"(?:\\.|[^"\\])*"|'[^']'|\b(?:fn|pub|struct|impl|let|mut|use|mod|const|static|return|match|if|else|for|in|while|loop|unsafe|extern|as|type|enum|trait|where|crate|self|Self|async|await|package|dependencies|profile|release)\b|\b(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64|bool|char|str|String|Vec|Option|Result|Some|None|Ok|Err|RefCell|Session|Box|Rc|Arc)\b|\b\d+(?:\.\d+)?(?:_?[uif]\d+)?\b|#\[[^\]]+\])/g;

  const parts: (string | JSX.Element)[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(line)) !== null) {
    if (match.index > lastIdx) {
      parts.push(line.slice(lastIdx, match.index));
    }
    const token = match[0];
    if (token.startsWith("//")) {
      parts.push(
        <span key={match.index} className="text-subtle italic">
          {token}
        </span>,
      );
    } else if (token.startsWith('"') || token.startsWith("'")) {
      parts.push(
        <span key={match.index} className="text-ok">
          {token}
        </span>,
      );
    } else if (token.startsWith("#[")) {
      parts.push(
        <span key={match.index} className="text-warn">
          {token}
        </span>,
      );
    } else if (
      /^(?:fn|pub|struct|impl|let|mut|use|mod|const|static|return|match|if|else|for|in|while|loop|unsafe|extern|as|type|enum|trait|where|crate|self|Self|async|await|package|dependencies|profile|release)$/.test(
        token,
      )
    ) {
      parts.push(
        <span key={match.index} className="text-accent font-semibold">
          {token}
        </span>,
      );
    } else if (
      /^(?:u8|u16|u32|u64|u128|usize|i8|i16|i32|i64|i128|isize|f32|f64|bool|char|str|String|Vec|Option|Result|Some|None|Ok|Err|RefCell|Session|Box|Rc|Arc)$/.test(
        token,
      )
    ) {
      parts.push(
        <span key={match.index} className="text-warn font-medium">
          {token}
        </span>,
      );
    } else if (/^\d/.test(token)) {
      parts.push(
        <span key={match.index} className="text-accent/80 font-mono">
          {token}
        </span>,
      );
    } else {
      parts.push(token);
    }
    lastIdx = tokenRegex.lastIndex;
  }

  if (lastIdx < line.length) {
    parts.push(line.slice(lastIdx));
  }

  return parts.length ? parts : line;
}

function PackPage() {
  const [active, setActive] = useState("/pack/src/lib.rs");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [searchFilter, setSearchFilter] = useState("");
  const [codeSearch, setCodeSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<FileCategory>("all");
  const [wrapText, setWrapText] = useState(false);
  const [mobileView, setMobileView] = useState<"files" | "code">("code");

  const current = useMemo(() => FILES.find((f) => f.path === active) ?? FILES[5], [active]);
  const isBinary = current.path.endsWith(".zip") || current.path.endsWith(".wasm");

  useEffect(() => {
    void openFile("/pack/src/lib.rs");
  }, []);

  async function openFile(path: string) {
    setActive(path);
    setError("");
    setCopied(false);
    setCodeSearch("");
    if (path.endsWith(".zip") || path.endsWith(".wasm")) {
      setText("");
      setMobileView("code");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const content = await res.text();
      setText(content);
      setMobileView("code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load file contents");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload(f: PackFile) {
    setBusy(true);
    setError("");
    try {
      const name = f.path.split("/").pop() || "file";
      await saveFile(f.path, name, f.mime);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const copyCode = () => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const filteredFiles = useMemo(() => {
    return FILES.filter((f) => {
      const matchesCat = categoryFilter === "all" || f.category === categoryFilter;
      const matchesQuery =
        !searchFilter.trim() ||
        f.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
        f.description.toLowerCase().includes(searchFilter.toLowerCase()) ||
        f.lang.toLowerCase().includes(searchFilter.toLowerCase());
      return matchesCat && matchesQuery;
    });
  }, [categoryFilter, searchFilter]);

  const lines = useMemo(() => {
    if (!text) return [];
    return text.split("\n");
  }, [text]);

  const searchMatchesCount = useMemo(() => {
    if (!codeSearch.trim() || !lines.length) return 0;
    const q = codeSearch.toLowerCase();
    return lines.filter((l) => l.toLowerCase().includes(q)).length;
  }, [lines, codeSearch]);

  const categories = [
    { id: "all" as const, label: "All", count: FILES.length },
    { id: "rust" as const, label: "Rust Core", count: FILES.filter((f) => f.category === "rust").length },
    { id: "wasm" as const, label: "WASM", count: FILES.filter((f) => f.category === "wasm").length },
    { id: "bundle" as const, label: "Bundles", count: FILES.filter((f) => f.category === "bundle").length },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg antialiased selection:bg-accent/30 selection:text-fg">
      {/* Studio Header Bar */}
      <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface/95 px-3 backdrop-blur-sm sm:px-4">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-sm border border-line bg-panel/70 px-2.5 py-1 font-mono text-2xs font-medium text-muted hover:border-line-hover hover:bg-elevated hover:text-fg transition-all"
            title="Return to Workstation"
          >
            <ArrowLeft className="size-3.5 text-accent" />
            <span>Lab Workstation</span>
          </Link>

          <div className="h-4 w-px bg-line/60" />

          <div className="flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded bg-accent/15 text-accent">
              <Code2 className="size-3.5" />
            </div>
            <h1 className="text-xs font-semibold tracking-tight text-fg sm:text-sm">
              Engine Source Pack
            </h1>
            <Badge tone="ok" className="hidden font-mono text-3xs sm:inline-flex">
              v1.0.0
            </Badge>
            <Badge tone="neutral" className="hidden font-mono text-3xs md:inline-flex">
              WASM32 ABI
            </Badge>
          </div>
        </div>

        {/* Global Quick Action Buttons */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Mobile view switch */}
          <div className="flex rounded border border-line bg-panel p-0.5 md:hidden">
            <button
              type="button"
              onClick={() => setMobileView("files")}
              className={cn(
                "rounded px-2 py-0.5 text-3xs font-mono transition-colors",
                mobileView === "files" ? "bg-accent text-accent-fg font-semibold" : "text-muted",
              )}
            >
              Files ({filteredFiles.length})
            </button>
            <button
              type="button"
              onClick={() => setMobileView("code")}
              className={cn(
                "rounded px-2 py-0.5 text-3xs font-mono transition-colors",
                mobileView === "code" ? "bg-accent text-accent-fg font-semibold" : "text-muted",
              )}
            >
              Inspector
            </button>
          </div>

          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void handleDownload(FILES[1])}
            className="hidden h-7 gap-1.5 px-2 font-mono text-2xs lg:inline-flex"
            title="Download all Rust sources in a single file"
          >
            <FileText className="size-3 text-accent" />
            <span>ALL_RUST.txt</span>
          </Button>

          <Button
            size="sm"
            disabled={busy}
            onClick={() => void handleDownload(FILES[0])}
            className="h-7 gap-1.5 px-2.5 font-mono text-2xs shadow-xs"
            title="Download full crate archive"
          >
            <Archive className="size-3.5" />
            <span>Download ZIP</span>
          </Button>
        </div>
      </header>

      {/* Main Two-Panel Layout */}
      <div className="grid min-h-0 flex-1 md:grid-cols-[280px_1fr] lg:grid-cols-[320px_1fr]">
        {/* Left Sidebar: File Explorer */}
        <aside
          className={cn(
            "flex flex-col border-r border-line bg-surface/40",
            mobileView === "files" ? "flex" : "hidden md:flex",
          )}
        >
          {/* Mobile Notice Card (clean, elegant iPad assistance) */}
          <div className="border-b border-line bg-elevated/40 p-2.5">
            <div className="flex items-start gap-2 rounded border border-line/60 bg-panel/60 p-2">
              <Smartphone className="size-3.5 text-accent shrink-0 mt-0.5" />
              <div className="space-y-0.5 text-3xs">
                <p className="font-semibold text-fg">Mobile & iPad Compatibility</p>
                <p className="text-muted leading-relaxed">
                  Browse, inspect, or copy any file code directly. ZIP files can be saved straight into the Apple Files app.
                </p>
              </div>
            </div>
          </div>

          {/* Search and Category Filter Bar */}
          <div className="shrink-0 space-y-2 border-b border-line bg-surface/70 p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-subtle" />
              <input
                type="text"
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                placeholder="Filter files (e.g. ela, wasm, clone)..."
                className="h-7 w-full rounded border border-line bg-panel pl-7 pr-6 font-mono text-2xs placeholder:text-subtle focus:border-accent focus:outline-none"
              />
              {searchFilter && (
                <button
                  type="button"
                  onClick={() => setSearchFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle hover:text-fg text-2xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Category tabs */}
            <div className="flex items-center gap-1 overflow-x-auto lab-scroll pb-0.5">
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryFilter(c.id)}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-0.5 font-mono text-3xs transition-all whitespace-nowrap cursor-pointer",
                    categoryFilter === c.id
                      ? "bg-accent text-accent-fg font-semibold shadow-xs"
                      : "bg-panel/60 text-muted hover:bg-elevated hover:text-fg",
                  )}
                >
                  <span>{c.label}</span>
                  <span className="text-3xs opacity-80">({c.count})</span>
                </button>
              ))}
            </div>
          </div>

          {/* File Tree List */}
          <div className="flex-1 overflow-y-auto lab-scroll p-2 space-y-1">
            <div className="px-1.5 py-1 font-mono text-3xs font-semibold uppercase tracking-wider text-subtle">
              Workspace Files ({filteredFiles.length})
            </div>

            {filteredFiles.map((f) => {
              const isSelected = active === f.path;
              return (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => void openFile(f.path)}
                  className={cn(
                    "w-full flex items-start gap-2 rounded-md p-2 text-left transition-all cursor-pointer group",
                    isSelected
                      ? "bg-accent-dim/40 border border-accent/40 shadow-xs"
                      : "border border-transparent hover:bg-elevated/70 hover:border-line/40",
                  )}
                >
                  <div className="mt-0.5 shrink-0">{getFileIcon(f)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          "font-mono text-2xs font-medium truncate",
                          isSelected ? "text-accent font-semibold" : "text-fg group-hover:text-fg",
                        )}
                      >
                        {f.name}
                      </span>
                      <span className="shrink-0 font-mono text-3xs text-subtle">
                        {f.sizeStr}
                      </span>
                    </div>
                    <p className="line-clamp-1 text-3xs text-muted leading-tight mt-0.5">
                      {f.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Sidebar Footer: Quick Download Crate card */}
          <div className="border-t border-line bg-surface/80 p-2.5">
            <div className="flex items-center justify-between font-mono text-3xs text-muted">
              <span>9 Rust Modules</span>
              <span>1 WASM Target</span>
            </div>
          </div>
        </aside>

        {/* Right Stage: Code & Asset Inspector */}
        <main
          className={cn(
            "flex min-h-0 flex-1 flex-col bg-bg",
            mobileView === "code" ? "flex" : "hidden md:flex",
          )}
        >
          {/* File Inspector Header Bar */}
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface/80 px-3 py-2 sm:px-4">
            <div className="flex items-center gap-2 min-w-0">
              <div className="shrink-0">{getFileIcon(current)}</div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-mono text-xs font-semibold text-fg">
                    {current.name}
                  </span>
                  <Badge tone="neutral" className="text-3xs font-mono">
                    {current.lang}
                  </Badge>
                  <span className="font-mono text-3xs text-subtle">
                    {current.sizeStr}
                  </span>
                  {!isBinary && lines.length > 0 && (
                    <span className="font-mono text-3xs text-subtle">
                      • {lines.length} lines
                    </span>
                  )}
                </div>
                <p className="font-mono text-3xs text-muted truncate max-w-lg hidden sm:block">
                  {current.description}
                </p>
              </div>
            </div>

            {/* In-File Inspector Controls */}
            <div className="flex items-center gap-1.5 ml-auto">
              {!isBinary && (
                <>
                  {/* In-code search input */}
                  <div className="relative hidden sm:block">
                    <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-subtle" />
                    <input
                      type="text"
                      value={codeSearch}
                      onChange={(e) => setCodeSearch(e.target.value)}
                      placeholder="Find in code..."
                      className="h-6.5 w-32 md:w-40 rounded border border-line bg-panel pl-6 pr-4 font-mono text-3xs placeholder:text-subtle focus:border-accent focus:outline-none"
                    />
                    {codeSearch && (
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 font-mono text-3xs text-muted">
                        {searchMatchesCount}
                      </span>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setWrapText(!wrapText)}
                    className={cn(
                      "h-7 px-2 font-mono text-3xs",
                      wrapText ? "text-accent bg-accent/10" : "text-muted",
                    )}
                    title="Toggle Word Wrap"
                  >
                    <WrapText className="size-3" />
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copyCode}
                    className="h-7 gap-1 px-2.5 font-mono text-3xs"
                    title="Copy full source code"
                  >
                    {copied ? <Check className="size-3 text-ok" /> : <Copy className="size-3" />}
                    <span>{copied ? "Copied" : "Copy"}</span>
                  </Button>
                </>
              )}

              <Button
                size="sm"
                variant="subtle"
                disabled={busy}
                onClick={() => void handleDownload(current)}
                className="h-7 gap-1.5 px-2.5 font-mono text-3xs"
                title={`Download ${current.name}`}
              >
                <Download className="size-3" />
                <span>Save</span>
              </Button>
            </div>
          </div>

          {/* Status / Error Toast */}
          {error && (
            <div className="border-b border-danger/40 bg-danger/10 px-3 py-1.5 font-mono text-2xs text-danger flex items-center justify-between">
              <span>{error}</span>
              <button type="button" onClick={() => setError("")} className="hover:underline">
                Dismiss
              </button>
            </div>
          )}

          {/* Main Content Area */}
          <div className="min-h-0 flex-1 overflow-auto lab-scroll relative">
            {loading ? (
              <div className="flex h-full items-center justify-center text-muted font-mono text-xs">
                <span className="animate-pulse">Loading source file...</span>
              </div>
            ) : isBinary ? (
              /* High-Craft Binary / Archive Hero Card */
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <div className="relative mb-4 flex size-20 items-center justify-center rounded-xl border border-line bg-elevated/70 shadow-panel">
                  {current.path.endsWith(".wasm") ? (
                    <Cpu className="size-10 text-accent animate-pulse" />
                  ) : (
                    <Archive className="size-10 text-warn" />
                  )}
                  <div className="absolute -bottom-2 -right-2 rounded-full border border-line bg-surface px-1.5 py-0.5 font-mono text-3xs font-semibold text-fg">
                    {current.sizeStr}
                  </div>
                </div>

                <h2 className="text-base font-semibold text-fg">{current.name}</h2>
                <p className="mt-1 max-w-md text-xs text-muted">
                  {current.description}
                </p>

                {current.exports && (
                  <div className="mt-4 max-w-md w-full rounded-md border border-line bg-panel/70 p-3 text-left font-mono text-3xs">
                    <div className="text-subtle font-semibold uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                      <Terminal className="size-3 text-accent" />
                      <span>Exported C-ABI Function Symbols (10)</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-fg/80">
                      {current.exports.map((fn) => (
                        <div key={fn} className="rounded bg-surface/60 px-1.5 py-0.5 truncate text-accent">
                          • {fn}()
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                  <Button
                    size="default"
                    disabled={busy}
                    onClick={() => void handleDownload(current)}
                    className="gap-2 px-5 font-mono text-xs shadow-xs"
                  >
                    <Download className="size-4" />
                    <span>Download {current.name}</span>
                  </Button>
                </div>
              </div>
            ) : (
              /* Code Viewer with Line Numbers and Syntax Highlighting */
              <div className="flex min-h-full font-mono text-2xs leading-relaxed">
                {/* Line numbers gutter */}
                <div className="sticky left-0 z-10 select-none border-r border-line/60 bg-surface/60 py-3 text-right font-mono text-3xs text-subtle/70">
                  {lines.map((_, i) => (
                    <div key={i} className="px-3">
                      {i + 1}
                    </div>
                  ))}
                </div>

                {/* Code content */}
                <div
                  className={cn(
                    "flex-1 py-3 px-4",
                    wrapText ? "whitespace-pre-wrap break-all" : "whitespace-pre overflow-x-auto",
                  )}
                >
                  {lines.map((line, i) => {
                    const isMatch =
                      codeSearch.trim() && line.toLowerCase().includes(codeSearch.toLowerCase());
                    return (
                      <div
                        key={i}
                        className={cn(
                          "transition-colors",
                          isMatch ? "bg-accent/20 text-fg rounded-xs px-1 -mx-1" : "text-fg/90",
                        )}
                      >
                        {highlightLine(line)}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
