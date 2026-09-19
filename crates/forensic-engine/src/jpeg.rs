//! JPEG marker walk, quantization tables, SOF geometry, APP metadata.

use crate::json::{Json, hex_preview};

#[derive(Clone, Debug, Default)]
pub struct JpegInfo {
    pub is_jpeg: bool,
    pub progressive: bool,
    pub components: u8,
    pub width: u16,
    pub height: u16,
    pub precision: u8,
    pub restart_interval: u16,
    pub h_samp: [u8; 4],
    pub v_samp: [u8; 4],
    pub q_sel: [u8; 4],
    pub qtables: Vec<(u8, [u16; 64])>,
    pub markers: Vec<Marker>,
    pub comments: Vec<String>,
    pub app1: Vec<Vec<u8>>,
    pub thumbnail: Option<Vec<u8>>,
}

#[derive(Clone, Debug)]
pub struct Marker {
    pub name: String,
    pub offset: usize,
    pub length: usize,
}

const MARKER_NAMES: &[(u8, &str)] = &[
    (0xd8, "SOI"),
    (0xd9, "EOI"),
    (0xda, "SOS"),
    (0xdb, "DQT"),
    (0xc4, "DHT"),
    (0xdd, "DRI"),
    (0xfe, "COM"),
    (0xe0, "APP0"),
    (0xe1, "APP1"),
    (0xe2, "APP2"),
    (0xe3, "APP3"),
    (0xe4, "APP4"),
    (0xe5, "APP5"),
    (0xe6, "APP6"),
    (0xe7, "APP7"),
    (0xe8, "APP8"),
    (0xe9, "APP9"),
    (0xea, "APP10"),
    (0xeb, "APP11"),
    (0xec, "APP12"),
    (0xed, "APP13"),
    (0xee, "APP14"),
    (0xef, "APP15"),
    (0xc0, "SOF0"),
    (0xc1, "SOF1"),
    (0xc2, "SOF2"),
    (0xc3, "SOF3"),
    (0xc5, "SOF5"),
    (0xc6, "SOF6"),
    (0xc7, "SOF7"),
    (0xc9, "SOF9"),
    (0xca, "SOF10"),
    (0xcb, "SOF11"),
];

fn marker_name(m: u8) -> String {
    if (0xd0..=0xd7).contains(&m) {
        return format!("RST{}", m - 0xd0);
    }
    MARKER_NAMES
        .iter()
        .find(|(k, _)| *k == m)
        .map(|(_, n)| n.to_string())
        .unwrap_or_else(|| format!("FF{:02X}", m))
}

pub fn parse_jpeg(bytes: &[u8]) -> JpegInfo {
    let mut info = JpegInfo::default();
    if bytes.len() < 4 || bytes[0] != 0xff || bytes[1] != 0xd8 {
        return info;
    }
    info.is_jpeg = true;
    info.markers.push(Marker {
        name: "SOI".into(),
        offset: 0,
        length: 2,
    });
    let mut i = 2usize;
    while i + 1 < bytes.len() {
        if bytes[i] != 0xff {
            i += 1;
            continue;
        }
        while i < bytes.len() && bytes[i] == 0xff {
            i += 1;
        }
        if i >= bytes.len() {
            break;
        }
        let m = bytes[i];
        i += 1;
        if m == 0x00 || m == 0xff {
            continue;
        }
        if m == 0xd9 {
            info.markers.push(Marker {
                name: "EOI".into(),
                offset: i - 2,
                length: 2,
            });
            break;
        }
        if m == 0xda {
            info.markers.push(Marker {
                name: "SOS".into(),
                offset: i - 2,
                length: bytes.len().saturating_sub(i - 2),
            });
            // Scan payload — skip stuffed 0xFF00 until next marker we don't fully parse.
            break;
        }
        if (0xd0..=0xd7).contains(&m) {
            info.markers.push(Marker {
                name: marker_name(m),
                offset: i - 2,
                length: 2,
            });
            continue;
        }
        if i + 1 >= bytes.len() {
            break;
        }
        let len = u16::from_be_bytes([bytes[i], bytes[i + 1]]) as usize;
        let start = i - 2;
        let payload = i + 2;
        let end = (i + len).min(bytes.len());
        info.markers.push(Marker {
            name: marker_name(m),
            offset: start,
            length: 2 + len,
        });
        match m {
            0xdb => parse_dqt(&bytes[payload..end], &mut info),
            0xc0 | 0xc1 | 0xc2 => {
                info.progressive = m == 0xc2;
                parse_sof(&bytes[payload..end], &mut info);
            }
            0xdd if end - payload >= 2 => {
                info.restart_interval = u16::from_be_bytes([bytes[payload], bytes[payload + 1]]);
            }
            0xfe => {
                if let Ok(s) = std::str::from_utf8(&bytes[payload..end]) {
                    info.comments.push(s.trim_matches('\0').to_string());
                }
            }
            0xe1 => {
                info.app1.push(bytes[payload..end].to_vec());
                if let Some(thumb) = extract_exif_thumbnail(&bytes[payload..end]) {
                    info.thumbnail = Some(thumb);
                }
            }
            _ => {}
        }
        i += len;
    }
    info
}

