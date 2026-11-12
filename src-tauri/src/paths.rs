use serde::{Deserialize, Serialize};
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub const PORTABLE_ROOT_TOKEN: &str = "${PORTABLE_ROOT}";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DistributionMode {
    Installer,
    Portable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePaths {
    pub mode: DistributionMode,
    pub exe_dir: PathBuf,
    pub config_dir: PathBuf,
    pub projects_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub presets_dir: PathBuf,
    pub plugins_dir: PathBuf,
    pub models_dir: PathBuf,
    pub exports_dir: PathBuf,
    pub logs_dir: PathBuf,
    pub db_path: PathBuf,
    pub is_writable: bool,
    pub write_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BootstrapSettings {
    pub custom_models_dir: Option<String>,
    pub custom_projects_dir: Option<String>,
    pub custom_exports_dir: Option<String>,
}

impl RuntimePaths {
    pub fn initialize() -> AppResult<Self> {
        let exe_path = env::current_exe().map_err(AppError::Io)?;
        let exe_dir = exe_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));

        // Allow automated test suites to pass SONORA_FORCE_PORTABLE_DIR if needed,
        // otherwise strictly detect portable.flag next to executable.
        let (mode, root_dir) = if let Ok(forced) = env::var("SONORA_FORCE_PORTABLE_DIR") {
            (DistributionMode::Portable, PathBuf::from(forced))
        } else if exe_dir.join("portable.flag").is_file() {
            (DistributionMode::Portable, exe_dir.clone())
        } else {
            (DistributionMode::Installer, exe_dir.clone())
        };

        let mut paths = match mode {
            DistributionMode::Portable => Self {
                mode,
                exe_dir: root_dir.clone(),
                config_dir: root_dir.join("config"),
                projects_dir: root_dir.join("projects"),
                cache_dir: root_dir.join("cache"),
                presets_dir: root_dir.join("presets"),
                plugins_dir: root_dir.join("plugins"),
                models_dir: root_dir.join("models"),
                exports_dir: root_dir.join("exports"),
                logs_dir: root_dir.join("logs"),
                db_path: root_dir.join("config").join("sonora.db"),
                is_writable: true,
                write_error: None,
            },
            DistributionMode::Installer => {
                let app_data = dirs::config_dir()
                    .unwrap_or_else(|| root_dir.join("appdata"))
                    .join("SONORA AI STUDIO");
                let local_data = dirs::data_local_dir()
                    .unwrap_or_else(|| app_data.clone())
                    .join("SONORA AI STUDIO");
                let docs_dir = dirs::document_dir()
                    .unwrap_or_else(|| local_data.clone())
                    .join("SONORA AI Studio Projects");
                let music_dir = dirs::audio_dir()
                    .unwrap_or_else(|| docs_dir.clone())
                    .join("SONORA Exports");

                Self {
                    mode,
                    exe_dir: root_dir,
                    config_dir: app_data.join("config"),
                    projects_dir: docs_dir,
                    cache_dir: local_data.join("cache"),
                    presets_dir: app_data.join("presets"),
                    plugins_dir: app_data.join("plugins"),
                    models_dir: local_data.join("models"),
                    exports_dir: music_dir,
                    logs_dir: local_data.join("logs"),
                    db_path: app_data.join("config").join("sonora.db"),
                    is_writable: true,
                    write_error: None,
                }
            }
        };

        // Ensure directories exist and test writability strictly.
        if let Err(err) = paths.ensure_directories_and_probe() {
            if mode == DistributionMode::Portable {
                // Critical requirement: NEVER fall back silently to AppData in Portable Mode.
                return Err(AppError::PortableReadOnly(
                    paths.exe_dir.display().to_string(),
                    err.to_string(),
                ));
            }
            paths.is_writable = false;
            paths.write_error = Some(err.to_string());
        }

        // Apply optional custom overrides from config/bootstrap.json
        paths.apply_bootstrap_overrides();
        Ok(paths)
    }

    fn ensure_directories_and_probe(&self) -> AppResult<()> {
        let required = [
            &self.config_dir,
            &self.projects_dir,
            &self.cache_dir,
            &self.cache_dir.join("peaks"),
            &self.cache_dir.join("renders"),
            &self.cache_dir.join("webview2"),
            &self.presets_dir,
            &self.plugins_dir,
            &self.models_dir,
            &self.exports_dir,
            &self.logs_dir,
        ];
        for dir in required {
            fs::create_dir_all(dir)?;
        }

        // Probe writability in config_dir and cache_dir
        for probe_dir in [&self.config_dir, &self.cache_dir] {
            let probe_file = probe_dir.join(".sonora_write_probe");
            {
                let mut f = OpenOptions::new()
                    .create(true)
                    .write(true)
                    .truncate(true)
                    .open(&probe_file)?;
                f.write_all(b"ok")?;
            }
            let _ = fs::remove_file(&probe_file);
        }

        Ok(())
    }

    fn apply_bootstrap_overrides(&mut self) {
        let bootstrap_path = self.config_dir.join("bootstrap.json");
        if let Ok(raw) = fs::read_to_string(&bootstrap_path) {
            if let Ok(cfg) = serde_json::from_str::<BootstrapSettings>(&raw) {
                if let Some(m) = cfg.custom_models_dir.filter(|s| !s.trim().is_empty()) {
                    let resolved = self.resolve_stored_path(&m);
                    if fs::create_dir_all(&resolved).is_ok() {
                        self.models_dir = resolved;
                    }
                }
                if let Some(p) = cfg.custom_projects_dir.filter(|s| !s.trim().is_empty()) {
                    let resolved = self.resolve_stored_path(&p);
                    if fs::create_dir_all(&resolved).is_ok() {
                        self.projects_dir = resolved;
                    }
                }
                if let Some(e) = cfg.custom_exports_dir.filter(|s| !s.trim().is_empty()) {
                    let resolved = self.resolve_stored_path(&e);
                    if fs::create_dir_all(&resolved).is_ok() {
                        self.exports_dir = resolved;
                    }
                }
            }
        }
    }

    pub fn save_custom_models_dir(&mut self, dir_str: &str) -> AppResult<PathBuf> {
        let resolved = self.resolve_stored_path(dir_str);
        fs::create_dir_all(&resolved)?;
        // Verify writable
        let probe = resolved.join(".sonora_model_probe");
        OpenOptions::new().create(true).write(true).open(&probe)?;
        let _ = fs::remove_file(&probe);

        self.models_dir = resolved.clone();

        let bootstrap_path = self.config_dir.join("bootstrap.json");
        let mut cfg = fs::read_to_string(&bootstrap_path)
            .ok()
            .and_then(|s| serde_json::from_str::<BootstrapSettings>(&s).ok())
            .unwrap_or_default();
        cfg.custom_models_dir = Some(self.to_stored_path(&resolved));
        fs::write(&bootstrap_path, serde_json::to_string_pretty(&cfg)?)?;
        Ok(resolved)
    }

    /// Converts an absolute path inside portable root into `${PORTABLE_ROOT}/...`
    /// so portable libraries & projects work seamlessly across drive letter changes.
    pub fn to_stored_path(&self, path: &Path) -> String {
        if self.mode == DistributionMode::Portable {
            let norm_root = normalize_for_compare(&self.exe_dir);
            let norm_target = normalize_for_compare(path);
            if norm_target == norm_root {
                return PORTABLE_ROOT_TOKEN.to_string();
            }
            if let Some(rel) = norm_target.strip_prefix(&(norm_root + "/")) {
                return format!("{PORTABLE_ROOT_TOKEN}/{rel}");
            }
        }
        path.to_string_lossy().replace('\\', "/")
    }

    /// Resolves `${PORTABLE_ROOT}/...` back to the live runtime drive/folder.
    pub fn resolve_stored_path(&self, stored: &str) -> PathBuf {
        if let Some(rest) = stored.strip_prefix(PORTABLE_ROOT_TOKEN) {
            let trimmed = rest.trim_start_matches(['/', '\\']);
            if trimmed.is_empty() {
                return self.exe_dir.clone();
            }
            let mut out = self.exe_dir.clone();
            for part in trimmed.split(['/', '\\']) {
                if !part.is_empty() {
                    out.push(part);
                }
            }
            return out;
        }
        PathBuf::from(stored)
    }

    pub fn append_log(&self, level: &str, message: &str) {
        let log_file = self.logs_dir.join("sonora.log");
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_file) {
            let ts = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
            let _ = writeln!(f, "[{ts}] [{level}] {message}");
        }
    }
}

