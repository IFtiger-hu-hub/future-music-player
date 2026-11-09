use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use url::Url;

pub const AUTHORIZE_ENDPOINT: &str = "https://oauth-login.platform.hicloud.com/oauth2/v3/authorize";
pub const TOKEN_ENDPOINT: &str = "https://oauth-login.cloud.huawei.com/oauth2/v3/token";
pub const MUSIC_ENDPOINT: &str = "https://api-drcn.music.dbankcloud.cn";
pub const CLIENT_ID: &str = "101444301";
pub const REDIRECT_URI: &str = "hms://redirect_uri";
pub const ATTEMPT_LIFETIME_SECS: u64 = 600;
pub const VAULT_AAD: &[u8] = b"hwmusic-viva-session-v1";

#[derive(Debug, Clone)]
pub struct AuthAttempt {
    verifier: String,
    state: String,
    created_epoch_secs: u64,
    consumed: bool,
    code: Option<String>,
    exchanged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MusicSession {
    pub token: String,
    pub sns_user_id: String,
    pub expire_time: String,
}

impl MusicSession {
    pub fn account_key(&self) -> String {
        let mut hasher = Sha256::new();
        hasher.update(self.sns_user_id.as_bytes());
        hex::encode(hasher.finalize())
    }
}

pub fn random_url_safe(num_bytes: usize) -> String {
    let mut bytes = vec![0u8; num_bytes];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(&bytes)
}

pub fn pkce_s256_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

impl AuthAttempt {
    pub fn new(now_epoch_secs: u64) -> Self {
        Self {
            verifier: random_url_safe(48),
            state: random_url_safe(32),
            created_epoch_secs: now_epoch_secs,
            consumed: false,
            code: None,
            exchanged: false,
        }
    }

    pub fn new_deterministic(verifier: &str, state: &str, now_epoch_secs: u64) -> Self {
        Self {
            verifier: verifier.to_string(),
            state: state.to_string(),
            created_epoch_secs: now_epoch_secs,
            consumed: false,
            code: None,
            exchanged: false,
        }
    }

    pub fn state(&self) -> &str {
        &self.state
    }

    pub fn authorize_url(&self) -> String {
        let challenge = pkce_s256_challenge(&self.verifier);
        let mut u = Url::parse(AUTHORIZE_ENDPOINT).expect("valid authorize endpoint");
        u.query_pairs_mut()
            .append_pair("client_id", CLIENT_ID)
            .append_pair("redirect_uri", REDIRECT_URI)
            .append_pair("response_type", "code")
            .append_pair("access_type", "offline")
            .append_pair("scope", "openid")
            .append_pair("state", &self.state)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("countryCode", "cn")
            .append_pair("ui_locales", "zh-cn");
        u.to_string()
    }

    /// Consumes the first exact callback `hms://redirect_uri?code=...&state=...`.
    /// Single-use, rejects fragments, duplicate parameters, expired attempts, or state mismatches.
    pub fn accept(&mut self, raw_url: &str, now_epoch_secs: u64) -> Result<(), String> {
        if self.consumed {
            return Err("authorization attempt already settled".into());
        }
        if !is_callback_url(raw_url) {
            return Err("authorization callback destination rejected".into());
        }
        self.consumed = true;
        if now_epoch_secs < self.created_epoch_secs
            || now_epoch_secs - self.created_epoch_secs > ATTEMPT_LIFETIME_SECS
        {
            return Err("authorization attempt expired".into());
        }

        let u = Url::parse(raw_url).map_err(|_| "invalid authorization callback")?;
        let mut counts: HashMap<String, usize> = HashMap::new();
        let mut params: HashMap<String, String> = HashMap::new();
        for (k, v) in u.query_pairs() {
            *counts.entry(k.to_string()).or_insert(0) += 1;
            params.insert(k.to_string(), v.to_string());
        }

        for key in ["state", "code", "error"] {
            if counts.get(key).copied().unwrap_or(0) > 1 {
                return Err("duplicate authorization parameter".into());
            }
        }

        let got_state = params.get("state").map(|s| s.as_str()).unwrap_or("");
        if got_state != self.state {
            return Err("authorization state mismatch".into());
        }

        if params.contains_key("error") {
            return Err("authorization denied".into());
        }

        let code = params.get("code").cloned().unwrap_or_default();
        if code.is_empty() {
            return Err("authorization code missing".into());
        }
        self.code = Some(code);
        Ok(())
    }

