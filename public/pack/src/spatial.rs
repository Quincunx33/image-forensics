//! Spatial detectors: noise, edges, sharpness, color, CFA, resampling.

use crate::stats::{luma, scale_to_u8, Stats};

pub fn to_luma(rgba: &[u8], w: u32, h: u32) -> Vec<f32> {
    let n = (w as usize) * (h as usize);
    let mut y = Vec::with_capacity(n);
    for i in 0..n {
        y.push(luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]));
    }
    y
}

fn clamp_i(v: i32, max: i32) -> i32 {
    v.clamp(0, max)
}

/// Box-filter residual (high-pass), local variance, Laplacian, median, multi-scale.
/// method: 0 hp, 1 var, 2 std, 3 lap, 4 median, 5 multiscale
pub fn noise_map(
    y: &[f32],
    w: u32,
    h: u32,
    method: u32,
    window: u32,
    gain: f32,
    percentile: f32,
    out: &mut [u8],
) -> Stats {
    let w = w as usize;
    let h = h as usize;
    let n = w * h;
    let mut r = vec![0f32; n];
    let radius = ((window.max(3) as usize) / 2).min(15);

    match method {
        1 | 2 => {
            // Integral images for O(1) window variance
            let mut sum = vec![0f64; (w + 1) * (h + 1)];
            let mut sq = vec![0f64; (w + 1) * (h + 1)];
            for yy in 0..h {
                let mut rs = 0.0;
                let mut rq = 0.0;
                for xx in 0..w {
                    let v = y[yy * w + xx] as f64;
                    rs += v;
                    rq += v * v;
                    let i = (yy + 1) * (w + 1) + (xx + 1);
                    sum[i] = sum[yy * (w + 1) + (xx + 1)] + rs;
                    sq[i] = sq[yy * (w + 1) + (xx + 1)] + rq;
                }
            }
            let rect = |int: &[f64], x0: i32, y0: i32, x1: i32, y1: i32| -> f64 {
                let idx = |x: i32, y: i32| (y.max(0) as usize) * (w + 1) + (x.max(0) as usize);
                int[idx(x1, y1)] + int[idx(x0, y0)] - int[idx(x1, y0)] - int[idx(x0, y1)]
            };
            for yy in 0..h {
                for xx in 0..w {
                    let x0 = xx as i32 - radius as i32;
                    let y0 = yy as i32 - radius as i32;
                    let x1 = (xx as i32 + radius as i32 + 1).min(w as i32);
                    let y1 = (yy as i32 + radius as i32 + 1).min(h as i32);
                    let x0c = x0.max(0);
                    let y0c = y0.max(0);
                    let area = ((x1 - x0c) * (y1 - y0c)).max(1) as f64;
                    let s = rect(&sum, x0c, y0c, x1, y1);
                    let q = rect(&sq, x0c, y0c, x1, y1);
                    let mean = s / area;
                    let var = (q / area - mean * mean).max(0.0);
                    r[yy * w + xx] = if method == 2 {
                        var.sqrt() as f32
                    } else {
                        var as f32
                    };
                }
            }
        }
        3 => {
            // Laplacian residual (4-neighbour)
            for yy in 0..h {
                for xx in 0..w {
                    let c = y[yy * w + xx];
                    let l = y[yy * w + xx.saturating_sub(1)];
                    let ri = y[yy * w + (xx + 1).min(w - 1)];
                    let u = y[yy.saturating_sub(1) * w + xx];
                    let d = y[(yy + 1).min(h - 1) * w + xx];
                    r[yy * w + xx] = (4.0 * c - l - ri - u - d).abs();
                }
            }
        }
        4 => {
            // 3x3 median residual
            let mut win = [0f32; 9];
            for yy in 0..h {
                for xx in 0..w {
                    let mut k = 0;
                    for dy in -1i32..=1 {
                        for dx in -1i32..=1 {
                            let x = clamp_i(xx as i32 + dx, w as i32 - 1) as usize;
                            let yv = clamp_i(yy as i32 + dy, h as i32 - 1) as usize;
                            win[k] = y[yv * w + x];
                            k += 1;
                        }
                    }
                    win.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                    r[yy * w + xx] = (y[yy * w + xx] - win[4]).abs();
                }
            }
        }
        5 => {
            // Multi-scale: |y - box3| + |y - box7|
            let hp = |rad: usize, dst: &mut [f32]| {
                for yy in 0..h {
                    for xx in 0..w {
                        let mut s = 0.0;
                        let mut c = 0.0;
                        let y0 = yy.saturating_sub(rad);
                        let y1 = (yy + rad).min(h - 1);
                        let x0 = xx.saturating_sub(rad);
                        let x1 = (xx + rad).min(w - 1);
                        for yv in y0..=y1 {
                            for x in x0..=x1 {
                                s += y[yv * w + x];
                                c += 1.0;
                            }
                        }
                        dst[yy * w + xx] = (y[yy * w + xx] - s / c).abs();
                    }
                }
            };
            let mut a = vec![0f32; n];
            let mut b = vec![0f32; n];
            hp(1, &mut a);
            hp(3, &mut b);
            for i in 0..n {
                r[i] = a[i] + 0.5 * b[i];
            }
        }
        _ => {
            // High-pass vs box mean
            for yy in 0..h {
                for xx in 0..w {
                    let mut s = 0.0;
                    let mut c = 0.0;
                    let y0 = yy.saturating_sub(radius);
                    let y1 = (yy + radius).min(h - 1);
                    let x0 = xx.saturating_sub(radius);
                    let x1 = (xx + radius).min(w - 1);
                    for yv in y0..=y1 {
                        for x in x0..=x1 {
                            s += y[yv * w + x];
                            c += 1.0;
                        }
                    }
                    r[yy * w + xx] = (y[yy * w + xx] - s / c).abs();
                }
            }
        }
    }
    scale_to_u8(&r, out, gain, percentile)
}

