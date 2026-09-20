import { existsSync, cpSync, mkdirSync } from "node:fs";

// If Nitro built for Vercel (.vercel/output/static) but the deployment platform (e.g. Cloudflare Pages)
// expects `dist`, mirror the static output into `dist` so validation never fails.
if (!existsSync("dist") && existsSync(".vercel/output/static")) {
  console.log("[ensure-dist] Mirroring .vercel/output/static to dist...");
  mkdirSync("dist", { recursive: true });
  cpSync(".vercel/output/static", "dist", { recursive: true });
}