    /// Consumes the authorization code and PKCE verifier to produce the token exchange form.
    pub fn take_exchange_form(
        &mut self,
        now_epoch_secs: u64,
    ) -> Result<Vec<(String, String)>, String> {
        if !self.consumed
            || self.exchanged
            || self.code.is_none()
            || now_epoch_secs < self.created_epoch_secs
            || now_epoch_secs - self.created_epoch_secs > ATTEMPT_LIFETIME_SECS
        {
            return Err("authorization code unavailable".into());
        }
        self.exchanged = true;
        let code = self.code.take().unwrap_or_default();
        let verifier = std::mem::take(&mut self.verifier);

        Ok(vec![
            ("grant_type".into(), "authorization_code".into()),
            ("client_id".into(), CLIENT_ID.into()),
            ("redirect_uri".into(), REDIRECT_URI.into()),
            ("code".into(), code),
            ("code_verifier".into(), verifier),
        ])
    }
}

pub fn is_callback_url(raw: &str) -> bool {
    if raw.contains('#') {
        return false;
    }
    let Ok(u) = Url::parse(raw) else {
        return false;
    };
    u.scheme().eq_ignore_ascii_case("hms")
        && u.host_str()
            .map(|h| h.eq_ignore_ascii_case("redirect_uri"))
            .unwrap_or(false)
        && u.username().is_empty()
        && u.password().is_none()
        && (u.path().is_empty() || u.path() == "/")
}

pub fn is_allowed_login_url(raw: &str) -> bool {
    let Ok(u) = Url::parse(raw) else {
        return false;
    };
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    if let Some(port) = u.port() {
        if port != 443 {
            return false;
        }
    }
    let Some(host) = u.host_str().map(|h| h.to_ascii_lowercase()) else {
        return false;
    };
    match host.as_str() {
        "oauth-login.platform.hicloud.com"
        | "id1.cloud.huawei.com"
        | "oauth-login.cloud.huawei.com"
        | "account.huawei.com"
        | "consumer.huawei.com" => true,
        "oauth-login1.cloud.huawei.com" => u.path() == "/oauth2/v3/loginCallback",
        _ => false,
    }
}

/// Checks whether a resource URL (cover or audio stream) belongs to the trusted Huawei CDN domains.
pub fn is_safe_resource_url(raw: &str) -> bool {
    let Ok(u) = Url::parse(raw) else {
        return false;
    };
    if u.scheme() != "https" || !u.username().is_empty() || u.password().is_some() {
        return false;
    }
    if let Some(port) = u.port() {
        if port != 443 {
            return false;
        }
    }
    let Some(host) = u.host_str().map(|h| h.to_ascii_lowercase()) else {
        return false;
    };
    for suffix in [".dbankcdn.cn", ".tingmall.com", ".kuke.com"] {
        if host.ends_with(suffix) && host.len() > suffix.len() {
            return true;
        }
    }
    false
}

/// Builds the verified Huawei Music Digest Authorization header:
/// `Digest username=app-music-baseline, nonce=<random>, created=<ISO8601 UTC>, token=<music token>`
pub fn build_music_digest_header(token: &str, iso8601_utc: &str) -> Result<String, String> {
    if token.contains(['\r', '\n', ',']) {
        return Err("invalid music session token".into());
    }
    let nonce = random_url_safe(24);
    let mut header = format!(
        "Digest username=app-music-baseline, nonce={}, created={}",
        nonce, iso8601_utc
    );
    if !token.is_empty() {
        header.push_str(", token=");
        header.push_str(token);
    }
    Ok(header)
}

/// Per API_CONTRACT.md: `auditionEnd`/`auditionTime` appear on full tracks too;
/// only `/preview/` in the stream path is reliable evidence of a trial stream.
pub fn is_preview_stream(stream_url: &str) -> bool {
    stream_url.to_ascii_lowercase().contains("/preview/")
}

/// Encrypts a `MusicSession` with AES-256-GCM and AAD `hwmusic-viva-session-v1`.
pub fn seal_session(session: &MusicSession, key: &[u8; 32]) -> Result<Vec<u8>, String> {
    if session.token.is_empty() || session.sns_user_id.is_empty() {
        return Err("invalid session".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "invalid vault key")?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = serde_json::to_vec(session).map_err(|_| "serialize session failed")?;
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: &plaintext,
                aad: VAULT_AAD,
            },
        )
        .map_err(|_| "encrypt session failed")?;

