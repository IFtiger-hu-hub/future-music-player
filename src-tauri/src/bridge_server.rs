use crate::huawei::{
    build_music_digest_header, is_preview_stream, is_safe_resource_url, now_iso8601_utc,
    open_session, MusicSession, MUSIC_ENDPOINT,
};
use crate::lyrics::{
    merge_lyric_romanizations, merge_lyric_subtitles, parse_hmrc, parse_lrc, parse_netease_yrc,
    LyricLine,
};
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

fn format_listen_count(raw_times: u64) -> String {
    if raw_times >= 10_000 {
        format!("{:.1}万", (raw_times as f64) / 10_000.0)
    } else if raw_times > 0 {
        format!("{}", raw_times)
    } else {
        "热门".into()
    }
}

pub async fn handle_recommendations(query: &str) -> Result<Value, String> {
    let q = if query.trim().is_empty() {
        "华语精选"
    } else {
        query.trim()
    };
    let data = huawei_post(
        "",
        "/music-search-service/v10/service/fuzzysearch",
        json!({
            "contentType": "4",
            "correct": "1",
            "queryWord": q,
            "start": "0",
            "limit": "10"
        }),
    )
    .await?;

    let mut playlists = Vec::new();
    if let Some(items) = data.get("musicListSimpleInfos").and_then(|v| v.as_array()) {
        for p in items {
            let pid = p
                .get("contentID")
                .or_else(|| p.get("musicListID"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let title = p
                .get("contentName")
                .or_else(|| p.get("musicListName"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if pid.is_empty() || title.is_empty() {
                continue;
            }
            let mut cover = String::new();
            if let Some(pic) = p.get("picture") {
                for k in ["middleImgURL", "bigImgURL", "smallImgURL"] {
                    if let Some(u) = pic.get(k).and_then(|v| v.as_str()) {
                        if is_safe_resource_url(u) {
                            cover = u
                                .replace("music_pgcsonglistcover_1000x1000.", "music_pgcsonglistcover_500x500.")
                                .replace("music_cover_1000x1000.", "music_cover_300x300.");
                            break;
                        }
                    }
                }
            }
            let total_count = p
                .get("totalCount")
                .or_else(|| p.get("playNum"))
                .and_then(|v| {
                    v.as_u64()
                        .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                })
                .unwrap_or(30);
            let raw_times = p
                .get("times")
                .and_then(|v| {
                    v.as_u64()
                        .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                })
                .unwrap_or(1_280_000);
            let desc = p
                .get("description")
                .or_else(|| p.get("listDesc"))
                .and_then(|v| v.as_str())
                .unwrap_or("华为音乐官方精选无损歌单")
                .replace("<br>", " ")
                .trim()
                .to_string();

            playlists.push(json!({
                "id": format!("pl_hw_{}", pid),
                "sourcePlaylistId": pid,
                "title": title,
                "description": desc,
                "coverUrl": cover,
                "trackCount": total_count,
                "playCount": format_listen_count(raw_times),
            }));
        }
    }

    Ok(json!({
        "ok": true,
        "playlists": playlists,
    }))
}

pub async fn handle_playlist_detail(playlist_id: &str) -> Result<Value, String> {
    let raw_id = playlist_id
        .trim()
        .strip_prefix("pl_hw_")
        .or_else(|| playlist_id.trim().strip_prefix("pl_"))
        .unwrap_or(playlist_id.trim());
    if raw_id.is_empty() {
        return Err("missing playlist id".into());
    }

    let detail = huawei_post(
        "",
        "/music-operation-service/v2/service/musiclist/detail/bymusiclistid",
        json!({
            "musicListID": raw_id,
            "copyrightSwitch": "1",
            "start": 0,
            "limit": "50"
        }),
    )
    .await
    .unwrap_or_else(|_| json!({}));

    let mut tracks = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let info = detail.get("musicListInfoEx").cloned().unwrap_or_else(|| json!({}));

    if let Some(list) = info.get("songSimpleInfos").and_then(|v| v.as_array()) {
        for item in list {
            if let Some(norm) = normalize_provider_track(item) {
                let cid = norm["sourceTrackId"].as_str().unwrap_or("").to_string();
                if seen.insert(cid) {
                    tracks.push(norm);
                }
            }
        }
    }

    // Fallback to user playlist detail endpoint if needed
    if tracks.is_empty() {
        if let Some(sess) = load_persisted_session() {
            let query_path = format!(
                "/music-userbehavior-service/v1/service/playlist/detail/all?playListID={}&start=0&limit=50",
                raw_id
            );
            if let Ok(u_detail) = huawei_get(&sess.token, &query_path).await {
                if let Some(list) = u_detail
                    .get("playListInfoEx")
                    .and_then(|e| e.get("playListSongInfoList"))
                    .and_then(|v| v.as_array())
                {
                    for item in list {
                        if let Some(norm) = normalize_provider_track(item) {
                            let cid = norm["sourceTrackId"].as_str().unwrap_or("").to_string();
                            if seen.insert(cid) {
                                tracks.push(norm);
                            }
                        }
                    }
                }
            }
        }
    }

    let name = info
        .get("musicListName")
        .or_else(|| info.get("contentName"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let description = info
        .get("listDesc")
        .or_else(|| info.get("description"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .replace("<br>", " ")
        .trim()
        .to_string();
    let mut cover = String::new();
    if let Some(pic) = info.get("picture") {
        for k in ["middleImgURL", "bigImgURL", "smallImgURL"] {
            if let Some(u) = pic.get(k).and_then(|v| v.as_str()) {
                if is_safe_resource_url(u) {
                    cover = u.to_string();
                    break;
                }
            }
        }
    }

    Ok(json!({
        "ok": true,
        "playlistId": format!("pl_hw_{}", raw_id),
        "sourcePlaylistId": raw_id,
        "name": name,
        "description": description,
        "coverUrl": cover,
        "tracks": tracks,
    }))
}

fn is_safe_stream_proxy_url(raw: &str) -> bool {
    if is_safe_resource_url(raw) {
        return true;
    }
    let Ok(u) = Url::parse(raw) else {
        return false;
    };
    if (u.scheme() != "https" && u.scheme() != "http")
        || !u.username().is_empty()
        || u.password().is_some()
    {
        return false;
    }
    let Some(host) = u.host_str().map(|h| h.to_ascii_lowercase()) else {
        return false;
    };
    host == "music.163.com"
        || host.ends_with(".music.126.net")
        || host.ends_with(".126.net")
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct NeteaseSession {
    pub uid: String,
    pub nickname: String,
    pub avatar_url: String,
    #[serde(default)]
    pub cookie: String,
}

fn netease_session_file() -> PathBuf {
    home_dir()
        .join(".config")
        .join("future-music")
        .join("netease-session.json")
}

pub fn save_netease_session(session: &NeteaseSession) {
    let path = netease_session_file();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(session) {
        let _ = fs::write(&path, raw);
    }
}

pub fn clear_netease_session() {
    let path = netease_session_file();
    let _ = fs::remove_file(path);
}

pub fn load_netease_session() -> Option<NeteaseSession> {
    let path = netease_session_file();
    let raw = fs::read_to_string(&path).ok()?;
    let sess: NeteaseSession = serde_json::from_str(&raw).ok()?;
    if sess.uid.trim().is_empty() {
        return None;
    }
    Some(sess)
}

fn sanitize_netease_cover(raw: &str) -> String {
    let trimmed = raw.trim().replace("http://", "https://");
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.contains("126.net") && !trimmed.contains("param=") {
        if trimmed.contains('?') {
            format!("{trimmed}&param=300y300")
        } else {
            format!("{trimmed}?param=300y300")
        }
    } else {
        trimmed
    }
}

pub fn normalize_netease_track(item: &Value) -> Option<Value> {
    let id_str = item
        .get("id")
        .and_then(|v| {
            v.as_i64()
                .map(|n| n.to_string())
                .or_else(|| v.as_str().map(|s| s.to_string()))
        })?
        .trim()
        .to_string();
    let title = item
        .get("name")
        .and_then(|v| v.as_str())?
        .trim()
        .to_string();
    if id_str.is_empty() || title.is_empty() {
        return None;
    }

    let mut artists: Vec<String> = Vec::new();
    if let Some(arr) = item
        .get("ar")
        .or_else(|| item.get("artists"))
        .and_then(|v| v.as_array())
    {
        for a in arr {
            if let Some(n) = a.get("name").and_then(|v| v.as_str()) {
                let trimmed = n.trim();
                if !trimmed.is_empty() {
                    artists.push(trimmed.to_string());
                }
            }
        }
    }
    if artists.is_empty() {
        artists.push("未知歌手".to_string());
    }

    let album_obj = item.get("al").or_else(|| item.get("album"));
    let album = album_obj
        .and_then(|a| a.get("name"))
        .and_then(|v| v.as_str())
        .unwrap_or("网易云音乐")
        .trim()
        .to_string();
    let raw_cover = album_obj
        .and_then(|a| a.get("picUrl"))
        .or_else(|| item.get("picUrl"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let cover_url = sanitize_netease_cover(raw_cover);

    let dur_ms = item
        .get("dt")
        .or_else(|| item.get("duration"))
        .and_then(|v| v.as_u64())
        .unwrap_or(225_000);
    let duration_seconds = (dur_ms / 1000).max(1);

    let fee = item.get("fee").and_then(|v| v.as_i64()).unwrap_or(0);
    let is_vip = fee == 1 || fee == 4;

    Some(json!({
        "id": format!("ncm_{id_str}"),
        "sourceTrackId": id_str,
        "title": title,
        "artists": artists,
        "album": album,
        "durationSeconds": duration_seconds,
        "coverUrl": cover_url,
        "isVip": is_vip,
        "source": "netease",
    }))
}

async fn netease_get(url: &str, cookie: Option<&str>) -> Result<Value, String> {
    let client = http_client();
    let mut req = client
        .get(url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        )
        .header("Referer", "https://music.163.com/");
    if let Some(c) = cookie.filter(|s| !s.trim().is_empty()) {
        req = req.header("Cookie", c);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("网易云请求失败: {e}"))?;
    resp.json::<Value>()
        .await
        .map_err(|e| format!("网易云响应解析失败: {e}"))
}

async fn netease_post_form(
    url: &str,
    form: &[(&str, String)],
    cookie: Option<&str>,
) -> Result<Value, String> {
    let client = http_client();
    let mut req = client
        .post(url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        )
        .header("Referer", "https://music.163.com/")
        .form(form);
    if let Some(c) = cookie.filter(|s| !s.trim().is_empty()) {
        req = req.header("Cookie", c);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("网易云 POST 请求失败: {e}"))?;
    resp.json::<Value>()
        .await
        .map_err(|e| format!("网易云响应解析失败: {e}"))
}

pub async fn handle_netease_search(query: &str) -> Result<Value, String> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(json!({ "ok": true, "tracks": [] }));
    }
    let enc: String = url::form_urlencoded::byte_serialize(q.as_bytes()).collect();
    let url = format!(
        "https://music.163.com/api/cloudsearch/pc?s={enc}&type=1&offset=0&limit=30"
    );
    let sess = load_netease_session();
    let cookie = sess.as_ref().map(|s| s.cookie.as_str());
    let data = netease_get(&url, cookie).await?;
    let mut tracks = Vec::new();
    if let Some(songs) = data
        .get("result")
        .and_then(|r| r.get("songs"))
        .and_then(|v| v.as_array())
    {
        for s in songs {
            if let Some(norm) = normalize_netease_track(s) {
                tracks.push(norm);
            }
        }
    }
    Ok(json!({ "ok": true, "tracks": tracks }))
}

pub async fn handle_netease_recommendations() -> Result<Value, String> {
    let sess = load_netease_session();
    let cookie = sess.as_ref().map(|s| s.cookie.as_str());
    let data = netease_get(
        "https://music.163.com/api/personalized/playlist?limit=10",
        cookie,
    )
    .await?;
    let mut playlists = Vec::new();
    if let Some(items) = data.get("result").and_then(|v| v.as_array()) {
        for p in items {
            let pid = p
                .get("id")
                .and_then(|v| {
                    v.as_i64()
                        .map(|n| n.to_string())
                        .or_else(|| v.as_str().map(|s| s.to_string()))
                })
                .unwrap_or_default();
            let title = p
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if pid.is_empty() || title.is_empty() {
                continue;
            }
            let cover = sanitize_netease_cover(
                p.get("picUrl")
                    .or_else(|| p.get("coverImgUrl"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(""),
            );
            let track_count = p.get("trackCount").and_then(|v| v.as_u64()).unwrap_or(30);
            let play_count_raw = p
                .get("playCount")
                .and_then(|v| v.as_f64().map(|f| f as u64).or_else(|| v.as_u64()))
                .unwrap_or(500_000);
            let desc = p
                .get("copywriter")
                .and_then(|v| v.as_str())
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("网易云音乐官方推荐歌单")
                .to_string();

            playlists.push(json!({
                "id": format!("pl_ncm_{pid}"),
                "sourcePlaylistId": pid,
                "source": "netease",
                "title": title,
                "description": desc,
                "coverUrl": cover,
                "trackCount": track_count,
                "playCount": format_listen_count(play_count_raw),
            }));
        }
    }
    Ok(json!({ "ok": true, "playlists": playlists }))
}

pub async fn handle_netease_playlist_detail(playlist_id: &str) -> Result<Value, String> {
    let raw_id = playlist_id
        .trim()
        .strip_prefix("pl_ncm_")
        .or_else(|| playlist_id.trim().strip_prefix("pl_"))
        .unwrap_or(playlist_id.trim());
    if raw_id.is_empty() {
        return Err("missing netease playlist id".into());
    }
    let sess = load_netease_session();
    let cookie = sess.as_ref().map(|s| s.cookie.as_str());
    let detail = netease_post_form(
        "https://music.163.com/api/v6/playlist/detail",
        &[
            ("id", raw_id.to_string()),
            ("n", "100".to_string()),
            ("s", "0".to_string()),
        ],
        cookie,
    )
    .await?;

    let pl = detail.get("playlist").cloned().unwrap_or_else(|| json!({}));
    let mut tracks = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Some(list) = pl.get("tracks").and_then(|v| v.as_array()) {
        for item in list {
            if let Some(norm) = normalize_netease_track(item) {
                let cid = norm["sourceTrackId"].as_str().unwrap_or("").to_string();
                if seen.insert(cid) {
                    tracks.push(norm);
                }
            }
        }
    }

    // If `trackIds` contains more tracks than returned in `tracks` (up to 80), fetch via `v3/song/detail`
    if let Some(track_ids_arr) = pl.get("trackIds").and_then(|v| v.as_array()) {
        let missing_ids: Vec<String> = track_ids_arr
            .iter()
            .take(80)
            .filter_map(|t| {
                t.get("id").and_then(|v| {
                    v.as_i64()
                        .map(|n| n.to_string())
                        .or_else(|| v.as_str().map(|s| s.to_string()))
                })
            })
            .filter(|id| !seen.contains(id))
            .collect();

        if !missing_ids.is_empty() {
            let c_objs: Vec<Value> = missing_ids
                .iter()
                .map(|id| json!({ "id": id.parse::<i64>().unwrap_or(0) }))
                .collect();
            let c_str = serde_json::to_string(&c_objs).unwrap_or_else(|_| "[]".into());
            if let Ok(s_detail) = netease_post_form(
                "https://music.163.com/api/v3/song/detail",
                &[("c", c_str)],
                cookie,
            )
            .await
            {
                if let Some(songs) = s_detail.get("songs").and_then(|v| v.as_array()) {
                    for s in songs {
                        if let Some(norm) = normalize_netease_track(s) {
                            let cid = norm["sourceTrackId"].as_str().unwrap_or("").to_string();
                            if seen.insert(cid) {
                                tracks.push(norm);
                            }
                        }
                    }
                }
            }
        }
    }

    let name = pl
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("网易云歌单")
        .trim()
        .to_string();
    let description = pl
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("来自网易云音乐歌单")
        .replace('\n', " ")
        .trim()
        .to_string();
    let cover = sanitize_netease_cover(
        pl.get("coverImgUrl")
            .or_else(|| pl.get("picUrl"))
            .and_then(|v| v.as_str())
            .unwrap_or(""),
    );

    Ok(json!({
        "ok": true,
        "playlistId": format!("pl_ncm_{raw_id}"),
        "sourcePlaylistId": raw_id,
        "source": "netease",
        "name": name,
        "description": description,
        "coverUrl": cover,
        "tracks": tracks,
    }))
}

fn extract_digits_id(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        return trimmed.to_string();
    }
    if let Some(pos) = trimmed.find("id=") {
        let after = &trimmed[pos + 3..];
        let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
        if !digits.is_empty() {
            return digits;
        }
    }
    String::new()
}

async fn resolve_netease_uid_from_input(raw_input: &str) -> Result<String, String> {
    let trimmed = raw_input.trim();
    if trimmed.is_empty() {
        return Err("请输入您的网易云音乐昵称、数字 UID 或个人主页链接".into());
    }
    let direct_digits = extract_digits_id(trimmed);
    if !direct_digits.is_empty() {
        return Ok(direct_digits);
    }

    // Search user by nickname via NetEase cloudsearch type=1002
    let enc: String = url::form_urlencoded::byte_serialize(trimmed.as_bytes()).collect();
    let url = format!(
        "https://music.163.com/api/cloudsearch/pc?s={enc}&type=1002&offset=0&limit=5"
    );
    let data = netease_get(&url, None).await?;
    if let Some(users) = data
        .get("result")
        .and_then(|r| r.get("userprofiles"))
        .and_then(|v| v.as_array())
    {
        if let Some(first) = users.first() {
            if let Some(uid) = first.get("userId").and_then(|v| {
                v.as_i64()
                    .map(|n| n.to_string())
                    .or_else(|| v.as_str().map(|s| s.to_string()))
            }) {
                if !uid.is_empty() {
                    return Ok(uid);
                }
            }
        }
    }
    Err(format!("未找到昵称为「{trimmed}」的网易云用户，请检查昵称或直接输入数字 UID"))
}

pub async fn handle_netease_qr_create() -> Result<Value, String> {
    let data = netease_get(
        "https://music.163.com/api/login/qrcode/unikey?type=1",
        None,
    )
    .await?;
    let unikey = data
        .get("unikey")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if unikey.is_empty() {
        return Err("无法从网易云获取扫码 unikey".into());
    }
    let qr_url = format!("https://music.163.com/login?codekey={unikey}");
    let code = qrcode::QrCode::new(qr_url.as_bytes())
        .map_err(|e| format!("二维码生成失败: {e}"))?;
    let svg = code
        .render()
        .min_dimensions(200, 200)
        .dark_color(qrcode::render::svg::Color("#18181A"))
        .light_color(qrcode::render::svg::Color("#FFFFFF"))
        .build();

    Ok(json!({
        "ok": true,
        "unikey": unikey,
        "qrUrl": qr_url,
        "qrSvg": svg,
    }))
}

pub async fn handle_netease_qr_poll(body: &Value) -> Result<Value, String> {
    let key = body
        .get("unikey")
        .or_else(|| body.get("key"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if key.is_empty() {
        return Err("missing unikey".into());
    }
    let fallback_nick = body
        .get("nickname")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let url = format!(
        "https://music.163.com/api/login/qrcode/client/login?type=1&key={key}"
    );
    let client = http_client();
    let resp = client
        .get(&url)
        .header(
            "User-Agent",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        )
        .header("Referer", "https://music.163.com/")
        .send()
        .await
        .map_err(|e| format!("扫码状态查询失败: {e}"))?;

    let mut cookies = Vec::new();
    for val in resp.headers().get_all("set-cookie") {
        if let Ok(s) = val.to_str() {
            if let Some(pair) = s.split(';').next() {
                cookies.push(pair.trim().to_string());
            }
        }
    }
    let cookie_header = cookies.join("; ");
    let data: Value = resp
        .json()
        .await
        .map_err(|e| format!("扫码状态解析失败: {e}"))?;

    let code = data.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
    let message = data
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let scanned_nick = data
        .get("nickname")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let scanned_avatar = data
        .get("avatarUrl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if code == 803 {
        let mut uid = String::new();
        let mut nickname = if !scanned_nick.is_empty() {
            scanned_nick.clone()
        } else {
            fallback_nick.clone()
        };
        let mut avatar_url = scanned_avatar.clone();

        if !cookie_header.is_empty() {
            if let Ok(acc) = netease_get(
                "https://music.163.com/api/nuser/account/get",
                Some(&cookie_header),
            )
            .await
            {
                if let Some(prof) = acc.get("profile") {
                    if let Some(u) = prof.get("userId").and_then(|v| {
                        v.as_i64()
                            .map(|n| n.to_string())
                            .or_else(|| v.as_str().map(|s| s.to_string()))
                    }) {
                        uid = u;
                    }
                    if let Some(n) = prof.get("nickname").and_then(|v| v.as_str()) {
                        nickname = n.trim().to_string();
                    }
                    if let Some(av) = prof.get("avatarUrl").and_then(|v| v.as_str()) {
                        avatar_url = sanitize_netease_cover(av);
                    }
                }
            }
        }

        if uid.is_empty() && !nickname.is_empty() {
            if let Ok(resolved) = resolve_netease_uid_from_input(&nickname).await {
                uid = resolved;
            }
        }

        if !uid.is_empty() {
            save_netease_session(&NeteaseSession {
                uid: uid.clone(),
                nickname: nickname.clone(),
                avatar_url: avatar_url.clone(),
                cookie: cookie_header.clone(),
            });
        }

        return Ok(json!({
            "ok": true,
            "code": 803,
            "message": "扫码登录成功",
            "uid": uid,
            "nickname": nickname,
            "avatarUrl": avatar_url,
            "cookie": cookie_header,
        }));
    }

    // Also resolve UID immediately when code == 802 ("授权中" - user has scanned on phone and nickname is returned!)
    let mut pre_resolved_uid = String::new();
    if code == 802 && !scanned_nick.is_empty() {
        if let Ok(u) = resolve_netease_uid_from_input(&scanned_nick).await {
            pre_resolved_uid = u;
        }
    }

    Ok(json!({
        "ok": true,
        "code": code,
        "message": message,
        "nickname": scanned_nick,
        "avatarUrl": sanitize_netease_cover(&scanned_avatar),
        "uid": pre_resolved_uid,
    }))
}

pub async fn handle_netease_sync(body: &Value) -> Result<Value, String> {
    let existing = load_netease_session();
    let input_str = body
        .get("uid")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| existing.as_ref().map(|s| s.uid.clone()))
        .unwrap_or_default();
    let raw_uid = resolve_netease_uid_from_input(&input_str).await?;
    let cookie = body
        .get("cookie")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| existing.as_ref().map(|s| s.cookie.clone()))
        .unwrap_or_default();

    let url = format!(
        "https://music.163.com/api/user/playlist?uid={raw_uid}&limit=30&offset=0"
    );
    let data = netease_get(&url, Some(&cookie)).await?;
    let Some(pl_arr) = data.get("playlist").and_then(|v| v.as_array()) else {
        return Err("未能获取到该 UID 的公开歌单，请检查 UID 是否正确".into());
    };
    if pl_arr.is_empty() {
        return Err("该网易云 UID 下暂无公开歌单".into());
    }

    let mut nickname = format!("UID {raw_uid}");
    let mut avatar_url = String::new();
    if let Some(creator) = pl_arr.first().and_then(|p| p.get("creator")) {
        if let Some(n) = creator.get("nickname").and_then(|v| v.as_str()) {
            if !n.trim().is_empty() {
                nickname = n.trim().to_string();
            }
        }
        if let Some(av) = creator.get("avatarUrl").and_then(|v| v.as_str()) {
            avatar_url = sanitize_netease_cover(av);
        }
    }

    let sess = NeteaseSession {
        uid: raw_uid.clone(),
        nickname: nickname.clone(),
        avatar_url: avatar_url.clone(),
        cookie: cookie.clone(),
    };
    save_netease_session(&sess);

    let mut fav_tracks = Vec::new();
    let mut playlists = Vec::new();
    let mut seen_fav = std::collections::HashSet::new();

    for (idx, p) in pl_arr.iter().take(12).enumerate() {
        let pid = p
            .get("id")
            .and_then(|v| {
                v.as_i64()
                    .map(|n| n.to_string())
                    .or_else(|| v.as_str().map(|s| s.to_string()))
            })
            .unwrap_or_default();
        if pid.is_empty() {
            continue;
        }
        let pname = p
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("网易云歌单")
            .trim()
            .to_string();
        let pcover = sanitize_netease_cover(
            p.get("coverImgUrl")
                .or_else(|| p.get("picUrl"))
                .and_then(|v| v.as_str())
                .unwrap_or(""),
        );
        let pcount = p.get("trackCount").and_then(|v| v.as_u64()).unwrap_or(0);
        let pdesc = p
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("来自网易云音乐同步歌单")
            .replace('\n', " ")
            .trim()
            .to_string();

        // Fetch tracks for the first playlist ("我喜欢的音乐") and up to 4 user playlists immediately
        let mut pl_tracks = Vec::new();
        let mut pl_track_ids = Vec::new();
        if idx < 5 {
            if let Ok(det) = handle_netease_playlist_detail(&pid).await {
                if let Some(arr) = det.get("tracks").and_then(|v| v.as_array()) {
                    for t in arr {
                        if let Some(tid) = t.get("id").and_then(|v| v.as_str()) {
                            pl_track_ids.push(tid.to_string());
                        }
                        if idx == 0 {
                            let cid = t
                                .get("sourceTrackId")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string();
                            if seen_fav.insert(cid) {
                                fav_tracks.push(t.clone());
                            }
                        }
                        pl_tracks.push(t.clone());
                    }
                }
            }
        }

        playlists.push(json!({
            "id": format!("pl_ncm_{pid}"),
            "sourcePlaylistId": pid,
            "source": "netease",
            "name": pname,
            "description": if pdesc.is_empty() { "来自网易云音乐账号歌单".to_string() } else { pdesc },
            "coverUrl": pcover,
            "trackCount": pcount.max(pl_track_ids.len() as u64),
            "trackIds": pl_track_ids,
            "tracks": pl_tracks,
        }));
    }

    if let Ok(db) = crate::db::LibraryDb::open_default() {
        let now_ms = (crate::huawei::now_epoch_secs() * 1000) as i64;
        let _ = db.persist_netease_sync(&raw_uid, &nickname, &fav_tracks, &playlists, now_ms);
    }

    Ok(json!({
        "ok": true,
        "uid": raw_uid,
        "nickname": nickname,
        "avatarUrl": avatar_url,
        "tracks": fav_tracks,
        "playlists": playlists,
    }))
}

async fn fetch_netease_lyrics(song_id: &str) -> Vec<LyricLine> {
    let url = format!(
        "https://music.163.com/api/song/lyric?id={song_id}&lv=1&kv=1&tv=-1&rv=-1&yv=1"
    );
    let Ok(data) = netease_get(&url, None).await else {
        return Vec::new();
    };
    let yrc_raw = data
        .get("yrc")
        .and_then(|v| v.get("lyric"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let lrc_raw = data
        .get("lrc")
        .and_then(|v| v.get("lyric"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let tlyric_raw = data
        .get("tlyric")
        .and_then(|v| v.get("lyric"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let romalrc_raw = data
        .get("romalrc")
        .and_then(|v| v.get("lyric"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut lines = if !yrc_raw.trim().is_empty() {
        let parsed_yrc = parse_netease_yrc(yrc_raw);
        if parsed_yrc.is_empty() {
            parse_lrc(lrc_raw)
        } else {
            parsed_yrc
        }
    } else {
        parse_lrc(lrc_raw)
    };

    if !tlyric_raw.trim().is_empty() {
        let trans_lines = parse_lrc(tlyric_raw);
        lines = merge_lyric_subtitles(lines, &trans_lines);
    }
    if !romalrc_raw.trim().is_empty() {
        let roma_lines = parse_lrc(romalrc_raw);
        lines = merge_lyric_romanizations(lines, &roma_lines);
    }
    lines
}

pub async fn handle_netease_resolve(body: &Value) -> Result<Value, String> {
    let mut song_id = body
        .get("contentCode")
        .or_else(|| body.get("sourceTrackId"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .strip_prefix("ncm_")
        .unwrap_or_else(|| {
            body.get("contentCode")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
        })
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

    if song_id.is_empty() || !song_id.chars().all(|c| c.is_ascii_digit()) {
        let q = format!("{title} {artist}").trim().to_string();
        if !q.is_empty() {
            if let Ok(sres) = handle_netease_search(&q).await {
                if let Some(first) = sres
                    .get("tracks")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                {
                    song_id = first
                        .get("sourceTrackId")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                }
            }
        }
    }

    let ncm_lyrics = if !song_id.is_empty() {
        fetch_netease_lyrics(&song_id).await
    } else {
        Vec::new()
    };

    // 1. Try direct NetEase stream via enhance/player/url
    let sess = load_netease_session();
    let cookie = sess.as_ref().map(|s| s.cookie.as_str());
    let mut direct_url = String::new();
    let mut is_free_trial = false;

    if !song_id.is_empty() {
        let enhance_url = format!(
            "https://music.163.com/api/song/enhance/player/url?ids=%5B{song_id}%5D&br=320000"
        );
        if let Ok(pdata) = netease_get(&enhance_url, cookie).await {
            if let Some(first) = pdata
                .get("data")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
            {
                if let Some(u) = first.get("url").and_then(|v| v.as_str()) {
                    let trimmed = u.trim();
                    if is_safe_stream_proxy_url(trimmed) {
                        direct_url = trimmed.to_string();
                        is_free_trial = first.get("freeTrialInfo").is_some()
                            && !first.get("freeTrialInfo").unwrap().is_null();
                    }
                }
            }
        }
    }

    // 2. If direct_url is present and not a 30s VIP trial, stream via local proxy
    if !direct_url.is_empty() && !is_free_trial {
        let encoded_url: String =
            url::form_urlencoded::byte_serialize(direct_url.as_bytes()).collect();
        let stream_url = format!(
            "http://127.0.0.1:{}/api/huawei/stream?url={}",
            active_bridge_port(),
            encoded_url
        );
        let is_flac = direct_url.to_ascii_lowercase().contains(".flac");
        return Ok(json!({
            "ok": true,
            "contentCode": song_id,
            "streamUrl": stream_url,
            "rawStreamUrl": direct_url,
            "quality": if is_flac { "lossless" } else { "standard" },
            "formatLabel": if is_flac { "网易云无损 FLAC" } else { "网易云 320k MP3" },
            "isPreview": false,
            "resolvedBy": "netease",
            "lyrics": to_frontend_lyrics(ncm_lyrics),
        }));
    }

    // 3. Automatic cross-source unblocking via Huawei Music lossless engine when NetEase track is VIP-locked!
    if !title.is_empty() {
        let hw_sess = load_persisted_session();
        let fallback_req = json!({
            "contentCode": "",
            "title": title,
            "artist": artist,
            "quality": body.get("quality").and_then(|v| v.as_str()).unwrap_or("lossless"),
        });
        if let Ok(mut hw_resolved) = handle_resolve(hw_sess.as_ref(), &fallback_req).await {
            if let Some(obj) = hw_resolved.as_object_mut() {
                obj.insert("resolvedBy".into(), json!("huawei_unblock"));
                obj.insert(
                    "formatLabel".into(),
                    json!("华为无损点亮 · FLAC"),
                );
                // Prefer NetEase's rich dual-language / yrc lyrics if Huawei didn't return word-by-word lyrics
                if !ncm_lyrics.is_empty() {
                    obj.insert("lyrics".into(), json!(to_frontend_lyrics(ncm_lyrics)));
                }
            }
            return Ok(hw_resolved);
        }
    }

    // 4. If Huawei fallback is not logged in or didn't match, still return lyrics if available or error
    if !direct_url.is_empty() {
        let encoded_url: String =
            url::form_urlencoded::byte_serialize(direct_url.as_bytes()).collect();
        let stream_url = format!(
            "http://127.0.0.1:{}/api/huawei/stream?url={}",
            active_bridge_port(),
            encoded_url
        );
        return Ok(json!({
            "ok": true,
            "contentCode": song_id,
            "streamUrl": stream_url,
            "rawStreamUrl": direct_url,
            "quality": "standard",
            "formatLabel": "网易云试听片段",
            "isPreview": true,
            "resolvedBy": "netease",
            "lyrics": to_frontend_lyrics(ncm_lyrics),
        }));
    }

    Err("该网易云曲目为 VIP 专享，登录华为音乐或填写网易云黑胶 Cookie 后可自动点亮无损全曲".into())
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
    if !is_safe_stream_proxy_url(raw_url) {
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
        ("POST", "/api/huawei/recommendations") => {
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            let q = body_json
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match tauri::async_runtime::block_on(handle_recommendations(q)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 500, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/huawei/playlist/detail") => {
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            let pid = body_json
                .get("playlistId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match tauri::async_runtime::block_on(handle_playlist_detail(pid)) {
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
        ("GET", "/api/netease/status") => {
            if let Some(sess) = load_netease_session() {
                send_json(
                    stream,
                    200,
                    &json!({
                        "loggedIn": true,
                        "uid": sess.uid,
                        "nickname": sess.nickname,
                        "avatarUrl": sess.avatar_url,
                        "hasCookie": !sess.cookie.trim().is_empty(),
                    }),
                );
            } else {
                send_json(stream, 200, &json!({ "loggedIn": false }));
            }
        }
        ("POST", "/api/netease/sync") => {
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            match tauri::async_runtime::block_on(handle_netease_sync(&body_json)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 400, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/netease/qr/create") => {
            match tauri::async_runtime::block_on(handle_netease_qr_create()) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 500, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/netease/qr/poll") => {
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            match tauri::async_runtime::block_on(handle_netease_qr_poll(&body_json)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 500, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/netease/logout") => {
            clear_netease_session();
            send_json(stream, 200, &json!({ "ok": true }));
        }
        ("POST", "/api/netease/search") => {
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            let q = body_json
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match tauri::async_runtime::block_on(handle_netease_search(q)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 500, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/netease/recommendations") => {
            match tauri::async_runtime::block_on(handle_netease_recommendations()) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 500, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/netease/playlist/detail") => {
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            let pid = body_json
                .get("playlistId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            match tauri::async_runtime::block_on(handle_netease_playlist_detail(pid)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 500, &json!({ "ok": false, "error": e })),
            }
        }
        ("POST", "/api/netease/resolve") => {
            let body_json: Value = serde_json::from_str(&body_part).unwrap_or_else(|_| json!({}));
            match tauri::async_runtime::block_on(handle_netease_resolve(&body_json)) {
                Ok(val) => send_json(stream, 200, &val),
                Err(e) => send_json(stream, 404, &json!({ "ok": false, "error": e })),
            }
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