fn normalize_for_compare(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    let trimmed = raw.trim_end_matches('/');
    #[cfg(windows)]
    {
        trimmed.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_relative_roundtrip_across_drives() {
        let mut p1 = RuntimePaths {
            mode: DistributionMode::Portable,
            exe_dir: PathBuf::from(r"D:\Tools\SONORA-Portable"),
            config_dir: PathBuf::from(r"D:\Tools\SONORA-Portable\config"),
            projects_dir: PathBuf::from(r"D:\Tools\SONORA-Portable\projects"),
            cache_dir: PathBuf::from(r"D:\Tools\SONORA-Portable\cache"),
            presets_dir: PathBuf::from(r"D:\Tools\SONORA-Portable\presets"),
            plugins_dir: PathBuf::from(r"D:\Tools\SONORA-Portable\plugins"),
            models_dir: PathBuf::from(r"D:\Tools\SONORA-Portable\models"),
            exports_dir: PathBuf::from(r"D:\Tools\SONORA-Portable\exports"),
            logs_dir: PathBuf::from(r"D:\Tools\SONORA-Portable\logs"),
            db_path: PathBuf::from(r"D:\Tools\SONORA-Portable\config\sonora.db"),
            is_writable: true,
            write_error: None,
        };

        let clip = PathBuf::from(r"D:\Tools\SONORA-Portable\projects\ep1\voice.wav");
        let stored = p1.to_stored_path(&clip);
        assert_eq!(stored, "${PORTABLE_ROOT}/projects/ep1/voice.wav");

        // Simulate plugging USB flashdrive into a different PC with drive G:
        p1.exe_dir = PathBuf::from(r"G:\SONORA-Portable");
        let resolved = p1.resolve_stored_path(&stored);
        assert_eq!(
            resolved,
            PathBuf::from(r"G:\SONORA-Portable")
                .join("projects")
                .join("ep1")
                .join("voice.wav")
        );
    }

    #[test]
    fn portable_mode_creates_all_dirs_and_rejects_unwritable_root() {
        let dir = std::env::temp_dir().join(format!("sonora_paths_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        env::set_var("SONORA_FORCE_PORTABLE_DIR", &dir);
        let paths = RuntimePaths::initialize().expect("portable dir should initialize");
        assert_eq!(paths.mode, DistributionMode::Portable);
        assert!(paths.config_dir.is_dir());
        assert!(paths.projects_dir.is_dir());
        assert!(paths.cache_dir.join("webview2").is_dir());
        assert!(paths.models_dir.is_dir());
        assert!(paths.exports_dir.is_dir());
        assert!(paths.logs_dir.is_dir());

        // Pointing portable root at a regular file simulates an unwritable directory:
        // create_dir_all must fail strictly with AppError::PortableReadOnly, never AppData fallback.
        let file_blocking_dir = dir.join("not_a_directory.lock");
        fs::write(&file_blocking_dir, b"locked").unwrap();
        env::set_var("SONORA_FORCE_PORTABLE_DIR", &file_blocking_dir);
        let err = RuntimePaths::initialize().unwrap_err();
        env::remove_var("SONORA_FORCE_PORTABLE_DIR");

        assert!(
            matches!(err, AppError::PortableReadOnly(_, _)),
            "Expected PortableReadOnly error, got: {err}"
        );

        let _ = fs::remove_dir_all(dir);
    }
}