/// method: 0 Sobel, 1 Scharr, 2 Laplacian, 3 Canny-like (sobel + thin)
pub fn edge_map(
    y: &[f32],
    w: u32,
    h: u32,
    method: u32,
    gain: f32,
    percentile: f32,
    out: &mut [u8],
) -> Stats {
    let w = w as usize;
    let h = h as usize;
    let n = w * h;
    let mut mag = vec![0f32; n];
    let mut gx = vec![0f32; n];
    let mut gy = vec![0f32; n];

    let (kx, ky): ([f32; 9], [f32; 9]) = if method == 1 {
        (
            [-3.0, 0.0, 3.0, -10.0, 0.0, 10.0, -3.0, 0.0, 3.0],
            [-3.0, -10.0, -3.0, 0.0, 0.0, 0.0, 3.0, 10.0, 3.0],
        )
    } else {
        (
            [-1.0, 0.0, 1.0, -2.0, 0.0, 2.0, -1.0, 0.0, 1.0],
            [-1.0, -2.0, -1.0, 0.0, 0.0, 0.0, 1.0, 2.0, 1.0],
        )
    };

    if method == 2 {
        for yy in 1..h - 1 {
            for xx in 1..w - 1 {
                let c = y[yy * w + xx];
                mag[yy * w + xx] = (4.0 * c
                    - y[yy * w + xx - 1]
                    - y[yy * w + xx + 1]
                    - y[(yy - 1) * w + xx]
                    - y[(yy + 1) * w + xx])
                    .abs();
            }
        }
        return scale_to_u8(&mag, out, gain, percentile);
    }

    for yy in 1..h - 1 {
        for xx in 1..w - 1 {
            let mut sx = 0.0;
            let mut sy = 0.0;
            let mut k = 0;
            for dy in 0..3 {
                for dx in 0..3 {
                    let v = y[(yy + dy - 1) * w + (xx + dx - 1)];
                    sx += v * kx[k];
                    sy += v * ky[k];
                    k += 1;
                }
            }
            gx[yy * w + xx] = sx;
            gy[yy * w + xx] = sy;
            mag[yy * w + xx] = (sx * sx + sy * sy).sqrt();
        }
    }

    if method == 3 {
        // Non-maximum suppression + simple hysteresis-ish keep
        let mut thin = vec![0f32; n];
        for yy in 1..h - 1 {
            for xx in 1..w - 1 {
                let i = yy * w + xx;
                let m = mag[i];
                let ax = gx[i].abs();
                let ay = gy[i].abs();
                let (n1, n2) = if ax > ay {
                    (mag[i - 1], mag[i + 1])
                } else {
                    (mag[i - w], mag[i + w])
                };
                if m >= n1 && m >= n2 {
                    thin[i] = m;
                }
            }
        }
        mag = thin;
    }
    scale_to_u8(&mag, out, gain, percentile)
}

