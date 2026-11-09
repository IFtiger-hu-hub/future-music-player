use crate::huawei::{
    build_music_digest_header, is_preview_stream, is_safe_resource_url, now_iso8601_utc,
    open_session, MusicSession, MUSIC_ENDPOINT,
};
use crate::lyrics::{merge_lyric_subtitles, parse_hmrc, parse_lrc, LyricLine};
use base64::{engine::general_purpose::STANDARD as BASE64_STD, Engine as _};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::OnceLock;
use url::Url;

pub const BRIDGE_PORT: u16 = 19420;
static ACTIVE_BRIDGE_PORT: AtomicU16 = AtomicU16::new(BRIDGE_PORT);
static SHARED_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn http_client() -> &'static reqwest::Client {
    SHARED_HTTP_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(25))
            .pool_max_idle_per_host(4)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

pub fn active_bridge_port() -> u16 {
    ACTIVE_BRIDGE_PORT.load(Ordering::Relaxed)
}

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
        if let (Ok(secrets_json), Ok(key_bytes)) = (
            serde_json::from_str::<Value>(&secrets_raw),
            BASE64_STD.decode(key_b64.trim()),
        ) {
            if key_bytes.len() == 32 {
                let mut key_arr = [0u8; 32];
                key_arr.copy_from_slice(&key_bytes);
                if let Some(entry_b64) = secrets_json
                    .get("entries")
                    .and_then(|e| e.get("plugin.session.huawei"))
                    .and_then(|s| s.as_str())
                {
                    if let Ok(outer_blob) = BASE64_STD.decode(entry_b64.trim()) {
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

fn to_frontend_lyrics(lines: Vec<LyricLine>) -> Vec<Value> {
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

fn extract_lyric_urls_from_play_data(play_data: &Value) -> (String, String, String) {
    let mut lrc_url = String::new();
    let mut hmrc_url = String::new();
    let mut inline_text = String::new();

    fn inspect_block(
        block: Option<&Value>,
        lrc_url: &mut String,
        hmrc_url: &mut String,
        inline_text: &mut String,
    ) {
        let Some(b) = block else { return };
        if let Some(s) = b.as_str() {
            if let Ok(parsed) = serde_json::from_str::<Value>(s) {
                inspect_block(Some(&parsed), lrc_url, hmrc_url, inline_text);
                return;
            }
            if is_safe_resource_url(s) {
                if s.ends_with(".hmrc") {
                    if hmrc_url.is_empty() {
                        *hmrc_url = s.to_string();
                    }
                } else if lrc_url.is_empty() {
                    *lrc_url = s.to_string();
                }
            } else if s.starts_with('[') && inline_text.is_empty() {
                *inline_text = s.to_string();
            }
            return;
        }
        if let Some(obj) = b.as_object() {
            if let Some(w) = obj.get("wordByWordLyric").and_then(|v| v.as_str()) {
                if is_safe_resource_url(w) && hmrc_url.is_empty() {
                    *hmrc_url = w.to_string();
                }
            }
            if let Some(l) = obj.get("lineByLineLyric").and_then(|v| v.as_str()) {
                if is_safe_resource_url(l) && lrc_url.is_empty() {
                    *lrc_url = l.to_string();
                }
            }
            if let Some(la) = obj.get("lyricAddress").and_then(|v| v.as_str()) {
                if is_safe_resource_url(la) && lrc_url.is_empty() {
                    *lrc_url = la.to_string();
                }
            }
            if let Some(inner) = obj.get("lyrics") {
                inspect_block(Some(inner), lrc_url, hmrc_url, inline_text);
            }
        }
    }

    inspect_block(
        play_data.get("lyrics"),
        &mut lrc_url,
        &mut hmrc_url,
        &mut inline_text,
    );
    inspect_block(
        play_data.get("songInfo").and_then(|s| s.get("lyrics")),
        &mut lrc_url,
        &mut hmrc_url,
        &mut inline_text,
    );
    inspect_block(
        play_data.get("lyricAddress"),
        &mut lrc_url,
        &mut hmrc_url,
        &mut inline_text,
    );
    inspect_block(
        play_data.get("contentExInfo"),
        &mut lrc_url,
        &mut hmrc_url,
        &mut inline_text,
    );
    inspect_block(
        play_data
            .get("songInfo")
            .and_then(|s| s.get("contentExInfo")),
        &mut lrc_url,
        &mut hmrc_url,
        &mut inline_text,
    );

    (lrc_url, hmrc_url, inline_text)
}

async fn huawei_post(token: &str, path: &str, body: Value) -> Result<Value, String> {
    let client = http_client();
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

async fn huawei_get(token: &str, path_with_query: &str) -> Result<Value, String> {
    let client = http_client();
    let auth = build_music_digest_header(token, &now_iso8601_utc())?;
    let resp = client
        .get(format!("{}{}", MUSIC_ENDPOINT, path_with_query))
        .header("Authorization", auth)
        .header("User-Agent", "tinglan-native/0.1")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    resp.json::<Value>().await.map_err(|e| e.to_string())
}

fn normalize_provider_track(item: &Value) -> Option<Value> {
    let cid = item
        .get("contentID")
        .or_else(|| item.get("contentId"))
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
        return None;
    }

    let mut artists = Vec::new();
    if let Some(pairs) = item.get("artistNamePairs").and_then(|v| v.as_array()) {
        for p in pairs {
            if let Some(n) = p
                .get("artistName")
                .or_else(|| p.get("name"))
                .and_then(|v| v.as_str())
            {
                if !n.trim().is_empty() {
                    artists.push(n.trim().to_string());
                }
            }
        }
    }
    if artists.is_empty() {
        artists.push(
            item.get("artistName")
                .or_else(|| item.get("singerName"))
                .and_then(|v| v.as_str())
                .unwrap_or("未知艺人")
                .trim()
                .to_string(),
        );
    }

    let mut cover = String::new();
    if let Some(pic) = item.get("picture") {
        // Prefer smallImgURL/middleImgURL for track lists so WebKit does not decode
        // 150+ 1000x1000 (4MB each) uncompressed bitmaps into RAM at once.
        for k in ["smallImgURL", "middleImgURL", "bigImgURL"] {
            if let Some(u) = pic.get(k).and_then(|v| v.as_str()) {
                if is_safe_resource_url(u) {
                    cover = u
                        .replace("music_cover_1000x1000.", "music_cover_300x300.")
                        .replace("music_cover_500x500.", "music_cover_300x300.")
                        .replace("-1000X1000-", "-240X240-")
                        .replace("-600X600-", "-240X240-");
                    break;
                }
            }
        }
    }

    let dur = item
        .get("duration")
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
        })
        .unwrap_or(225);

    Some(json!({
        "id": format!("hw_{}", cid),
        "sourceTrackId": cid,
        "title": title,
        "artists": artists,
        "album": item.get("albumName").and_then(|v| v.as_str()).unwrap_or("华为音乐"),
        "durationSeconds": dur,
        "coverUrl": cover,
    }))
}

pub async fn handle_sync(session: &MusicSession) -> Result<Value, String> {
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
            if let Some(norm) = normalize_provider_track(item) {
                let cid = norm
                    .get("sourceTrackId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if seen.insert(cid) {
                    tracks.push(norm);
                }
            }
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
            "limit": 100,
            "contentTypes": [4, 5, 7]
        }),
    )
    .await
    .unwrap_or_else(|_| json!({}));

    let mut playlists = Vec::new();
    if let Some(pl_items) = pl_data.get("favoriteInfos").and_then(|v| v.as_array()) {
        for p in pl_items {
            let pid = p
                .get("contentID")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let pname = p
                .get("contentName")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if pid.is_empty() || pname.is_empty() {
                continue;
            }
            let c_type = p
                .get("contentType")
                .and_then(|v| {
                    v.as_i64()
                        .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
                })
                .unwrap_or(5);

            let mut pl_track_ids = Vec::new();
            if c_type != 4 {
                let query_path = format!(
                    "/music-userbehavior-service/v1/service/playlist/detail/all?playListID={}&start=0&limit=50",
                    pid
                );
                if let Ok(detail) = huawei_get(&session.token, &query_path).await {
                    if let Some(list) = detail
                        .get("playListInfoEx")
                        .and_then(|e| e.get("playListSongInfoList"))
                        .and_then(|v| v.as_array())
                    {
                        for item in list {
                            if let Some(norm) = normalize_provider_track(item) {
                                let tid = norm["id"].as_str().unwrap_or("").to_string();
                                let cid = norm["sourceTrackId"].as_str().unwrap_or("").to_string();
                                pl_track_ids.push(tid);
                                if seen.insert(cid) {
                                    tracks.push(norm);
                                }
                            }
                        }
                    }
                }
            } else if let Ok(detail) = huawei_post(
                "",
                "/music-operation-service/v2/service/musiclist/detail/bymusiclistid",
                json!({
                    "musicListID": pid,
                    "copyrightSwitch": "1",
                    "start": 0,
                    "limit": "50"
                }),
            )
            .await
            {
                if let Some(list) = detail
                    .get("musicListInfoEx")
                    .and_then(|e| e.get("songSimpleInfos"))
                    .and_then(|v| v.as_array())
                {
                    for item in list {
                        if let Some(norm) = normalize_provider_track(item) {
                            let tid = norm["id"].as_str().unwrap_or("").to_string();
                            let cid = norm["sourceTrackId"].as_str().unwrap_or("").to_string();
                            pl_track_ids.push(tid);
                            if seen.insert(cid) {
                                tracks.push(norm);
                            }
                        }
                    }
                }
            }

            let cover = p
                .get("picture")
                .and_then(|pic| {
                    pic.get("bigImgURL")
                        .or_else(|| pic.get("middleImgURL"))
                        .or_else(|| pic.get("smallImgURL"))
                })
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let total_count = p
                .get("totalCount")
                .and_then(|v| {
                    v.as_u64()
                        .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                })
                .unwrap_or(pl_track_ids.len() as u64);

            playlists.push(json!({
                "id": format!("pl_hw_{}", pid),
                "sourcePlaylistId": pid,
                "name": pname,
                "description": p.get("listDesc").and_then(|v| v.as_str()).unwrap_or("来自华为音乐账号云端歌单"),
                "coverUrl": cover,
                "trackCount": total_count,
                "trackIds": pl_track_ids,
            }));
        }
    }

    // Write-through to the 23-table SQLite database (~/.config/future-music/library.db)
    if let Ok(db) = crate::db::LibraryDb::open_default() {
        let now_ms = (crate::huawei::now_epoch_secs() * 1000) as i64;
        let _ = db.persist_huawei_sync(&session.sns_user_id, &tracks, &playlists, now_ms);
    }

    Ok(json!({
        "ok": true,
        "snsUserID": session.sns_user_id,
        "snsUserId": session.sns_user_id,
        "tracks": tracks,
        "playlists": playlists,
    }))
}

