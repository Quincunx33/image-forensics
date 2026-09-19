import { fmt, fmtBytes } from "./stats";
import type {
  CaseRecord,
  CustodyEvent,
  DetectorParams,
  EvidenceEntry,
  Heatmap,
  ParsedMedia,
} from "./types";
import { SOFTWARE_VERSION } from "./types";

export interface ReportModel {
  caseRecord: CaseRecord;
  media: ParsedMedia & { warnings?: string[] };
  evidence: EvidenceEntry[];
  maps: Partial<Record<string, { stats: Heatmap["stats"]; extra?: unknown; note?: string }>>;
  params: DetectorParams;
  custody: CustodyEvent[];
  engine: string;
}

export function reportJson(model: ReportModel): string {
  const body = {
    schema: "tracebench.forensic-report.v1",
    softwareVersion: SOFTWARE_VERSION,
    generatedAt: new Date().toISOString(),
    case: model.caseRecord,
    file: {
      filename: model.caseRecord.originalFilename,
      mime: model.caseRecord.mime,
      size: model.caseRecord.size,
      sha256: model.caseRecord.sha256,
      sha512: model.caseRecord.sha512,
      dimensions: `${model.caseRecord.width}x${model.caseRecord.height}`,
    },
    metadata: model.media.fields,
    jpeg: model.media.jpeg ?? null,
    warnings: model.media.warnings ?? [],
    evidence: model.evidence,
    measurements: model.maps,
    parameters: model.params,
    chainOfCustody: model.custody,
    engine: model.engine,
    limitations: [
      "This report records measurements, not authenticity verdicts.",
      "Do not interpret any single detector as proof of editing or generative origin.",
      "Re-run with the same software version, parameters, and original bytes to reproduce maps.",
    ],
    reproducibility: {
      softwareVersion: SOFTWARE_VERSION,
      detectorVersions: model.caseRecord.detectorVersions,
      originalImmutable: true,
      processing: "in-memory derivatives only",
    },
  };
  return `${JSON.stringify(body)}\n`;
}

export function reportCsv(model: ReportModel): string {
  const rows = [
    ["detector", "status", "strength", "observation", "measurement", "region", "uncertainty"].join(","),
  ];
  for (const e of model.evidence) {
    const cell = (s: string) => `"${s.replace(/"/g, '""')}"`;
    rows.push(
      [e.detector, e.status, e.strength, e.observation, e.measurement, e.region, e.uncertainty]
        .map(cell)
        .join(","),
    );
  }
  return rows.join("\n");
}

export function reportHtml(model: ReportModel): string {
  const c = model.caseRecord;
  const ev = model.evidence
    .map(
      (e) => `<section class="ev">
<h3>${esc(e.detector)}</h3>
<p class="meta">${esc(e.status)} · ${esc(e.strength)}</p>
<p><strong>Observation.</strong> ${esc(e.observation)}</p>
<p><strong>Measurement.</strong> ${esc(e.measurement)}</p>
<p><strong>Region.</strong> ${esc(e.region)}</p>
<p><strong>Uncertainty.</strong> ${esc(e.uncertainty)}</p>
<p><strong>Limitations.</strong> ${esc(e.limitations.join(" "))}</p>
</section>`,
    )
    .join("\n");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<title>Tracebench report ${esc(c.caseId)}</title>
<style>
body{font:14px/1.5 "IBM Plex Sans",system-ui,sans-serif;background:#f4f1ea;color:#1b1d21;margin:0;padding:32px}
h1{font-weight:600;letter-spacing:-.02em;margin:0 0 8px}
h2{margin:28px 0 8px;font-size:15px;text-transform:uppercase;letter-spacing:.12em;color:#5c656e}
.ev{border-top:1px solid #d5d0c6;padding:12px 0}
.meta{color:#5c656e;font-size:12px}
code,pre{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px}
dl{display:grid;grid-template-columns:180px 1fr;gap:4px 16px}
dt{color:#5c656e}
</style></head><body>
<h1>Tracebench forensic report</h1>
<p>Measurements and limitations — not an authenticity verdict.</p>
<h2>Case</h2>
<dl>
<dt>Case ID</dt><dd>${esc(c.caseId)}</dd>
<dt>Evidence ID</dt><dd>${esc(c.evidenceId)}</dd>
<dt>File</dt><dd>${esc(c.originalFilename)} (${esc(c.mime)}, ${fmtBytes(c.size)})</dd>
<dt>Raster</dt><dd>${c.width}×${c.height}</dd>
<dt>SHA-256</dt><dd><code>${esc(c.sha256)}</code></dd>
<dt>SHA-512</dt><dd><code>${esc(c.sha512)}</code></dd>
<dt>Analyzed</dt><dd>${esc(c.analyzedAt)}</dd>
<dt>Software</dt><dd>${esc(c.softwareVersion)} / ${esc(model.engine)}</dd>
</dl>
<h2>Evidence</h2>
${ev}
<h2>Chain of custody</h2>
<pre>${esc(JSON.stringify(model.custody, null, 2))}</pre>
<p>Original bytes were not modified. All maps are derived in memory.</p>
</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&", "<": "<", ">": ">", '"': "&quot;", "'": "&#39;" })[ch]!);
}

/** Minimal PDF (Helvetica) for the case + evidence tables. */
export function reportPdf(model: ReportModel): Uint8Array {
  const lines: string[] = [];
  const add = (t: string) => {
    const chunks = t.match(/.{1,92}/g) ?? [t];
    for (const c of chunks) lines.push(c.replace(/[^\x20-\x7E]/g, "?"));
  };
  add("TRACEBENCH FORENSIC REPORT");
  add(`Case ${model.caseRecord.caseId}   Evidence ${model.caseRecord.evidenceId}`);
  add(`File ${model.caseRecord.originalFilename}  ${model.caseRecord.width}x${model.caseRecord.height}`);
  add(`SHA-256 ${model.caseRecord.sha256}`);
  add(`Engine ${model.engine}  software ${SOFTWARE_VERSION}`);
  add("");
  add("This document records measurements. It is not an authenticity verdict.");
  add("");
  for (const e of model.evidence) {
    add(`${e.detector}  [${e.status}/${e.strength}]`);
    add(`  ${e.observation}`);
    add(`  ${e.measurement}`);
    add("");
  }
  const contentParts: string[] = ["BT", "/F1 10 Tf", "50 780 Td", "12 TL"];
  for (const line of lines) {
    contentParts.push(`(${line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")}) '`);
  }
  contentParts.push("ET");
  const stream = contentParts.join("\n");
  const objs: string[] = [];
  objs.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj");
  objs.push("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj");
  objs.push(
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
  );
  objs.push(`4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj`);
  objs.push("5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj");
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const o of objs) {
    offsets.push(pdf.length);
    pdf += `${o}\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

export function downloadBlob(filename: string, mime: string, data: BlobPart) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export { fmt, fmtBytes };
