# Tracebench detectors

Every detector writes a measurement, the method, parameters, and limitations.
None of them emit an authenticity probability.

| Detector | Method | Status |
| --- | --- | --- |
| ELA | JPEG re-encode → absolute residual → percentile scale | Implemented (Rust/WASM + JS) |
| Local noise | Integral-image variance, Laplacian, high-pass, median | Implemented |
| Edge | Sobel / Scharr / Laplacian / NMS | Implemented |
| Sharpness | Variance of Laplacian + gradient energy | Implemented |
| DCT / frequency | 8×8 DCT-II band energy; 8×8 blocking | Implemented |
| Double JPEG | DCT histogram autocorrelation | Implemented — not proof of editing |
| Resampling | Second-derivative even/odd lag | Implemented |
| Copy-move | Block descriptors + offset clustering | Implemented |
| Color | Opponent-color gradient excess | Implemented |
| Thumbnail | EXIF JPEG thumbnail vs scaled main | Implemented when present |
| CFA | 2×2 green residual | Experimental |
| PRNU | Median residual without reference set | Experimental / not attribution |
| Semantic regions (face, hands, …) | Requires a local vision model | Not implemented — statistical hotspots only |

ELA is marked **not applicable** on non-JPEG containers.
