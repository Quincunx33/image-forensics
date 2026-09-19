export async function shaHex(buffer: ArrayBuffer, algo: "SHA-256" | "SHA-512"): Promise<string> {
  const buf = await crypto.subtle.digest(algo, buffer);
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, "0");
  return hex;
}

export function caseIdFromHash(sha256: string, ts: Date): string {
  const d = ts.toISOString().slice(0, 10).replace(/-/g, "");
  return `TB-${d}-${sha256.slice(0, 6).toUpperCase()}`;
}

export function evidenceIdFromHash(sha256: string): string {
  return `EV-${sha256.slice(0, 12).toUpperCase()}`;
}
