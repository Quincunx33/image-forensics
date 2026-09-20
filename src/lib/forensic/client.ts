import type {
  CaseRecord,
  DetectorParams,
  EngineKind,
  Heatmap,
  ModuleId,
  ParsedMedia,
  PixelSample,
  Stats,
} from "./types";

export type LoadedPayload = {
  engine: EngineKind;
  engineVersion: string;
  caseRecord: CaseRecord;
  media: ParsedMedia & { hasThumbnail: boolean; warnings: string[] };
  thumbnail: Uint8Array | null;
  original: ImageBitmap;
};

type Handler = (msg: WorkerMsg) => void;

export type WorkerMsg =
  | { id: number; type: "ready"; engine: EngineKind; version: string; simd: boolean }
  | { id: number; type: "progress"; pct: number; label: string }
  | ({ id: number; type: "loaded" } & LoadedPayload)
  | { id: number; type: "map"; map: Heatmap; suiteIndex?: number; suiteTotal?: number }
  | { id: number; type: "map-error"; module: ModuleId; error: string }
  | { id: number; type: "suite-done" }
  | { id: number; type: "region-stats"; stats: Stats }
  | { id: number; type: "pixel"; sample: PixelSample }
  | { id: number; type: "error"; error: string };

export class ForensicClient {
  private worker: Worker | null = null;
  private seq = 1;
  private pending = new Map<number, Handler>();
  onMessage: Handler | null = null;

  start() {
    if (this.worker) return;
    this.worker = new Worker(new URL("../../workers/forensic.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (ev: MessageEvent<WorkerMsg>) => {
      const msg = ev.data;
      this.onMessage?.(msg);
      const h = this.pending.get(msg.id);
      if (h) {
        h(msg);
        if (
          msg.type === "ready" ||
          msg.type === "loaded" ||
          msg.type === "suite-done" ||
          msg.type === "error" ||
          msg.type === "region-stats" ||
          msg.type === "pixel" ||
          (msg.type === "map" && msg.suiteIndex === undefined)
        ) {
          if (msg.type !== "map" || msg.suiteIndex === undefined) this.pending.delete(msg.id);
        }
      }
    };
    this.worker.onerror = (err) => {
      err.preventDefault();
      this.onMessage?.({ id: 0, type: "error", error: err.message || "Worker error" });
    };
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  private send(payload: object, transfer: Transferable[] = []): number {
    if (!this.worker) this.start();
    const id = this.seq++;
    this.worker!.postMessage({ id, ...payload }, transfer);
    return id;
  }

  init(): Promise<Extract<WorkerMsg, { type: "ready" }>> {
    this.start();
    const id = this.send({ type: "init" });
    return this.wait(id, "ready") as Promise<Extract<WorkerMsg, { type: "ready" }>>;
  }

  load(buffer: ArrayBuffer, name: string, mime?: string) {
    return this.send({ type: "load", buffer, name, mime }, [buffer]);
  }

  demo() {
    return this.send({ type: "demo" });
  }

  run(module: ModuleId, params: DetectorParams) {
    return this.send({ type: "run", module, params });
  }

  runSuite(params: DetectorParams) {
    return this.send({ type: "run-suite", params });
  }

  region(x: number, y: number, w: number, h: number) {
    return this.send({ type: "region", x, y, w, h });
  }

  pixel(x: number, y: number) {
    return this.send({ type: "pixel", x, y });
  }

  private wait(id: number, type: WorkerMsg["type"]): Promise<WorkerMsg> {
    return new Promise((resolve, reject) => {
      this.pending.set(id, (msg) => {
        if (msg.type === "error") reject(new Error(msg.error));
        else if (msg.type === type) resolve(msg);
      });
    });
  }
}
