//! Tracebench forensic engine — wasm32 C ABI + native tests.
//!
//! All image bytes stay in-process. The original buffer is never mutated.

mod clone;
mod dct;
mod ela;
mod jpeg;
mod json;
mod spatial;
mod stats;

use std::cell::RefCell;

use crate::stats::Stats;

pub const VERSION: &str = "1.0.0";
pub const ENGINE_ID: &str = "tracebench-forensic-engine";

const DEFAULT_MAX_PIXELS: u32 = 16_000_000;
const DEFAULT_MAX_DIM: u32 = 8192;
const DEFAULT_MAX_FILE: u32 = 48 * 1024 * 1024;

#[derive(Default)]
struct Session {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    file: Vec<u8>,
    luma: Vec<f32>,
    max_pixels: u32,
    max_dim: u32,
    max_file: u32,
    last_json: Vec<u8>,
    last_error: Vec<u8>,
    thumbnail: Vec<u8>,
}

impl Session {
    fn set_error(&mut self, msg: &str) {
        let mut b = msg.as_bytes().to_vec();
        b.push(0);
        self.last_error = b;
    }
    fn set_json(&mut self, s: String) -> u32 {
        let mut b = s.into_bytes();
        b.push(0);
        let ptr = b.as_ptr() as u32;
        self.last_json = b;
        ptr
    }
}

thread_local! {
    static SESSION: RefCell<Session> = RefCell::new(Session {
        max_pixels: DEFAULT_MAX_PIXELS,
        max_dim: DEFAULT_MAX_DIM,
        max_file: DEFAULT_MAX_FILE,
        ..Session::default()
    });
}

fn with_session<T>(f: impl FnOnce(&mut Session) -> T) -> T {
    SESSION.with(|s| f(&mut s.borrow_mut()))
}

#[no_mangle]
pub extern "C" fn tb_version() -> u32 {
    static V: &str = "1.0.0\0";
    V.as_ptr() as u32
}

#[no_mangle]
pub extern "C" fn tb_engine_id() -> u32 {
    static V: &str = "tracebench-forensic-engine\0";
    V.as_ptr() as u32
}

/// Allocate `size` bytes, 8-byte aligned. Pair with tb_free.
#[no_mangle]
pub extern "C" fn tb_alloc(size: u32) -> u32 {
    if size == 0 || size > 512 * 1024 * 1024 {
        return 0;
    }
    let mut v = vec![0u8; size as usize];
    let ptr = v.as_mut_ptr() as u32;
    std::mem::forget(v);
    ptr
}

#[no_mangle]
pub extern "C" fn tb_free(ptr: u32, size: u32) {
    if ptr == 0 || size == 0 {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr as *mut u8, size as usize, size as usize);
    }
}

#[no_mangle]
pub extern "C" fn tb_set_limits(max_pixels: u32, max_dim: u32, max_file: u32) {
    with_session(|s| {
        if max_pixels > 0 {
            s.max_pixels = max_pixels;
        }
        if max_dim > 0 {
            s.max_dim = max_dim;
        }
        if max_file > 0 {
            s.max_file = max_file;
        }
    });
}

