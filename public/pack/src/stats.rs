//! Descriptive statistics for residual / heatmap buffers.

#[derive(Clone, Copy, Debug, Default)]
pub struct Stats {
    pub mean: f64,
    pub median: f64,
    pub std: f64,
    pub min: f64,
    pub max: f64,
    pub p05: f64,
    pub p95: f64,
    pub p99: f64,
    pub energy: f64,
    pub entropy: f64,
}

impl Stats {
    pub fn write_f64(&self, out: &mut [f64]) {
        if out.len() < 10 {
            return;
        }
        out[0] = self.mean;
        out[1] = self.median;
        out[2] = self.std;
        out[3] = self.min;
        out[4] = self.max;
        out[5] = self.p05;
        out[6] = self.p95;
        out[7] = self.p99;
        out[8] = self.energy;
        out[9] = self.entropy;
    }
}

pub fn stats_f32(data: &[f32]) -> Stats {
    if data.is_empty() {
        return Stats::default();
    }
    let n = data.len() as f64;
    let mut min = f32::INFINITY;
    let mut max = f32::NEG_INFINITY;
    let mut sum = 0.0f64;
    let mut energy = 0.0f64;
    for &v in data {
        let x = if v.is_finite() { v } else { 0.0 };
        if x < min {
            min = x;
        }
        if x > max {
            max = x;
        }
        let d = x as f64;
        sum += d;
        energy += d * d;
    }
    let mean = sum / n;
    let mut var = 0.0f64;
    for &v in data {
        let x = if v.is_finite() { v as f64 } else { 0.0 };
        let d = x - mean;
        var += d * d;
    }
    let std = (var / n).sqrt();

    let mut sorted: Vec<f32> = data
        .iter()
        .map(|v| if v.is_finite() { *v } else { 0.0 })
        .collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let percentile = |p: f64| -> f64 {
        let idx = ((p / 100.0) * (sorted.len().saturating_sub(1) as f64)).round() as usize;
        sorted[idx.min(sorted.len() - 1)] as f64
    };

    // 64-bin entropy of normalized values
    let range = (max - min).max(1e-8);
    let mut bins = [0u32; 64];
    for &v in data {
        let x = if v.is_finite() { v } else { min };
        let b = (((x - min) / range) * 63.0).floor() as usize;
        bins[b.min(63)] += 1;
    }
    let mut entropy = 0.0f64;
    for c in bins {
        if c == 0 {
            continue;
        }
        let p = c as f64 / n;
        entropy -= p * p.log2();
    }

    Stats {
        mean,
        median: percentile(50.0),
        std,
        min: min as f64,
        max: max as f64,
        p05: percentile(5.0),
        p95: percentile(95.0),
        p99: percentile(99.0),
        energy: energy / n,
        entropy,
    }
}

/// Percentile clip then linear scale to 0..255.
pub fn scale_to_u8(src: &[f32], dst: &mut [u8], gain: f32, percentile: f32) -> Stats {
    let stats = stats_f32(src);
    if src.is_empty() || dst.is_empty() {
        return stats;
    }
    let p = percentile.clamp(50.0, 100.0) as f64;
    let mut sorted: Vec<f32> = src
        .iter()
        .map(|v| if v.is_finite() { *v } else { 0.0 })
        .collect();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let idx = ((p / 100.0) * (sorted.len().saturating_sub(1) as f64)).round() as usize;
    let clip = sorted[idx.min(sorted.len() - 1)].max(1e-8);
    let g = gain.max(0.01) as f32;
    let n = src.len().min(dst.len());
    for i in 0..n {
        let v = src[i].max(0.0) / clip * 255.0 * g;
        dst[i] = v.clamp(0.0, 255.0) as u8;
    }
    stats
}

pub fn luma(r: u8, g: u8, b: u8) -> f32 {
    0.2126 * r as f32 + 0.7152 * g as f32 + 0.0722 * b as f32
}
