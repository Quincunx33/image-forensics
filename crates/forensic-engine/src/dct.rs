//! 8×8 DCT-II, frequency band energy maps, double-compression periodicity.

use crate::stats::{scale_to_u8, Stats};

const CS: [f32; 8] = [
    0.70710678, 0.49039264, 0.46193977, 0.41573481, 0.35355339, 0.27778512, 0.19134172, 0.09754516,
];

fn dct_1d(x: &[f32; 8], y: &mut [f32; 8]) {
    // Scaled DCT-II, orthonormal-ish coefficients for energy maps (not JPEG exact).
    for k in 0..8 {
        let mut s = 0.0;
        for n in 0..8 {
            let ang = std::f32::consts::PI / 8.0 * k as f32 * (n as f32 + 0.5);
            s += x[n] * ang.cos();
        }
        y[k] = s * if k == 0 { CS[0] } else { 0.5 };
    }
}

fn dct_2d(block: &[f32; 64], out: &mut [f32; 64]) {
    let mut tmp = [0f32; 64];
    let mut row = [0f32; 8];
    let mut drow = [0f32; 8];
    for r in 0..8 {
        for c in 0..8 {
            row[c] = block[r * 8 + c];
        }
        dct_1d(&row, &mut drow);
        for c in 0..8 {
            tmp[r * 8 + c] = drow[c];
        }
    }
    let mut col = [0f32; 8];
    let mut dcol = [0f32; 8];
    for c in 0..8 {
        for r in 0..8 {
            col[r] = tmp[r * 8 + c];
        }
        dct_1d(&col, &mut dcol);
        for r in 0..8 {
            out[r * 8 + c] = dcol[r];
        }
    }
}

/// band: 0 low (u+v<=2), 1 mid, 2 high (u+v>=8), 3 all AC energy, 4 block artifact
pub fn frequency_map(
    y: &[f32],
    w: u32,
    h: u32,
    band: u32,
    gain: f32,
    percentile: f32,
    out: &mut [u8],
) -> Stats {
    let w = w as usize;
    let h = h as usize;
    let n = w * h;
    let mut r = vec![0f32; n];
    let bw = w / 8;
    let bh = h / 8;
    if band == 4 {
        // Discontinuity across 8×8 boundaries
        for yy in 0..h {
            for xx in 0..w {
                let mut e = 0.0;
                if xx > 0 && xx % 8 == 0 {
                    e += (y[yy * w + xx] - y[yy * w + xx - 1]).abs();
                }
                if yy > 0 && yy % 8 == 0 {
                    e += (y[yy * w + xx] - y[(yy - 1) * w + xx]).abs();
                }
                r[yy * w + xx] = e;
            }
        }
        return scale_to_u8(&r, out, gain, percentile);
    }
    let mut block = [0f32; 64];
    let mut coeff = [0f32; 64];
    for by in 0..bh {
        for bx in 0..bw {
            for j in 0..8 {
                for i in 0..8 {
                    block[j * 8 + i] = y[(by * 8 + j) * w + (bx * 8 + i)];
                }
            }
            dct_2d(&block, &mut coeff);
            let mut e = 0.0;
            for v in 0..8 {
                for u in 0..8 {
                    if u == 0 && v == 0 {
                        continue;
                    }
                    let s = u + v;
                    let include = match band {
                        0 => s <= 2,
                        1 => s > 2 && s < 8,
                        2 => s >= 8,
                        _ => true,
                    };
                    if include {
                        e += coeff[v * 8 + u] * coeff[v * 8 + u];
                    }
                }
            }
            e = e.sqrt();
            for j in 0..8 {
                for i in 0..8 {
                    r[(by * 8 + j) * w + (bx * 8 + i)] = e;
                }
            }
        }
    }
    scale_to_u8(&r, out, gain, percentile)
}

/// Histogram-periodicity indicator map for possible double JPEG (aligned).
pub fn double_jpeg_map(
    y: &[f32],
    w: u32,
    h: u32,
    gain: f32,
    percentile: f32,
    out: &mut [u8],
) -> (Stats, f64) {
    let w = w as usize;
    let h = h as usize;
    let n = w * h;
    let bw = w / 8;
    let bh = h / 8;
    let mut hist = [0u32; 512];
    let mut block = [0f32; 64];
    let mut coeff = [0f32; 64];
    let mut ac_abs: Vec<i32> = Vec::with_capacity(bw * bh * 16);
    for by in 0..bh {
        for bx in 0..bw {
            for j in 0..8 {
                for i in 0..8 {
                    block[j * 8 + i] = y[(by * 8 + j) * w + (bx * 8 + i)] - 128.0;
                }
            }
            dct_2d(&block, &mut coeff);
            // Use a mid-frequency coefficient often quantized (u=1,v=0)
            let c = coeff[1].round() as i32;
            ac_abs.push(c);
            let bin = (c + 256).clamp(0, 511) as usize;
            hist[bin] += 1;
        }
    }
    // Periodicity score: peak of autocorrelation of the histogram (lags 2..16)
    let mut best_lag = 0;
    let mut best = 0.0f64;
    let mean: f64 = hist.iter().map(|x| *x as f64).sum::<f64>() / 512.0;
    for lag in 2..17 {
        let mut acc = 0.0;
        let mut c = 0.0;
        for i in 0..(512 - lag) {
            acc += (hist[i] as f64 - mean) * (hist[i + lag] as f64 - mean);
            c += 1.0;
        }
        let v = acc / c;
        if v > best {
            best = v;
            best_lag = lag;
        }
    }
    let energy: f64 = hist.iter().map(|x| {
        let d = *x as f64 - mean;
        d * d
    }).sum::<f64>()
        / 512.0;
    let score = if energy > 1.0 { best / energy } else { 0.0 };

    // Local map: blocks whose DCT (1,0) is near a multiple of estimated period
    let mut r = vec![0f32; n];
    let period = best_lag.max(2) as f32;
    let mut idx = 0;
    for by in 0..bh {
        for bx in 0..bw {
            let c = ac_abs[idx] as f32;
            idx += 1;
            let nearest = (c / period).round() * period;
            let dist = (c - nearest).abs();
            let v = (1.0 - dist / (period * 0.5)).max(0.0);
            for j in 0..8 {
                for i in 0..8 {
                    r[(by * 8 + j) * w + (bx * 8 + i)] = v;
                }
            }
        }
    }
    let stats = scale_to_u8(&r, out, gain, percentile);
    (stats, score)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dct_dc_energy() {
        let block = [1.0f32; 64];
        let mut out = [0f32; 64];
        dct_2d(&block, &mut out);
        // DC should dominate a constant block
        assert!(out[0].abs() > out[1].abs());
        assert!(out[0].abs() > 0.5);
    }
}
