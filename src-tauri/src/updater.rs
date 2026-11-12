use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use crate::error::{AppError, AppResult};
use crate::paths::{DistributionMode, RuntimePaths};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_notes: String,
    pub installer_url: Option<String>,
    pub portable_zip_url: Option<String>,
    pub sha256: Option<String>,
    pub mode: DistributionMode,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoteManifest {
    version: String,
    release_notes: String,
    installer_url: Option<String>,
    portable_zip_url: Option<String>,
    sha256: Option<String>,
}

pub async fn check_for_updates(paths: &RuntimePaths, manifest_url: Option<String>) -> AppResult<UpdateCheckResult> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let Some(url) = manifest_url.filter(|u| !u.trim().is_empty()) else {
        return Ok(UpdateCheckResult {
            current_version: current.clone(),
            latest_version: current,
            update_available: false,
            release_notes: "No update server URL configured. You can apply local update packages manually.".into(),
            installer_url: None,
            portable_zip_url: None,
            sha256: None,
            mode: paths.mode,
        });
    };

    let manifest: RemoteManifest = if Path::new(&url).is_file() {
        let txt = fs::read_to_string(&url)?;
        serde_json::from_str(&txt)?
    } else {
        reqwest::get(&url)
            .await
            .map_err(|e| AppError::Invalid(format!("Update check failed: {e}")))?
            .json::<RemoteManifest>()
            .await
            .map_err(|e| AppError::Invalid(format!("Invalid update manifest: {e}")))?
    };

    let update_available = manifest.version != current;
    Ok(UpdateCheckResult {
        current_version: current,
        latest_version: manifest.version,
        update_available,
        release_notes: manifest.release_notes,
        installer_url: manifest.installer_url,
        portable_zip_url: manifest.portable_zip_url,
        sha256: manifest.sha256,
        mode: paths.mode,
    })
}

/// Archives portable config/, presets/, and settings into config/backups/backup-<ts>.zip
/// before updating or migrating portable builds.
pub fn backup_portable_config(paths: &RuntimePaths) -> AppResult<String> {
    let backups_dir = paths.config_dir.join("backups");
    fs::create_dir_all(&backups_dir)?;
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let out_zip = backups_dir.join(format!("sonora_backup_{ts}.zip"));

    let file = File::create(&out_zip)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    for (prefix, folder) in [("config", &paths.config_dir), ("presets", &paths.presets_dir)] {
        if !folder.is_dir() {
            continue;
        }
        for entry in walkdir::WalkDir::new(folder).into_iter().filter_map(Result::ok) {
            let p = entry.path();
            if p.is_file() {
                // Skip nested backups to avoid recursive bloat
                if p.starts_with(&backups_dir) {
                    continue;
                }
                if let Ok(rel) = p.strip_prefix(folder) {
                    let name = format!("{}/{}", prefix, rel.to_string_lossy().replace('\\', "/"));
                    zip.start_file(name, options)
                        .map_err(|e| AppError::Invalid(format!("Zip error: {e}")))?;
                    let mut f = File::open(p)?;
                    let mut buf = Vec::new();
                    f.read_to_end(&mut buf)?;
                    zip.write_all(&buf)?;
                }
            }
        }
    }
    zip.finish()
        .map_err(|e| AppError::Invalid(format!("Zip finish error: {e}")))?;
    Ok(out_zip.display().to_string())
}