pub async fn handle_resolve(session: Option<&MusicSession>, body: &Value) -> Result<Value, String> {
    let Some(sess) = session else {
        return Err("尚未登录华为账号".into());
    };
    let mut target_code = body
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

    // If contentCode is missing or is a prefixed ID, resolve real contentID via fuzzysearch
    if target_code.is_empty()
        || target_code.starts_with("hw_")
        || target_code.starts_with("loc_")
    {
        let q = format!("{} {}", title, artist).trim().to_string();
        if !q.is_empty() {
            if let Ok(sdata) = huawei_post(
                "",
                "/music-search-service/v10/service/fuzzysearch",
                json!({
                    "contentType": "1",
                    "correct": "1",
                    "queryWord": q,
                    "start": "0",
                    "limit": "5"
                }),
            )
            .await
            {
                if let Some(first) = sdata
                    .get("songSimpleInfos")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                {
                    target_code = first
                        .get("contentID")
                        .or_else(|| first.get("contentId"))
                        .or_else(|| first.get("songCode"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .trim()
                        .to_string();
                }
            }
        }
    }

    if target_code.is_empty() {
        return Err("未找到对应的华为音乐曲目 ID".into());
    }

    let q_types = if want_lossless {
        vec!["3", "1"]
    } else {
        vec!["1"]
    };
    let mut play_data = json!({});
    let mut file_url = String::new();

    for qt in q_types {
        if let Ok(pdata) = huawei_post(
            &sess.token,
            "/music-play-service/v3/service/file/bycontentcode",
            json!({
                "contentCode": target_code,
                "contentType": "1",
                "qualityType": qt
            }),
        )
        .await
        {
            let u = pdata
                .get("fileURL")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if is_safe_resource_url(&u) {
                file_url = u;
                play_data = pdata;
                break;
            }
        }
    }

    if file_url.is_empty() {
        return Err("当前歌曲暂无可播流或需会员权限".into());
    }

    let (lrc_url, hmrc_url, inline_text) = extract_lyric_urls_from_play_data(&play_data);
    let client = http_client();
    let mut parsed_lines: Vec<LyricLine> = Vec::new();

    if !hmrc_url.is_empty() {
        if let Ok(resp) = client.get(&hmrc_url).send().await {
            if let Ok(raw_hmrc) = resp.text().await {
                parsed_lines = parse_hmrc(&raw_hmrc);
            }
        }
    }
    if !lrc_url.is_empty() {
        if let Ok(resp) = client.get(&lrc_url).send().await {
            if let Ok(raw_lrc) = resp.text().await {
                let plain_lines = parse_lrc(&raw_lrc);
                if parsed_lines.is_empty() {
                    parsed_lines = plain_lines;
                } else {
                    parsed_lines = merge_lyric_subtitles(parsed_lines, &plain_lines);
                }
            }
        }
    }
    if parsed_lines.is_empty() && !inline_text.is_empty() {
        parsed_lines = parse_lrc(&inline_text);
    }

    let duration_seconds = play_data
        .get("songInfo")
        .and_then(|s| s.get("duration"))
        .and_then(|v| {
            v.as_u64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
        })
        .filter(|d| *d > 0);

    let play_q = play_data
        .get("playQuality")
        .or_else(|| play_data.get("qualityType"))
        .and_then(|v| {
            v.as_i64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
        })
        .unwrap_or(1);
    let is_lossless = play_q == 3 || file_url.to_ascii_lowercase().contains(".flac");

    let encoded_url: String =
        url::form_urlencoded::byte_serialize(file_url.as_bytes()).collect();
    let stream_url = format!(
        "http://127.0.0.1:{}/api/huawei/stream?url={}",
        active_bridge_port(),
        encoded_url
    );

    Ok(json!({
        "ok": true,
        "contentCode": target_code,
        "streamUrl": stream_url,
        "rawStreamUrl": file_url,
        "quality": if is_lossless { "lossless" } else { "standard" },
        "formatLabel": if is_lossless { "无损 FLAC" } else { "320k MP3" },
        "isPreview": is_preview_stream(&file_url),
        "durationSeconds": duration_seconds,
        "lyrics": to_frontend_lyrics(parsed_lines),
    }))
}

pub async fn handle_search(query: &str) -> Result<Value, String> {
    let data = huawei_post(
        "",
        "/music-search-service/v10/service/fuzzysearch",
        json!({
            "contentType": "1",
            "correct": "1",
            "queryWord": query,
            "start": "0",
            "limit": "30"
        }),
    )
    .await?;

    let mut tracks = Vec::new();
    if let Some(items) = data.get("songSimpleInfos").and_then(|v| v.as_array()) {
        for item in items {
            if let Some(norm) = normalize_provider_track(item) {
                tracks.push(norm);
            }
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
    let url_owned = raw_url.to_string();
    let _ = tauri::async_runtime::block_on(async move {
        let client = http_client();
        let mut req = client.get(&url_owned).header("User-Agent", "tinglan-native/0.1");
        if let Some(ref r) = range_header {
            req = req.header("Range", r);
        }
        let mut upstream = req.send().await.ok()?;
        let status = upstream.status().as_u16();
        let ct_raw = upstream
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("audio/flac");
        let ct = if ct_raw.contains("x-flac") || url_owned.to_ascii_lowercase().contains(".flac") {
            "audio/flac".to_string()
        } else {
            ct_raw.to_string()
        };
        let cl = upstream
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
        let cr = upstream
            .headers()
            .get("content-range")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let status_line = if status == 206 {
            "HTTP/1.1 206 Partial Content"
        } else {
            "HTTP/1.1 200 OK"
        };
        let mut hdr = format!(
            "{}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n",
            status_line, ct
        );
        if let Some(len_str) = cl {
            hdr.push_str(&format!("Content-Length: {}\r\n", len_str));
        }
        if let Some(c_range) = cr {
            hdr.push_str(&format!("Content-Range: {}\r\n", c_range));
        }
        hdr.push_str("\r\n");

        if stream.write_all(hdr.as_bytes()).is_err() {
            return Some(());
        }
        // Stream chunks immediately so audio playback starts in <150ms without waiting for full FLAC download
        while let Ok(Some(chunk)) = upstream.chunk().await {
            if stream.write_all(&chunk).is_err() {
                break;
            }
        }
        Some(())
    });
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
            let chunk_len = end - start + 1;
            let _ = file.seek(SeekFrom::Start(start));
            let hdr = format!(
                "HTTP/1.1 206 Partial Content\r\nContent-Type: {}\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
                mime, chunk_len, start, end, total
            );
            let _ = stream.write_all(hdr.as_bytes());
            let mut limited = file.take(chunk_len);
            let _ = std::io::copy(&mut limited, &mut stream);
            return;
        }
    }

    let hdr = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n",
        mime,
        total
    );
    let _ = stream.write_all(hdr.as_bytes());
    let _ = std::io::copy(&mut file, &mut stream);
}

/// Reads the full HTTP request headers AND full `Content-Length` body across multiple TCP packets.
fn read_full_http_request(stream: &mut TcpStream) -> Option<(String, String)> {
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(10)));
    let mut data = Vec::with_capacity(4096);
    let mut chunk = [0u8; 4096];
    let header_end_idx;

    loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        data.extend_from_slice(&chunk[..n]);
        if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
            header_end_idx = pos;
            break;
        }
        if data.len() > 65536 {
            return None;
        }
    }

    let header_str = String::from_utf8_lossy(&data[..header_end_idx]).to_string();
    let mut content_length = 0usize;
    for line in header_str.lines() {
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse::<usize>().unwrap_or(0);
            }
        }
    }

    let body_start = header_end_idx + 4;
    while data.len() < body_start + content_length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        data.extend_from_slice(&chunk[..n]);
    }

    let body_end = (body_start + content_length).min(data.len());
    let body_str = String::from_utf8_lossy(&data[body_start..body_end]).to_string();
    Some((header_str, body_str))
}