#[no_mangle]
pub extern "C" fn tb_set_image(ptr: u32, w: u32, h: u32) -> i32 {
    with_session(|s| {
        if w == 0 || h == 0 || w > s.max_dim || h > s.max_dim {
            s.set_error("dimension limit");
            return -5;
        }
        let n = match (w as usize).checked_mul(h as usize) {
            Some(v) => v,
            None => {
                s.set_error("overflow");
                return -5;
            }
        };
        if n as u32 > s.max_pixels {
            s.set_error("pixel limit");
            return -5;
        }
        let bytes = n.saturating_mul(4);
        let slice = unsafe { std::slice::from_raw_parts(ptr as *const u8, bytes) };
        s.width = w;
        s.height = h;
        s.rgba = slice.to_vec();
        s.luma = spatial::to_luma(&s.rgba, w, h);
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_set_file(ptr: u32, len: u32) -> i32 {
    with_session(|s| {
        if len > s.max_file {
            s.set_error("file size limit");
            return -5;
        }
        let slice = unsafe { std::slice::from_raw_parts(ptr as *const u8, len as usize) };
        s.file = slice.to_vec();
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_width() -> u32 {
    with_session(|s| s.width)
}
#[no_mangle]
pub extern "C" fn tb_height() -> u32 {
    with_session(|s| s.height)
}

#[no_mangle]
pub extern "C" fn tb_last_error() -> u32 {
    with_session(|s| {
        if s.last_error.is_empty() {
            0
        } else {
            s.last_error.as_ptr() as u32
        }
    })
}

#[no_mangle]
pub extern "C" fn tb_last_json() -> u32 {
    with_session(|s| {
        if s.last_json.is_empty() {
            0
        } else {
            s.last_json.as_ptr() as u32
        }
    })
}

#[no_mangle]
pub extern "C" fn tb_last_json_len() -> u32 {
    with_session(|s| s.last_json.len().saturating_sub(1) as u32)
}

fn write_stats(ptr: u32, st: &Stats) {
    if ptr == 0 {
        return;
    }
    let out = unsafe { std::slice::from_raw_parts_mut(ptr as *mut f64, 10) };
    st.write_f64(out);
}

fn map_out<'a>(s: &'a Session, ptr: u32) -> Option<&'a mut [u8]> {
    if ptr == 0 || s.width == 0 {
        return None;
    }
    let n = (s.width as usize) * (s.height as usize);
    Some(unsafe { std::slice::from_raw_parts_mut(ptr as *mut u8, n) })
}

/// quality 1-100, gain*100 (e.g. 1200 = 12.0), percentile*100 (9800 = 98)
#[no_mangle]
pub extern "C" fn tb_ela(quality: u32, gain_x100: u32, percentile_x100: u32, out_ptr: u32, stats_ptr: u32) -> i32 {
    with_session(|s| {
        if s.rgba.is_empty() {
            s.set_error("no image");
            return -1;
        }
        // PNG / non-JPEG: still run (re-encode from pixels) but JSON notes inappropriateness.
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => {
                s.set_error("out");
                return -2;
            }
        };
        let params = ela::ElaParams {
            quality: quality.clamp(1, 100) as u8,
            gain: gain_x100 as f32 / 100.0,
            percentile: percentile_x100 as f32 / 100.0,
        };
        match ela::error_level(&s.rgba, s.width, s.height, params, out) {
            Ok(st) => {
                write_stats(stats_ptr, &st);
                let jpeg = s.file.len() >= 3 && s.file[0] == 0xff && s.file[1] == 0xd8;
                let note = if jpeg {
                    "ELA residual after JPEG re-encode. High error can indicate locally different compression history — not proof of editing."
                } else {
                    "ELA is designed for JPEG. This file does not appear to be JPEG; residual mainly reflects the encoder's first-time quantization and is easy to misread."
                };
                s.set_json(format!(
                    "{{\"appropriate\":{},\"quality\":{},\"note\":\"{}\"}}",
                    jpeg, params.quality, note
                ));
                0
            }
            Err(e) => {
                s.set_error(e);
                -3
            }
        }
    })
}

#[no_mangle]
pub extern "C" fn tb_noise(
    method: u32,
    window: u32,
    gain_x100: u32,
    percentile_x100: u32,
    out_ptr: u32,
    stats_ptr: u32,
) -> i32 {
    with_session(|s| {
        if s.luma.is_empty() {
            s.set_error("no image");
            return -1;
        }
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => return -2,
        };
        let st = spatial::noise_map(
            &s.luma,
            s.width,
            s.height,
            method,
            window,
            gain_x100 as f32 / 100.0,
            percentile_x100 as f32 / 100.0,
            out,
        );
        write_stats(stats_ptr, &st);
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_edge(
    method: u32,
    gain_x100: u32,
    percentile_x100: u32,
    out_ptr: u32,
    stats_ptr: u32,
) -> i32 {
    with_session(|s| {
        if s.luma.is_empty() {
            s.set_error("no image");
            return -1;
        }
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => return -2,
        };
        let st = spatial::edge_map(
            &s.luma,
            s.width,
            s.height,
            method,
            gain_x100 as f32 / 100.0,
            percentile_x100 as f32 / 100.0,
            out,
        );
        write_stats(stats_ptr, &st);
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_sharpness(
    window: u32,
    gain_x100: u32,
    percentile_x100: u32,
    out_ptr: u32,
    stats_ptr: u32,
) -> i32 {
    with_session(|s| {
        if s.luma.is_empty() {
            s.set_error("no image");
            return -1;
        }
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => return -2,
        };
        let st = spatial::sharpness_map(
            &s.luma,
            s.width,
            s.height,
            window,
            gain_x100 as f32 / 100.0,
            percentile_x100 as f32 / 100.0,
            out,
        );
        write_stats(stats_ptr, &st);
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_color(gain_x100: u32, percentile_x100: u32, out_ptr: u32, stats_ptr: u32) -> i32 {
    with_session(|s| {
        if s.rgba.is_empty() {
            s.set_error("no image");
            return -1;
        }
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => return -2,
        };
        let st = spatial::color_anomaly_map(
            &s.rgba,
            s.width,
            s.height,
            gain_x100 as f32 / 100.0,
            percentile_x100 as f32 / 100.0,
            out,
        );
        write_stats(stats_ptr, &st);
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_cfa(gain_x100: u32, percentile_x100: u32, out_ptr: u32, stats_ptr: u32) -> i32 {
    with_session(|s| {
        if s.rgba.is_empty() {
            s.set_error("no image");
            return -1;
        }
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => return -2,
        };
        let st = spatial::cfa_map(
            &s.rgba,
            s.width,
            s.height,
            gain_x100 as f32 / 100.0,
            percentile_x100 as f32 / 100.0,
            out,
        );
        write_stats(stats_ptr, &st);
        s.set_json("{\"experimental\":true,\"note\":\"CFA/demosaic residuals are camera-pipeline dependent. Absence or presence is not attribution.\"}".into());
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_resample(
    gain_x100: u32,
    percentile_x100: u32,
    out_ptr: u32,
    stats_ptr: u32,
) -> i32 {
    with_session(|s| {
        if s.luma.is_empty() {
            s.set_error("no image");
            return -1;
        }
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => return -2,
        };
        let st = spatial::resample_map(
            &s.luma,
            s.width,
            s.height,
            gain_x100 as f32 / 100.0,
            percentile_x100 as f32 / 100.0,
            out,
        );
        write_stats(stats_ptr, &st);
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_frequency(
    band: u32,
    gain_x100: u32,
    percentile_x100: u32,
    out_ptr: u32,
    stats_ptr: u32,
) -> i32 {
    with_session(|s| {
        if s.luma.is_empty() {
            s.set_error("no image");
            return -1;
        }
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => return -2,
        };
        let st = dct::frequency_map(
            &s.luma,
            s.width,
            s.height,
            band,
            gain_x100 as f32 / 100.0,
            percentile_x100 as f32 / 100.0,
            out,
        );
        write_stats(stats_ptr, &st);
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_double_jpeg(
    gain_x100: u32,
    percentile_x100: u32,
    out_ptr: u32,
    stats_ptr: u32,
) -> i32 {
    with_session(|s| {
        if s.luma.is_empty() {
            s.set_error("no image");
            return -1;
        }
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => return -2,
        };
        let (st, score) = dct::double_jpeg_map(
            &s.luma,
            s.width,
            s.height,
            gain_x100 as f32 / 100.0,
            percentile_x100 as f32 / 100.0,
            out,
        );
        write_stats(stats_ptr, &st);
        s.set_json(format!(
            "{{\"periodicityScore\":{:.6},\"note\":\"Histogram periodicity can arise from aligned recompression, transcoding, or camera JPEG engines. It does not by itself prove content editing.\"}}",
            score
        ));
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_clone(
    block: u32,
    stride: u32,
    threshold: u32,
    min_region: u32,
    gain_x100: u32,
    percentile_x100: u32,
    out_ptr: u32,
    stats_ptr: u32,
) -> i32 {
    with_session(|s| {
        if s.luma.is_empty() {
            s.set_error("no image");
            return -1;
        }
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => return -2,
        };
        let result = clone::copy_move(
            &s.luma,
            s.width,
            s.height,
            block,
            stride,
            threshold,
            min_region,
            gain_x100 as f32 / 100.0,
            percentile_x100 as f32 / 100.0,
            out,
        );
        write_stats(stats_ptr, &result.stats);
        s.set_json(result.json);
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_prnu_residual(
    gain_x100: u32,
    percentile_x100: u32,
    out_ptr: u32,
    stats_ptr: u32,
) -> i32 {
    // Without a reference set this is a noise residual, not a camera fingerprint.
    with_session(|s| {
        if s.luma.is_empty() {
            s.set_error("no image");
            return -1;
        }
        let out = match map_out(s, out_ptr) {
            Some(o) => o,
            None => return -2,
        };
        let st = spatial::noise_map(
            &s.luma,
            s.width,
            s.height,
            4,
            5,
            gain_x100 as f32 / 100.0,
            percentile_x100 as f32 / 100.0,
            out,
        );
        write_stats(stats_ptr, &st);
        s.set_json("{\"experimental\":true,\"referenceSet\":false,\"note\":\"PRNU attribution requires a camera reference set. This map is a wavelet-like median residual only.\"}".into());
        0
    })
}

#[no_mangle]
pub extern "C" fn tb_jpeg_json() -> u32 {
    with_session(|s| {
        let info = jpeg::parse_jpeg(&s.file);
        if let Some(t) = info.thumbnail.clone() {
            s.thumbnail = t;
        }
        let js = jpeg::jpeg_to_json(&info, s.file.len());
        s.set_json(js)
    })
}

#[no_mangle]
pub extern "C" fn tb_thumbnail_ptr() -> u32 {
    with_session(|s| {
        if s.thumbnail.is_empty() {
            0
        } else {
            s.thumbnail.as_ptr() as u32
        }
    })
}

#[no_mangle]
pub extern "C" fn tb_thumbnail_len() -> u32 {
    with_session(|s| s.thumbnail.len() as u32)
}

/// Region stats on luminance: x,y,w,h
#[no_mangle]
pub extern "C" fn tb_region_luma_stats(x: u32, y: u32, rw: u32, rh: u32, stats_ptr: u32) -> i32 {
    with_session(|s| {
        if s.luma.is_empty() {
            return -1;
        }
        let w = s.width as usize;
        let h = s.height as usize;
        let x0 = x.min(s.width) as usize;
        let y0 = y.min(s.height) as usize;
        let x1 = (x + rw).min(s.width) as usize;
        let y1 = (y + rh).min(s.height) as usize;
        if x1 <= x0 || y1 <= y0 {
            return -4;
        }
        let mut buf = Vec::with_capacity((x1 - x0) * (y1 - y0));
        for yy in y0..y1 {
            for xx in x0..x1 {
                buf.push(s.luma[yy * w + xx]);
            }
        }
        let st = stats::stats_f32(&buf);
        write_stats(stats_ptr, &st);
        let _ = h;
        0
    })
}

/// Compare two rectangular ROIs on luma. Writes 20 f64 (A then B).
#[no_mangle]
pub extern "C" fn tb_region_compare(
    ax: u32,
    ay: u32,
    aw: u32,
    ah: u32,
    bx: u32,
    by: u32,
    bw: u32,
    bh: u32,
    stats_ptr: u32,
) -> i32 {
    with_session(|s| {
        if s.luma.is_empty() || stats_ptr == 0 {
            return -1;
        }
        let grab = |x: u32, y: u32, rw: u32, rh: u32| -> Vec<f32> {
            let x0 = x.min(s.width) as usize;
            let y0 = y.min(s.height) as usize;
            let x1 = (x + rw).min(s.width) as usize;
            let y1 = (y + rh).min(s.height) as usize;
            let mut buf = Vec::new();
            let w = s.width as usize;
            for yy in y0..y1 {
                for xx in x0..x1 {
                    buf.push(s.luma[yy * w + xx]);
                }
            }
            buf
        };
        let a = stats::stats_f32(&grab(ax, ay, aw, ah));
        let b = stats::stats_f32(&grab(bx, by, bw, bh));
        let out = unsafe { std::slice::from_raw_parts_mut(stats_ptr as *mut f64, 20) };
        a.write_f64(&mut out[0..10]);
        b.write_f64(&mut out[10..20]);
        0
    })
}

pub fn parse_jpeg_bytes(bytes: &[u8]) -> jpeg::JpegInfo {
    jpeg::parse_jpeg(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gray_rgba(w: u32, h: u32, v: u8) -> Vec<u8> {
        let n = (w * h) as usize;
        let mut out = vec![0u8; n * 4];
        for i in 0..n {
            out[i * 4] = v;
            out[i * 4 + 1] = v;
            out[i * 4 + 2] = v;
            out[i * 4 + 3] = 255;
        }
        out
    }

    #[test]
    fn ela_uniform_is_low() {
        let w = 64u32;
        let h = 64u32;
        let rgba = gray_rgba(w, h, 128);
        let mut out = vec![0u8; (w * h) as usize];
        let st = ela::error_level(
            &rgba,
            w,
            h,
            ela::ElaParams {
                quality: 90,
                gain: 1.0,
                percentile: 99.0,
            },
            &mut out,
        )
        .unwrap();
        // Uniform field recompresses cleanly; mean residual should be small.
        assert!(st.mean < 8.0, "mean {}", st.mean);
    }

    #[test]
    fn jpeg_soi() {
        let bytes = [0xff, 0xd8, 0xff, 0xd9];
        let info = jpeg::parse_jpeg(&bytes);
        assert!(info.is_jpeg);
    }

    #[test]
    fn noise_variance_higher_on_noise() {
        let w = 32u32;
        let h = 32u32;
        let mut y = vec![128.0f32; (w * h) as usize];
        let mut out = vec![0u8; y.len()];
        let st0 = spatial::noise_map(&y, w, h, 1, 5, 1.0, 99.0, &mut out);
        for i in 0..y.len() {
            y[i] = (i % 17) as f32 * 8.0;
        }
        let st1 = spatial::noise_map(&y, w, h, 1, 5, 1.0, 99.0, &mut out);
        assert!(st1.mean > st0.mean);
    }

    #[test]
    fn clone_finds_pasted_block() {
        let w = 96u32;
        let h = 96u32;
        let mut y = vec![0f32; (w * h) as usize];
        for yy in 0..h {
            for xx in 0..w {
                y[(yy * w + xx) as usize] = ((xx * 13 + yy * 7) % 255) as f32;
            }
        }
        // Copy 24x24 from (8,8) to (56,56)
        for j in 0..24 {
            for i in 0..24 {
                let src = ((8 + j) * w + (8 + i)) as usize;
                let dst = ((56 + j) * w + (56 + i)) as usize;
                y[dst] = y[src];
            }
        }
        let mut out = vec![0u8; y.len()];
        let r = clone::copy_move(&y, w, h, 16, 8, 40, 3, 4.0, 99.0, &mut out);
        assert!(
            r.json.contains("potential") || r.stats.max > 0.0,
            "{}",
            r.json
        );
    }

    #[test]
    fn stats_constant() {
        let data = vec![3.0f32; 100];
        let st = stats::stats_f32(&data);
        assert!((st.mean - 3.0).abs() < 1e-6);
        assert!(st.std.abs() < 1e-6);
        assert!((st.median - 3.0).abs() < 1e-6);
    }
}
