//! Tiny JSON writer — avoids serde to keep the wasm binary small.

pub struct Json {
    buf: String,
}

impl Json {
    pub fn new() -> Self {
        Self {
            buf: String::with_capacity(4096),
        }
    }

    pub fn into_string(self) -> String {
        let mut s = self.buf;
        if s.ends_with(',') {
            s.pop();
        }
        s
    }

    pub fn begin_obj(&mut self) {
        self.buf.push('{');
    }
    pub fn end_obj(&mut self) {
        self.trim_comma();
        self.buf.push('}');
        self.buf.push(',');
    }
    pub fn begin_arr(&mut self) {
        self.buf.push('[');
    }
    pub fn end_arr(&mut self) {
        self.trim_comma();
        self.buf.push(']');
        self.buf.push(',');
    }
    pub fn comma(&mut self) {
        if !self.buf.ends_with(',') {
            self.buf.push(',');
        }
    }
    fn trim_comma(&mut self) {
        if self.buf.ends_with(',') {
            self.buf.pop();
        }
    }
    pub fn key(&mut self, k: &str) {
        self.str(k);
        self.buf.push(':');
    }
    pub fn str(&mut self, s: &str) {
        self.buf.push('"');
        for c in s.chars() {
            match c {
                '"' => self.buf.push_str("\\\""),
                '\\' => self.buf.push_str("\\\\"),
                '\n' => self.buf.push_str("\\n"),
                '\r' => self.buf.push_str("\\r"),
                '\t' => self.buf.push_str("\\t"),
                c if (c as u32) < 0x20 => self.buf.push_str(&format!("\\u{:04x}", c as u32)),
                c => self.buf.push(c),
            }
        }
        self.buf.push('"');
    }
    pub fn num(&mut self, n: f64) {
        if !n.is_finite() {
            self.buf.push_str("0");
        } else if n.fract() == 0.0 && n.abs() < 1e15 {
            self.buf.push_str(&format!("{}", n as i64));
        } else {
            self.buf.push_str(&format!("{:.6}", n));
        }
    }
    pub fn bool(&mut self, b: bool) {
        self.buf.push_str(if b { "true" } else { "false" });
    }
    pub fn str_field(&mut self, k: &str, v: &str) {
        self.key(k);
        self.str(v);
        self.buf.push(',');
    }
    pub fn num_field(&mut self, k: &str, v: f64) {
        self.key(k);
        self.num(v);
        self.buf.push(',');
    }
    pub fn bool_field(&mut self, k: &str, v: bool) {
        self.key(k);
        self.bool(v);
        self.buf.push(',');
    }
}

pub fn hex_preview(b: &[u8], n: usize) -> String {
    b.iter()
        .take(n)
        .map(|x| format!("{:02X}", x))
        .collect::<Vec<_>>()
        .join(" ")
}
