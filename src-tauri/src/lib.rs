pub mod bridge_server;
pub mod db;
pub mod huawei;
pub mod local_scanner;
pub mod lyrics;
pub mod matcher;
pub mod plugin_host;

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use url::Url;

pub struct AppRuntimeState {
    pub active_attempt: Mutex<Option<huawei::AuthAttempt>>,
    pub active_session: Mutex<Option<huawei::MusicSession>>,
}

impl Default for AppRuntimeState {
    fn default() -> Self {
        Self {
            active_attempt: Mutex::new(None),
            active_session: Mutex::new(bridge_server::load_persisted_session()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HuaweiAuthPreview {
    pub authorize_url: String,
    pub redirect_uri: String,
    pub client_id: String,
    pub pkce_method: String,
    pub music_endpoint: String,
    pub digest_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HuaweiAuthSuccessPayload {
    pub sns_user_id: String,
    pub account_key: String,
    pub expire_time: String,
}

#[tauri::command]
fn get_huawei_status(state: State<'_, AppRuntimeState>) -> serde_json::Value {
    if let Some(sess) = bridge_server::load_persisted_session() {
        if let Ok(mut guard) = state.active_session.lock() {
            *guard = Some(sess.clone());
        }
        return serde_json::json!({
            "loggedIn": true,
            "snsUserID": sess.sns_user_id,
            "snsUserId": sess.sns_user_id,
            "expireTime": sess.expire_time,
        });
    }
    serde_json::json!({ "loggedIn": false })
}

#[tauri::command]
async fn resolve_huawei_track(params: serde_json::Value) -> Result<serde_json::Value, String> {
    let sess = bridge_server::load_persisted_session();
    bridge_server::handle_resolve(sess.as_ref(), &params).await
}

#[tauri::command]
async fn sync_huawei_library() -> Result<serde_json::Value, String> {
    let Some(sess) = bridge_server::load_persisted_session() else {
        return Err("not logged in".into());
    };
    bridge_server::handle_sync(&sess).await
}

#[tauri::command]
async fn search_huawei_catalog(query: String) -> Result<serde_json::Value, String> {
    bridge_server::handle_search(&query).await
}

#[tauri::command]
fn get_huawei_auth_contract(state: State<'_, AppRuntimeState>) -> HuaweiAuthPreview {
    let attempt = huawei::AuthAttempt::new(huawei::now_epoch_secs());
    let auth_url = attempt.authorize_url();
    if let Ok(mut guard) = state.active_attempt.lock() {
        *guard = Some(attempt);
    }
    let digest = huawei::build_music_digest_header("demo_music_token", &huawei::now_iso8601_utc())
        .unwrap_or_default();
    HuaweiAuthPreview {
        authorize_url: auth_url,
        redirect_uri: huawei::REDIRECT_URI.into(),
        client_id: huawei::CLIENT_ID.into(),
        pkce_method: "S256".into(),
        music_endpoint: huawei::MUSIC_ENDPOINT.into(),
        digest_preview: digest,
    }
}

/// Opens a disposable controlled Tauri WebviewWindow pointing at the official Huawei OAuth2 PKCE page,
/// enforces `is_allowed_login_url`, intercepts `hms://redirect_uri?code=...&state=...` without
/// registering a global OS scheme, and exchanges the code for a real `loginex` music session.
#[tauri::command]
async fn start_huawei_webview_login(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<String, String> {
    let attempt = huawei::AuthAttempt::new(huawei::now_epoch_secs());
    let auth_url_str = attempt.authorize_url();
    if let Ok(mut guard) = state.active_attempt.lock() {
        *guard = Some(attempt);
    }

    if let Some(existing) = app.get_webview_window("huawei-oauth") {
        let _ = existing.close();
    }

    let parsed_url = Url::parse(&auth_url_str).map_err(|e| e.to_string())?;
    let app_for_nav = app.clone();

    WebviewWindowBuilder::new(&app, "huawei-oauth", WebviewUrl::External(parsed_url))
        .title("华为账号安全登录 · Future Music 受控会话窗口")
        .inner_size(520.0, 680.0)
        .resizable(true)
        .center()
        .on_navigation(move |nav_url| {
            let raw = nav_url.as_str().to_string();

            // 1. Intercept hms://redirect_uri?code=...&state=...
            if huawei::is_callback_url(&raw) {
                let app_handle = app_for_nav.clone();
                tauri::async_runtime::spawn(async move {
                    if let Some(win) = app_handle.get_webview_window("huawei-oauth") {
                        let _ = win.close();
                    }
                    let _ = complete_huawei_callback_internal(&app_handle, &raw).await;
                });
                return false;
            }

            // 2. Enforce Huawei OAuth domain allowlist
            huawei::is_allowed_login_url(&raw)
        })
        .build()
        .map_err(|e| format!("无法创建受控登录窗口: {e}"))?;

    Ok(auth_url_str)
}

/// Allows pasting or receiving a `hms://redirect_uri?code=...&state=...` callback URL directly
/// (useful when the user completes login in an external browser or embedded webview).
#[tauri::command]
async fn submit_huawei_callback_url(
    app: AppHandle,
    callback_url: String,
) -> Result<HuaweiAuthSuccessPayload, String> {
    complete_huawei_callback_internal(&app, &callback_url).await
}

async fn complete_huawei_callback_internal(
    app: &AppHandle,
    raw_callback: &str,
) -> Result<HuaweiAuthSuccessPayload, String> {
    let state: State<'_, AppRuntimeState> = app.state();
    let mut attempt_opt = {
        let mut guard = state
            .active_attempt
            .lock()
            .map_err(|_| "attempt lock poisoned".to_string())?;
        guard.take()
    };

    let Some(ref mut attempt) = attempt_opt else {
        let err_msg = "当前没有进行中的登录会话，请重新发起华为登录".to_string();
        let _ = app.emit("huawei-auth-error", &err_msg);
        return Err(err_msg);
    };

    if let Err(e) = attempt.accept(raw_callback, huawei::now_epoch_secs()) {
        let _ = app.emit("huawei-auth-error", &e);
        return Err(e);
    }

    match huawei::exchange_code_for_music_session(attempt).await {
        Ok(session) => {
            bridge_server::save_persisted_session(&session);
            let payload = HuaweiAuthSuccessPayload {
                sns_user_id: session.sns_user_id.clone(),
                account_key: session.account_key(),
                expire_time: session.expire_time.clone(),
            };
            if let Ok(mut s_guard) = state.active_session.lock() {
                *s_guard = Some(session);
            }
            let _ = app.emit("huawei-auth-success", &payload);
            Ok(payload)
        }
        Err(e) => {
            let _ = app.emit("huawei-auth-error", &e);
            Err(e)
        }
    }
}

/// Fetches the logged-in Huawei account's real favorites and playlists via `favorite/simple/all`.
#[tauri::command]
async fn sync_huawei_assets_live(
    state: State<'_, AppRuntimeState>,
) -> Result<huawei::HuaweiSyncSnapshot, String> {
    let session_opt = {
        let guard = state
            .active_session
            .lock()
            .map_err(|_| "session lock poisoned".to_string())?;
        guard.clone()
    };
    let Some(session) = session_opt else {
        return Err("尚未登录华为音乐会话，请先打开华为登录窗口完成扫码授权".into());
    };
    huawei::fetch_huawei_account_assets(&session).await
}

#[tauri::command]
fn parse_lyric_document(raw: String, format: String) -> Result<Vec<lyrics::LyricLine>, String> {
    match format.to_ascii_lowercase().as_str() {
        "hmrc" => Ok(lyrics::parse_hmrc(&raw)),
        "ttml" => lyrics::parse_ttml(&raw),
        _ => Ok(lyrics::parse_lrc(&raw)),
    }
}

#[tauri::command]
fn scan_music_folder(folder_path: String) -> Result<local_scanner::LocalScanSummary, String> {
    local_scanner::scan_local_directory(Path::new(&folder_path))
}

#[tauri::command]
fn get_library_snapshot() -> Result<serde_json::Value, String> {
    let db = db::LibraryDb::open_default().map_err(|e| e.to_string())?;
    db.load_runtime_snapshot().map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavePlaylistArgs {
    id: String,
    name: String,
    description: String,
    track_ids: Vec<String>,
}

#[tauri::command]
fn save_local_playlist(args: SavePlaylistArgs) -> Result<(), String> {
    let db = db::LibraryDb::open_default().map_err(|e| e.to_string())?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    db.upsert_local_playlist(&args.id, &args.name, &args.description, &args.track_ids, now_ms)
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "linux")]
fn configure_webkit_low_memory() {
    #[repr(C)]
    struct WebKitWebContext(std::ffi::c_void);
    #[repr(C)]
    struct WebKitMemoryPressureSettings(std::ffi::c_void);

    extern "C" {
        fn webkit_web_context_get_default() -> *mut WebKitWebContext;
        fn webkit_web_context_set_cache_model(context: *mut WebKitWebContext, cache_model: i32);
        fn webkit_memory_pressure_settings_new() -> *mut WebKitMemoryPressureSettings;
        fn webkit_memory_pressure_settings_set_memory_limit(
            settings: *mut WebKitMemoryPressureSettings,
            memory_limit: u32,
        );
        fn webkit_memory_pressure_settings_set_conservative_threshold(
            settings: *mut WebKitMemoryPressureSettings,
            value: f64,
        );
        fn webkit_memory_pressure_settings_set_strict_threshold(
            settings: *mut WebKitMemoryPressureSettings,
            value: f64,
        );
        fn webkit_memory_pressure_settings_free(settings: *mut WebKitMemoryPressureSettings);
        fn webkit_website_data_manager_set_memory_pressure_settings(
            settings: *mut WebKitMemoryPressureSettings,
        );
    }

    unsafe {
        // Must be configured before or right as WebContext initializes:
        // Limit WebProcess decoded image & JS caches to 160 MiB and use
        // WEBKIT_CACHE_MODEL_DOCUMENT_VIEWER (0) so decoded cover bitmaps
        // are evicted aggressively instead of accumulating hundreds of MBs.
        let settings = webkit_memory_pressure_settings_new();
        if !settings.is_null() {
            webkit_memory_pressure_settings_set_memory_limit(settings, 160);
            webkit_memory_pressure_settings_set_conservative_threshold(settings, 0.35);
            webkit_memory_pressure_settings_set_strict_threshold(settings, 0.55);
            webkit_website_data_manager_set_memory_pressure_settings(settings);
            webkit_memory_pressure_settings_free(settings);
        }

        let ctx = webkit_web_context_get_default();
        if !ctx.is_null() {
            // 0 = WEBKIT_CACHE_MODEL_DOCUMENT_VIEWER (minimal memory cache)
            webkit_web_context_set_cache_model(ctx, 0);
        }
    }
}

#[tauri::command]
fn set_desktop_lyric_open(app: AppHandle, open: bool, locked: bool) -> Result<(), String> {
    if open {
        if let Some(win) = app.get_webview_window("desktop-lyric") {
            let _ = win.show();
            let _ = win.set_always_on_top(true);
            let _ = win.set_ignore_cursor_events(locked);
            return Ok(());
        }

        let win = WebviewWindowBuilder::new(
            &app,
            "desktop-lyric",
            WebviewUrl::App("index.html?window=desktop-lyric".into()),
        )
        .title("Future Music 桌面歌词")
        .inner_size(860.0, 156.0)
        .min_inner_size(460.0, 110.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .build()
        .map_err(|e| format!("无法创建系统级桌面歌词窗口: {e}"))?;

        if let Ok(Some(monitor)) = win.primary_monitor() {
            let screen_size = monitor.size();
            let scale = monitor.scale_factor();
            let win_w = (860.0 * scale) as i32;
            let win_h = (156.0 * scale) as i32;
            let x = ((screen_size.width as i32 - win_w) / 2).max(0);
            let y = (screen_size.height as i32 - win_h - (68.0 * scale) as i32).max(0);
            let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
        }

        let _ = win.show();
        let _ = win.set_always_on_top(true);
        let _ = win.set_ignore_cursor_events(locked);
    } else if let Some(win) = app.get_webview_window("desktop-lyric") {
        // Destroy the secondary WebviewWindow when closed so its WebKitWebProcess
        // exits immediately and frees ~140MB of renderer memory.
        let _ = win.close();
    }
    Ok(())
}

#[tauri::command]
fn set_desktop_lyric_locked(app: AppHandle, locked: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("desktop-lyric") {
        let _ = win.set_ignore_cursor_events(locked);
    }
    let _ = app.emit("desktop-lyric-lock-changed", locked);
    Ok(())
}

#[tauri::command]
fn start_desktop_lyric_dragging(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("desktop-lyric") {
        win.start_dragging().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = db::LibraryDb::open_default();
    bridge_server::spawn_embedded_bridge_server();
    tauri::Builder::default()
        .manage(AppRuntimeState::default())
        .setup(|app| {
            #[cfg(target_os = "linux")]
            configure_webkit_low_memory();

            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let play_pause_item =
                MenuItem::with_id(app, "play_pause", "播放 / 暂停", true, None::<&str>)?;
            let prev_item = MenuItem::with_id(app, "prev", "上一首", true, None::<&str>)?;
            let next_item = MenuItem::with_id(app, "next", "下一首", true, None::<&str>)?;
            let lyric_item =
                MenuItem::with_id(app, "desktop_lyric", "桌面歌词开关", true, None::<&str>)?;
            let lyric_lock_item = MenuItem::with_id(
                app,
                "desktop_lyric_lock",
                "锁定 / 解锁桌面歌词 (穿透)",
                true,
                None::<&str>,
            )?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 Future Music", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &sep1,
                    &play_pause_item,
                    &prev_item,
                    &next_item,
                    &lyric_item,
                    &lyric_lock_item,
                    &sep2,
                    &quit_item,
                ],
            )?;

            let mut tray_builder = TrayIconBuilder::with_id("future-music-tray")
                .tooltip("Future Music · 跨源无损音乐播放器")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app_handle, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app_handle.get_webview_window("main") {
                            let _ = win.unminimize();
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "play_pause" => {
                        let _ = app_handle.emit("tray-toggle-play", ());
                    }
                    "prev" => {
                        let _ = app_handle.emit("tray-prev-track", ());
                    }
                    "next" => {
                        let _ = app_handle.emit("tray-next-track", ());
                    }
                    "desktop_lyric" => {
                        let _ = app_handle.emit("tray-toggle-desktop-lyric", ());
                    }
                    "desktop_lyric_lock" => {
                        let _ = app_handle.emit("tray-toggle-desktop-lyric-lock", ());
                    }
                    "quit" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app_handle = tray.app_handle();
                        if let Some(win) = app_handle.get_webview_window("main") {
                            let is_visible = win.is_visible().unwrap_or(false);
                            let is_minimized = win.is_minimized().unwrap_or(false);
                            if is_visible && !is_minimized {
                                let _ = win.hide();
                            } else {
                                let _ = win.unminimize();
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                    }
                });

            if let Some(default_icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(default_icon.clone());
            }

            let _ = tray_builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Clicking the native window close button on the main window hides it to the system tray
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            } else if window.label() == "desktop-lyric" {
                if let WindowEvent::Destroyed = event {
                    let _ = window.app_handle().emit("desktop-lyric-closed", ());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_huawei_status,
            resolve_huawei_track,
            sync_huawei_library,
            search_huawei_catalog,
            get_huawei_auth_contract,
            start_huawei_webview_login,
            submit_huawei_callback_url,
            sync_huawei_assets_live,
            parse_lyric_document,
            scan_music_folder,
            get_library_snapshot,
            save_local_playlist,
            set_desktop_lyric_open,
            set_desktop_lyric_locked,
            start_desktop_lyric_dragging
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{AlbumDto, ArtistDto, LibraryDb, SourceTrackInput};
    use crate::huawei::*;
    use crate::lyrics::*;
    use crate::matcher::*;
    use crate::plugin_host::*;
    use std::fs;

    #[test]
    fn test_sqlite_23_tables_and_favorites_invariants() {
        let db = LibraryDb::open_in_memory().expect("open in-memory sqlite");
        let count = db.table_count().expect("table count");
        assert_eq!(count, 23, "must create all 23 tables from ASTRA schema");

        let hw_acc = db
            .upsert_account(
                "huawei",
                "sns_hash_9021",
                "HUAWEI ID 186****9021",
                "logged_in",
                1731110400000,
            )
            .expect("upsert huawei account");

        let ncm_acc = db
            .upsert_account(
                "netease",
                "ncm_hash_001",
                "NetEase User",
                "logged_in",
                1731110400000,
            )
            .expect("upsert netease account");

        let hw_track = SourceTrackInput {
            source: "huawei".into(),
            source_track_id: "hw_9981203".into(),
            title: "晚风心里吹".into(),
            artists: vec![ArtistDto {
                id: "ar_1".into(),
                name: "阿梨粤".into(),
            }],
            album: Some(AlbumDto {
                id: "al_1".into(),
                title: "晚风心里吹".into(),
            }),
            duration_ms: Some(221_000),
            cover_url: "https://img.dbankcdn.cn/cover1.jpg".into(),
            access: "full".into(),
            quality: "lossless".into(),
        };

        let ncm_same_track = SourceTrackInput {
            source: "netease".into(),
            source_track_id: "ncm_185924".into(),
            title: "晚风心里吹 (Studio)".into(),
            artists: vec![ArtistDto {
                id: "ar_ncm".into(),
                name: "阿梨粤".into(),
            }],
            album: Some(AlbumDto {
                id: "al_ncm".into(),
                title: "晚风心里吹".into(),
            }),
            duration_ms: Some(221_000),
            cover_url: "".into(),
            access: "full".into(),
            quality: "lossless".into(),
        };

        let trk1 = db
            .upsert_track_and_binding(
                &hw_acc,
                "favorites",
                "huawei:fav",
                &hw_track,
                1731110401000,
            )
            .expect("upsert hw track");
        let trk2 = db
            .upsert_track_and_binding(
                &ncm_acc,
                "favorites",
                "netease:fav",
                &ncm_same_track,
                1731110402000,
            )
            .expect("upsert ncm track");

        // Same recording across Huawei and NetEase must share the exact same canonical track ID!
        assert_eq!(
            trk1, trk2,
            "same recording from Huawei and NetEase must mount onto one canonical track row"
        );

        db.add_favorite(&trk1, 1731110403000)
            .expect("add to local favorites");

        // Remote un-favorite on Huawei only deactivates origin, never deletes local favorite
        db.deactivate_origin("favorites", "huawei:fav", 1731110409000)
            .expect("deactivate origin");

        let favs = db.list_favorites().expect("list favorites");
        assert_eq!(favs.len(), 1, "local favorite must survive remote origin deactivation");
        assert_eq!(favs[0].sources, vec!["huawei".to_string(), "netease".to_string()]);
    }

    #[test]
    fn test_merge_tracks_and_undo_merge_audit() {
        let db = LibraryDb::open_in_memory().expect("open db");
        let acc = db
            .upsert_account("local", "disk", "Local Disk", "logged_in", 1000)
            .unwrap();

        let t_a = db
            .upsert_track_and_binding(
                &acc,
                "local",
                "disk:1",
                &SourceTrackInput {
                    source: "local".into(),
                    source_track_id: "loc_1".into(),
                    title: "富士山下".into(),
                    artists: vec![ArtistDto {
                        id: "".into(),
                        name: "陈奕迅".into(),
                    }],
                    album: None,
                    duration_ms: Some(259_000),
                    cover_url: "".into(),
                    access: "full".into(),
                    quality: "lossless".into(),
                },
                1000,
            )
            .unwrap();

        let t_b = db
            .upsert_track_and_binding(
                &acc,
                "local",
                "disk:2",
                &SourceTrackInput {
                    source: "local".into(),
                    source_track_id: "loc_2".into(),
                    title: "Sorrow Beneath Mt. Fuji".into(),
                    artists: vec![ArtistDto {
                        id: "".into(),
                        name: "Eason Chan".into(),
                    }],
                    album: None,
                    duration_ms: Some(259_000),
                    cover_url: "".into(),
                    access: "full".into(),
                    quality: "lossless".into(),
                },
                1001,
            )
            .unwrap();

        assert_ne!(t_a, t_b);
        db.add_favorite(&t_a, 1002).unwrap();
        db.add_favorite(&t_b, 1003).unwrap();

        let merge_id = db.merge_tracks(&t_a, &t_b, "jev", 0.94, 2000).unwrap();
        assert_eq!(db.resolve_track_id(&t_b).unwrap(), t_a);
        assert_eq!(db.list_favorites().unwrap().len(), 1);

        // Undo merge restores both tracks and writes merge_blocks
        db.undo_merge(&merge_id, 3000).unwrap();
        assert_eq!(db.resolve_track_id(&t_b).unwrap(), t_b);
        assert_eq!(db.list_favorites().unwrap().len(), 2);
    }

    #[test]
    fn test_huawei_oauth_pkce_digest_preview_and_vault_crypto() {
        let mut attempt = AuthAttempt::new_deterministic("verifier_secret_123456", "state_xyz", 1000);
        let auth_url = attempt.authorize_url();
        assert!(auth_url.starts_with(AUTHORIZE_ENDPOINT));
        assert!(auth_url.contains("client_id=101444301"));
        assert!(auth_url.contains("redirect_uri=hms%3A%2F%2Fredirect_uri"));
        assert!(auth_url.contains("code_challenge_method=S256"));

        // Domain whitelist checks
        assert!(is_allowed_login_url(
            "https://oauth-login.platform.hicloud.com/oauth2/v3/authorize"
        ));
        assert!(is_allowed_login_url(
            "https://oauth-login1.cloud.huawei.com/oauth2/v3/loginCallback"
        ));
        assert!(!is_allowed_login_url("https://evil.example.com/oauth2"));

        // Accept valid callback
        let cb = "hms://redirect_uri?code=auth_code_777&state=state_xyz";
        attempt.accept(cb, 1120).expect("valid callback accepted");

        // Second accept must fail (single-use)
        assert!(attempt.accept(cb, 1121).is_err());

        let form = attempt.take_exchange_form(1125).expect("exchange form");
        assert!(form.contains(&("code".into(), "auth_code_777".into())));
        assert!(form.contains(&("code_verifier".into(), "verifier_secret_123456".into())));

        // Digest header check
        let digest = build_music_digest_header("mus_tok_888", "2026-11-09T01:00:00Z").unwrap();
        assert!(digest.starts_with("Digest username=app-music-baseline, nonce="));
        assert!(digest.ends_with(", created=2026-11-09T01:00:00Z, token=mus_tok_888"));

        // Preview detection rule: only /preview/ in URL path counts
        assert!(is_preview_stream(
            "https://music.dbankcdn.cn/preview/track_123.mp3"
        ));
        assert!(!is_preview_stream(
            "https://music.dbankcdn.cn/full/track_123.flac?auditionTime=60"
        ));

        // Vault AES-256-GCM roundtrip
        let key = [42u8; 32];
        let sess = MusicSession {
            token: "sec_token_abc".into(),
            sns_user_id: "uid_9021".into(),
            expire_time: "20261231235959".into(),
        };
        let sealed = seal_session(&sess, &key).expect("seal session");
        let opened = open_session(&sealed, &key).expect("open session");
        assert_eq!(opened, sess);

        let wrong_key = [7u8; 32];
        assert!(open_session(&sealed, &wrong_key).is_err());
    }

    #[test]
    fn test_hmrc_and_ttml_word_by_word_lyrics_parser() {
        // 1. Cantonese HMRC with caret romanization
        let hmrc_cantonese = "[1200,4800]<0,600>愿<600,1100>晚风<1700,1400>将我吹 ^jyun6 maan5 fung1 zoeng1 ngo5 ceoi1";
        let lines = parse_hmrc(hmrc_cantonese);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].time_ms, 1200);
        assert_eq!(lines[0].text, "愿晚风将我吹");
        assert_eq!(
            lines[0].romanization.as_deref(),
            Some("jyun6 maan5 fung1 zoeng1 ngo5 ceoi1")
        );
        assert_eq!(lines[0].words.len(), 3);
        assert_eq!(lines[0].words[1].text, "晚风");
        assert_eq!(lines[0].words[1].start_ms, 1800);

        // 2. Foreign HMRC where caret tail is Chinese translation
        let hmrc_foreign = "[0,5000]<0,1200>Группа <1200,1800>крови ^<0,500>血<500,500>型";
        let f_lines = parse_hmrc(hmrc_foreign);
        assert_eq!(f_lines.len(), 1);
        assert_eq!(f_lines[0].translation.as_deref(), Some("血型"));
        assert!(f_lines[0].romanization.is_none());

        // 3. Apple Music style TTML with word spans & translation role
        let ttml_doc = r#"<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">
          <body>
            <div>
              <p begin="10.0s" dur="4.0s">
                <span begin="0.5s" dur="1.0s">星河</span>
                <span begin="1.5s" dur="2.0s">万里</span>
                <span ttm:role="x-translation">Vast Galaxy</span>
                <span ttm:role="x-roman">sing1 ho4 maan6 leoi5</span>
              </p>
            </div>
          </body>
        </tt>"#;
        let t_lines = parse_ttml(ttml_doc).expect("valid TTML");
        assert_eq!(t_lines.len(), 1);
        assert_eq!(t_lines[0].time_ms, 10_000);
        assert_eq!(t_lines[0].end_ms, 14_000);
        assert_eq!(t_lines[0].words.len(), 2);
        assert_eq!(t_lines[0].words[0].start_ms, 10_500);
        assert_eq!(t_lines[0].words[1].end_ms, 13_500);
        assert_eq!(t_lines[0].translation.as_deref(), Some("Vast Galaxy"));
        assert_eq!(t_lines[0].romanization.as_deref(), Some("sing1 ho4 maan6 leoi5"));

        // 4. Reject timeContainer="seq"
        let seq_ttml = r#"<tt timeContainer="seq"><body><p begin="0s" dur="2s">No</p></body></tt>"#;
        assert!(parse_ttml(seq_ttml).is_err());
    }

    #[test]
    fn test_two_stage_matcher_and_stdio_json_rpc_framing() {
        let policy = MatchPolicy::default();
        let studio = TrackProbe {
            source: "huawei".into(),
            id: "1".into(),
            title: "晴天".into(),
            artists: vec!["周杰伦".into()],
            album: Some("叶惠美".into()),
            duration_seconds: Some(269.0),
            version: detect_version(&["晴天"]),
        };
        let studio_ncm = TrackProbe {
            source: "netease".into(),
            id: "2".into(),
            title: "晴天".into(),
            artists: vec!["周杰伦".into()],
            album: Some("叶惠美".into()),
            duration_seconds: Some(269.5),
            version: detect_version(&["晴天"]),
        };
        let live_cut = TrackProbe {
            source: "qq".into(),
            id: "3".into(),
            title: "晴天 (Live)".into(),
            artists: vec!["周杰伦".into()],
            album: Some("The One 演唱会".into()),
            duration_seconds: Some(269.0),
            version: detect_version(&["晴天 (Live)"]),
        };

        let v_same = decide(&studio, &studio_ncm, &policy);
        assert!(v_same.same);
        assert_eq!(v_same.band, Band::Similar);

        let v_live = decide(&studio, &live_cut, &policy);
        assert!(!v_live.same);
        assert_eq!(v_live.reason, "version-mismatch");

        // JSON-RPC 2.0 Content-Length framing roundtrip (two concatenated frames)
        let req1 = build_initialize_request("huawei");
        let req2 = RpcMessage {
            jsonrpc: "2.0".into(),
            id: Some(serde_json::json!("h:2")),
            method: Some("source.catalog.search".into()),
            params: Some(serde_json::json!({ "query": "富士山下", "limit": 50 })),
            result: None,
            error: None,
        };
        let mut wire = encode_frame(&req1).unwrap();
        wire.extend_from_slice(&encode_frame(&req2).unwrap());

        let decoded = decode_frames_from_slice(&wire).expect("decode two concatenated frames");
        assert_eq!(decoded.len(), 2);
        assert_eq!(decoded[0].method.as_deref(), Some("initialize"));
        assert_eq!(decoded[1].method.as_deref(), Some("source.catalog.search"));
    }

    #[test]
    fn test_local_audio_directory_scanner() {
        let tmp_dir = std::env::temp_dir().join("future_music_test_scan");
        let _ = fs::remove_dir_all(&tmp_dir);
        fs::create_dir_all(&tmp_dir).unwrap();

        let sample_file = tmp_dir.join("陈奕迅 - 富士山下.flac");
        fs::write(&sample_file, b"fLaC_mock_lossless_header_bytes_for_fingerprint").unwrap();

        let summary = local_scanner::scan_local_directory(&tmp_dir).expect("scan temp dir");
        assert_eq!(summary.scanned_files, 1);
        assert_eq!(summary.imported_tracks.len(), 1);
        assert_eq!(summary.imported_tracks[0].title, "富士山下");
        assert_eq!(summary.imported_tracks[0].artists[0].name, "陈奕迅");
        assert_eq!(summary.imported_tracks[0].quality, "lossless");

        let _ = fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_sqlite_runtime_persistence_roundtrip() {
        let db = LibraryDb::open_in_memory().expect("open in-memory db");
        let tracks = vec![serde_json::json!({
            "id": "hw_track_99001",
            "sourceTrackId": "99001",
            "title": "晚风心里吹",
            "artists": ["阿梨粤"],
            "album": "晚风心里吹",
            "durationSeconds": 215,
            "coverUrl": "https://example.com/music_cover_300x300.webp"
        })];
        let playlists = vec![serde_json::json!({
            "id": "pl_hw_1001",
            "name": "粤语精选",
            "description": "华为云端歌单",
            "coverUrl": "https://example.com/music_cover_300x300.webp",
            "trackCount": 1,
            "trackIds": ["hw_track_99001"]
        })];

        db.persist_huawei_sync("user_1001", &tracks, &playlists, 1710000000000)
            .expect("persist huawei sync");
        db.upsert_local_playlist(
            "pl_local_1",
            "深夜编码歌单",
            "本地自定义",
            &["hw_track_99001".to_string()],
            1710000001000,
        )
        .expect("upsert local playlist");

        let snap = db.load_runtime_snapshot().expect("load runtime snapshot");
        assert_eq!(snap["ok"], true);
        assert_eq!(snap["tracks"].as_array().unwrap().len(), 1);
        assert_eq!(snap["tracks"][0]["title"], "晚风心里吹");
        assert_eq!(snap["playlists"].as_array().unwrap().len(), 2);
    }
}