    let mut out = Vec::with_capacity(12 + ciphertext.len());
    out.extend_from_slice(&nonce_bytes);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypts a sealed `MusicSession` blob using AES-256-GCM and AAD `hwmusic-viva-session-v1`.
pub fn open_session(blob: &[u8], key: &[u8; 32]) -> Result<MusicSession, String> {
    if blob.len() < 12 || blob.len() > 64 * 1024 {
        return Err("invalid encrypted session".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| "invalid vault key")?;
    let nonce = Nonce::from_slice(&blob[..12]);
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: &blob[12..],
                aad: VAULT_AAD,
            },
        )
        .map_err(|_| "session could not be decrypted")?;

    let session: MusicSession =
        serde_json::from_slice(&plaintext).map_err(|_| "invalid session document")?;
    if session.token.is_empty() || session.sns_user_id.is_empty() {
        return Err("invalid session document".into());
    }
    let _ = build_music_digest_header(&session.token, "2026-11-09T00:00:00Z")?;
    Ok(session)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HuaweiPlaylistSummary {
    pub id: String,
    pub title: String,
    pub kind: String, // "owned" | "collected" | "chart"
    pub description: String,
    pub cover_url: String,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HuaweiSyncSnapshot {
    pub sns_user_id: String,
    pub account_key: String,
    pub favorite_tracks: Vec<crate::db::SourceTrackInput>,
    pub playlists: Vec<HuaweiPlaylistSummary>,
}

pub fn now_iso8601_utc() -> String {
    chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

pub fn now_epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(1731110400)
}

/// Real network exchange:
/// 1) `POST https://oauth-login.cloud.huawei.com/oauth2/v3/token` (application/x-www-form-urlencoded)
/// 2) `POST https://api-drcn.music.dbankcloud.cn/music-odpapp-service/v5/service/userinfo/loginex`
/// 3) `ValidateSession` against `/music-userbehavior-service/v3/service/favorite/simple/all`
pub async fn exchange_code_for_music_session(
    attempt: &mut AuthAttempt,
) -> Result<MusicSession, String> {
    let form_pairs = attempt.take_exchange_form(now_epoch_secs())?;
    let encoded_form: String = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(form_pairs.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .finish();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("http client init failed: {e}"))?;

    // Step 1: Exchange OAuth code for Huawei account access_token
    let token_resp = client
        .post(TOKEN_ENDPOINT)
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(encoded_form)
        .send()
        .await
        .map_err(|_| "code exchange network request failed".to_string())?;

    if !token_resp.status().is_success() {
        return Err(format!(
            "code exchange failed (HTTP {})",
            token_resp.status().as_u16()
        ));
    }

    let token_json: serde_json::Value = token_resp
        .json()
        .await
        .map_err(|_| "code exchange decode failed".to_string())?;
    let access_token = token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if access_token.is_empty() {
        return Err("account access token missing".into());
    }

    // Step 2: Exchange account access_token for Huawei Music loginex session
    let digest_without_token = build_music_digest_header("", &now_iso8601_utc())?;
    let loginex_resp = client
        .post(format!(
            "{}/music-odpapp-service/v5/service/userinfo/loginex",
            MUSIC_ENDPOINT
        ))
        .header("Content-Type", "application/json")
        .header("Authorization", digest_without_token)
        .json(&serde_json::json!({ "accessToken": access_token }))
        .send()
        .await
        .map_err(|_| "music exchange network request failed".to_string())?;

    if !loginex_resp.status().is_success() {
        return Err(format!(
            "music exchange failed (HTTP {})",
            loginex_resp.status().as_u16()
        ));
    }

    let loginex_json: serde_json::Value = loginex_resp
        .json()
        .await
        .map_err(|_| "music exchange decode failed".to_string())?;
    let result_code = loginex_json
        .get("result")
        .and_then(|r| r.get("resultCode"))
        .and_then(|c| c.as_str())
        .unwrap_or("");
    if result_code != "000000" {
        return Err(format!("music exchange rejected (resultCode={result_code})"));
    }

    let music_token = loginex_json
        .get("token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let sns_user_id = loginex_json
        .get("snsUserID")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let expire_time = loginex_json
        .get("expireTime")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    if music_token.is_empty() || sns_user_id.is_empty() {
        return Err("music session incomplete".into());
    }

    let session = MusicSession {
        token: music_token,
        sns_user_id,
        expire_time,
    };

    // Step 3: Validate session can read favorites
    validate_music_session(&client, &session).await?;
    Ok(session)
}

pub async fn validate_music_session(
    client: &reqwest::Client,
    session: &MusicSession,
) -> Result<(), String> {
    let auth = build_music_digest_header(&session.token, &now_iso8601_utc())?;
    let resp = client
        .post(format!(
            "{}/music-userbehavior-service/v3/service/favorite/simple/all",
            MUSIC_ENDPOINT
        ))
        .header("Content-Type", "application/json")
        .header("Authorization", auth)
        .json(&serde_json::json!({
            "targetSnsUserID": session.sns_user_id,
            "start": 0,
            "limit": 1,
            "contentTypes": [1]
        }))
        .send()
        .await
        .map_err(|_| "session validation network request failed".to_string())?;

    if !resp.status().is_success() {
        return Err(format!(
            "session validation failed (HTTP {})",
            resp.status().as_u16()
        ));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|_| "session validation decode failed".to_string())?;
    let code = body
        .get("result")
        .and_then(|r| r.get("resultCode"))
        .and_then(|c| c.as_str())
        .unwrap_or("");
    if code != "000000" {
        return Err(format!("session validation resultCode={code}"));
    }
    Ok(())
}

fn parse_provider_track_item(item: &serde_json::Value) -> Option<crate::db::SourceTrackInput> {
    let id = item
        .get("contentID")
        .or_else(|| item.get("contentId"))
        .or_else(|| item.get("songCode"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let title = item
        .get("contentName")
        .or_else(|| item.get("songName"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if id.is_empty() || title.is_empty() {
        return None;
    }

    let mut artists = Vec::new();
    if let Some(pairs) = item.get("artistNamePairs").and_then(|v| v.as_array()) {
        for p in pairs {
            let name = p
                .get("artistName")
                .or_else(|| p.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if !name.is_empty() {
                let aid = p
                    .get("artistID")
                    .or_else(|| p.get("id"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                artists.push(crate::db::ArtistDto {
                    id: aid,
                    name: name.to_string(),
                });
            }
        }
    }
    if artists.is_empty() {
        let fallback_artist = item
            .get("artistName")
            .or_else(|| item.get("singerName"))
            .and_then(|v| v.as_str())
            .unwrap_or("未知艺人")
            .trim()
            .to_string();
        artists.push(crate::db::ArtistDto {
            id: String::new(),
            name: fallback_artist,
        });
    }

    let album_title = item
        .get("albumName")
        .or_else(|| item.get("albumNamePair").and_then(|a| a.get("albumName")))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let album = if album_title.is_empty() {
        None
    } else {
        Some(crate::db::AlbumDto {
            id: item
                .get("albumID")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
            title: album_title,
        })
    };

    let duration_sec = item
        .get("duration")
        .and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
        })
        .filter(|d| *d > 0.0 && d.is_finite());

    let mut cover_url = String::new();
    if let Some(pic) = item.get("picture") {
        for k in ["bigImgURL", "middleImgURL", "smallImgURL"] {
            if let Some(u) = pic.get(k).and_then(|v| v.as_str()) {
                if is_safe_resource_url(u) {
                    cover_url = u.to_string();
                    break;
                }
            }
        }
    }

    Some(crate::db::SourceTrackInput {
        source: "huawei".into(),
        source_track_id: id,
        title,
        artists,
        album,
        duration_ms: duration_sec.map(|s| (s * 1000.0).round() as i64),
        cover_url,
        access: "full".into(),
        quality: "lossless".into(),
    })
}

/// Paginates through the user's real Huawei Music favorites (`contentTypes=[1]`, `limit=50`)
/// and playlists (`contentTypes=[4,5,7]`), deduplicating by `contentID`.
pub async fn fetch_huawei_account_assets(
    session: &MusicSession,
) -> Result<HuaweiSyncSnapshot, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())?;

    let mut favorite_tracks = Vec::new();
    let mut seen_track_ids = std::collections::HashSet::new();
    let limit = 50usize;
    let mut start = 0usize;

    while start < 100_000 {
        let auth = build_music_digest_header(&session.token, &now_iso8601_utc())?;
        let resp = client
            .post(format!(
                "{}/music-userbehavior-service/v3/service/favorite/simple/all",
                MUSIC_ENDPOINT
            ))
            .header("Content-Type", "application/json")
            .header("Authorization", auth)
            .json(&serde_json::json!({
                "targetSnsUserID": session.sns_user_id,
                "start": start,
                "limit": limit,
                "contentTypes": [1]
            }))
            .send()
            .await
            .map_err(|_| "favorites pagination network request failed".to_string())?;

        if !resp.status().is_success() {
            return Err(format!("favorites failed (HTTP {})", resp.status().as_u16()));
        }
        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|_| "favorites decode failed".to_string())?;
        let code = body
            .get("result")
            .and_then(|r| r.get("resultCode"))
            .and_then(|c| c.as_str())
            .unwrap_or("");
        if code != "000000" {
            return Err(format!("favorites business error (resultCode={code})"));
        }

        let items = body
            .get("favoriteInfos")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let raw_len = items.len();
        let mut new_in_page = 0usize;
        for raw in &items {
            if let Some(track) = parse_provider_track_item(raw) {
                if seen_track_ids.insert(track.source_track_id.clone()) {
                    new_in_page += 1;
                    favorite_tracks.push(track);
                }
            }
        }

        if raw_len < limit || new_in_page == 0 {
            break;
        }
        start += raw_len;
    }

    // Fetch playlists (contentTypes=[4,5,7])
    let mut playlists = Vec::new();
    let auth_pl = build_music_digest_header(&session.token, &now_iso8601_utc())?;
    if let Ok(pl_resp) = client
        .post(format!(
            "{}/music-userbehavior-service/v3/service/favorite/simple/all",
            MUSIC_ENDPOINT
        ))
        .header("Content-Type", "application/json")
        .header("Authorization", auth_pl)
        .json(&serde_json::json!({
            "targetSnsUserID": session.sns_user_id,
            "start": 0,
            "limit": 50,
            "contentTypes": [4, 5, 7]
        }))
        .send()
        .await
    {
        if let Ok(pl_json) = pl_resp.json::<serde_json::Value>().await {
            if let Some(items) = pl_json.get("favoriteInfos").and_then(|v| v.as_array()) {
                for p in items {
                    let id = p
                        .get("contentID")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let title = p
                        .get("contentName")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let ctype = p
                        .get("contentType")
                        .and_then(|v| {
                            v.as_i64()
                                .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
                        })
                        .unwrap_or(5);
                    let kind = match ctype {
                        4 => "collected",
                        5 => "owned",
                        7 => "chart",
                        _ => "owned",
                    };
                    let count = p
                        .get("totalCount")
                        .and_then(|v| {
                            v.as_u64()
                                .or_else(|| v.as_str().and_then(|s| s.parse::<u64>().ok()))
                        })
                        .unwrap_or(0) as usize;
                    if !id.is_empty() && !title.is_empty() {
                        playlists.push(HuaweiPlaylistSummary {
                            id,
                            title,
                            kind: kind.into(),
                            description: p
                                .get("listDesc")
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string(),
                            cover_url: String::new(),
                            count,
                        });
                    }
                }
            }
        }
    }

    Ok(HuaweiSyncSnapshot {
        sns_user_id: session.sns_user_id.clone(),
        account_key: session.account_key(),
        favorite_tracks,
        playlists,
    })
}