/// Variance of Laplacian + gradient energy mix.
pub fn sharpness_map(
    y: &[f32],
    w: u32,
    h: u32,
    window: u32,
    gain: f32,
    percentile: f32,
    out: &mut [u8],
) -> Stats {
    let w = w as usize;
    let h = h as usize;
    let n = w * h;
    let mut lap = vec![0f32; n];
    for yy in 1..h - 1 {
        for xx in 1..w - 1 {
            let c = y[yy * w + xx];
            lap[yy * w + xx] = 4.0 * c
                - y[yy * w + xx - 1]
                - y[yy * w + xx + 1]
                - y[(yy - 1) * w + xx]
                - y[(yy + 1) * w + xx];
        }
    }
    let radius = ((window.max(5) as usize) / 2).min(11);
    let mut r = vec![0f32; n];
    for yy in 0..h {
        for xx in 0..w {
            let mut s = 0.0;
            let mut sq = 0.0;
            let mut g = 0.0;
            let mut c = 0.0;
            let y0 = yy.saturating_sub(radius);
            let y1 = (yy + radius).min(h - 1);
            let x0 = xx.saturating_sub(radius);
            let x1 = (xx + radius).min(w - 1);
            for yv in y0..=y1 {
                for x in x0..=x1 {
                    let v = lap[yv * w + x];
                    s += v;
                    sq += v * v;
                    if x + 1 <= x1 {
                        let dx = y[yv * w + x] - y[yv * w + (x + 1).min(w - 1)];
                        g += dx * dx;
                    }
                    c += 1.0;
                }
            }
            let mean = s / c;
            let var = (sq / c - mean * mean).max(0.0);
            r[yy * w + xx] = var + 0.15 * (g / c);
        }
    }
    scale_to_u8(&r, out, gain, percentile)
}

/// Color discontinuity: chroma gradient vs luma gradient (Lab-ish a,b via simple opponent).
pub fn color_anomaly_map(
    rgba: &[u8],
    w: u32,
    h: u32,
    gain: f32,
    percentile: f32,
    out: &mut [u8],
) -> Stats {
    let w = w as usize;
    let h = h as usize;
    let n = w * h;
    let mut a = vec![0f32; n];
    let mut b = vec![0f32; n];
    let mut y = vec![0f32; n];
    for i in 0..n {
        let r = rgba[i * 4] as f32;
        let g = rgba[i * 4 + 1] as f32;
        let bl = rgba[i * 4 + 2] as f32;
        y[i] = luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
        a[i] = r - g;
        b[i] = 0.5 * (r + g) - bl;
    }
    let mut rmap = vec![0f32; n];
    for yy in 1..h - 1 {
        for xx in 1..w - 1 {
            let i = yy * w + xx;
            let gy = (y[i + 1] - y[i - 1]).abs() + (y[i + w] - y[i - w]).abs();
            let ga = (a[i + 1] - a[i - 1]).abs() + (a[i + w] - a[i - w]).abs();
            let gb = (b[i + 1] - b[i - 1]).abs() + (b[i + w] - b[i - w]).abs();
            let chroma = ga + gb;
            rmap[i] = (chroma - 0.85 * gy).max(0.0);
        }
    }
    scale_to_u8(&rmap, out, gain, percentile)
}

/// Experimental CFA / demosaic residual: 2x2 period energy.
pub fn cfa_map(rgba: &[u8], w: u32, h: u32, gain: f32, percentile: f32, out: &mut [u8]) -> Stats {
    let w = w as usize;
    let h = h as usize;
    let n = w * h;
    let mut green = vec![0f32; n];
    for i in 0..n {
        green[i] = rgba[i * 4 + 1] as f32;
    }
    let mut r = vec![0f32; n];
    for yy in 2..h - 2 {
        for xx in 2..w - 2 {
            // High-pass then 2x2 checker correlation
            let c = green[yy * w + xx];
            let hp = c
                - 0.25
                    * (green[yy * w + xx - 1]
                        + green[yy * w + xx + 1]
                        + green[(yy - 1) * w + xx]
                        + green[(yy + 1) * w + xx]);
            let even = ((xx + yy) & 1) as f32 * 2.0 - 1.0;
            r[yy * w + xx] = (hp * even).abs();
        }
    }
    scale_to_u8(&r, out, gain, percentile)
}

/// Gallagher-style resampling: second derivative periodicity along rows/cols.
pub fn resample_map(y: &[f32], w: u32, h: u32, gain: f32, percentile: f32, out: &mut [u8]) -> Stats {
    let w = w as usize;
    let h = h as usize;
    let n = w * h;
    let mut d2 = vec![0f32; n];
    for yy in 0..h {
        for xx in 1..w - 1 {
            let i = yy * w + xx;
            d2[i] = (y[i - 1] - 2.0 * y[i] + y[i + 1]).abs();
        }
    }
    // Local periodicity energy: compare even vs odd lag-2 difference
    let mut r = vec![0f32; n];
    for yy in 2..h - 2 {
        for xx in 4..w - 4 {
            let i = yy * w + xx;
            let mut even = 0.0;
            let mut odd = 0.0;
            for k in 0..8 {
                let v = d2[i - 4 + k];
                if k % 2 == 0 {
                    even += v;
                } else {
                    odd += v;
                }
            }
            r[i] = (even - odd).abs();
        }
    }
    scale_to_u8(&r, out, gain, percentile)
}
