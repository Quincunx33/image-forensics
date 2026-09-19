//! Copy-move / clone detector: overlapping block descriptors + offset clustering.

use crate::json::Json;
use crate::stats::{scale_to_u8, Stats};

#[derive(Clone, Copy)]
struct Feat {
    x: u16,
    y: u16,
    d: [u8; 16],
}

fn hamming_like(a: &[u8; 16], b: &[u8; 16]) -> u32 {
    let mut s = 0u32;
    for i in 0..16 {
        s += (a[i] as i32 - b[i] as i32).unsigned_abs();
    }
    s
}

pub struct CloneResult {
    pub stats: Stats,
    pub json: String,
}

pub fn copy_move(
    y: &[f32],
    w: u32,
    h: u32,
    block: u32,
    stride: u32,
    threshold: u32,
    min_region: u32,
    gain: f32,
    percentile: f32,
    out: &mut [u8],
) -> CloneResult {
    let w = w as usize;
    let h = h as usize;
    let n = w * h;
    let mut mask = vec![0f32; n];
    let bs = block.clamp(8, 32) as usize;
    let st = stride.clamp(4, 32) as usize;
    let thr = threshold.clamp(4, 400);
    let min_r = min_region.clamp(2, 200) as usize;

    if w < bs + 4 || h < bs + 4 {
        let stats = scale_to_u8(&mask, out, gain, percentile);
        return CloneResult {
            stats,
            json: "{\"matches\":[],\"clusters\":0,\"status\":\"insufficient\"}".into(),
        };
    }

    let mut feats: Vec<Feat> = Vec::new();
    let sub = bs / 4;
    let mut yy = 0;
    while yy + bs <= h {
        let mut xx = 0;
        while xx + bs <= w {
            let mut d = [0u8; 16];
            let mut k = 0;
            for sy in 0..4 {
                for sx in 0..4 {
                    let mut s = 0.0;
                    let mut c = 0.0;
                    for j in 0..sub {
                        for i in 0..sub {
                            s += y[(yy + sy * sub + j) * w + (xx + sx * sub + i)];
                            c += 1.0;
                        }
                    }
                    d[k] = (s / c).clamp(0.0, 255.0) as u8;
                    k += 1;
                }
            }
            feats.push(Feat {
                x: xx as u16,
                y: yy as u16,
                d,
            });
            xx += st;
            if feats.len() > 48_000 {
                break;
            }
        }
        yy += st;
        if feats.len() > 48_000 {
            break;
        }
    }

    // Lexicographic sort on first 4 descriptor bytes so neighbors in feature space are nearby
    feats.sort_by(|a, b| a.d[0..4].cmp(&b.d[0..4]));

    #[derive(Clone)]
    struct Hit {
        ax: u16,
        ay: u16,
        bx: u16,
        by: u16,
        dx: i16,
        dy: i16,
        sim: u32,
    }
    let mut hits: Vec<Hit> = Vec::new();
    let min_dist2 = (bs as i32 * 2).pow(2);

    for i in 0..feats.len() {
        let a = feats[i];
        let lim = (i + 12).min(feats.len());
        for j in i + 1..lim {
            let b = feats[j];
            let dist = hamming_like(&a.d, &b.d);
            if dist > thr {
                continue;
            }
            let dx = a.x as i32 - b.x as i32;
            let dy = a.y as i32 - b.y as i32;
            if dx * dx + dy * dy < min_dist2 {
                continue;
            }
            // Canonicalize offset so A is "left/top"
            let (ax, ay, bx, by, odx, ody) = if (a.y, a.x) < (b.y, b.x) {
                (a.x, a.y, b.x, b.y, b.x as i16 - a.x as i16, b.y as i16 - a.y as i16)
            } else {
                (b.x, b.y, a.x, a.y, a.x as i16 - b.x as i16, a.y as i16 - b.y as i16)
            };
            hits.push(Hit {
                ax,
                ay,
                bx,
                by,
                dx: odx,
                dy: ody,
                sim: dist,
            });
            if hits.len() > 8_000 {
                break;
            }
        }
        if hits.len() > 8_000 {
            break;
        }
    }

    // Cluster by quantized displacement
    use std::collections::HashMap;
    let mut buckets: HashMap<(i16, i16), Vec<usize>> = HashMap::new();
    for (i, h) in hits.iter().enumerate() {
        let qx = (h.dx / 4) * 4;
        let qy = (h.dy / 4) * 4;
        buckets.entry((qx, qy)).or_default().push(i);
    }
    let mut clusters = 0u32;
    let mut reported: Vec<&Hit> = Vec::new();
    for (_k, idxs) in buckets.iter() {
        if idxs.len() < min_r {
            continue;
        }
        clusters += 1;
        for &i in idxs {
            let h = &hits[i];
            paint_block(&mut mask, w, h.ax as usize, h.ay as usize, bs, 1.0);
            paint_block(&mut mask, w, h.bx as usize, h.by as usize, bs, 1.0);
            if reported.len() < 80 {
                reported.push(h);
            }
        }
    }

    let stats = scale_to_u8(&mask, out, gain, percentile);
    let mut j = Json::new();
    j.begin_obj();
    j.num_field("clusters", clusters as f64);
    j.num_field("hits", hits.len() as f64);
    j.num_field("blocks", feats.len() as f64);
    j.str_field(
        "status",
        if clusters == 0 {
            "no significant match"
        } else {
            "potential indicator"
        },
    );
    j.key("matches");
    j.begin_arr();
    for (i, h) in reported.iter().enumerate() {
        j.begin_obj();
        j.num_field("ax", h.ax as f64);
        j.num_field("ay", h.ay as f64);
        j.num_field("bx", h.bx as f64);
        j.num_field("by", h.by as f64);
        j.num_field("dx", h.dx as f64);
        j.num_field("dy", h.dy as f64);
        j.num_field("distance", h.sim as f64);
        j.end_obj();
        if i + 1 < reported.len() {
            j.comma();
        }
    }
    j.end_arr();
    j.end_obj();
    CloneResult {
        stats,
        json: j.into_string(),
    }
}

fn paint_block(mask: &mut [f32], w: usize, x: usize, y: usize, bs: usize, v: f32) {
    let h = mask.len() / w;
    for j in 0..bs {
        let yy = y + j;
        if yy >= h {
            break;
        }
        for i in 0..bs {
            let xx = x + i;
            if xx >= w {
                break;
            }
            let idx = yy * w + xx;
            if mask[idx] < v {
                mask[idx] = v;
            }
        }
    }
}
