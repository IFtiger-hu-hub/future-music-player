use quick_xml::events::Event;
use quick_xml::Reader;
use serde::{Deserialize, Serialize};

pub const MAX_TTML_BYTES: usize = 512 * 1024;
pub const MAX_TTML_DEPTH: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricWord {
    pub text: String,
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LyricLine {
    pub time_ms: u64,
    pub end_ms: u64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub romanization: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub translation: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub words: Vec<LyricWord>,
}

fn has_han(s: &str) -> bool {
    s.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c))
}

fn parse_ms_pair(raw: &str) -> Option<(u64, u64)> {
    let mut parts = raw.split(',');
    let first = parts.next()?.trim().parse::<f64>().ok()?;
    let second = parts.next()?.trim().parse::<f64>().ok()?;
    if parts.next().is_some() || first < 0.0 || second < 0.0 {
        return None;
    }
    Some((first.round() as u64, second.round() as u64))
}

fn strip_word_markers(text: &str) -> String {
    let mut out = String::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'<' {
            if let Some(rel_end) = text[i..].find('>') {
                let inside = &text[i + 1..i + rel_end];
                if inside.contains(',') {
                    i += rel_end + 1;
                    continue;
                }
            }
        }
        let ch = text[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Parses Huawei Music's `.hmrc` word-by-word lyric format:
/// `[lineStart,lineDuration]<wordOffset,wordDuration>text<offset,duration>text ^romanization`
pub fn parse_hmrc(raw: &str) -> Vec<LyricLine> {
    let mut out = Vec::new();
    for raw_line in raw.replace("\r\n", "\n").lines() {
        let line = raw_line.trim();
        if line.is_empty()
            || line.starts_with("[ti:")
            || line.starts_with("[ar:")
            || line.starts_with("[al:")
            || line.starts_with("[by:")
            || line.starts_with("[offset:")
            || !line.starts_with('[')
        {
            continue;
        }
        let Some(close_bracket) = line.find(']') else {
            continue;
        };
        let Some((line_start, line_dur)) = parse_ms_pair(&line[1..close_bracket]) else {
            continue;
        };
        let mut rest = &line[close_bracket + 1..];

        let mut romanization: Option<String> = None;
        let mut translation: Option<String> = None;

        if let Some(caret) = rest.find('^') {
            let tail = strip_word_markers(rest[caret + 1..].trim());
            rest = &rest[..caret];
            let body_plain = strip_word_markers(rest);
            if !tail.is_empty() {
                if has_han(&tail) && !has_han(&body_plain) {
                    translation = Some(tail);
                } else {
                    romanization = Some(tail);
                }
            }
        }

        let mut words = Vec::new();
        let mut full_text = String::new();
        let mut cursor = rest;

        while let Some(open) = cursor.find('<') {
            let after_open = &cursor[open..];
            let Some(close_rel) = after_open.find('>') else {
                break;
            };
            let Some((offset_ms, dur_ms)) = parse_ms_pair(&after_open[1..close_rel]) else {
                break;
            };
            cursor = &after_open[close_rel + 1..];
            let chunk = if let Some(next_open) = cursor.find('<') {
                let c = &cursor[..next_open];
                cursor = &cursor[next_open..];
                c
            } else {
                let c = cursor;
                cursor = "";
                c
            };
            if chunk.is_empty() {
                continue;
            }
            let start_ms = line_start + offset_ms;
            let end_ms = start_ms + dur_ms.max(15);
            words.push(LyricWord {
                text: chunk.to_string(),
                start_ms,
                end_ms,
            });
            full_text.push_str(chunk);
        }

        for i in 0..words.len().saturating_sub(1) {
            let next_start = words[i + 1].start_ms;
            if words[i].end_ms > next_start {
                words[i].end_ms = next_start.max(words[i].start_ms + 10);
            }
        }

        let body = full_text.trim().to_string();
        if body.is_empty() {
            continue;
        }

        out.push(LyricLine {
            time_ms: line_start,
            end_ms: line_start + line_dur.max(500),
            text: body,
            romanization,
            translation,
            words,
        });
    }

    for i in 0..out.len().saturating_sub(1) {
        if out[i].end_ms > out[i + 1].time_ms && out[i + 1].time_ms > out[i].time_ms {
            out[i].end_ms = out[i + 1].time_ms;
        }
    }
    out
}

/// Parses TTML time expressions (`"12.5s"`, `"400ms"`, `"01:02.300"`, `"00:01:02.5"`) into milliseconds.
pub fn parse_ttml_time_ms(expr: &str) -> Result<u64, String> {
    let s = expr.trim();
    if s.is_empty() {
        return Err("empty time expression".into());
    }
    if let Some(ms_str) = s.strip_suffix("ms") {
        let v: f64 = ms_str.trim().parse().map_err(|_| "invalid ms")?;
        if v < 0.0 || !v.is_finite() {
            return Err("negative or non-finite ms".into());
        }
        return Ok(v.round() as u64);
    }
    if let Some(sec_str) = s.strip_suffix('s') {
        let v: f64 = sec_str.trim().parse().map_err(|_| "invalid seconds")?;
        if v < 0.0 || !v.is_finite() {
            return Err("negative or non-finite seconds".into());
        }
        return Ok((v * 1000.0).round() as u64);
    }
    let parts: Vec<&str> = s.split(':').collect();
    match parts.len() {
        1 => {
            let sec: f64 = parts[0].parse().map_err(|_| "invalid seconds")?;
            if sec < 0.0 || !sec.is_finite() {
                return Err("negative seconds".into());
            }
            Ok((sec * 1000.0).round() as u64)
        }
        2 => {
            let mins: u64 = parts[0].parse().map_err(|_| "invalid minutes")?;
            let sec: f64 = parts[1].parse().map_err(|_| "invalid seconds")?;
            if sec < 0.0 || sec >= 60.0 || !sec.is_finite() {
                return Err("out-of-range seconds".into());
            }
            Ok(mins * 60_000 + (sec * 1000.0).round() as u64)
        }
        3 => {
            let hours: u64 = parts[0].parse().map_err(|_| "invalid hours")?;
            let mins: u64 = parts[1].parse().map_err(|_| "invalid minutes")?;
            let sec: f64 = parts[2].parse().map_err(|_| "invalid seconds")?;
            if mins >= 60 || sec < 0.0 || sec >= 60.0 || !sec.is_finite() {
                return Err("out-of-range clock time".into());
            }
            Ok(hours * 3_600_000 + mins * 60_000 + (sec * 1000.0).round() as u64)
        }
        _ => Err("unsupported time expression".into()),
    }
}

/// Parses Apple-style TTML lyrics with relative container timing, word spans,
/// `ttm:role="x-translation"` / `ttm:role="x-roman"`, and rejects `timeContainer="seq"`.
pub fn parse_ttml(raw: &str) -> Result<Vec<LyricLine>, String> {
    if raw.len() > MAX_TTML_BYTES {
        return Err("TTML document exceeds 512 KiB limit".into());
    }

    let mut reader = Reader::from_str(raw);
    reader.config_mut().trim_text(false);

    let mut depth = 0usize;
    let mut lines = Vec::new();
    let mut in_p = false;
    let mut p_begin_ms = 0u64;
    let mut p_end_ms = 0u64;
    let mut current_words: Vec<LyricWord> = Vec::new();
    let mut current_plain = String::new();
    let mut current_trans = String::new();
    let mut current_roman = String::new();

    // Span tracking
    let mut active_span_role = String::new();
    let mut active_word_span: Option<(u64, u64, String)> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                depth += 1;
                if depth > MAX_TTML_DEPTH {
                    return Err("TTML depth exceeds 32 limit".into());
                }
                for attr in e.attributes().flatten() {
                    let k = String::from_utf8_lossy(attr.key.as_ref()).to_lowercase();
                    let v = String::from_utf8_lossy(&attr.value).to_lowercase();
                    if k.ends_with("timecontainer") && v == "seq" {
                        return Err("TTML timeContainer=seq is not supported".into());
                    }
                }

                let tag = String::from_utf8_lossy(e.local_name().as_ref()).to_lowercase();
                if tag == "p" {
                    in_p = true;
                    p_begin_ms = 0;
                    current_words.clear();
                    current_plain.clear();
                    current_trans.clear();
                    current_roman.clear();

                    let mut dur_opt = None;
                    let mut end_opt = None;
                    for attr in e.attributes().flatten() {
                        let k = String::from_utf8_lossy(attr.key.as_ref()).to_lowercase();
                        let v = String::from_utf8_lossy(&attr.value);
                        if k == "begin" {
                            p_begin_ms = parse_ttml_time_ms(&v)?;
                        } else if k == "dur" {
                            dur_opt = Some(parse_ttml_time_ms(&v)?);
                        } else if k == "end" {
                            end_opt = Some(parse_ttml_time_ms(&v)?);
                        }
                    }
                    p_end_ms = match (dur_opt, end_opt) {
                        (Some(d), Some(end)) => (p_begin_ms + d).min(end),
                        (Some(d), None) => p_begin_ms + d,
                        (None, Some(end)) => end,
                        (None, None) => p_begin_ms + 4000,
                    };
                } else if tag == "span" && in_p {
                    let mut role = String::new();
                    let mut s_begin = None;
                    let mut s_dur = None;
                    let mut s_end = None;
                    for attr in e.attributes().flatten() {
                        let k = String::from_utf8_lossy(attr.key.as_ref()).to_lowercase();
                        let v = String::from_utf8_lossy(&attr.value);
                        if k.ends_with("role") {
                            role = v.to_lowercase();
                        } else if k == "begin" {
                            s_begin = Some(parse_ttml_time_ms(&v)?);
                        } else if k == "dur" {
                            s_dur = Some(parse_ttml_time_ms(&v)?);
                        } else if k == "end" {
                            s_end = Some(parse_ttml_time_ms(&v)?);
                        }
                    }

                    if role.contains("translation") {
                        active_span_role = "translation".into();
                    } else if role.contains("roman") || role.contains("pronunciation") {
                        active_span_role = "roman".into();
                    } else if let Some(b) = s_begin {
                        // Relative or absolute word timing inside <p>
                        let abs_start = if b < p_begin_ms { p_begin_ms + b } else { b };
                        let abs_end = if let Some(d) = s_dur {
                            (abs_start + d).min(p_end_ms)
                        } else if let Some(e_ms) = s_end {
                            let cand = if e_ms <= p_end_ms && e_ms >= abs_start {
                                e_ms
                            } else {
                                p_begin_ms + e_ms
                            };
                            cand.min(p_end_ms)
                        } else {
                            (abs_start + 400).min(p_end_ms)
                        };
                        active_word_span = Some((abs_start, abs_end, String::new()));
                    }
                }
            }
            Ok(Event::Text(t)) => {
                if !in_p {
                    continue;
                }
                let text = t.unescape().map_err(|e| e.to_string())?.to_string();
                if let Some((_, _, ref mut w_buf)) = active_word_span {
                    w_buf.push_str(&text);
                } else if active_span_role == "translation" {
                    current_trans.push_str(&text);
                } else if active_span_role == "roman" {
                    current_roman.push_str(&text);
                } else {
                    current_plain.push_str(&text);
                }
            }
            Ok(Event::End(e)) => {
                depth = depth.saturating_sub(1);
                let tag = String::from_utf8_lossy(e.local_name().as_ref()).to_lowercase();
                if tag == "span" && in_p {
                    if let Some((w_start, w_end, w_text)) = active_word_span.take() {
                        let trimmed = w_text.trim();
                        if !trimmed.is_empty() {
                            current_plain.push_str(&w_text);
                            current_words.push(LyricWord {
                                text: trimmed.to_string(),
                                start_ms: w_start,
                                end_ms: w_end.max(w_start + 50),
                            });
                        }
                    }
                    active_span_role.clear();
                } else if tag == "p" && in_p {
                    in_p = false;
                    let body = current_plain.trim().to_string();
                    if !body.is_empty() {
                        lines.push(LyricLine {
                            time_ms: p_begin_ms,
                            end_ms: p_end_ms.max(p_begin_ms + 500),
                            text: body,
                            romanization: if current_roman.trim().is_empty() {
                                None
                            } else {
                                Some(current_roman.trim().to_string())
                            },
                            translation: if current_trans.trim().is_empty() {
                                None
                            } else {
                                Some(current_trans.trim().to_string())
                            },
                            words: current_words.clone(),
                        });
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(format!("XML parse error: {e}")),
            _ => {}
        }
    }

    if lines.is_empty() {
        return Err("malformed or empty TTML".into());
    }
    Ok(lines)
}

/// Parses standard `[mm:ss.xx] lyric` LRC lines, including inline `^` subtitles and duplicate-timestamp translations.
pub fn parse_lrc(raw: &str) -> Vec<LyricLine> {
    let mut temp = Vec::new();
    for raw_line in raw.replace("\r\n", "\n").lines() {
        let mut cursor = raw_line.trim();
        if !cursor.starts_with('[') {
            continue;
        }
        let mut stamps = Vec::new();
        while cursor.starts_with('[') {
            let Some(close) = cursor.find(']') else {
                break;
            };
            let stamp = &cursor[1..close];
            if let Ok(time_ms) = parse_ttml_time_ms(stamp) {
                stamps.push(time_ms);
                cursor = cursor[close + 1..].trim();
            } else {
                break;
            }
        }
        if stamps.is_empty() {
            continue;
        }
        let mut text_part = cursor;
        let mut romanization: Option<String> = None;
        let mut translation: Option<String> = None;
        if let Some(caret) = text_part.find('^') {
            let tail = strip_word_markers(text_part[caret + 1..].trim());
            text_part = text_part[..caret].trim();
            if !tail.is_empty() {
                if has_han(&tail) && !has_han(text_part) {
                    translation = Some(tail);
                } else {
                    romanization = Some(tail);
                }
            }
        }
        let text = text_part.trim();
        if text.is_empty() {
            continue;
        }
        for time_ms in stamps {
            temp.push(LyricLine {
                time_ms,
                end_ms: time_ms + 5000,
                text: text.to_string(),
                romanization: romanization.clone(),
                translation: translation.clone(),
                words: Vec::new(),
            });
        }
    }

    temp.sort_by_key(|l| l.time_ms);

    let mut out: Vec<LyricLine> = Vec::new();
    for item in temp {
        if let Some(prev) = out.last_mut() {
            let is_credits = item.text.to_lowercase().contains("written by")
                || item.text.contains("作词")
                || item.text.contains("作曲")
                || item.text.contains("编曲");
            if prev.time_ms.abs_diff(item.time_ms) <= 80 && prev.text != item.text && !is_credits {
                if prev.translation.is_none() {
                    prev.translation = Some(item.text);
                }
                if prev.romanization.is_none() && item.romanization.is_some() {
                    prev.romanization = item.romanization;
                }
                continue;
            }
        }
        out.push(item);
    }

    for i in 0..out.len().saturating_sub(1) {
        if out[i + 1].time_ms > out[i].time_ms {
            out[i].end_ms = out[i + 1].time_ms;
        }
    }
    out
}

fn normalize_for_match(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// Merges translations/romanizations from a plain LRC track into word-by-word HMRC lines.
pub fn merge_lyric_subtitles(
    mut hmrc_lines: Vec<LyricLine>,
    lrc_lines: &[LyricLine],
) -> Vec<LyricLine> {
    if hmrc_lines.is_empty() || lrc_lines.is_empty() {
        return hmrc_lines;
    }
    for line in &mut hmrc_lines {
        if line.translation.is_some() && line.romanization.is_some() {
            continue;
        }
        let norm_line = normalize_for_match(&line.text);
        if let Some(cand) = lrc_lines
            .iter()
            .filter(|p| p.time_ms.abs_diff(line.time_ms) <= 1800)
            .min_by_key(|p| p.time_ms.abs_diff(line.time_ms))
        {
            if line.translation.is_none() {
                if let Some(ref trans) = cand.translation {
                    line.translation = Some(trans.clone());
                } else {
                    let norm_cand = normalize_for_match(&cand.text);
                    if !norm_cand.is_empty() && norm_cand != norm_line {
                        line.translation = Some(cand.text.clone());
                    }
                }
            }
            if line.romanization.is_none() && cand.romanization.is_some() {
                line.romanization = cand.romanization.clone();
            }
        }
    }
    hmrc_lines
}
