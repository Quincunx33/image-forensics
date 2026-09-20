#!/bin/sh
set -eu
cd /workspace
echo "[tracebench] building forensic-engine wasm"
RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=+simd128" \
  cargo build -p forensic-engine --release --target wasm32-unknown-unknown
src="target/wasm32-unknown-unknown/release/forensic_engine.wasm"
dst="public/forensic-engine.wasm"
mkdir -p public
cp "$src" "$dst"
ls -la "$dst"
