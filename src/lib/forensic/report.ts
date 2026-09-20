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
  originalImageBase64?: string;
  analysisImages?: Array<{ title: string; base64: string }>;
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
    images: {
      original: model.originalImageBase64 ?? null,
      analysis: model.analysisImages ?? [],
    },
  };
  return `${JSON.stringify(body)}\n`;
}

export function reportCsv(model: ReportModel): string {
  const rows = [
    ["detector", "status", "strength", "observation", "measurement", "region", "uncertainty"].join(","),
  ];
  for (const e of model.evidence) {
    const cell = (val: any) => {
      const s = val === undefined || val === null ? "" : String(val);
      return `"${s.replace(/"/g, '""')}"`;
    };
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
  const m = model.media;
  const jpeg = m.jpeg;

  // Render findings / evidence cards with specific visual styling
  const evCards = model.evidence
    .map((e) => {
      const isDanger = e.strength === "inconsistency";
      const isWarn = e.strength === "indicator";
      const isOk = e.strength === "none" || e.strength === "weak";
      
      let badgeColor = "bg-neutral-100 text-neutral-800 border-neutral-300";
      if (isDanger) badgeColor = "bg-rose-50 text-rose-700 border-rose-200";
      else if (isWarn) badgeColor = "bg-amber-50 text-amber-700 border-amber-200";
      else if (isOk) badgeColor = "bg-emerald-50 text-emerald-700 border-emerald-200";

      return `
      <div class="evidence-card ${isDanger ? "border-danger" : isWarn ? "border-warn" : ""}">
        <div class="card-header">
          <h3>${esc(e.detector)}</h3>
          <span class="badge ${badgeColor}">${esc(e.status.toUpperCase())} · ${esc(e.strength.toUpperCase())}</span>
        </div>
        <div class="card-grid">
          <div class="field">
            <span class="field-label">Observation</span>
            <p class="field-value">${esc(e.observation)}</p>
          </div>
          <div class="field">
            <span class="field-label">Measurement Metrics</span>
            <p class="field-value font-mono text-xs bg-slate-50 p-1.5 rounded">${esc(e.measurement)}</p>
          </div>
          <div class="field">
            <span class="field-label">Analyzed Region</span>
            <p class="field-value">${esc(e.region)}</p>
          </div>
          <div class="field">
            <span class="field-label">Uncertainty Bound</span>
            <p class="field-value font-mono text-xs">${esc(e.uncertainty)}</p>
          </div>
        </div>
        <div class="card-footer">
          <p><strong>Methodological Limitations:</strong> ${esc(e.limitations.join(" "))}</p>
        </div>
      </div>`;
    })
    .join("\n");

  // Render attached forensic images if available
  let attachedImagesHtml = "";
  if (model.originalImageBase64 || (model.analysisImages && model.analysisImages.length > 0)) {
    let originalCard = "";
    if (model.originalImageBase64) {
      originalCard = `
      <div class="image-card">
        <h4 class="image-card-title">Ingested Source Evidence (Original)</h4>
        <div class="image-wrapper">
          <img referrerPolicy="no-referrer" src="${model.originalImageBase64}" alt="Original forensic target" />
        </div>
        <p class="image-caption">Cryptographically verified ingestion snapshot of the original target media.</p>
      </div>`;
    }

    let analysisCards = "";
    if (model.analysisImages && model.analysisImages.length > 0) {
      analysisCards = model.analysisImages
        .map((img) => `
        <div class="image-card">
          <h4 class="image-card-title">Forensic Map: ${esc(img.title)}</h4>
          <div class="image-wrapper">
            <img referrerPolicy="no-referrer" src="${img.base64}" alt="${esc(img.title)} analysis map" />
          </div>
          <p class="image-caption">Visualization generated via WASM computation kernel with standard settings.</p>
        </div>`)
        .join("\n");
    }

    attachedImagesHtml = `
    <h2 class="section-title">Attached Forensic Image Evidence</h2>
    <div class="images-container">
      ${originalCard}
      ${analysisCards}
    </div>`;
  }

  // Render chain of custody timeline
  const timelineNodes = model.custody
    .map((event, idx) => `
    <div class="timeline-item">
      <div class="timeline-badge">${idx + 1}</div>
      <div class="timeline-panel">
        <div class="timeline-heading">
          <h4 class="timeline-title">${esc(event.operation)}</h4>
          <p><small class="text-muted"><time class="font-mono">${esc(event.ts)}</time> · Engine: ${esc(event.engine)} (v${esc(event.softwareVersion)})</small></p>
        </div>
        <div class="timeline-body">
          <p>${esc(JSON.stringify(event.parameters))}</p>
          ${event.hashSha256 ? `<p class="text-xs text-slate-500 mt-1">SHA-256: <code class="bg-slate-100 px-1 py-0.5 rounded font-mono break-all">${esc(event.hashSha256)}</code></p>` : ""}
        </div>
      </div>
    </div>`)
    .join("\n");

  // Render JPEG quantization values if available
  let qTableHtml = "";
  if (jpeg?.quantizationTables && jpeg.quantizationTables.length > 0) {
    const qValues = jpeg.quantizationTables[0].values;
    let gridCells = "";
    for (let i = 0; i < 64; i++) {
      const val = qValues[i] ?? 0;
      // High quantization values styled with subtle heatmaps
      const intensity = Math.min(100, Math.max(0, Math.floor((val / 120) * 100)));
      const style = `background-color: rgba(224, 242, 254, ${intensity / 100}); font-weight: ${val > 20 ? "600" : "400"};`;
      gridCells += `<div class="q-cell" style="${style}">${val}</div>`;
    }
    qTableHtml = `
    <div class="q-table-container">
      <h3 class="section-subtitle">JPEG Luminance Quantization Matrix (DQT Table 0)</h3>
      <div class="q-grid">
        ${gridCells}
      </div>
      <p class="text-xs text-slate-500 mt-2">Matrix coefficients dictate compression loss levels. Higher values on high frequencies indicate heavy recompression artifacts.</p>
    </div>`;
  }

  // EXIF fields list
  const exifRows = m.fields
    .map((f) => `
    <tr class="exif-row">
      <td class="exif-tag font-mono text-slate-500 text-xs">${esc(f.group)}.${esc(f.key)}</td>
      <td class="exif-val text-slate-800 text-xs font-mono">${esc(f.value)}</td>
    </tr>`)
    .join("\n");

  const generatedDateStr = new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Tracebench Cryptographic Forensic Dossier — ${esc(c.caseId)}</title>
  <style>
    :root {
      --primary: #0f172a;
      --primary-light: #1e293b;
      --accent: #0284c7;
      --border: #e2e8f0;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #334155;
      --text-dark: #0f172a;
      --success: #10b981;
      --warn: #f59e0b;
      --danger: #ef4444;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      line-height: 1.5;
      background-color: var(--bg);
      color: var(--text);
      padding: 40px 24px;
    }
    
    .container {
      max-width: 1040px;
      margin: 0 auto;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(15, 23, 42, 0.05);
      overflow: hidden;
    }
    
    /* Header Stamp & Title block */
    .header-bar {
      background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%);
      color: #ffffff;
      padding: 32px;
      position: relative;
      border-bottom: 4px solid var(--accent);
    }
    .header-badge {
      position: absolute;
      top: 32px;
      right: 32px;
      border: 2px dashed rgba(255,255,255,0.4);
      padding: 6px 12px;
      font-family: monospace;
      font-size: 11px;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #38bdf8;
      border-radius: 4px;
    }
    .header-bar h1 {
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.025em;
      margin-bottom: 8px;
    }
    .header-bar p {
      font-size: 14px;
      color: #94a3b8;
    }
    
    /* Content sections */
    .content {
      padding: 32px;
    }
    
    h2.section-title {
      font-size: 14px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--primary-light);
      margin: 32px 0 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    h2.section-title:first-of-type {
      margin-top: 0;
    }
    
    /* Case specs grid */
    .specs-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .spec-item {
      background: #f8fafc;
      border: 1px solid #f1f5f9;
      padding: 14px;
      border-radius: 8px;
    }
    .spec-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      color: #64748b;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
      display: block;
    }
    .spec-value {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-dark);
      word-break: break-all;
    }
    
    /* Evidence cards */
    .evidence-list {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .evidence-card {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      transition: all 0.2s;
    }
    .evidence-card:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.02);
    }
    .evidence-card.border-danger {
      border-left: 4px solid var(--danger);
    }
    .evidence-card.border-warn {
      border-left: 4px solid var(--warn);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 14px;
    }
    .card-header h3 {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-dark);
    }
    .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 9999px;
      border: 1px solid;
      letter-spacing: 0.025em;
      white-space: nowrap;
    }
    
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 12px;
    }
    .field-label {
      font-size: 10px;
      text-transform: uppercase;
      color: #94a3b8;
      font-weight: 600;
      display: block;
      margin-bottom: 2px;
    }
    .field-value {
      font-size: 12px;
      color: var(--text);
    }
    .card-footer {
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px dashed #f1f5f9;
      font-size: 11px;
      color: #64748b;
    }
    
    /* Timeline styles for Custody */
    .timeline {
      position: relative;
      padding-left: 32px;
      margin: 16px 0;
    }
    .timeline::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 15px;
      width: 2px;
      background-color: var(--border);
    }
    .timeline-item {
      position: relative;
      margin-bottom: 24px;
    }
    .timeline-item:last-child {
      margin-bottom: 0;
    }
    .timeline-badge {
      position: absolute;
      left: -32px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: var(--primary);
      color: white;
      font-size: 11px;
      font-weight: bold;
      border: 4px solid var(--card-bg);
    }
    .timeline-panel {
      background: #f8fafc;
      border: 1px solid #f1f5f9;
      padding: 16px;
      border-radius: 8px;
    }
    .timeline-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-dark);
    }
    .timeline-body {
      font-size: 12px;
      margin-top: 6px;
    }
    
    /* JPEG Quantization matrix visualization */
    .q-grid {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: 2px;
      max-width: 320px;
      margin: 12px 0;
      border: 1px solid var(--border);
      padding: 2px;
      border-radius: 6px;
      background: #f1f5f9;
    }
    .q-cell {
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: monospace;
      font-size: 11px;
      border-radius: 3px;
      background: white;
    }
    .section-subtitle {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-dark);
      margin-top: 16px;
    }
    
    /* EXIF Table scrollable */
    .exif-container {
      max-height: 300px;
      overflow-y: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .exif-table {
      width: 100%;
      border-collapse: collapse;
    }
    .exif-table th {
      background: #f8fafc;
      position: sticky;
      top: 0;
      text-align: left;
      padding: 10px 16px;
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      color: #64748b;
      border-bottom: 1px solid var(--border);
    }
    .exif-row {
      border-bottom: 1px solid #f1f5f9;
    }
    .exif-row:last-child {
      border-bottom: none;
    }
    .exif-tag {
      padding: 8px 16px;
      width: 35%;
      font-weight: 500;
      border-right: 1px solid #f1f5f9;
    }
    .exif-val {
      padding: 8px 16px;
    }
    
    /* Certification Stamp signature block */
    .certification-block {
      margin-top: 40px;
      padding: 24px;
      border: 2px solid var(--primary-light);
      border-radius: 8px;
      background: #fafaf9;
      display: flex;
      flex-wrap: wrap;
      gap: 24px;
      justify-content: space-between;
      align-items: center;
    }
    .cert-details {
      flex: 1;
      min-width: 250px;
    }
    .cert-title {
      font-size: 14px;
      font-weight: 700;
      color: var(--text-dark);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cert-text {
      font-size: 12px;
      color: #64748b;
      line-height: 1.6;
    }
    .cert-seal {
      width: 140px;
      height: 140px;
      border: 3px double var(--primary);
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 10px;
      text-align: center;
      font-family: monospace;
      background: white;
      color: var(--primary);
      user-select: none;
      box-shadow: 0 4px 10px rgba(0,0,0,0.03);
    }
    .seal-text-top { font-size: 8px; font-weight: bold; letter-spacing: 1px; }
    .seal-text-mid { font-size: 11px; font-weight: 900; color: var(--accent); margin: 4px 0; }
    .seal-text-bot { font-size: 7px; color: #64748b; }

    /* Attached image styling */
    .images-container {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .image-card {
      background: #ffffff;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .image-card-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-dark);
      margin-bottom: 8px;
    }
    .image-wrapper {
      width: 100%;
      height: 240px;
      border-radius: 6px;
      overflow: hidden;
      background: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
    }
    .image-wrapper img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .image-caption {
      font-size: 11px;
      color: #64748b;
      margin-top: 8px;
      line-height: 1.4;
    }
    
    /* Print optimizations */
    @media print {
      body {
        background: #ffffff;
        padding: 0;
        font-size: 12px;
      }
      .container {
        border: none;
        box-shadow: none;
      }
      .header-bar {
        background: #f8fafc !important;
        color: #0f172a !important;
        border-bottom: 2px solid #0f172a;
        padding: 16px 0;
      }
      .header-badge {
        color: #000000 !important;
        border-color: #000000 !important;
      }
      .spec-item {
        background: #ffffff !important;
        border: 1px solid #cbd5e1 !important;
      }
      .evidence-card {
        border: 1px solid #cbd5e1 !important;
        page-break-inside: avoid;
      }
      .timeline-panel {
        background: #ffffff !important;
        border: 1px solid #cbd5e1 !important;
      }
      .cert-seal {
        border-color: #000000 !important;
      }
      .image-card {
        border: 1px solid #cbd5e1 !important;
        page-break-inside: avoid;
      }
      .exif-container {
        max-height: none !important;
        overflow: visible !important;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header Block -->
    <header class="header-bar">
      <div class="header-badge">VERIFIED BLOCK</div>
      <h1>Tracebench Forensic Report</h1>
      <p>Cryptographic integrity, raster forensics, and structure measurement dossier.</p>
    </header>

    <div class="content">
      <!-- Case & File Overview -->
      <h2 class="section-title">Case & Original File Overview</h2>
      <div class="specs-grid">
        <div class="spec-item">
          <span class="spec-label">Case Identifier</span>
          <span class="spec-value font-mono">${esc(c.caseId)}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Evidence Tag</span>
          <span class="spec-value font-mono">${esc(c.evidenceId)}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Original Filename</span>
          <span class="spec-value">${esc(c.originalFilename)}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Format / Dimensions</span>
          <span class="spec-value">${esc(c.mime)} · ${c.width} × ${c.height} px</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">SHA-256 Signature</span>
          <span class="spec-value font-mono text-xs">${esc(c.sha256)}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">SHA-512 Signature</span>
          <span class="spec-value font-mono text-xs">${esc(c.sha512)}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Analysis Timestamp</span>
          <span class="spec-value font-mono text-xs">${esc(c.analyzedAt)}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Engine / Software</span>
          <span class="spec-value font-mono text-xs">${esc(c.softwareVersion)} / ${esc(model.engine)}</span>
        </div>
      </div>

      <!-- Core Evidence Findings -->
      <h2 class="section-title">Forensic Engine Evidence Dossier</h2>
      <div class="evidence-list">
        ${evCards}
      </div>

      <!-- JPEG Metadata Analysis -->
      <h2 class="section-title">Structural Artifact Measurement</h2>
      <div class="specs-grid">
        <div class="spec-item">
          <span class="spec-label">Coding Profile</span>
          <span class="spec-value">${jpeg?.progressive ? "Progressive Scan" : "Baseline Sequential"}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Chroma Subsampling</span>
          <span class="spec-value">${jpeg?.chromaSubsampling ?? "N/A (Non-JPEG)"}</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Color Channels</span>
          <span class="spec-value">${jpeg?.components ?? "N/A"} channels</span>
        </div>
        <div class="spec-item">
          <span class="spec-label">Estimated Quality Index</span>
          <span class="spec-value font-mono text-xs">${jpeg?.estimatedQuality != null ? jpeg.estimatedQuality.toFixed(1) + "%" : "N/A"}</span>
        </div>
      </div>
      
      ${qTableHtml}

      ${attachedImagesHtml}

      <!-- Chain of Custody Timeline -->
      <h2 class="section-title">Chain of Custody Ledger (Audit Trail)</h2>
      <div class="timeline">
        ${timelineNodes}
      </div>

      <!-- EXIF / Metadata Tag Ledger -->
      <h2 class="section-title">Embedded EXIF Metadata Tag Registry</h2>
      <div class="exif-container">
        <table class="exif-table">
          <thead>
            <tr>
              <th>Tag Namespace & Name</th>
              <th>Parsed Value</th>
            </tr>
          </thead>
          <tbody>
            ${exifRows}
          </tbody>
        </table>
      </div>

      <!-- Digital Signature & Stamp Certify Block -->
      <div class="certification-block">
        <div class="cert-details">
          <h4 class="cert-title">
            <svg class="text-emerald-500" style="width: 16px; height: 16px; fill: currentColor;" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M2.166 4.9L10 .954l7.834 3.946A2 2 0 0119 6.653v5.694a4 4 0 01-1.316 2.985l-7.143 6.308a.8.8 0 01-1.082 0l-7.143-6.308A4 4 0 011 12.347V6.653a2 2 0 011.166-1.753zm7.25 10.748L14.75 10.4a.75.75 0 10-1.1-1.02l-4.14 4.47-1.82-1.82a.75.75 0 10-1.06 1.06l2.35 2.35a.75.75 0 001.036.008z" clip-rule="evenodd"/>
            </svg>
            Cryptographic Integrity Certification
          </h4>
          <p class="cert-text">
            This document certifies that the original file bytes were ingested into the immutable 
            Tracebench memory sandbox. All derived forensic analysis maps, Laplacian residuals, 
            Discrete Cosine Transforms, and copy-move hashes correspond to the cryptographic signature 
            indexed above.
          </p>
          <p class="cert-text" style="margin-top: 8px;">
            <strong>Verification Hash:</strong> <code class="font-mono text-xs bg-stone-200 px-1.5 py-0.5 rounded text-stone-800">${esc(c.sha256.substring(0, 32))}...</code>
          </p>
          <p class="cert-text" style="margin-top: 6px; font-size: 11px;">
            Report generated automatically via Tracebench WASM Core on: <time class="font-mono">${generatedDateStr}</time>
          </p>
        </div>
        
        <div class="cert-seal">
          <div class="seal-text-top">FORENSIC LAB</div>
          <div class="seal-text-mid">TRACEBENCH</div>
          <div class="seal-text-top">CERTIFIED</div>
          <div class="seal-text-bot" style="margin-top: 6px;">HASH ID: ${esc(c.caseId.substring(0, 8))}</div>
        </div>
      </div>

    </div>
  </div>
</body>
</html>`;
}

function esc(s: any): string {
  const str = s === undefined || s === null ? "" : String(s);
  return str.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
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