fn parse_dqt(payload: &[u8], info: &mut JpegInfo) {
    let mut p = 0;
    while p < payload.len() {
        let pq_tq = payload[p];
        p += 1;
        let precision = pq_tq >> 4;
        let id = pq_tq & 0x0f;
        let mut table = [0u16; 64];
        if precision == 0 {
            if p + 64 > payload.len() {
                break;
            }
            for i in 0..64 {
                table[i] = payload[p + i] as u16;
            }
            p += 64;
        } else {
            if p + 128 > payload.len() {
                break;
            }
            for i in 0..64 {
                table[i] = u16::from_be_bytes([payload[p + i * 2], payload[p + i * 2 + 1]]);
            }
            p += 128;
        }
        info.qtables.push((id, table));
    }
}

fn parse_sof(payload: &[u8], info: &mut JpegInfo) {
    if payload.len() < 6 {
        return;
    }
    info.precision = payload[0];
    info.height = u16::from_be_bytes([payload[1], payload[2]]);
    info.width = u16::from_be_bytes([payload[3], payload[4]]);
    info.components = payload[5];
    let mut p = 6;
    for c in 0..info.components.min(4) {
        if p + 3 > payload.len() {
            break;
        }
        let _id = payload[p];
        let samp = payload[p + 1];
        info.h_samp[c as usize] = samp >> 4;
        info.v_samp[c as usize] = samp & 0x0f;
        info.q_sel[c as usize] = payload[p + 2];
        p += 3;
    }
}

/// Very small TIFF walker: locate JPEGInterchangeFormat (0x0201) + length (0x0202).
fn extract_exif_thumbnail(app1: &[u8]) -> Option<Vec<u8>> {
    let body = if app1.starts_with(b"Exif\0\0") {
        &app1[6..]
    } else {
        return None;
    };
    if body.len() < 8 {
        return None;
    }
    let le = body.starts_with(b"II");
    let be = body.starts_with(b"MM");
    if !le && !be {
        return None;
    }
    let u16r = |b: &[u8], o: usize| -> Option<u16> {
        let s = b.get(o..o + 2)?;
        Some(if le {
            u16::from_le_bytes([s[0], s[1]])
        } else {
            u16::from_be_bytes([s[0], s[1]])
        })
    };
    let u32r = |b: &[u8], o: usize| -> Option<u32> {
        let s = b.get(o..o + 4)?;
        Some(if le {
            u32::from_le_bytes([s[0], s[1], s[2], s[3]])
        } else {
            u32::from_be_bytes([s[0], s[1], s[2], s[3]])
        })
    };
    let ifd0 = u32r(body, 4)? as usize;
    // thumbnail is typically IFD1
    let n0 = u16r(body, ifd0)? as usize;
    let next = ifd0 + 2 + n0 * 12;
    let ifd1 = u32r(body, next)? as usize;
    if ifd1 == 0 || ifd1 + 2 > body.len() {
        return None;
    }
    let n1 = u16r(body, ifd1)? as usize;
    let mut off = None;
    let mut len = None;
    for i in 0..n1 {
        let e = ifd1 + 2 + i * 12;
        let tag = u16r(body, e)?;
        let val = u32r(body, e + 8)?;
        match tag {
            0x0201 => off = Some(val as usize),
            0x0202 => len = Some(val as usize),
            _ => {}
        }
    }
    let o = off?;
    let l = len?;
    if o + l <= body.len() && l > 16 {
        let t = body[o..o + l].to_vec();
        if t.len() >= 2 && t[0] == 0xff && t[1] == 0xd8 {
            return Some(t);
        }
    }
    None
}

