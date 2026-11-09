use std::path::Path;
use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::matcher::{clean_title, detect_version, fold, Version};

pub const SCHEMA_SQL: &str = include_str!("schema.sql");
pub const DEFAULT_PROFILE: &str = "local";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ArtistDto {
    #[serde(default)]
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AlbumDto {
    #[serde(default)]
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceTrackInput {
    pub source: String,
    pub source_track_id: String,
    pub title: String,
    pub artists: Vec<ArtistDto>,
    pub album: Option<AlbumDto>,
    pub duration_ms: Option<i64>,
    pub cover_url: String,
    pub access: String,   // "full" | "preview" | "unknown"
    pub quality: String,  // "lossless" | "hires" | "standard"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanonicalRowSummary {
    pub id: String,
    pub title: String,
    pub artists: Vec<ArtistDto>,
    pub album: Option<AlbumDto>,
    pub duration_ms: Option<i64>,
    pub cover_url: String,
    pub merged_into: Option<String>,
    pub sources: Vec<String>,
}

pub struct LibraryDb {
    pub conn: Connection,
}

impl LibraryDb {
    /// Open an on-disk or in-memory SQLite database and apply the 23-table schema.
    pub fn open_in_memory() -> SqlResult<Self> {
        let conn = Connection::open_in_memory()?;
        Self::init(conn)
    }

    pub fn open_path(path: &Path) -> SqlResult<Self> {
        let conn = Connection::open(path)?;
        let _ = conn.pragma_update(None, "journal_mode", "WAL");
        let _ = conn.pragma_update(None, "synchronous", "FULL");
        let _ = conn.busy_timeout(std::time::Duration::from_millis(5000));
        Self::init(conn)
    }

    fn init(conn: Connection) -> SqlResult<Self> {
        let has_migrations: i64 = conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
            [],
            |row| row.get(0),
        )?;

        if has_migrations == 0 {
            conn.execute_batch(SCHEMA_SQL)?;
            let mut hasher = Sha256::new();
            hasher.update(SCHEMA_SQL.as_bytes());
            let digest = hex::encode(hasher.finalize());
            conn.execute(
                "INSERT INTO schema_migrations(version, ddl_digest, applied_at) VALUES(1, ?1, ?2)",
                params![digest, 1731110400000i64],
            )?;
            conn.execute(
                "INSERT INTO profiles(id, name, created_at) VALUES(?1, 'Default Profile', ?2)",
                params![DEFAULT_PROFILE, 1731110400000i64],
            )?;
        }

        Ok(Self { conn })
    }

    /// Count how many tables exist in the database (verifies the 23-table ASTRA design).
    pub fn table_count(&self) -> SqlResult<usize> {
        let count: i64 = self.conn.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
            [],
            |row| row.get(0),
        )?;
        Ok(count as usize)
    }

    /// Deterministic canonical track ID from initial (source, source_track_id).
    pub fn canonical_id_for(source: &str, source_track_id: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(source.as_bytes());
        hasher.update(&[0u8]);
        hasher.update(source_track_id.as_bytes());
        let sum = hasher.finalize();
        format!("trk_{}", hex::encode(&sum[..12]))
    }

    /// Resolve a track ID across `merged_into` alias chains with cycle detection.
    pub fn resolve_track_id(&self, track_id: &str) -> Result<String, String> {
        let mut current = track_id.to_string();
        let mut visited = Vec::with_capacity(8);
        loop {
            if visited.contains(&current) {
                return Err(format!("cycle detected in merged_into chain starting at {track_id}"));
            }
            visited.push(current.clone());

            let next: Option<Option<String>> = match self.conn.query_row(
                "SELECT merged_into FROM tracks WHERE id = ?1",
                params![current],
                |row| row.get(0),
            ) {
                Ok(v) => Some(v),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e.to_string()),
            };

            match next {
                None => return Err(format!("canonical track not found: {current}")),
                Some(None) => return Ok(current),
                Some(Some(parent)) => current = parent,
            }
        }
    }

    /// Upsert a source account and mark it current for that source.
    pub fn upsert_account(
        &self,
        source: &str,
        account_key: &str,
        account_label: &str,
        state: &str,
        now_ms: i64,
    ) -> SqlResult<String> {
        let acc_id = format!("acc_{}_{}", source, &account_key[..account_key.len().min(12)]);
        self.conn.execute(
            "UPDATE source_accounts SET is_current = 0 WHERE source = ?1",
            params![source],
        )?;
        self.conn.execute(
            "INSERT INTO source_accounts(id, source, account_key, account_label, state, is_current, session_generation, updated_at)
             VALUES(?1, ?2, ?3, ?4, ?5, 1, 1, ?6)
             ON CONFLICT(source, account_key) DO UPDATE SET
               account_label = excluded.account_label,
               state = excluded.state,
               is_current = 1,
               session_generation = source_accounts.session_generation + 1,
               updated_at = excluded.updated_at",
            params![acc_id, source, account_key, account_label, state, now_ms],
        )?;
        Ok(acc_id)
    }

    /// Upsert a track from a provider/local source into `tracks`, `source_identities`, `source_bindings`,
    /// and `binding_origins`. Automatically merges into an existing canonical track if normalized title
    /// and artist match with compatible version.
    pub fn upsert_track_and_binding(
        &self,
        account_id: &str,
        origin_kind: &str,
        origin_key: &str,
        input: &SourceTrackInput,
        now_ms: i64,
    ) -> SqlResult<String> {
        // 1. Check if (source, source_track_id) already has a permanent identity
        let existing_identity: Option<(i64, String)> = match self.conn.query_row(
            "SELECT id, home_track_id FROM source_identities WHERE source = ?1 AND source_track_id = ?2",
            params![input.source, input.source_track_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ) {
            Ok(v) => Some(v),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e),
        };

        let artists_json = serde_json::to_string(&input.artists).unwrap_or_else(|_| "[]".into());
        let album_json = match &input.album {
            Some(a) => serde_json::to_string(a).unwrap_or_else(|_| "null".into()),
            None => "null".into(),
        };
        let version: Version = detect_version(&[
            input.title.as_str(),
            input.album.as_ref().map(|a| a.title.as_str()).unwrap_or(""),
        ]);
        let version_json = serde_json::to_string(&version).unwrap_or_else(|_| "{}".into());
        let version_key = version.key();
        let norm_title = fold(&clean_title(&input.title));
        let norm_artists = input
            .artists
            .iter()
            .map(|a| fold(&a.name))
            .collect::<Vec<_>>()
            .join("|");

        let mut digest_hasher = Sha256::new();
        digest_hasher.update(input.title.as_bytes());
        digest_hasher.update(artists_json.as_bytes());
        let metadata_digest = hex::encode(digest_hasher.finalize());

        let (identity_id, canonical_track_id) = if let Some((id_row, home_id)) = existing_identity {
            let resolved = self.resolve_track_id(&home_id).unwrap_or(home_id);
            (id_row, resolved)
        } else {
            // 2. Look for an existing unmerged canonical track with matching norm_title & version_key & artist overlap
            let candidate_id: Option<String> = match self.conn.query_row(
                "SELECT id FROM tracks WHERE merged_into IS NULL AND norm_title = ?1 AND version_key = ?2 AND norm_artists = ?3 LIMIT 1",
                params![norm_title, version_key, norm_artists],
                |row| row.get(0),
            ) {
                Ok(v) => Some(v),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(e) => return Err(e),
            };

            let home_track_id = if let Some(existing_track_id) = candidate_id {
                existing_track_id
            } else {
                let new_id = Self::canonical_id_for(&input.source, &input.source_track_id);
                self.conn.execute(
                    "INSERT OR IGNORE INTO tracks(
                        id, title, artists_json, album_json, version_json, version_key,
                        cover_url, duration_ms, norm_title, norm_artists, merged_into,
                        revision, created_at, updated_at
                    ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, 1, ?11, ?11)",
                    params![
                        new_id,
                        input.title,
                        artists_json,
                        album_json,
                        version_json,
                        version_key,
                        input.cover_url,
                        input.duration_ms,
                        norm_title,
                        norm_artists,
                        now_ms
                    ],
                )?;
                for artist in &input.artists {
                    let af = fold(&artist.name);
                    if !af.is_empty() {
                        self.conn.execute(
                            "INSERT OR IGNORE INTO track_artists(track_id, artist_norm) VALUES(?1, ?2)",
                            params![new_id, af],
                        )?;
                    }
                }
                new_id
            };

            // Increment library_clock import_seq
            self.conn.execute(
                "UPDATE library_clock SET import_seq = import_seq + 1, revision = revision + 1 WHERE singleton = 1",
                [],
            )?;
            let import_seq: i64 = self.conn.query_row(
                "SELECT import_seq FROM library_clock WHERE singleton = 1",
                [],
                |r| r.get(0),
            )?;

            self.conn.execute(
                "INSERT INTO source_identities(
                    source, source_track_id, home_track_id, import_seq, first_imported_at,
                    title, artists_json, album_json, version_json, version_key,
                    cover_url, duration_ms, metadata_digest, revision, updated_at
                ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 1, ?5)",
                params![
                    input.source,
                    input.source_track_id,
                    home_track_id,
                    import_seq,
                    now_ms,
                    input.title,
                    artists_json,
                    album_json,
                    version_json,
                    version_key,
                    input.cover_url,
                    input.duration_ms,
                    metadata_digest
                ],
            )?;
            let id_row = self.conn.last_insert_rowid();
            (id_row, home_track_id)
        };

        // 3. Upsert source_bindings and binding_origins
        self.conn.execute(
            "INSERT INTO source_bindings(identity_id, account_id, access, quality, evidence_json, last_seen_at)
             VALUES(?1, ?2, ?3, ?4, '{}', ?5)
             ON CONFLICT(identity_id, account_id) DO UPDATE SET
               access = excluded.access,
               quality = excluded.quality,
               last_seen_at = excluded.last_seen_at",
            params![identity_id, account_id, input.access, input.quality, now_ms],
        )?;

        let binding_id: i64 = self.conn.query_row(
            "SELECT id FROM source_bindings WHERE identity_id = ?1 AND account_id = ?2",
            params![identity_id, account_id],
            |r| r.get(0),
        )?;

        self.conn.execute(
            "INSERT INTO binding_origins(binding_id, origin_kind, origin_key, active, updated_at)
             VALUES(?1, ?2, ?3, 1, ?4)
             ON CONFLICT(binding_id, origin_kind, origin_key) DO UPDATE SET
               active = 1,
               updated_at = excluded.updated_at",
            params![binding_id, origin_kind, origin_key, now_ms],
        )?;

        Ok(canonical_track_id)
    }

    /// Add a canonical track to `favorites` and `member_refs`.
    /// Per invariant: remote updates never delete favorites even if origin is deactivated.
    pub fn add_favorite(&self, track_id: &str, now_ms: i64) -> SqlResult<()> {
        let resolved = self.resolve_track_id(track_id).unwrap_or_else(|_| track_id.to_string());
        let next_pos: i64 = self.conn.query_row(
            "SELECT COALESCE(MAX(position) + 1, 0) FROM favorites WHERE profile_id = ?1",
            params![DEFAULT_PROFILE],
            |r| r.get(0),
        )?;

        self.conn.execute(
            "INSERT OR IGNORE INTO favorites(profile_id, track_id, position, added_at)
             VALUES(?1, ?2, ?3, ?4)",
            params![DEFAULT_PROFILE, resolved, next_pos, now_ms],
        )?;

        self.conn.execute(
            "INSERT OR IGNORE INTO member_refs(owner_kind, owner_id, ref_key, anchor_track_id, position, added_at, revision)
             VALUES('favorites', ?1, ?2, ?2, ?3, ?4, 1)",
            params![DEFAULT_PROFILE, resolved, next_pos, now_ms],
        )?;
        Ok(())
    }

    /// Simulate remote collection un-favoriting: deactivates `binding_origins` for that source,
    /// while preserving the canonical track in `favorites`.
    pub fn deactivate_origin(&self, origin_kind: &str, origin_key: &str, now_ms: i64) -> SqlResult<()> {
        self.conn.execute(
            "UPDATE binding_origins SET active = 0, updated_at = ?3 WHERE origin_kind = ?1 AND origin_key = ?2",
            params![origin_kind, origin_key, now_ms],
        )?;
        Ok(())
    }

    /// Merge `loser_id` into `winner_id` and record reversible audit in `merge_decisions` and `merge_before`.
    pub fn merge_tracks(
        &self,
        winner_id: &str,
        loser_id: &str,
        method: &str,
        score: f64,
        now_ms: i64,
    ) -> Result<String, String> {
        let w = self.resolve_track_id(winner_id)?;
        let l = self.resolve_track_id(loser_id)?;
        if w == l {
            return Err("cannot merge a track into itself".into());
        }

        let merge_id = format!("merge_{}_{}", &w[..w.len().min(8)], &l[..l.len().min(8)]);
        self.conn
            .execute(
                "UPDATE tracks SET merged_into = ?1, revision = revision + 1, updated_at = ?2 WHERE id = ?3",
                params![w, now_ms, l],
            )
            .map_err(|e| e.to_string())?;

        // Repoint favorites projection from loser to winner
        self.conn
            .execute(
                "UPDATE OR IGNORE favorites SET track_id = ?1 WHERE track_id = ?2",
                params![w, l],
            )
            .map_err(|e| e.to_string())?;
        self.conn
            .execute("DELETE FROM favorites WHERE track_id = ?1", params![l])
            .map_err(|e| e.to_string())?;

        self.conn
            .execute(
                "INSERT INTO merge_decisions(
                    id, left_track_id, right_track_id, winner_track_id, loser_track_id,
                    method, score, rules_version, template_version, decision_digest,
                    applied_revision, created_at
                ) VALUES(?1, ?2, ?3, ?2, ?3, ?4, ?5, 'v1', 'v1', 'sha256_demo', 1, ?6)",
                params![merge_id, w, l, method, score, now_ms],
            )
            .map_err(|e| e.to_string())?;

        let before_json = serde_json::json!({ "merged_into": null }).to_string();
        let after_json = serde_json::json!({ "merged_into": w }).to_string();
        self.conn
            .execute(
                "INSERT INTO merge_before(merge_id, format_version, seq, entity_kind, entity_key, changed_fields_json, before_json, after_json)
                 VALUES(?1, 1, 1, 'track', ?2, '[\"merged_into\"]', ?3, ?4)",
                params![merge_id, l, before_json, after_json],
            )
            .map_err(|e| e.to_string())?;

        Ok(merge_id)
    }

    /// Undo a previous merge using `merge_decisions` and `member_refs`, and write a `merge_blocks` entry.
    pub fn undo_merge(&self, merge_id: &str, now_ms: i64) -> Result<(), String> {
        let (winner_id, loser_id): (String, String) = self
            .conn
            .query_row(
                "SELECT winner_track_id, loser_track_id FROM merge_decisions WHERE id = ?1 AND revoked_at IS NULL",
                params![merge_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        self.conn
            .execute(
                "UPDATE tracks SET merged_into = NULL, revision = revision + 1, updated_at = ?2 WHERE id = ?1",
                params![loser_id, now_ms],
            )
            .map_err(|e| e.to_string())?;

        self.conn
            .execute(
                "UPDATE merge_decisions SET revoked_at = ?2 WHERE id = ?1",
                params![merge_id, now_ms],
            )
            .map_err(|e| e.to_string())?;

        // Restore favorite projection if member_refs had loser_id
        let had_loser_fav: i64 = self
            .conn
            .query_row(
                "SELECT count(*) FROM member_refs WHERE owner_kind='favorites' AND anchor_track_id = ?1",
                params![loser_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if had_loser_fav > 0 {
            let _ = self.add_favorite(&loser_id, now_ms);
        }

        // Write merge_blocks so automated matcher won't immediately re-merge
        let left_json = serde_json::json!([winner_id]).to_string();
        let right_json = serde_json::json!([loser_id]).to_string();
        self.conn
            .execute(
                "INSERT INTO merge_blocks(merge_id, chunk_no, format_version, left_anchors_json, right_anchors_json, created_at)
                 VALUES(?1, 0, 1, ?2, ?3, ?4)",
                params![merge_id, left_json, right_json, now_ms],
            )
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// List all favorite canonical tracks with their mounted active/inactive source bindings.
    pub fn list_favorites(&self) -> SqlResult<Vec<CanonicalRowSummary>> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.title, t.artists_json, t.album_json, t.duration_ms, t.cover_url, t.merged_into
             FROM favorites f
             JOIN tracks t ON t.id = f.track_id
             WHERE f.profile_id = ?1
             ORDER BY f.position ASC",
        )?;

        let rows = stmt.query_map(params![DEFAULT_PROFILE], |row| {
            let id: String = row.get(0)?;
            let title: String = row.get(1)?;
            let artists_raw: String = row.get(2)?;
            let album_raw: String = row.get(3)?;
            let duration_ms: Option<i64> = row.get(4)?;
            let cover_url: String = row.get(5)?;
            let merged_into: Option<String> = row.get(6)?;

            let artists: Vec<ArtistDto> = serde_json::from_str(&artists_raw).unwrap_or_default();
            let album: Option<AlbumDto> = serde_json::from_str(&album_raw).ok();

            Ok((id, title, artists, album, duration_ms, cover_url, merged_into))
        })?;

        let mut out = Vec::new();
        for item in rows {
            let (id, title, artists, album, duration_ms, cover_url, merged_into) = item?;
            // Collect all sources whose home_track_id resolves to `id`
            let mut src_stmt = self.conn.prepare(
                "SELECT si.source, si.home_track_id FROM source_identities si ORDER BY si.import_seq ASC",
            )?;
            let src_rows = src_stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            let mut sources = Vec::new();
            for sr in src_rows {
                let (src, home) = sr?;
                if self.resolve_track_id(&home).unwrap_or(home) == id && !sources.contains(&src) {
                    sources.push(src);
                }
            }

            out.push(CanonicalRowSummary {
                id,
                title,
                artists,
                album,
                duration_ms,
                cover_url,
                merged_into,
                sources,
            });
        }
        Ok(out)
    }
}