/// Safely extracts updated portable app binaries from a release ZIP while strictly
/// protecting user folders: config/, projects/, models/, presets/, plugins/, exports/.
pub fn safe_apply_portable_zip(paths: &RuntimePaths, zip_path: &Path) -> AppResult<String> {
    if paths.mode != DistributionMode::Portable {
        return Err(AppError::Invalid("Safe portable ZIP update is only available in Portable Edition".into()));
    }
    let backup_path = backup_portable_config(paths)?;
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)
        .map_err(|e| AppError::Invalid(format!("Invalid ZIP archive: {e}")))?;

    let protected_prefixes = [
        "config/",
        "projects/",
        "models/",
        "presets/",
        "plugins/",
        "exports/",
        "logs/",
    ];

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| AppError::Invalid(e.to_string()))?;
        let raw_name = entry.name().replace('\\', "/");
        // Strip optional top-level folder prefix `SONORA-AI-Studio-Portable/`
        let rel = raw_name
            .split_once('/')
            .map(|(head, tail)| {
                if head.eq_ignore_ascii_case("SONORA-AI-Studio-Portable") {
                    tail
                } else {
                    raw_name.as_str()
                }
            })
            .unwrap_or(raw_name.as_str());

        if rel.is_empty() || entry.is_dir() {
            continue;
        }
        // Reject path traversal entries (ZIP Slip)
        let rel_path = Path::new(rel);
        if rel_path.is_absolute()
            || rel_path
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::Prefix(_)))
        {
            continue;
        }
        if protected_prefixes.iter().any(|p| rel.starts_with(p)) {
            continue;
        }

        let target = paths.exe_dir.join(rel_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        // Avoid overwriting the currently running exe directly on Windows; stage as .new
        let final_target = if rel.eq_ignore_ascii_case("SONORA-AI-Studio.exe") {
            paths.exe_dir.join("SONORA-AI-Studio.exe.new")
        } else {
            target
        };

        let mut out = File::create(&final_target)?;
        std::io::copy(&mut entry, &mut out)?;
    }

    Ok(backup_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn make_portable_paths(root: &Path) -> RuntimePaths {
        let p = RuntimePaths {
            mode: DistributionMode::Portable,
            exe_dir: root.to_path_buf(),
            config_dir: root.join("config"),
            projects_dir: root.join("projects"),
            cache_dir: root.join("cache"),
            presets_dir: root.join("presets"),
            plugins_dir: root.join("plugins"),
            models_dir: root.join("models"),
            exports_dir: root.join("exports"),
            logs_dir: root.join("logs"),
            db_path: root.join("config").join("sonora.db"),
            is_writable: true,
            write_error: None,
        };
        for d in [
            &p.config_dir,
            &p.projects_dir,
            &p.cache_dir,
            &p.presets_dir,
            &p.plugins_dir,
            &p.models_dir,
            &p.exports_dir,
            &p.logs_dir,
        ] {
            fs::create_dir_all(d).unwrap();
        }
        p
    }

    #[test]
    fn portable_backup_and_safe_zip_preserves_user_data() {
        let root = std::env::temp_dir().join(format!("sonora_upd_{}", uuid::Uuid::new_v4()));
        let paths = make_portable_paths(&root);

        // Seed user data across all protected directories
        fs::write(&paths.db_path, b"user-sqlite-data").unwrap();
        fs::write(paths.projects_dir.join("podcast.sonora"), b"user-project").unwrap();
        fs::write(paths.presets_dir.join("voice.json"), b"user-preset").unwrap();
        fs::write(paths.models_dir.join("sh.rnnn"), b"user-model").unwrap();
        fs::write(paths.exports_dir.join("final.wav"), b"user-export").unwrap();
        fs::write(paths.logs_dir.join("sonora.log"), b"user-log").unwrap();
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("bin").join("ffmpeg.exe"), b"old-ffmpeg").unwrap();

        // Build mock update zip attempting to overwrite config/ & escape via ..
        let zip_path = root.join("update.zip");
        {
            let f = File::create(&zip_path).unwrap();
            let mut zw = ZipWriter::new(f);
            let opts = SimpleFileOptions::default();

            zw.start_file("SONORA-AI-Studio-Portable/SONORA-AI-Studio.exe", opts).unwrap();
            zw.write_all(b"new-binary-v2").unwrap();

            zw.start_file("SONORA-AI-Studio-Portable/bin/ffmpeg.exe", opts).unwrap();
            zw.write_all(b"new-ffmpeg-v2").unwrap();

            zw.start_file("SONORA-AI-Studio-Portable/config/sonora.db", opts).unwrap();
            zw.write_all(b"OVERWRITTEN").unwrap();

            zw.start_file("SONORA-AI-Studio-Portable/projects/new.sonora", opts).unwrap();
            zw.write_all(b"SHOULD-SKIP").unwrap();

            zw.start_file("../escape.txt", opts).unwrap();
            zw.write_all(b"BAD").unwrap();

            zw.finish().unwrap();
        }

        let backup_zip = safe_apply_portable_zip(&paths, &zip_path).unwrap();
        assert!(PathBuf::from(&backup_zip).is_file());

        // Updated binaries staged safely
        assert_eq!(fs::read(root.join("SONORA-AI-Studio.exe.new")).unwrap(), b"new-binary-v2");
        assert_eq!(fs::read(root.join("bin").join("ffmpeg.exe")).unwrap(), b"new-ffmpeg-v2");

        // All user folders remained strictly untouched
        assert_eq!(fs::read(&paths.db_path).unwrap(), b"user-sqlite-data");
        assert_eq!(fs::read(paths.projects_dir.join("podcast.sonora")).unwrap(), b"user-project");
        assert!(!paths.projects_dir.join("new.sonora").exists());
        assert_eq!(fs::read(paths.presets_dir.join("voice.json")).unwrap(), b"user-preset");
        assert_eq!(fs::read(paths.models_dir.join("sh.rnnn")).unwrap(), b"user-model");
        assert_eq!(fs::read(paths.exports_dir.join("final.wav")).unwrap(), b"user-export");
        assert_eq!(fs::read(paths.logs_dir.join("sonora.log")).unwrap(), b"user-log");

        // Path traversal did not escape
        assert!(!root.parent().unwrap().join("escape.txt").exists());

        let _ = fs::remove_dir_all(root);
    }
}