pub fn jpeg_to_json(info: &JpegInfo, file_len: usize) -> String {
    let mut j = Json::new();
    j.begin_obj();
    j.bool_field("isJpeg", info.is_jpeg);
    j.bool_field("progressive", info.progressive);
    j.num_field("width", info.width as f64);
    j.num_field("height", info.height as f64);
    j.num_field("precision", info.precision as f64);
    j.num_field("components", info.components as f64);
    j.num_field("restartInterval", info.restart_interval as f64);
    j.num_field("fileLength", file_len as f64);
    let h_s = info.h_samp[0].max(1);
    let _v = info.v_samp[0].max(1);
    let ch = info.h_samp[1].max(1);
    let _cv = info.v_samp[1].max(1);
    let sub = if info.components >= 3 {
        format!("{}:{}:{}", h_s / ch.max(1), h_s / ch.max(1), h_s / ch.max(1))
    } else {
        "1:1:1".into()
    };
    // Standard 4:2:0 / 4:2:2 labels
    let chroma = if info.components < 3 {
        "grayscale"
    } else if info.h_samp[0] == 2 && info.v_samp[0] == 2 && info.h_samp[1] == 1 && info.v_samp[1] == 1
    {
        "4:2:0"
    } else if info.h_samp[0] == 2 && info.v_samp[0] == 1 && info.h_samp[1] == 1 && info.v_samp[1] == 1
    {
        "4:2:2"
    } else if info.h_samp[0] == 1 && info.v_samp[0] == 1 {
        "4:4:4"
    } else {
        "custom"
    };
    j.str_field("chromaSubsampling", chroma);
    j.str_field("samplingHint", &sub);
    if let Some((_, table)) = info.qtables.first() {
        j.num_field("estimatedQuality", estimate_quality(table));
    }
    j.key("quantizationTables");
    j.begin_arr();
    for (id, table) in &info.qtables {
        j.begin_obj();
        j.num_field("id", *id as f64);
        let sum: u32 = table.iter().map(|x| *x as u32).sum();
        j.num_field("sum", sum as f64);
        j.num_field("dc", table[0] as f64);
        j.key("values");
        j.begin_arr();
        for (i, v) in table.iter().enumerate() {
            j.num(*v as f64);
            if i + 1 < 64 {
                j.comma();
            }
        }
        j.end_arr();
        j.end_obj();
        j.comma();
    }
    j.end_arr();
    j.key("markers");
    j.begin_arr();
    for (i, m) in info.markers.iter().enumerate() {
        j.begin_obj();
        j.str_field("name", &m.name);
        j.num_field("offset", m.offset as f64);
        j.num_field("length", m.length as f64);
        j.end_obj();
        if i + 1 < info.markers.len() {
            j.comma();
        }
    }
    j.end_arr();
    j.key("comments");
    j.begin_arr();
    for (i, c) in info.comments.iter().enumerate() {
        j.str(c);
        if i + 1 < info.comments.len() {
            j.comma();
        }
    }
    j.end_arr();
    j.bool_field("hasThumbnail", info.thumbnail.is_some());
    j.num_field("app1Count", info.app1.len() as f64);
    if let Some(a) = info.app1.first() {
        j.str_field("app1Head", &hex_preview(a, 24));
        if a.starts_with(b"Exif") {
            j.str_field("app1Kind", "Exif");
        } else if a.windows(4).any(|w| w == b"http" || w == b"<xmp" || w == b"<?xm") {
            j.str_field("app1Kind", "XMP");
        } else {
            j.str_field("app1Kind", "APP1");
        }
    }
    j.end_obj();
    j.into_string()
}

/// Estimate a JPEG quality factor from the first luminance Q table (standard IJG).
pub fn estimate_quality(table: &[u16; 64]) -> f64 {
    // Mean of AC coefficients relative to a typical Q=50 table is noisy;
    // use the classic "sum of table" heuristic.
    let sum: f64 = table.iter().map(|x| *x as f64).sum();
    // IJG quality 50 luminance sum is 217. Scale empirically.
    let q = 100.0 - (sum - 64.0) / 14.0;
    q.clamp(1.0, 100.0)
}
