#!/bin/sh
set -eu
cd /workspace
node scripts/preview.mjs stop || true
if [ ! -f public/forensic-engine.wasm ]; then
  sh scripts/build-wasm.sh || true
fi
if curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev >>/tmp/app-startup.log 2>&1 &
