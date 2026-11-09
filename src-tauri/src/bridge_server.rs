use crate::huawei::{
    build_music_digest_header, is_preview_stream, is_safe_resource_url, now_iso8601_utc,
    open_session, MusicSession, MUSIC_ENDPOINT,
};
use crate::lyrics::{parse_hmrc, parse_lrc};
use base64::{engine::general_purpose::STANDARD as BASE64_STD, Engine as _};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use url::Url;

pub const BRIDGE_PORT: u16 = 19420;

fn home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn future_session_file() -> PathBuf {
    home_dir()
        .join(".config")
        .join("future-music")
        .join("huawei-session.json")
}

pub fn save_persisted_session(session: &MusicSession) {
    let path = future_session_file();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let payload = json!({
        "token": session.token,
        "snsUserID": session.sns_user_id,
        "expireTime": session.expire_time,
    });
    if let Ok(raw) = serde_json::to_string_pretty(&payload) {
        let _ = fs::write(&path, raw);
    }
}

pub fn load_persisted_session() -> Option<MusicSession> {
    // 1. Check ~/.config/future-music/huawei-session.json
    let primary = future_session_file();
    if let Ok(raw) = fs::read_to_string(&primary) {
        if let Ok(v) = serde_json::from_str::<Value>(&raw) {
            let token = v
                .get("token")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let sns = v
                .get("snsUserID")
                .or_else(|| v.get("snsUserId"))
                .or_else(|| v.get("sns_user_id"))
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            let exp = v
                .get("expireTime")
                .or_else(|| v.get("expire_time"))
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string();
            if !token.is_empty() && !sns.is_empty() {
                return Some(MusicSession {
                    token,
                    sns_user_id: sns,
                    expire_time: exp,
                });
            }
        }
    }

    // 2. Auto-discover from ~/.config/tinglan/native-v1/secrets.local.json + vault.key
    let tinglan_dir = home_dir().join(".config").join("tinglan").join("native-v1");
    let secrets_path = tinglan_dir.join("secrets.local.json");
    let key_path = tinglan_dir.join("vault.key");
    if let (Ok(secrets_raw), Ok(key_b64)) = (
        fs::read_to_string(&secrets_path),
        fs::read_to_string(&key_path),
    ) {
        if let (Ok(secrets_json), Ok(key_bytes), Ok(outer_cipher)) = (
            serde_json::from_str::<Value>(&secrets_raw),
            BASE64_STD.decode(key_b64.trim()),
            Ok::<(), ()>(()),
        ) {
            let _ = outer_cipher;
            if key_bytes.len() == 32 {
                let mut key_arr = [0u8; 32];
                key_arr.copy_from_slice(&key_bytes);
                if let Some(entry_b64) = secrets_json
                    .get("entries")
                    .and_then(|e| e.get("plugin.session.huawei"))
                    .and_then(|s| s.as_str())
                {
                    if let Ok(outer_blob) = BASE64_STD.decode(entry_b64.trim()) {
                        // Outer layer: AES-256-GCM with empty AAD (tinglan FileVault)
                        if outer_blob.len() > 28 {
                            use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
                            if let Ok(cipher) = Aes256Gcm::new_from_slice(&key_arr) {
                                let nonce = Nonce::from_slice(&outer_blob[..12]);
                                if let Ok(inner_blob) = cipher.decrypt(nonce, &outer_blob[12..]) {
                                    if let Ok(sess) = open_session(&inner_blob, &key_arr) {
                                        save_persisted_session(&sess);
                                        return Some(sess);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

fn to_frontend_lyrics(lines: Vec<crate::lyrics::LyricLine>) -> Vec<Value> {
    lines
        .into_iter()
        .map(|l| {
            let words: Vec<Value> = l
                .words
                .into_iter()
                .map(|w| {
                    json!({
                        "text": w.text,
                        "startMs": w.start_ms,
                        "endMs": w.end_ms,
                    })
                })
                .collect();
            json!({
                "timeMs": l.time_ms,
                "endMs": l.end_ms,
                "text": l.text,
                "romanization": l.romanization,
                "translation": l.translation,
                "words": if words.is_empty() { Value::Null } else { Value::Array(words) },
            })
        })
        .collect()
}

async fn huawei_post(token: &str, path: &str, body: Value) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let auth = build_music_digest_header(token, &now_iso8601_utc())?;
    let resp = client
        .post(format!("{}{}", MUSIC_ENDPOINT, path))
        .header("Content-Type", "application/json;charset=utf-8")
        .header("Authorization", auth)
        .header("User-Agent", "tinglan-native/0.1")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

async fn handle_sync(session: &MusicSession) -> Result<Value, String> {
    let mut tracks = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut start = 0usize;
    let limit = 50usize;

    while start < 2000 {
        let data = huawei_post(
            &session.token,
            "/music-userbehavior-service/v3/service/favorite/simple/all",
            json!({
                "targetSnsUserID": session.sns_user_id,
                "start": start,
                "limit": limit,
                "contentTypes": [1]
            }),
        )
        .await?;

        let items = data
            .get("favoriteInfos")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        if items.is_empty() {
            break;
        }
        for item in &items {
            let cid = item
                .get("contentID")
                .or_else(|| item.get("songCode"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let title = item
                .get("contentName")
                .or_else(|| item.get("songName"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if cid.is_empty() || title.is_empty() || !seen.insert(cid.to_string()) {
                continue;
            }
            let mut artists = Vec::new();
            if let Some(pairs) = item.get("artistNamePairs").and_then(|v| v.as_array()) {
                for p in pairs {
                    if let Some(n) = p.get("artistName").and_then(|v| v.as_str()) {
                        if !n.trim().is_empty() {
                            artists.push(n.trim().to_string());
                        }
                    }
                }
            }
            if artists.is_empty() {
                artists.push(
                    item.get("artistName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("未知艺人")
                        .to_string(),
                );
            }
            let cover = item
                .get("picture")
                .and_then(|p| {
                    p.get("bigImgURL")
                        .or_else(|| p.get("middleImgURL"))
                        .or_else(|| p.get("smallImgURL"))
                })
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let dur = item
                .get("duration")
                .and_then(|v| {
                    v.as_u64()
                        .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                })
                .unwrap_or(225);

            tracks.push(json!({
                "id": format!("hw_{}", cid),
                "sourceTrackId": cid,
                "title": title,
                "artists": artists,
                "album": item.get("albumName").and_then(|v| v.as_str()).unwrap_or("华为音乐收藏"),
                "durationSeconds": dur,
                "coverUrl": cover,
            }));
        }
        if items.len() < limit {
            break;
        }
        start += items.len();
    }

    let pl_data = huawei_post(
        &session.token,
        "/music-userbehavior-service/v3/service/favorite/simple/all",
        json!({
            "targetSnsUserID": session.sns_user_id,
            "start": 0,
            "limit": 50,
            "contentTypes": [4, 5, 7]
        }),
    )
    .await
    .unwrap_or_else(|_| json!({}));

    let mut playlists = Vec::new();
    if let Some(pl_items) = pl_data.get("favoriteInfos").and_then(|v| v.as_array()) {
        for p in pl_items {
            let pid = p.get("contentID").and_then(|v| v.as_str()).unwrap_or("");
            let pname = p.get("contentName").and_then(|v| v.as_str()).unwrap_or("");
            if pid.is_empty() || pname.is_empty() {
                continue;
            }
            let mut track_ids = Vec::new();
            if let Ok(detail) = huawei_post(
                &session.token,
                "/music-agn-service/v2/service/songlist/query",
                json!({
                    "songlistId": pid,
                    "contentType": p.get("contentType").and_then(|v| v.as_i64()).unwrap_or(5),
                    "start": 0,
                    "limit": 50
                }),
            )
            .await
            {
                let songs = detail
                    .get("songlistInfo")
                    .and_then(|i| i.get("songs"))
                    .or_else(|| detail.get("songs"))
                    .and_then(|v| v.as_array());
                if let Some(arr) = songs {
                    for s in arr {
                        if let Some(scid) = s
                            .get("contentID")
                            .or_else(|| s.get("songCode"))
                            .and_then(|v| v.as_str())
                        {
                            track_ids.push(format!("hw_{}", scid));
                        }
                    }
                }
            }
            let cover = p
                .get("picture")
                .and_then(|pic| pic.get("bigImgURL").or_else(|| pic.get("middleImgURL")))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let total_count = p
                .get("totalCount")
                .and_then(|v| v.as_u64())
                .unwrap_or(track_ids.len() as u64);

            playlists.push(json!({
                "id": format!("hw_pl_{}", pid),
                "sourcePlaylistId": pid,
                "name": pname,
                "description": p.get("listDesc").and_then(|v| v.as_str()).unwrap_or("华为音乐云端歌单"),
                "coverUrl": cover,
                "trackCount": total_count,
                "trackIds": track_ids,
            }));
        }
    }

    Ok(json!({
        "ok": true,
        "snsUserID": session.sns_user_id,
        "snsUserId": session.sns_user_id,
        "tracks": tracks,
        "playlists": playlists,
    }))
}

async fn handle_resolve(session: Option<&MusicSession>, body: &Value) -> Result<Value, String> {
    let token = session.map(|s| s.token.as_str()).unwrap_or("");
    let mut cid = body
        .get("contentCode")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let title = body
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let artist = body
        .get("artist")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    let want_lossless = body
        .get("quality")
        .and_then(|v| v.as_str())
        .unwrap_or("lossless")
        != "standard";

    if cid.is_empty() && !title.is_empty() {
        let q = format!("{} {}", title, artist).trim().to_string();
        if let Ok(sdata) = huawei_post(
            token,
            "/music-search-service/v1/service/search/common",
            json!({
                "searchKey": q,
                "searchType": "1",
                "pageNumber": "1",
                "pageSize": "10",
                "Command": "search_common"
            }),
        )
        .await
        {
            if let Some(items) = sdata.get("songItems").and_then(|v| v.as_array()) {
                if let Some(first) = items.first() {
                    cid = first
                        .get("contentID")
                        .or_else(|| first.get("songCode"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                }
            }
        }
    }

    if cid.is_empty() {
        return Err("未能匹配到华为云端曲目 ID".into());
    }

    let q_types = if want_lossless {
        vec!["3", "1"]
    } else {
        vec!["1"]
    };
    let mut raw_url = String::new();
    let mut resolved_quality = "standard";

    for qt in q_types {
        if let Ok(udata) = huawei_post(
            token,
            "/music-agn-service/v1/service/song/geturl",
            json!({ "contentCode": cid, "qualityType": qt }),
        )
        .await
        {
            let u = udata
                .get("url")
                .or_else(|| udata.get("playUrl"))
                .or_else(|| udata.get("songUrl"))
                .or_else(|| udata.get("listenUrl"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if !u.is_empty() && is_safe_resource_url(u) {
                raw_url = u.to_string();
                resolved_quality = if qt == "3" || u.to_ascii_lowercase().contains(".flac") {
                    "lossless"
                } else {
                    "standard"
                };
                break;
            }
        }
    }

    if raw_url.is_empty() {
        return Err("华为云端未返回可播放流地址".into());
    }

    // Fetch HMRC / LRC lyrics
    let mut lyrics_json = Vec::new();
    if let Ok(ldata) = huawei_post(
        token,
        "/music-agn-service/v2/service/song/lyric",
        json!({ "contentCode": cid }),
    )
    .await
    {
        let hmrc_url = ldata
            .get("WordbywordLyricUrl")
            .or_else(|| ldata.get("wordbywordLyricUrl"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let lrc_url = ldata
            .get("lyricUrl")
            .or_else(|| ldata.get("LyricUrl"))
            .and_then(|v| v.as_str())
            .unwrap_or("");

        let client = reqwest::Client::new();
        let mut parsed_lines = Vec::new();
        if !hmrc_url.is_empty() {
            if let Ok(resp) = client.get(hmrc_url).send().await {
                if let Ok(raw_hmrc) = resp.text().await {
                    parsed_lines = parse_hmrc(&raw_hmrc);
                }
            }
        }
        if parsed_lines.is_empty() && !lrc_url.is_empty() {
            if let Ok(resp) = client.get(lrc_url).send().await {
                if let Ok(raw_lrc) = resp.text().await {
                    parsed_lines = parse_lrc(&raw_lrc);
                }
            }
        }
        lyrics_json = to_frontend_lyrics(parsed_lines);
    }

    let encoded_url: String =
        url::form_urlencoded::byte_serialize(raw_url.as_bytes()).collect();
    let stream_url = format!(
        "http://127.0.0.1:{}/api/huawei/stream?url={}",
        BRIDGE_PORT, encoded_url
    );

    Ok(json!({
        "ok": true,
        "contentCode": cid,
        "streamUrl": stream_url,
        "quality": resolved_quality,
        "formatLabel": if resolved_quality == "lossless" { "无损 FLAC" } else { "标准音质" },
        "isPreview": is_preview_stream(&raw_url),
        "lyrics": lyrics_json,
    }))
}

async fn handle_search(session: Option<&MusicSession>, query: &str) -> Result<Value, String> {
    let token = session.map(|s| s.token.as_str()).unwrap_or("");
    let data = huawei_post(
        token,
        "/music-search-service/v1/service/search/common",
        json!({
            "searchKey": query,
            "searchType": "1",
            "pageNumber": "1",
            "pageSize": "30",
            "Command": "search_common"
        }),
    )
    .await?;

    let mut tracks = Vec::new();
    if let Some(items) = data.get("songItems").and_then(|v| v.as_array()) {
        for item in items {
            let cid = item
                .get("contentID")
                .or_else(|| item.get("songCode"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let title = item
                .get("contentName")
                .or_else(|| item.get("songName"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if cid.is_empty() || title.is_empty() {
                continue;
            }
            let artist = item
                .get("artistName")
                .or_else(|| item.get("singerName"))
                .and_then(|v| v.as_str())
                .unwrap_or("未知艺人");
            let cover = item
                .get("picture")
                .and_then(|p| p.get("bigImgURL").or_else(|| p.get("middleImgURL")))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let dur = item
                .get("duration")
                .and_then(|v| v.as_u64())
                .unwrap_or(225);
            tracks.push(json!({
                "id": format!("hw_{}", cid),
                "sourceTrackId": cid,
                "title": title,
                "artists": [artist],
                "album": item.get("albumName").and_then(|v| v.as_str()).unwrap_or("华为音乐"),
                "durationSeconds": dur,
                "coverUrl": cover,
            }));
        }
    }

    Ok(json!({ "ok": true, "tracks": tracks }))
}

fn send_json(mut stream: TcpStream, status: u16, payload: &Value) {
    let body = serde_json::to_vec(payload).unwrap_or_default();
    let status_text = match status {
        200 => "200 OK",
        400 => "400 Bad Request",
        401 => "401 Unauthorized",
        404 => "404 Not Found",
        _ => "500 Internal Server Error",
    };
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Range\r\nConnection: close\r\n\r\n",
        status_text,
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(&body);
}

fn proxy_huawei_stream(mut stream: TcpStream, raw_url: &str, range_header: Option<String>) {
    if !is_safe_resource_url(raw_url) {
        send_json(stream, 400, &json!({ "error": "invalid stream url" }));
        return;
    }
    let res = tauri::async_runtime::block_on(async move {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .ok()?;
        let mut req = client.get(raw_url).header("User-Agent", "tinglan-native/0.1");
        if let Some(ref r) = range_header {
            req = req.header("Range", r);
        }
        let upstream = req.send().await.ok()?;
        let status = upstream.status().as_u16();
        let ct = upstream
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("audio/flac")
            .to_string();
        let cr = upstream
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let bytes = upstream.bytes().await.ok()?;
        Some((status, ct, cr, bytes))
    });

    if let Some((status, ct, cr, bytes)) = res {
        let status_line = if status == 206 {
            "HTTP/1.1 206 Partial Content"
        } else {
            "HTTP/1.1 200 OK"
        };
        let mut hdr = format!(
            "{}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n",
            status_line,
            ct,
            bytes.len()
        );
        if let Some(c_range) = cr {
            hdr.push_str(&format!("Content-Range: {}\r\n", c_range));
        }
        hdr.push_str("\r\n");
        let _ = stream.write_all(hdr.as_bytes());
        let _ = stream.write_all(&bytes);
    } else {
        send_json(stream, 500, &json!({ "error": "upstream stream error" }));
    }
}

fn serve_local_file_stream(mut stream: TcpStream, file_path: &str, range_header: Option<String>) {
    let p = Path::new(file_path);
    let Ok(mut file) = fs::File::open(p) else {
        send_json(stream, 404, &json!({ "error": "file not found" }));
        return;
    };
    let Ok(meta) = file.metadata() else {
        send_json(stream, 404, &json!({ "error": "stat failed" }));
        return;
    };
    let total = meta.len();
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "ogg" => "audio/ogg",
        _ => "audio/flac",
    };

    if let Some(range) = range_header.and_then(|r| r.strip_prefix("bytes=").map(String::from)) {
        let parts: Vec<&str> = range.split('-').collect();
        let start = parts
            .first()
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(0);
        let end = parts
            .get(1)
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or_else(|| total.saturating_sub(1))
            .min(total.saturating_sub(1));
        if start <= end && start < total {
            let chunk_len = (end - start + 1) as usize;
            let mut buf = vec![0u8; chunk_len];
            let _ = file.seek(SeekFrom::Start(start));
            let _ = file.read_exact(&mut buf);
            let hdr = format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Type: {}\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                mime, chunk_len, start, end, total
            );
            let _ = stream.write_all(hdr.as_bytes());
            let _ = stream.write_all(&buf);
            return;
        }
    }

    let mut buf = Vec::new();
    let _ = file.read_to_end(&mut buf);
    let hdr = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        mime,
        buf.len()
    );
    let _ = stream.write_all(hdr.as_bytes());
    let _ = stream.write_all(&buf);
}

fn handle_client(mut stream: TcpStream) {
    let mut buf = [0u8; 16384];
    let Ok(n) = stream.read(&mut buf) else {
        return;
    };
    if n == 0 {
        return;
    }
    let raw_req = String::from_utf8_lossy(&buf[..n]);
    let Some(header_end) = raw_req.find("\r\n\r\n") else {
        return;
    };
    let header_part = &raw_req[..header_end];
    let body_part = &raw_req[header_end + 4..];

    let mut lines = header_part.lines();
    let first_line = lines.next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let full_path = parts.next().unwrap_or("/");

    if method == "OPTIONS" {
        send_json(stream, 200, &json!({ "ok": true }));
        return;
    }

    let mut headers = HashMap::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let parsed_url =
        Url::parse(&format!("http://127.0.0.1{}", full_path)).unwrap_or_else(|_| {
            Url::parse("http://127.0.0.1/").unwrap()
        });
    let pathname = parsed_url.path();
    let query_map: HashMap<String, String> = parsed_url.query_pairs().into_owned().collect();

    match (method, pathname) {
        ("GET", "/api/huawei/status") => {
            if let Some(sess) = load_persisted_session() {
                send_json(
                    stream,
                    200,
                    &json!({
                        "loggedIn": true,
                        "snsUserID": sess.sns_user_id,
                        "snsUserId": sess.sns_user_id,
                        "expireTime": sess.expire_time,
                    }),
                );
            } else {
                send_json(stream, 200, &json!({ "loggedIn": false }));
            }
        }
        ("POST", "/api/huawei/sync") => {
            let Some(sess) = load_persisted_session() else {
                send_json(stream, 401, &json!({ "ok": false, "error": "not logged in" }));
                return;
            };
            match tauri::async_runtime::block_on(handle_sync(&sess)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 500, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/huawei/resolve") => {
            let body_json: Value = serde_json::from_str(body_part).unwrap_or_else(|_| json!({}));
            let sess = load_persisted_session();
            match tauri::async_runtime::block_on(handle_resolve(sess.as_ref(), &body_json)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 404, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/huawei/search") => {
            let body_json: Value = serde_json::from_str(body_part).unwrap_or_else(|_| json!({}));
            let q = body_json
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let sess = load_persisted_session();
            match tauri::async_runtime::block_on(handle_search(sess.as_ref(), q)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 500, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/huawei/favorite") => {
            let body_json: Value = serde_json::from_str(body_part).unwrap_or_else(|_| json!({}));
            if let Some(sess) = load_persisted_session() {
                let cid = body_json
                    .get("contentCode")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let fav = body_json
                    .get("favorite")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                let endpoint = if fav {
                    "/music-userbehavior-service/v1/service/favorite/add"
                } else {
                    "/music-userbehavior-service/v1/service/favorite/delete"
                };
                let _ = tauri::async_runtime::block_on(huawei_post(
                    &sess.token,
                    endpoint,
                    json!({ "contentID": cid, "contentType": 1 }),
                ));
            }
            send_json(stream, 200, &json!({ "ok": true }));
        }
        ("GET", "/api/huawei/stream") => {
            let target = query_map.get("url").cloned().unwrap_or_default();
            let range = headers.get("range").cloned();
            proxy_huawei_stream(stream, &target, range);
        }
        ("POST", "/api/local/scan") => {
            let dir = home_dir().join("Music");
            let mut tracks = Vec::new();
            if let Ok(summary) = crate::local_scanner::scan_local_directory(&dir) {
                for t in summary.imported_tracks {
                    let enc: String =
                        url::form_urlencoded::byte_serialize(t.source_track_id.as_bytes())
                            .collect();
                    tracks.push(json!({
                        "id": format!("local_{}", t.source_track_id),
                        "sourceTrackId": t.source_track_id,
                        "title": t.title,
                        "artists": t.artists.iter().map(|a| a.name.clone()).collect::<Vec<_>>(),
                        "album": t.album.map(|a| a.title).unwrap_or_else(|| "本地音乐目录".into()),
                        "durationSeconds": t.duration_ms.unwrap_or(240_000) / 1000,
                        "quality": t.quality,
                        "formatLabel": "本地无损",
                        "streamUrl": format!("http://127.0.0.1:{}/api/local/stream?path={}", BRIDGE_PORT, enc),
                    }));
                }
            }
            send_json(
                stream,
                200,
                &json!({
                    "ok": true,
                    "scannedDir": dir.to_string_lossy(),
                    "tracks": tracks,
                }),
            );
        }
        ("GET", "/api/local/stream") => {
            let target = query_map.get("path").cloned().unwrap_or_default();
            let range = headers.get("range").cloned();
            serve_local_file_stream(stream, &target, range);
        }
        _ => {
            send_json(stream, 404, &json!({ "error": "not found" }));
        }
    }
}

pub fn spawn_embedded_bridge_server() {
    std::thread::spawn(move || {
        let Ok(listener) = TcpListener::bind(("127.0.0.1", BRIDGE_PORT)) else {
            return;
        };
        for conn in listener.incoming().flatten() {
            std::thread::spawn(move || {
                handle_client(conn);
            });
        }
    });
}

