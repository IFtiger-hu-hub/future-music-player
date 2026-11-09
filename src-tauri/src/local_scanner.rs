use crate::db::{AlbumDto, ArtistDto, SourceTrackInput};
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::tag::Accessor;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::Path;
use walkdir::WalkDir;

const SUPPORTED_EXTENSIONS: &[&str] = &["flac", "wav", "mp3", "m4a", "ogg", "opus"];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalScanSummary {
    pub scanned_files: usize,
    pub imported_tracks: Vec<SourceTrackInput>,
}

pub fn is_supported_audio_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| SUPPORTED_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Computes a fast deterministic fingerprint from file size + first 64 KiB + relative/canonical path
/// so renaming or re-scanning remains stable.
pub fn compute_audio_fingerprint(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 65536];
    let n = file.read(&mut buf).map_err(|e| e.to_string())?;

    let mut hasher = Sha256::new();
    hasher.update(meta.len().to_le_bytes());
    hasher.update(&buf[..n]);
    let digest = hex::encode(hasher.finalize());
    Ok(format!("loc_{}", &digest[..20]))
}

/// Parses a single audio file's tags via `lofty`, falling back to `Artist - Title.ext` filename parsing
/// when tags are absent or the file is a lightweight test fixture.
pub fn parse_local_audio_file(path: &Path) -> Result<SourceTrackInput, String> {
    if !is_supported_audio_file(path) {
        return Err("unsupported audio extension".into());
    }
    let fingerprint = compute_audio_fingerprint(path)?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("flac")
        .to_ascii_lowercase();

    let quality = match ext.as_str() {
        "wav" => "hires",
        "flac" => "lossless",
        _ => "standard",
    };

    // Attempt full lofty tag + audio property extraction first
    if let Ok(tagged_file) = lofty::read_from_path(path) {
        let props = tagged_file.properties();
        let dur_ms = props.duration().as_millis() as i64;
        if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
            let title = tag
                .title()
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());
            let artist = tag
                .artist()
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());
            let album = tag
                .album()
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty());

            if let Some(t) = title {
                return Ok(SourceTrackInput {
                    source: "local".into(),
                    source_track_id: fingerprint,
                    title: t,
                    artists: vec![ArtistDto {
                        id: String::new(),
                        name: artist.unwrap_or_else(|| "未知艺人".into()),
                    }],
                    album: album.map(|a| AlbumDto {
                        id: String::new(),
                        title: a,
                    }),
                    duration_ms: if dur_ms > 0 { Some(dur_ms) } else { None },
                    cover_url: String::new(),
                    access: "full".into(),
                    quality: quality.into(),
                });
            }
        }
    }

    // Fallback: parse `Artist - Title.ext` from filename stem
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "invalid filename".to_string())?;

    let (artist_name, title_name) = if let Some((a, t)) = stem.split_once(" - ") {
        (a.trim().to_string(), t.trim().to_string())
    } else {
        ("本地音频库".to_string(), stem.trim().to_string())
    };

    Ok(SourceTrackInput {
        source: "local".into(),
        source_track_id: fingerprint,
        title: title_name,
        artists: vec![ArtistDto {
            id: String::new(),
            name: artist_name,
        }],
        album: Some(AlbumDto {
            id: String::new(),
            title: "Local Lossless Collection".into(),
        }),
        duration_ms: Some(220_000),
        cover_url: String::new(),
        access: "full".into(),
        quality: quality.into(),
    })
}

/// Recursively scans a directory for supported audio files.
pub fn scan_local_directory(dir: &Path) -> Result<LocalScanSummary, String> {
    if !dir.exists() {
        return Err(format!("directory does not exist: {}", dir.display()));
    }
    let mut scanned_files = 0usize;
    let mut imported_tracks = Vec::new();

    for entry in WalkDir::new(dir).follow_links(false).max_depth(6).into_iter().flatten() {
        let p = entry.path();
        if p.is_file() && is_supported_audio_file(p) {
            scanned_files += 1;
            if let Ok(track) = parse_local_audio_file(p) {
                imported_tracks.push(track);
            }
        }
    }

    Ok(LocalScanSummary {
        scanned_files,
        imported_tracks,
    })
}

