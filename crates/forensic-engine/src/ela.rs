//! Error Level Analysis: JPEG re-encode, absolute residual, percentile scale.

use std::io::Cursor;

use jpeg_decoder::Decoder;
use jpeg_encoder::{ColorType, Encoder};

use crate::stats::{luma, scale_to_u8, Stats};

#[derive(Clone, Copy)]
pub struct ElaParams {
    pub quality: u8,
    pub gain: f32,
    pub percentile: f32,
}

impl Default for ElaParams {
    fn default() -> Self {
        Self {
            quality: 90,
            gain: 12.0,
            percentile: 98.0,
        }
    }
}

pub fn error_level(
    rgba: &[u8],
    w: u32,
    h: u32,
    params: ElaParams,
    out: &mut [u8],
) -> Result<Stats, &'static str> {
    if w == 0 || h == 0 || w > 65535 || h > 65535 {
        return Err("invalid dimensions");
    }
    let n = (w as usize) * (h as usize);
    if rgba.len() < n * 4 || out.len() < n {
        return Err("buffer");
    }
    let mut rgb = Vec::with_capacity(n * 3);
    for i in 0..n {
        rgb.push(rgba[i * 4]);
        rgb.push(rgba[i * 4 + 1]);
        rgb.push(rgba[i * 4 + 2]);
    }
    let mut jpeg = Vec::new();
    {
        let enc = Encoder::new(&mut jpeg, params.quality.clamp(1, 100));
        enc.encode(&rgb, w as u16, h as u16, ColorType::Rgb)
            .map_err(|_| "jpeg encode")?;
    }
    let mut dec = Decoder::new(Cursor::new(&jpeg));
    let decoded = dec.decode().map_err(|_| "jpeg decode")?;
    let info = dec.info().ok_or("jpeg info")?;
    let dw = info.width as usize;
    let dh = info.height as usize;
    let mut residual = vec![0f32; n];
    match info.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => {
            let m = dw.min(w as usize) * dh.min(h as usize);
            let _ = m;
            for y in 0..h as usize {
                for x in 0..w as usize {
                    let i = y * w as usize + x;
                    if x < dw && y < dh {
                        let j = (y * dw + x) * 3;
                        let dr = (rgba[i * 4] as i16 - decoded[j] as i16).unsigned_abs() as f32;
                        let dg =
                            (rgba[i * 4 + 1] as i16 - decoded[j + 1] as i16).unsigned_abs() as f32;
                        let db =
                            (rgba[i * 4 + 2] as i16 - decoded[j + 2] as i16).unsigned_abs() as f32;
                        residual[i] = 0.2126 * dr + 0.7152 * dg + 0.0722 * db;
                    }
                }
            }
        }
        jpeg_decoder::PixelFormat::L8 => {
            for y in 0..h as usize {
                for x in 0..w as usize {
                    let i = y * w as usize + x;
                    if x < dw && y < dh {
                        let y0 = luma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
                        residual[i] = (y0 - decoded[y * dw + x] as f32).abs();
                    }
                }
            }
        }
        _ => return Err("unsupported jpeg pixel format"),
    }
    Ok(scale_to_u8(
        &residual,
        out,
        params.gain,
        params.percentile,
    ))
}