fn handle_client(mut stream: TcpStream) {
    let Some((header_part, body_part)) = read_full_http_request(&mut stream) else {
        return;
    };

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
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            let sess = load_persisted_session();
            match tauri::async_runtime::block_on(handle_resolve(sess.as_ref(), &body_json)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 404, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/huawei/search") => {
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            let q = body_json
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match tauri::async_runtime::block_on(handle_search(q)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 500, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/huawei/favorite") => {
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            let cid = body_json
                .get("contentCode")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let fav = body_json
                .get("favorite")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            if !cid.is_empty() {
                if let Ok(db) = crate::db::LibraryDb::open_default() {
                    let now_ms = (crate::huawei::now_epoch_secs() * 1000) as i64;
                    let _ = db.set_favorite(cid, fav, now_ms);
                }
            }
            if let Some(sess) = load_persisted_session() {
                let action_type = if fav { "1" } else { "2" };
                let _ = tauri::async_runtime::block_on(huawei_post(
                    &sess.token,
                    "/music-userbehavior-service/v1/service/favorite/action",
                    json!({
                        "actionType": action_type,
                        "contentTypes": [1],
                        "contentIDs": [cid]
                    }),
                ));
            }
            send_json(stream, 200, &json!({ "ok": true }));
        }
        ("GET", "/api/library/snapshot") => {
            match crate::db::LibraryDb::open_default().and_then(|db| db.load_runtime_snapshot()) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 500, &json!({ "ok": false, "error": e.to_string() })),
            }
        }
        ("POST", "/api/library/playlist") => {
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            let pid = body_json.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let name = body_json.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let desc = body_json
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let tids: Vec<String> = body_json
                .get("trackIds")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            if !pid.is_empty() && !name.is_empty() {
                if let Ok(db) = crate::db::LibraryDb::open_default() {
                    let now_ms = (crate::huawei::now_epoch_secs() * 1000) as i64;
                    let _ = db.upsert_local_playlist(pid, name, desc, &tids, now_ms);
                }
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
                if let Ok(db) = crate::db::LibraryDb::open_default() {
                    let now_ms = (crate::huawei::now_epoch_secs() * 1000) as i64;
                    let _ = db.persist_local_tracks(&summary.imported_tracks, now_ms);
                }
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
                        "streamUrl": format!("http://127.0.0.1:{}/api/local/stream?path={}", active_bridge_port(), enc),
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
    let mut bound_listener = None;
    for port in BRIDGE_PORT..=19450 {
        if let Ok(l) = TcpListener::bind(("127.0.0.1", port)) {
            ACTIVE_BRIDGE_PORT.store(port, Ordering::Relaxed);
            bound_listener = Some(l);
            break;
        }
    }
    if bound_listener.is_none() {
        if let Ok(l) = TcpListener::bind(("127.0.0.1", 0)) {
            if let Ok(addr) = l.local_addr() {
                ACTIVE_BRIDGE_PORT.store(addr.port(), Ordering::Relaxed);
            }
            bound_listener = Some(l);
        }
    }
    let Some(listener) = bound_listener else {
        return;
    };
    std::thread::spawn(move || {
        for conn in listener.incoming().flatten() {
            std::thread::spawn(move || {
                handle_client(conn);
            });
        }
    });
}
