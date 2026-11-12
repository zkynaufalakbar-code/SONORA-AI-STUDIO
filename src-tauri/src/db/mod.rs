use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

use crate::error::AppResult;

pub struct Database {
    pub conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentProjectRow {
    pub id: String,
    pub name: String,
    pub project_path: String,
    pub updated_at: String,
    pub duration_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutosaveRow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub snapshot_json: String,
    pub saved_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetRow {
    pub id: String,
    pub effect_type: String,
    pub name: String,
    pub category: String,
    pub params_json: String,
    pub is_factory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModelRow {
    pub id: String,
    pub category: String,
    pub version: String,
    pub local_path: String,
    pub sha256: String,
    pub size_bytes: i64,
    pub installed_at: String,
}

impl Database {
    pub fn open(db_path: &Path) -> AppResult<Self> {
        let conn = Connection::open(db_path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "synchronous", "NORMAL")?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        db.seed_factory_presets()?;
        Ok(db)
    }

    fn migrate(&self) -> AppResult<()> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let version: i32 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if version < 1 {
            conn.execute_batch(
                "
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    project_path TEXT NOT NULL,
                    duration_ms INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS autosave_snapshots (
                    id TEXT PRIMARY KEY,
                    project_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    snapshot_json TEXT NOT NULL,
                    saved_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS waveform_cache (
                    file_hash TEXT PRIMARY KEY,
                    stored_path TEXT NOT NULL,
                    duration_ms INTEGER NOT NULL,
                    sample_rate INTEGER NOT NULL,
                    channels INTEGER NOT NULL,
                    bit_depth INTEGER NOT NULL,
                    codec TEXT NOT NULL,
                    bitrate INTEGER NOT NULL,
                    file_size_bytes INTEGER NOT NULL,
                    peak_file_path TEXT NOT NULL,
                    peak_dbfs REAL NOT NULL DEFAULT -100.0,
                    lufs_integrated REAL NOT NULL DEFAULT -24.0,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS presets (
                    id TEXT PRIMARY KEY,
                    effect_type TEXT NOT NULL,
                    name TEXT NOT NULL,
                    category TEXT NOT NULL,
                    params_json TEXT NOT NULL,
                    is_factory INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS ai_provider_configs (
                    provider_id TEXT PRIMARY KEY,
                    model_name TEXT,
                    endpoint TEXT,
                    custom_path TEXT,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS installed_models (
                    id TEXT PRIMARY KEY,
                    category TEXT NOT NULL,
                    version TEXT NOT NULL,
                    local_path TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    installed_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL
                );

                PRAGMA user_version = 1;
                ",
            )?;
        }
        Ok(())
    }

    fn seed_factory_presets(&self) -> AppResult<()> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM presets WHERE is_factory = 1",
            [],
            |r| r.get(0),
        )?;
        if count > 0 {
            return Ok(());
        }

        let factory = vec![
            ("factory-comp-vocal", "compressor", "Broadcast Vocal", "dynamics", r#"{"threshold":-18,"ratio":4,"attack":12,"release":140,"makeup":3,"knee":4}"#),
            ("factory-comp-podcast", "compressor", "Podcast Leveler", "dynamics", r#"{"threshold":-20,"ratio":3.5,"attack":10,"release":180,"makeup":4,"knee":6}"#),
            ("factory-limiter-master", "limiter", "Broadcast -1 dBFS", "dynamics", r#"{"ceiling":-1.0,"attack":2,"release":80}"#),
            ("factory-gate-room", "noise_gate", "Room Floor Gate", "dynamics", r#"{"threshold":-45,"range":-32,"attack":5,"hold":40,"release":120}"#),
            ("factory-eq3-clarity", "eq_3band", "Voice Presence", "equalizer", r#"{"low":-2.5,"mid":2.0,"high":3.0}"#),
            ("factory-hpf-rumble", "high_pass", "80 Hz Vocal Cut", "equalizer", r#"{"freq":80,"q":0.707}"#),
            ("factory-reverb-studio", "reverb", "Small Studio Room", "modulation_spatial", r#"{"roomSize":0.35,"decay":0.8,"damping":0.55,"mix":0.16}"#),
            ("factory-deess-soft", "de_esser", "Natural Sibilance Control", "restoration", r#"{"freq":6500,"threshold":-22,"intensity":0.45}"#),
            ("factory-denoise-clean", "noise_reduction", "Fan & AC Cleanup", "restoration", r#"{"noiseFloor":-30,"reduction":14,"sensitivity":0.5}"#),
            ("factory-chain-podcast-std", "chain", "Podcast Standard (-16 LUFS)", "podcast", r#"{"targetLufs":-16,"hpf":80,"compRatio":3.5,"deEss":0.4}"#),
        ];

        let now = chrono::Utc::now().to_rfc3339();
        for (id, etype, name, cat, params_json) in factory {
            conn.execute(
                "INSERT OR IGNORE INTO presets (id, effect_type, name, category, params_json, is_factory, created_at) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
                params![id, etype, name, cat, params_json, now],
            )?;
        }
        Ok(())
    }

    pub fn upsert_recent_project(
        &self,
        id: &str,
        name: &str,
        stored_project_path: &str,
        duration_ms: i64,
    ) -> AppResult<()> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO projects (id, name, project_path, duration_ms, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               project_path = excluded.project_path,
               duration_ms = excluded.duration_ms,
               updated_at = excluded.updated_at",
            params![id, name, stored_project_path, duration_ms, now],
        )?;
        Ok(())
    }

    pub fn list_recent_projects(&self) -> AppResult<Vec<RecentProjectRow>> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, project_path, updated_at, duration_ms FROM projects ORDER BY updated_at DESC LIMIT 20",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(RecentProjectRow {
                id: row.get(0)?,
                name: row.get(1)?,
                project_path: row.get(2)?,
                updated_at: row.get(3)?,
                duration_ms: row.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn save_autosave(&self, project_id: &str, name: &str, snapshot_json: &str) -> AppResult<()> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO autosave_snapshots (id, project_id, name, snapshot_json, saved_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               snapshot_json = excluded.snapshot_json,
               saved_at = excluded.saved_at",
            params![project_id, project_id, name, snapshot_json, now],
        )?;
        Ok(())
    }

    pub fn get_latest_autosave(&self) -> AppResult<Option<AutosaveRow>> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, project_id, name, snapshot_json, saved_at FROM autosave_snapshots ORDER BY saved_at DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map([], |row| {
            Ok(AutosaveRow {
                id: row.get(0)?,
                project_id: row.get(1)?,
                name: row.get(2)?,
                snapshot_json: row.get(3)?,
                saved_at: row.get(4)?,
            })
        })?;
        Ok(rows.next().transpose()?)
    }

    pub fn clear_autosave(&self, project_id: &str) -> AppResult<()> {
        let conn = self.conn.lock().expect("db lock poisoned");
        conn.execute(
            "DELETE FROM autosave_snapshots WHERE project_id = ?1",
            params![project_id],
        )?;
        Ok(())
    }

    pub fn list_presets(&self) -> AppResult<Vec<PresetRow>> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, effect_type, name, category, params_json, is_factory FROM presets ORDER BY is_factory DESC, name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(PresetRow {
                id: row.get(0)?,
                effect_type: row.get(1)?,
                name: row.get(2)?,
                category: row.get(3)?,
                params_json: row.get(4)?,
                is_factory: row.get::<_, i32>(5)? != 0,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn save_preset(&self, id: &str, effect_type: &str, name: &str, category: &str, params_json: &str) -> AppResult<()> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT OR REPLACE INTO presets (id, effect_type, name, category, params_json, is_factory, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)",
            params![id, effect_type, name, category, params_json, now],
        )?;
        Ok(())
    }

    pub fn delete_preset(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().expect("db lock poisoned");
        conn.execute("DELETE FROM presets WHERE id = ?1 AND is_factory = 0", params![id])?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let mut stmt = conn.prepare("SELECT value_json FROM app_settings WHERE key = ?1")?;
        let mut rows = stmt.query_map(params![key], |row| row.get::<_, String>(0))?;
        Ok(rows.next().transpose()?)
    }

    pub fn set_setting(&self, key: &str, value_json: &str) -> AppResult<()> {
        let conn = self.conn.lock().expect("db lock poisoned");
        conn.execute(
            "INSERT OR REPLACE INTO app_settings (key, value_json) VALUES (?1, ?2)",
            params![key, value_json],
        )?;
        Ok(())
    }

    pub fn upsert_installed_model(&self, row: &InstalledModelRow) -> AppResult<()> {
        let conn = self.conn.lock().expect("db lock poisoned");
        conn.execute(
            "INSERT OR REPLACE INTO installed_models (id, category, version, local_path, sha256, size_bytes, installed_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![row.id, row.category, row.version, row.local_path, row.sha256, row.size_bytes, row.installed_at],
        )?;
        Ok(())
    }

    pub fn list_installed_models(&self) -> AppResult<Vec<InstalledModelRow>> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, category, version, local_path, sha256, size_bytes, installed_at FROM installed_models",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(InstalledModelRow {
                id: r.get(0)?,
                category: r.get(1)?,
                version: r.get(2)?,
                local_path: r.get(3)?,
                sha256: r.get(4)?,
                size_bytes: r.get(5)?,
                installed_at: r.get(6)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn delete_installed_model(&self, id: &str) -> AppResult<()> {
        let conn = self.conn.lock().expect("db lock poisoned");
        conn.execute("DELETE FROM installed_models WHERE id = ?1", params![id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_schema_seeds_presets_and_crud_works() {
        let dir = std::env::temp_dir().join(format!("sonora_db_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = Database::open(&dir.join("sonora.db")).unwrap();

        let factory_presets = db.list_presets().unwrap();
        assert!(!factory_presets.is_empty());

        db.save_preset("user-p1", "compressor", "My Vocal Comp", "dynamics", r#"{"threshold":-18}"#).unwrap();
        assert!(db.list_presets().unwrap().iter().any(|p| p.id == "user-p1"));
        db.delete_preset("user-p1").unwrap();
        assert!(!db.list_presets().unwrap().iter().any(|p| p.id == "user-p1"));

        db.upsert_recent_project("proj-1", "Episode 1", "${PORTABLE_ROOT}/projects/ep1.sonora", 120_000).unwrap();
        assert_eq!(db.list_recent_projects().unwrap().len(), 1);

        db.save_autosave("proj-1", "Episode 1", r#"{"tracks":[]}"#).unwrap();
        assert_eq!(db.get_latest_autosave().unwrap().unwrap().project_id, "proj-1");
        db.clear_autosave("proj-1").unwrap();
        assert!(db.get_latest_autosave().unwrap().is_none());

        db.set_setting("theme", r#""dark""#).unwrap();
        assert_eq!(db.get_setting("theme").unwrap().as_deref(), Some(r#""dark""#));

        drop(db);
        let _ = std::fs::remove_dir_all(dir);
    }
}
