use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

use crate::db::{Database, InstalledModelRow};
use crate::error::{AppError, AppResult};
use crate::ffmpeg::locator::probe_ffmpeg;
use crate::paths::RuntimePaths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelCategory {
    SpeechRecognition,
    NoiseReduction,
    VocalSeparation,
    VoiceEnhancement,
    AudioClassification,
}

impl ModelCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SpeechRecognition => "speech_recognition",
            Self::NoiseReduction => "noise_reduction",
            Self::VocalSeparation => "vocal_separation",
            Self::VoiceEnhancement => "voice_enhancement",
            Self::AudioClassification => "audio_classification",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModelStatus {
    NotInstalled,
    Downloading,
    Installed,
    UpdateAvailable,
    Corrupted,
    Incompatible,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelEntry {
    pub id: String,
    pub name: String,
    pub category: ModelCategory,
    pub version: String,
    pub size_bytes: u64,
    pub description: String,
    pub runtime_requirement: String,
    pub download_url: String,
    pub sha256: String,
    pub file_name: String,
    pub local_path: Option<String>,
    pub status: ModelStatus,
    pub compatible: bool,
    pub compatibility_note: Option<String>,
    pub downloaded_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgress {
    pub model_id: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bps: u64,
    pub status: String, // downloading | verifying | completed | paused | error
    pub error: Option<String>,
}

pub struct ModelManager {
    active_cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl ModelManager {
    pub fn new() -> Self {
        Self {
            active_cancellations: Mutex::new(HashMap::new()),
        }
    }

    pub fn catalog() -> Vec<AiModelEntry> {
        vec![
            AiModelEntry {
                id: "rnnoise-std".into(),
                name: "RNNoise Standard (arnndn)".into(),
                category: ModelCategory::NoiseReduction,
                version: "1.0.0".into(),
                size_bytes: 85_000,
                description: "Lightweight recurrent neural network noise suppression model for FFmpeg arnndn (fan, AC, hum, room noise).".into(),
                runtime_requirement: "ffmpeg_arnndn".into(),
                download_url: "https://raw.githubusercontent.com/GregorR/rnnoise-models/master/somnolent-hogwash-2018-09-01/sh.rnnn".into(),
                sha256: "".into(),
                file_name: "sh.rnnn".into(),
                local_path: None,
                status: ModelStatus::NotInstalled,
                compatible: true,
                compatibility_note: None,
                downloaded_bytes: 0,
            },
            AiModelEntry {
                id: "whisper-tiny".into(),
                name: "Whisper Tiny (Multilingual)".into(),
                category: ModelCategory::SpeechRecognition,
                version: "1.0.0".into(),
                size_bytes: 77_691_713,
                description: "Fast offline speech-to-text model (GGML) for quick timestamped transcription & SRT export.".into(),
                runtime_requirement: "whisper_cli_or_python".into(),
                download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin".into(),
                sha256: "".into(),
                file_name: "ggml-tiny.bin".into(),
                local_path: None,
                status: ModelStatus::NotInstalled,
                compatible: true,
                compatibility_note: None,
                downloaded_bytes: 0,
            },
            AiModelEntry {
                id: "whisper-base".into(),
                name: "Whisper Base (Multilingual)".into(),
                category: ModelCategory::SpeechRecognition,
                version: "1.0.0".into(),
                size_bytes: 147_951_465,
                description: "Balanced accuracy offline transcription model for podcasts, interviews & voice-overs.".into(),
                runtime_requirement: "whisper_cli_or_python".into(),
                download_url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin".into(),
                sha256: "".into(),
                file_name: "ggml-base.bin".into(),
                local_path: None,
                status: ModelStatus::NotInstalled,
                compatible: true,
                compatibility_note: None,
                downloaded_bytes: 0,
            },
            AiModelEntry {
                id: "demucs-htdemucs".into(),
                name: "Demucs v4 Hybrid Transformer".into(),
                category: ModelCategory::VocalSeparation,
                version: "4.0.0".into(),
                size_bytes: 84_200_000,
                description: "Separates vocals, drums, bass, and instrumental stems via local Demucs runtime.".into(),
                runtime_requirement: "python_demucs".into(),
                download_url: "https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/955717e8-8726e21a.th".into(),
                sha256: "".into(),
                file_name: "htdemucs.th".into(),
                local_path: None,
                status: ModelStatus::NotInstalled,
                compatible: true,
                compatibility_note: None,
                downloaded_bytes: 0,
            },
            AiModelEntry {
                id: "deepfilternet-3".into(),
                name: "DeepFilterNet3 Voice Enhance".into(),
                category: ModelCategory::VoiceEnhancement,
                version: "3.0.0".into(),
                size_bytes: 9_800_000,
                description: "Full-band neural speech enhancement and dereverberation weights.".into(),
                runtime_requirement: "python_deepfilternet".into(),
                download_url: "https://github.com/Rikorose/DeepFilterNet/raw/main/models/DeepFilterNet3.tar.gz".into(),
                sha256: "".into(),
                file_name: "DeepFilterNet3.tar.gz".into(),
                local_path: None,
                status: ModelStatus::NotInstalled,
                compatible: true,
                compatibility_note: None,
                downloaded_bytes: 0,
            },
            AiModelEntry {
                id: "yamnet-classifier".into(),
                name: "YAMNet Audio Classifier (ONNX)".into(),
                category: ModelCategory::AudioClassification,
                version: "1.0.0".into(),
                size_bytes: 15_000_000,
                description: "Classifies speech, music, wind, fan, traffic, and room ambiance for smart assistant analysis.".into(),
                runtime_requirement: "python_onnxruntime".into(),
                download_url: "https://huggingface.co/qualcomm/YamNet/resolve/main/YamNet.onnx".into(),
                sha256: "".into(),
                file_name: "yamnet.onnx".into(),
                local_path: None,
                status: ModelStatus::NotInstalled,
                compatible: true,
                compatibility_note: None,
                downloaded_bytes: 0,
            },
        ]
    }

    pub fn list_models(&self, paths: &RuntimePaths, db: &Database) -> AppResult<Vec<AiModelEntry>> {
        let installed = db.list_installed_models()?;
        let installed_map: HashMap<String, InstalledModelRow> =
            installed.into_iter().map(|m| (m.id.clone(), m)).collect();

        let ff_caps = probe_ffmpeg(&paths.exe_dir, None);
        let cpuid = raw_cpuid::CpuId::new();
        let has_avx = cpuid
            .get_feature_info()
            .map(|f| f.has_avx())
            .unwrap_or(true);
        let has_python_onnx = check_python_module("onnxruntime");
        let has_demucs = check_python_module("demucs") || find_cli("demucs");
        let has_deepfilter = check_python_module("df") || find_cli("deepFilter");
        let has_whisper = check_python_module("faster_whisper") || find_cli("whisper-cli") || find_cli("whisper");

        let mut list = Self::catalog();
        for item in &mut list {
            let (compatible, note) = match item.runtime_requirement.as_str() {
                "ffmpeg_arnndn" => (
                    ff_caps.has_arnndn,
                    if ff_caps.has_arnndn {
                        Some("FFmpeg arnndn ready".into())
                    } else {
                        Some("FFmpeg missing arnndn filter".into())
                    },
                ),
                "whisper_cli_or_python" => (
                    has_avx,
                    if has_whisper {
                        Some("Local Whisper runtime detected".into())
                    } else {
                        Some("Downloads GGML weights; install whisper-cli or faster-whisper for local inference".into())
                    },
                ),
                "python_demucs" => (
                    has_avx,
                    if has_demucs {
                        Some("Demucs runtime detected".into())
                    } else {
                        Some("Requires Python 'demucs' package for local stem execution".into())
                    },
                ),
                "python_deepfilternet" => (
                    has_avx,
                    if has_deepfilter {
                        Some("DeepFilterNet runtime detected".into())
                    } else {
                        Some("Requires Python 'deepfilternet' package".into())
                    },
                ),
                "python_onnxruntime" => (
                    has_avx && has_python_onnx,
                    if has_python_onnx {
                        Some("ONNX Runtime detected".into())
                    } else {
                        Some("Python onnxruntime not found".into())
                    },
                ),
                _ => (true, None),
            };
            item.compatible = compatible;
            item.compatibility_note = note;

            let part_file = self.model_part_path(paths, item);
            if part_file.is_file() {
                if let Ok(meta) = fs::metadata(&part_file) {
                    item.downloaded_bytes = meta.len();
                }
            }

            if let Some(rec) = installed_map.get(&item.id) {
                let resolved = paths.resolve_stored_path(&rec.local_path);
                if resolved.is_file() {
                    item.local_path = Some(resolved.display().to_string());
                    item.downloaded_bytes = rec.size_bytes as u64;
                    if rec.version != item.version {
                        item.status = ModelStatus::UpdateAvailable;
                    } else if !rec.sha256.is_empty() && !verify_file_sha256(&resolved, &rec.sha256).unwrap_or(false) {
                        item.status = ModelStatus::Corrupted;
                    } else {
                        item.status = ModelStatus::Installed;
                    }
                } else {
                    item.status = ModelStatus::NotInstalled;
                }
            } else if !compatible {
                item.status = ModelStatus::Incompatible;
            }
        }
        Ok(list)
    }

    fn model_target_path(&self, paths: &RuntimePaths, entry: &AiModelEntry) -> PathBuf {
        paths
            .models_dir
            .join(entry.category.as_str())
            .join(&entry.id)
            .join(&entry.file_name)
    }

    fn model_part_path(&self, paths: &RuntimePaths, entry: &AiModelEntry) -> PathBuf {
        self.model_target_path(paths, entry).with_extension("part")
    }

    pub fn cancel_download(&self, model_id: &str) {
        if let Ok(guard) = self.active_cancellations.lock() {
            if let Some(flag) = guard.get(model_id) {
                flag.store(true, Ordering::Relaxed);
            }
        }
    }

    pub async fn download_model(
        &self,
        paths: &RuntimePaths,
        db: &Database,
        model_id: &str,
        on_progress: Channel<ModelDownloadProgress>,
    ) -> AppResult<AiModelEntry> {
        let entry = Self::catalog()
            .into_iter()
            .find(|m| m.id == model_id)
            .ok_or_else(|| AppError::Model(format!("Unknown model '{model_id}'")))?;

        let target = self.model_target_path(paths, &entry);
        let part = self.model_part_path(paths, &entry);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }

        let cancel_flag = Arc::new(AtomicBool::new(false));
        {
            let mut guard = self.active_cancellations.lock().expect("dl lock");
            guard.insert(model_id.to_string(), cancel_flag.clone());
        }

        let result = download_with_resume(
            &entry.download_url,
            &part,
            &target,
            &entry.sha256,
            entry.size_bytes,
            model_id,
            cancel_flag,
            &on_progress,
        )
        .await;

        {
            let mut guard = self.active_cancellations.lock().expect("dl lock");
            guard.remove(model_id);
        }

        let (actual_sha256, actual_size) = result?;
        let stored_path = paths.to_stored_path(&target);
        db.upsert_installed_model(&InstalledModelRow {
            id: entry.id.clone(),
            category: entry.category.as_str().to_string(),
            version: entry.version.clone(),
            local_path: stored_path,
            sha256: actual_sha256,
            size_bytes: actual_size as i64,
            installed_at: chrono::Utc::now().to_rfc3339(),
        })?;

        let _ = on_progress.send(ModelDownloadProgress {
            model_id: model_id.to_string(),
            downloaded_bytes: actual_size,
            total_bytes: actual_size,
            speed_bps: 0,
            status: "completed".into(),
            error: None,
        });

        let updated = self
            .list_models(paths, db)?
            .into_iter()
            .find(|m| m.id == model_id)
            .ok_or_else(|| AppError::Model("Model disappeared after install".into()))?;
        Ok(updated)
    }

    pub fn remove_model(&self, paths: &RuntimePaths, db: &Database, model_id: &str) -> AppResult<()> {
        if let Some(entry) = Self::catalog().into_iter().find(|m| m.id == model_id) {
            let dir = paths.models_dir.join(entry.category.as_str()).join(&entry.id);
            if dir.is_dir() {
                fs::remove_dir_all(dir)?;
            }
        }
        db.delete_installed_model(model_id)?;
        Ok(())
    }

    pub fn verify_model(&self, paths: &RuntimePaths, db: &Database, model_id: &str) -> AppResult<bool> {
        let installed = db.list_installed_models()?;
        let Some(rec) = installed.into_iter().find(|m| m.id == model_id) else {
            return Ok(false);
        };
        let resolved = paths.resolve_stored_path(&rec.local_path);
        if !resolved.is_file() {
            return Ok(false);
        }
        verify_file_sha256(&resolved, &rec.sha256)
    }
}

#[allow(clippy::too_many_arguments)]
async fn download_with_resume(
    url: &str,
    part_path: &Path,
    target_path: &Path,
    expected_sha256: &str,
    fallback_total: u64,
    model_id: &str,
    cancel_flag: Arc<AtomicBool>,
    on_progress: &Channel<ModelDownloadProgress>,
) -> AppResult<(String, u64)> {
    let existing_len = if part_path.is_file() {
        fs::metadata(part_path)?.len()
    } else {
        0
    };

    let client = reqwest::Client::builder()
        .user_agent("SONORA-AI-STUDIO/1.0")
        .build()
        .map_err(|e| AppError::Model(format!("HTTP client error: {e}")))?;

    let mut req = client.get(url);
    if existing_len > 0 {
        req = req.header("Range", format!("bytes={existing_len}-"));
    }

    let mut resp = req
        .send()
        .await
        .map_err(|e| AppError::Model(format!("Download request failed: {e}")))?;

    let status = resp.status();
    let (mut file, mut downloaded, total_bytes) = if status == reqwest::StatusCode::PARTIAL_CONTENT {
        let content_len = resp.content_length().unwrap_or(0);
        let total = existing_len + content_len;
        let f = OpenOptions::new().append(true).open(part_path)?;
        (f, existing_len, total.max(fallback_total))
    } else if status.is_success() {
        let total = resp.content_length().unwrap_or(fallback_total);
        let f = File::create(part_path)?;
        (f, 0, total)
    } else {
        return Err(AppError::Model(format!("Server returned HTTP {status}")));
    };

    let mut last_tick = std::time::Instant::now();
    let mut bytes_since_tick = 0u64;

    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| AppError::Model(format!("Stream read error: {e}")))?
    {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = on_progress.send(ModelDownloadProgress {
                model_id: model_id.to_string(),
                downloaded_bytes: downloaded,
                total_bytes,
                speed_bps: 0,
                status: "paused".into(),
                error: None,
            });
            return Err(AppError::Model("Download paused by user".into()));
        }

        file.write_all(&chunk)?;
        downloaded += chunk.len() as u64;
        bytes_since_tick += chunk.len() as u64;

        let elapsed = last_tick.elapsed().as_secs_f64();
        if elapsed >= 0.25 {
            let speed_bps = (bytes_since_tick as f64 / elapsed) as u64;
            let _ = on_progress.send(ModelDownloadProgress {
                model_id: model_id.to_string(),
                downloaded_bytes: downloaded,
                total_bytes: total_bytes.max(downloaded),
                speed_bps,
                status: "downloading".into(),
                error: None,
            });
            last_tick = std::time::Instant::now();
            bytes_since_tick = 0;
        }
    }
    file.flush()?;
    drop(file);

    let _ = on_progress.send(ModelDownloadProgress {
        model_id: model_id.to_string(),
        downloaded_bytes: downloaded,
        total_bytes: downloaded,
        speed_bps: 0,
        status: "verifying".into(),
        error: None,
    });

    let actual_sha = compute_file_sha256(part_path)?;
    if !expected_sha256.is_empty() && !actual_sha.eq_ignore_ascii_case(expected_sha256) {
        let _ = fs::remove_file(part_path);
        return Err(AppError::Model(format!(
            "SHA-256 verification failed: expected {expected_sha256}, got {actual_sha}"
        )));
    }

    if target_path.exists() {
        let _ = fs::remove_file(target_path);
    }
    fs::rename(part_path, target_path)?;
    let size = fs::metadata(target_path)?.len();
    Ok((actual_sha, size))
}

pub fn compute_file_sha256(path: &Path) -> AppResult<String> {
    let mut f = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn verify_file_sha256(path: &Path, expected_hex: &str) -> AppResult<bool> {
    if expected_hex.is_empty() {
        return Ok(path.is_file());
    }
    let actual = compute_file_sha256(path)?;
    Ok(actual.eq_ignore_ascii_case(expected_hex))
}

pub fn check_python_module(module: &str) -> bool {
    crate::ffmpeg::locator::new_hidden_command("python")
        .args(["-c", &format!("import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('{module}') else 1)")])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn find_cli(name: &str) -> bool {
    let candidate = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    if let Some(paths) = std::env::var_os("PATH") {
        for p in std::env::split_paths(&paths) {
            if p.join(&candidate).is_file() || p.join(name).is_file() {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_integrity_check_rejects_corruption() {
        let dir = std::env::temp_dir().join(format!("sonora_sha_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("model.bin");
        fs::write(&file, b"sonora-test-weights").unwrap();

        let digest = compute_file_sha256(&file).unwrap();
        assert!(verify_file_sha256(&file, &digest).unwrap());
        assert!(!verify_file_sha256(&file, "0000000000000000").unwrap());

        let _ = fs::remove_dir_all(dir);
    }
}
