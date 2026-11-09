use std::collections::{BTreeSet, HashSet};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Version {
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub live: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub remix: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub acoustic: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub instrumental: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub cover: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub demo: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub edition: String,
}

impl Version {
    pub fn key(&self) -> String {
        let mut parts = Vec::new();
        if self.live {
            parts.push("live");
        }
        if self.remix {
            parts.push("remix");
        }
        if self.acoustic {
            parts.push("acoustic");
        }
        if self.instrumental {
            parts.push("instrumental");
        }
        if self.cover {
            parts.push("cover");
        }
        if self.demo {
            parts.push("demo");
        }
        if !self.edition.is_empty() {
            parts.push(self.edition.as_str());
        }
        if parts.is_empty() {
            "studio".to_string()
        } else {
            parts.join("+")
        }
    }

    pub fn compatible(&self, other: &Self) -> bool {
        self.key() == other.key()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Band {
    Exact,
    Similar,
    Gray,
    Different,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchPolicy {
    pub candidate_floor: f64,
    pub auto_merge: f64,
    pub jev_merge: f64,
}

impl Default for MatchPolicy {
    fn default() -> Self {
        Self {
            candidate_floor: 0.55,
            auto_merge: 0.90,
            jev_merge: 0.80,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Verdict {
    pub same: bool,
    pub band: Band,
    pub method: String, // "id" | "version" | "code" | "jev"
    pub score: f64,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct TrackProbe {
    pub source: String,
    pub id: String,
    pub title: String,
    pub artists: Vec<String>,
    pub album: Option<String>,
    pub duration_seconds: Option<f64>,
    pub version: Version,
}

/// Fold normalizes text for comparison: full-width ASCII to half-width, lowercase,
/// punctuation and whitespace removed, CJK characters preserved.
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for mut ch in text.chars() {
        if ('！'..='～').contains(&ch) {
            if let Some(mapped) = char::from_u32(ch as u32 - 0xFEE0) {
                ch = mapped;
            }
        } else if ch == '　' {
            ch = ' ';
        }
        if ch.is_whitespace() || ch.is_ascii_punctuation() || is_general_punct_or_symbol(ch) {
            continue;
        }
        for lower in ch.to_lowercase() {
            out.push(lower);
        }
    }
    out
}

fn is_general_punct_or_symbol(c: char) -> bool {
    matches!(
        c,
        '（' | '）' | '【' | '】' | '《' | '》' | '「' | '」' | '『' | '』'
            | '、' | '，' | '。' | '：' | '；' | '！' | '？' | '·' | '—' | '～'
    )
}

const VERSION_MARKERS: &[&str] = &[
    "live",
    "现场",
    "演唱会",
    "remix",
    "混音",
    "acoustic",
    "unplugged",
    "不插电",
    "instrumental",
    "offvocal",
    "伴奏",
    "纯音乐",
    "cover",
    "翻唱",
    "demo",
    "小样",
    "合唱版",
    "合唱",
    "重生版",
    "重制版",
    "重置版",
    "加速版",
    "慢速版",
    "dj版",
];

pub fn detect_version(parts: &[&str]) -> Version {
    let mut v = Version::default();
    for part in parts {
        let lower = part.to_lowercase();
        if lower.contains("live") || lower.contains("现场") || lower.contains("演唱会") {
            v.live = true;
        }
        if lower.contains("remix") || lower.contains("混音") || lower.contains("dj版") {
            v.remix = true;
        }
        if lower.contains("acoustic") || lower.contains("unplugged") || lower.contains("不插电") {
            v.acoustic = true;
        }
        if lower.contains("instrumental")
            || lower.contains("offvocal")
            || lower.contains("伴奏")
            || lower.contains("纯音乐")
        {
            v.instrumental = true;
        }
        if lower.contains("cover") || lower.contains("翻唱") {
            v.cover = true;
        }
        if lower.contains("demo") || lower.contains("小样") {
            v.demo = true;
        }
        if lower.contains("合唱版") || lower.contains("合唱") {
            v.edition = "chorus".into();
        } else if lower.contains("重生版") {
            v.edition = "reborn".into();
        } else if lower.contains("重制版") || lower.contains("重置版") || lower.contains("remaster") {
            v.edition = "remaster".into();
        } else if lower.contains("加速版") {
            v.edition = "speedup".into();
        } else if lower.contains("慢速版") {
            v.edition = "slow".into();
        }
    }
    v
}

/// Strips bracketed annotations `(Live)` / `（现场版）` and version markers so base titles align.
pub fn clean_title(title: &str) -> String {
    let mut out = String::new();
    let mut depth: i32 = 0;
    for ch in title.chars() {
        match ch {
            '(' | '（' | '[' | '【' => {
                depth += 1;
            }
            ')' | '）' | ']' | '】' => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            _ => {
                if depth == 0 {
                    out.push(ch);
                }
            }
        }
    }
    let mut lower = out.to_lowercase();
    for marker in VERSION_MARKERS {
        lower = lower.replace(marker, " ");
    }
    lower.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn title_key(title: &str) -> String {
    fold(&clean_title(title))
}

fn bigrams(text: &str) -> HashSet<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut set = HashSet::new();
    if chars.len() == 1 {
        set.insert(chars[0].to_string());
        return set;
    }
    for i in 0..chars.len().saturating_sub(1) {
        let mut s = String::new();
        s.push(chars[i]);
        s.push(chars[i + 1]);
        set.insert(s);
    }
    set
}

pub fn title_similarity(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    let left = bigrams(a);
    let right = bigrams(b);
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let hits = left.intersection(&right).count();
    (2.0 * hits as f64) / ((left.len() + right.len()) as f64)
}

pub fn artist_set(artists: &[String]) -> Vec<String> {
    let mut set = BTreeSet::new();
    for raw in artists {
        let cleaned = raw
            .replace(" feat. ", "/")
            .replace(" feat ", "/")
            .replace(" ft. ", "/")
            .replace(" ft ", "/");
        for part in cleaned.split(['/', '&', ',', '，', '、', ';', '；', '+', '|']) {
            let f = fold(part.trim());
            if !f.is_empty() {
                set.insert(f);
            }
        }
    }
    set.into_iter().collect()
}

pub fn artist_overlap(a: &[String], b: &[String]) -> f64 {
    let left = artist_set(a);
    let right = artist_set(b);
    if left.is_empty() && right.is_empty() {
        return 0.5;
    }
    if left.is_empty() || right.is_empty() {
        return 0.35;
    }
    let hits = left.iter().filter(|x| right.contains(x)).count();
    let denom = left.len().min(right.len());
    (hits as f64) / (denom as f64)
}

pub fn duration_similarity(a: Option<f64>, b: Option<f64>) -> f64 {
    match (a, b) {
        (Some(da), Some(db)) if da > 0.0 && db > 0.0 => {
            let delta = (da - db).abs();
            if delta <= 2.0 {
                1.0
            } else if delta >= 15.0 {
                0.0
            } else {
                1.0 - (delta - 2.0) / 13.0
            }
        }
        _ => 0.5,
    }
}

pub fn album_similarity(a: Option<&str>, b: Option<&str>) -> f64 {
    match (a, b) {
        (Some(sa), Some(sb)) if !sa.is_empty() && !sb.is_empty() => {
            let fa = fold(sa);
            let fb = fold(sb);
            if fa == fb {
                1.0
            } else {
                title_similarity(&fa, &fb) * 0.5
            }
        }
        _ => 0.5,
    }
}

pub fn similarity(a: &TrackProbe, b: &TrackProbe) -> f64 {
    if !a.version.compatible(&b.version) {
        return 0.0;
    }
    let t_sim = title_similarity(&title_key(&a.title), &title_key(&b.title));
    if t_sim == 0.0 {
        return 0.0;
    }
    0.50 * t_sim
        + 0.30 * artist_overlap(&a.artists, &b.artists)
        + 0.12 * duration_similarity(a.duration_seconds, b.duration_seconds)
        + 0.08 * album_similarity(a.album.as_deref(), b.album.as_deref())
}

pub fn decide(a: &TrackProbe, b: &TrackProbe, policy: &MatchPolicy) -> Verdict {
    if a.source == b.source && a.id == b.id {
        return Verdict {
            same: true,
            band: Band::Exact,
            method: "id".into(),
            score: 1.0,
            reason: "same-source-id".into(),
        };
    }
    if !a.version.compatible(&b.version) {
        return Verdict {
            same: false,
            band: Band::Different,
            method: "version".into(),
            score: 0.0,
            reason: "version-mismatch".into(),
        };
    }
    let score = similarity(a, b);
    if score >= policy.auto_merge {
        Verdict {
            same: true,
            band: Band::Similar,
            method: "code".into(),
            score,
            reason: "code-auto".into(),
        }
    } else if score >= policy.candidate_floor {
        Verdict {
            same: false,
            band: Band::Gray,
            method: "code".into(),
            score,
            reason: "gray-zone".into(),
        }
    } else {
        Verdict {
            same: false,
            band: Band::Different,
            method: "code".into(),
            score,
            reason: "below-candidate-floor".into(),
        }
    }
}

/// Gate check for Jev gray-zone model: only invoked when `Band::Gray` AND
/// title similarity >= 0.85, artist overlap > 0, compatible versions, and duration delta <= 8s.
pub fn qualifies_for_jev(a: &TrackProbe, b: &TrackProbe, policy: &MatchPolicy) -> bool {
    let v = decide(a, b, policy);
    if v.band != Band::Gray {
        return false;
    }
    let t_sim = title_similarity(&title_key(&a.title), &title_key(&b.title));
    if t_sim < 0.85 {
        return false;
    }
    if artist_overlap(&a.artists, &b.artists) <= 0.0 {
        return false;
    }
    match (a.duration_seconds, b.duration_seconds) {
        (Some(da), Some(db)) if da > 0.0 && db > 0.0 => (da - db).abs() <= 8.0,
        _ => false,
    }
}

