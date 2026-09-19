import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadBlob } from "@/lib/forensic/report";

export const Route = createFileRoute("/pack")({ component: PackPage });

const FILES: { path: string; label: string; mime: string }[] = [
  { path: "/pack/rust-wasm-engine.zip", label: "rust-wasm-engine.zip", mime: "application/zip" },
  { path: "/pack/ALL_RUST.txt", label: "ALL_RUST.txt (সব .rs এক ফাইলে)", mime: "text/plain" },
  { path: "/pack/forensic-engine.wasm", label: "forensic-engine.wasm", mime: "application/wasm" },
  { path: "/pack/forensic-engine.js", label: "forensic-engine.js", mime: "text/javascript" },
  { path: "/pack/Cargo.toml", label: "Cargo.toml", mime: "text/plain" },
  { path: "/pack/src/lib.rs", label: "src/lib.rs", mime: "text/plain" },
  { path: "/pack/src/ela.rs", label: "src/ela.rs", mime: "text/plain" },
  { path: "/pack/src/dct.rs", label: "src/dct.rs", mime: "text/plain" },
  { path: "/pack/src/jpeg.rs", label: "src/jpeg.rs", mime: "text/plain" },
  { path: "/pack/src/clone.rs", label: "src/clone.rs", mime: "text/plain" },
  { path: "/pack/src/spatial.rs", label: "src/spatial.rs", mime: "text/plain" },
  { path: "/pack/src/stats.rs", label: "src/stats.rs", mime: "text/plain" },
  { path: "/pack/src/json.rs", label: "src/json.rs", mime: "text/plain" },
  { path: "/pack/examples/bench.rs", label: "examples/bench.rs", mime: "text/plain" },
];

async function save(path: string, filename: string, mime: string) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const buf = await res.arrayBuffer();
  downloadBlob(filename, mime, buf);
}

function PackPage() {
  const [active, setActive] = useState("/pack/src/lib.rs");
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const current = useMemo(() => FILES.find((f) => f.path === active) ?? FILES[5], [active]);

  useEffect(() => {
    void openFile("/pack/src/lib.rs");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openFile(path: string) {
    setActive(path);
    setErr("");
    if (path.endsWith(".zip") || path.endsWith(".wasm")) {
      setText("(বাইনারি ফাইল — Download চাপুন)");
      return;
    }
    const res = await fetch(path);
    setText(await res.text());
  }

  async function dl(f: { path: string; label: string; mime: string }) {
    setBusy(true);
    setErr("");
    try {
      const name = f.path.split("/").pop() || "file";
      await save(f.path, name, f.mime);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex h-11 items-center gap-3 border-b border-line bg-surface px-3">
        <Link to="/" className="text-sm text-muted hover:text-fg">
          ← Lab
        </Link>
        <span className="text-sm font-semibold">Engine source pack</span>
        <span className="font-mono text-2xs text-subtle">Rust + WASM + JS</span>
      </header>
      <div className="grid min-h-0 flex-1 md:grid-cols-[240px_1fr]">
        <aside className="border-b border-line p-3 md:border-b-0 md:border-r">
          <p className="mb-2 text-xs text-muted">
            iPad-এ zip কার্ড কাজ না করলে এখান থেকে ফাইল সেভ করুন। সব .rs চাইলে ALL_RUST.txt নিন।
          </p>
          <div className="mb-3 flex flex-wrap gap-1">
            <Button size="sm" disabled={busy} onClick={() => void dl(FILES[0])}>
              Zip
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void dl(FILES[1])}>
              সব Rust
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(text);
              }}
            >
              Copy view
            </Button>
          </div>
          {err ? <p className="mb-2 font-mono text-2xs text-danger">{err}</p> : null}
          <ul className="space-y-0.5">
            {FILES.map((f) => (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => void openFile(f.path)}
                  className={`w-full rounded px-2 py-1 text-left font-mono text-2xs ${
                    active === f.path ? "bg-accent-dim text-accent" : "text-muted hover:text-fg"
                  }`}
                >
                  {f.label}
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section className="flex min-h-0 flex-col">
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <span className="font-mono text-2xs text-subtle">{current.label}</span>
            <Button size="sm" className="ml-auto" disabled={busy} onClick={() => void dl(current)}>
              Download this
            </Button>
          </div>
          <pre className="min-h-0 flex-1 overflow-auto p-3 font-mono text-2xs leading-relaxed text-fg/90">
            {text || "বাম পাশ থেকে একটি ফাইল খুলুন।"}
          </pre>
        </section>
      </div>
    </div>
  );
}
