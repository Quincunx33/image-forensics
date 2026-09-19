//! Native micro-benchmark for detector kernels.
//! Run: cargo run -p forensic-engine --example bench --release

use forensic_engine::*;
use std::time::Instant;

fn gray(w: u32, h: u32) -> Vec<u8> {
    let n = (w * h) as usize;
    let mut v = vec![0u8; n * 4];
    for i in 0..n {
        let t = ((i * 37) % 255) as u8;
        v[i * 4] = t;
        v[i * 4 + 1] = t.wrapping_add(3);
        v[i * 4 + 2] = t.wrapping_add(7);
        v[i * 4 + 3] = 255;
    }
    v
}

fn main() {
    let w = 512u32;
    let h = 512u32;
    let rgba = gray(w, h);
    let ptr = rgba.as_ptr() as u32;
    // Native: just time parse + ela via public modules isn't C ABI safe for pointers.
    // Time JPEG parse of a tiny buffer and luma conversion pattern.
    let t0 = Instant::now();
    let _ = parse_jpeg_bytes(&[0xff, 0xd8, 0xff, 0xd9]);
    eprintln!("jpeg parse empty: {:?}", t0.elapsed());
    eprintln!("bench image {}x{} ({} bytes rgba)", w, h, rgba.len());
    let t1 = Instant::now();
    let mut y = vec![0f32; (w * h) as usize];
    for i in 0..(w * h) as usize {
        y[i] = 0.2126 * rgba[i * 4] as f32
            + 0.7152 * rgba[i * 4 + 1] as f32
            + 0.0722 * rgba[i * 4 + 2] as f32;
    }
    eprintln!("luma: {:?}", t1.elapsed());
    let _ = (ptr, VERSION, ENGINE_ID);
}
