# Tracebench

A local digital-image forensics workstation. Images never leave the browser.

- **Engine:** Rust → `wasm32-unknown-unknown` (`crates/forensic-engine`) with a TypeScript CPU fallback
- **UI:** React + TanStack Start, dark high-density laboratory layout
- **Privacy:** decode, hash, and detect in-memory; the original file is immutable

## What it does

Opens a JPEG/PNG/WebP, computes SHA-256/512, walks JPEG markers and EXIF/PNG metadata, then runs ELA, noise, edge, sharpness, DCT, resampling, copy-move, color, CFA (experimental), and PRNU residual (no reference fingerprint).

Results are **observations + statistics + limitations**, never “95% fake”.

## Build the WASM kernel

```
sh scripts/build-wasm.sh
```

Native tests:

```
cargo test -p forensic-engine --lib
```

## Scientific language

Use “no significant anomaly”, “potential indicator”, “statistical inconsistency”, or “insufficient evidence”. Do not treat a single heatmap as proof of editing or generative origin.

See `docs/DETECTORS.md`.
