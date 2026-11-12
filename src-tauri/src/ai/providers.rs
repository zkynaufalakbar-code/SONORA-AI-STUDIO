use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

use crate::ai::models::{check_python_module, find_cli};
use crate::ai::secrets::get_api_key;
use crate::audio::spectral::AudioTelemetry;
use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::ffmpeg::locator::{new_hidden_command, probe_ffmpeg};
use crate::paths::RuntimePaths;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderStatus {
    pub id: String,
    pub name: String,
    pub kind: String, // "local" | "cloud"
    pub configured: bool,
    pub available: bool,
    pub status_label: String,
    pub details: String,
    pub model_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub speaker: Option<String>,
    pub confidence: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantActionStep {
    pub id: String,
    #[serde(rename = "type")]
    pub action_type: String,
    pub label: String,
    pub params: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantResponse {
    pub reply: String,
    pub provider_used: String,
    pub action_plan: Vec<AssistantActionStep>,
}

pub fn probe_ai_providers(paths: &RuntimePaths, db: &Database) -> AppResult<Vec<AiProviderStatus>> {
    let ff = probe_ffmpeg(&paths.exe_dir, None);
    let installed = db.list_installed_models()?;
    let has_rnnoise = installed.iter().any(|m| m.id == "rnnoise-std");
    let has_whisper_model = installed.iter().any(|m| m.id.starts_with("whisper-"));
    let has_whisper_rt = check_python_module("faster_whisper") || find_cli("whisper-cli") || find_cli("whisper");
    let has_demucs_rt = check_python_module("demucs") || find_cli("demucs");
    let has_df_rt = check_python_module("df") || find_cli("deepFilter");
    let has_openai = get_api_key(paths, "openai")?.is_some();
    let has_gemini = get_api_key(paths, "gemini")?.is_some();

    Ok(vec![
        AiProviderStatus {
            id: "local_ffmpeg".into(),
            name: "Local DSP & FFmpeg Engine".into(),
            kind: "local".into(),
            configured: ff.available,
            available: ff.available,
            status_label: if ff.available { "Ready (Offline)".into() } else { "FFmpeg Missing".into() },
            details: "FFT Noise Reduction (afftdn), Voice Clarity EQ/Comp/De-esser, Silence Detection & Offline Intent Planner.".into(),
            model_name: ff.version,
        },
        AiProviderStatus {
            id: "local_rnnoise".into(),
            name: "RNNoise Neural Suppressor".into(),
            kind: "local".into(),
            configured: has_rnnoise && ff.has_arnndn,
            available: has_rnnoise && ff.has_arnndn,
            status_label: if has_rnnoise && ff.has_arnndn { "Ready".into() } else { "Model Not Installed".into() },
            details: "Neural speech noise suppression via FFmpeg arnndn. Download 'rnnoise-std' in AI Model Manager.".into(),
            model_name: if has_rnnoise { Some("sh.rnnn".into()) } else { None },
        },
        AiProviderStatus {
            id: "local_whisper".into(),
            name: "Whisper Local Speech-to-Text".into(),
            kind: "local".into(),
            configured: has_whisper_rt && has_whisper_model,
            available: has_whisper_rt,
            status_label: if has_whisper_rt && has_whisper_model {
                "Ready".into()
            } else if has_whisper_rt {
                "Model Required".into()
            } else {
                "Runtime Not Installed".into()
            },
            details: "Offline transcription using faster-whisper or whisper-cli + downloaded Whisper model.".into(),
            model_name: installed.iter().find(|m| m.id.starts_with("whisper-")).map(|m| m.id.clone()),
        },
        AiProviderStatus {
            id: "local_demucs".into(),
            name: "Demucs Stem Separation".into(),
            kind: "local".into(),
            configured: has_demucs_rt,
            available: has_demucs_rt,
            status_label: if has_demucs_rt { "Ready".into() } else { "Runtime Not Installed".into() },
            details: "Separates vocals, instrumental, bass, and drums locally (requires Python 'demucs').".into(),
            model_name: if has_demucs_rt { Some("htdemucs".into()) } else { None },
        },
        AiProviderStatus {
            id: "local_deepfilternet".into(),
            name: "DeepFilterNet Voice Enhancement".into(),
            kind: "local".into(),
            configured: has_df_rt,
            available: has_df_rt,
            status_label: if has_df_rt { "Ready".into() } else { "Runtime Not Installed".into() },
            details: "Neural speech enhancement & dereverberation (requires Python 'deepfilternet').".into(),
            model_name: None,
        },
        AiProviderStatus {
            id: "openai".into(),
            name: "OpenAI API (Whisper + GPT)".into(),
            kind: "cloud".into(),
            configured: has_openai,
            available: true,
            status_label: if has_openai { "API Key Configured".into() } else { "API Key Required".into() },
            details: "Cloud speech transcription (whisper-1) and GPT audio editing assistant.".into(),
            model_name: Some("gpt-4o-mini / whisper-1".into()),
        },
        AiProviderStatus {
            id: "gemini".into(),
            name: "Google Gemini API".into(),
            kind: "cloud".into(),
            configured: has_gemini,
            available: true,
            status_label: if has_gemini { "API Key Configured".into() } else { "API Key Required".into() },
            details: "Multimodal Gemini audio transcription & smart audio engineering assistant.".into(),
            model_name: Some("gemini-2.5-flash".into()),
        },
    ])
}

pub async fn run_transcription(
    paths: &RuntimePaths,
    db: &Database,
    ffmpeg_path: &Path,
    audio_path: &Path,
    provider_id: &str,
    language: Option<String>,
) -> AppResult<Vec<TranscriptSegment>> {
    match provider_id {
        "openai" => {
            let api_key = get_api_key(paths, "openai")?.ok_or_else(|| {
                AppError::Ai("OpenAI API key is not configured in Settings.".into())
            })?;
            transcribe_openai(ffmpeg_path, &paths.cache_dir, audio_path, &api_key, language).await
        }
        "gemini" => {
            let api_key = get_api_key(paths, "gemini")?.ok_or_else(|| {
                AppError::Ai("Google Gemini API key is not configured in Settings.".into())
            })?;
            transcribe_gemini(ffmpeg_path, &paths.cache_dir, audio_path, &api_key, language).await
        }
        "local_whisper" => transcribe_local_whisper(paths, db, audio_path, language),
        _ => Err(AppError::Ai(format!("Unsupported transcription provider '{provider_id}'"))),
    }
}

fn prepare_compact_audio_for_api(ffmpeg_path: &Path, cache_dir: &Path, audio_path: &Path) -> AppResult<std::path::PathBuf> {
    let tmp = cache_dir.join(format!("stt_{}.mp3", uuid::Uuid::new_v4()));
    let out = new_hidden_command(ffmpeg_path)
        .args(["-y", "-v", "error", "-i"])
        .arg(audio_path)
        .args(["-ac", "1", "-ar", "16000", "-b:a", "64k"])
        .arg(&tmp)
        .output()
        .map_err(|e| AppError::Ffmpeg(format!("STT pre-encode failed: {e}")))?;
    if !out.status.success() {
        return Err(AppError::Ffmpeg(String::from_utf8_lossy(&out.stderr).to_string()));
    }
    Ok(tmp)
}

async fn transcribe_openai(
    ffmpeg_path: &Path,
    cache_dir: &Path,
    audio_path: &Path,
    api_key: &str,
    language: Option<String>,
) -> AppResult<Vec<TranscriptSegment>> {
    let tmp = prepare_compact_audio_for_api(ffmpeg_path, cache_dir, audio_path)?;
    let bytes = fs::read(&tmp)?;
    let _ = fs::remove_file(&tmp);

    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name("audio.mp3")
        .mime_str("audio/mpeg")
        .map_err(|e| AppError::Ai(e.to_string()))?;

    let mut form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", "whisper-1")
        .text("response_format", "verbose_json");
    if let Some(lang) = language.filter(|l| !l.trim().is_empty() && l != "auto") {
        form = form.text("language", lang);
    }

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.openai.com/v1/audio/transcriptions")
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| AppError::Ai(format!("OpenAI Whisper request failed: {e}")))?;

    if !resp.status().is_success() {
        let err_txt = resp.text().await.unwrap_or_default();
        return Err(AppError::Ai(format!("OpenAI Whisper error: {err_txt}")));
    }

    let val: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Ai(format!("Invalid JSON from OpenAI: {e}")))?;

    let mut segments = Vec::new();
    if let Some(arr) = val.get("segments").and_then(|s| s.as_array()) {
        for (i, s) in arr.iter().enumerate() {
            let start_ms = (s.get("start").and_then(|v| v.as_f64()).unwrap_or(0.0) * 1000.0).round() as u64;
            let end_ms = (s.get("end").and_then(|v| v.as_f64()).unwrap_or(0.0) * 1000.0).round() as u64;
            let text = s.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            if !text.is_empty() {
                segments.push(TranscriptSegment {
                    id: format!("seg_{i}"),
                    start_ms,
                    end_ms,
                    text,
                    speaker: None,
                    confidence: None,
                });
            }
        }
    } else if let Some(full) = val.get("text").and_then(|v| v.as_str()) {
        segments.push(TranscriptSegment {
            id: "seg_0".into(),
            start_ms: 0,
            end_ms: 1000,
            text: full.trim().to_string(),
            speaker: None,
            confidence: None,
        });
    }
    Ok(segments)
}

async fn transcribe_gemini(
    ffmpeg_path: &Path,
    cache_dir: &Path,
    audio_path: &Path,
    api_key: &str,
    language: Option<String>,
) -> AppResult<Vec<TranscriptSegment>> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let tmp = prepare_compact_audio_for_api(ffmpeg_path, cache_dir, audio_path)?;
    let bytes = fs::read(&tmp)?;
    let _ = fs::remove_file(&tmp);
    let b64 = B64.encode(bytes);

    let lang_hint = language.unwrap_or_else(|| "auto".into());
    let prompt = format!(
        "Transcribe this audio accurately with timestamps. Language hint: {lang_hint}. Return strictly a JSON array of objects with fields: startMs (integer), endMs (integer), text (string), speaker (optional string)."
    );

    let body = json!({
        "contents": [{
            "parts": [
                { "text": prompt },
                { "inline_data": { "mime_type": "audio/mp3", "data": b64 } }
            ]
        }],
        "generationConfig": { "response_mime_type": "application/json" }
    });

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Ai(format!("Gemini request failed: {e}")))?;

    if !resp.status().is_success() {
        let err_txt = resp.text().await.unwrap_or_default();
        return Err(AppError::Ai(format!("Gemini API error: {err_txt}")));
    }

    let val: Value = resp.json().await.map_err(|e| AppError::Ai(e.to_string()))?;
    let raw_text = val["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("[]");
    let arr: Vec<Value> = serde_json::from_str(raw_text).unwrap_or_default();
    let segments = arr
        .into_iter()
        .enumerate()
        .filter_map(|(i, item)| {
            let text = item.get("text")?.as_str()?.trim().to_string();
            if text.is_empty() {
                return None;
            }
            Some(TranscriptSegment {
                id: format!("seg_{i}"),
                start_ms: item.get("startMs").and_then(|v| v.as_u64()).unwrap_or(0),
                end_ms: item.get("endMs").and_then(|v| v.as_u64()).unwrap_or(1000),
                text,
                speaker: item.get("speaker").and_then(|v| v.as_str()).map(|s| s.to_string()),
                confidence: None,
            })
        })
        .collect();
    Ok(segments)
}

fn transcribe_local_whisper(
    paths: &RuntimePaths,
    db: &Database,
    audio_path: &Path,
    language: Option<String>,
) -> AppResult<Vec<TranscriptSegment>> {
    if check_python_module("faster_whisper") {
        let lang_arg = language.unwrap_or_else(|| "auto".into());
        let py_script = r#"
import sys, json
from faster_whisper import WhisperModel
audio_path, model_size, lang = sys.argv[1], sys.argv[2], sys.argv[3]
model = WhisperModel(model_size, device="cpu", compute_type="int8")
kw = {} if lang == "auto" else {"language": lang}
segs, _ = model.transcribe(audio_path, **kw)
out = []
for i, s in enumerate(segs):
    out.append({"id": f"seg_{i}", "startMs": int(round(s.start*1000)), "endMs": int(round(s.end*1000)), "text": s.text.strip()})
print(json.dumps(out))
"#;
        let out = new_hidden_command("python")
            .args([
                "-c",
                py_script,
                &audio_path.display().to_string(),
                "tiny",
                &lang_arg,
            ])
            .output()
            .map_err(|e| AppError::Ai(format!("Local faster-whisper execution failed: {e}")))?;

        if !out.status.success() {
            return Err(AppError::Ai(format!(
                "faster-whisper error: {}",
                String::from_utf8_lossy(&out.stderr)
            )));
        }
        let segs: Vec<TranscriptSegment> = serde_json::from_slice(&out.stdout)?;
        return Ok(segs);
    }

    // Fallback check for whisper-cli + downloaded GGML model
    let installed = db.list_installed_models()?;
    let model_rec = installed
        .into_iter()
        .find(|m| m.id.starts_with("whisper-"))
        .ok_or_else(|| {
            AppError::Ai(
                "Local Whisper requires either Python 'faster-whisper' or 'whisper-cli' + downloaded Whisper model in AI Model Manager.".into(),
            )
        })?;
    let model_path = paths.resolve_stored_path(&model_rec.local_path);
    if !find_cli("whisper-cli") {
        return Err(AppError::Ai(
            "Whisper model is downloaded, but neither 'faster-whisper' (Python) nor 'whisper-cli' binary was found on PATH.".into(),
        ));
    }

    let out_json_base = paths.cache_dir.join(format!("whisper_{}", uuid::Uuid::new_v4()));
    let out = new_hidden_command("whisper-cli")
        .args([
            "-m",
            &model_path.display().to_string(),
            "-f",
            &audio_path.display().to_string(),
            "-oj",
            "-of",
            &out_json_base.display().to_string(),
        ])
        .output()
        .map_err(|e| AppError::Ai(format!("whisper-cli error: {e}")))?;
    if !out.status.success() {
        return Err(AppError::Ai(String::from_utf8_lossy(&out.stderr).to_string()));
    }
    let json_path = out_json_base.with_extension("json");
    let raw = fs::read_to_string(&json_path)?;
    let _ = fs::remove_file(&json_path);
    let parsed: Value = serde_json::from_str(&raw)?;
    let mut segs = Vec::new();
    if let Some(arr) = parsed.get("transcription").and_then(|v| v.as_array()) {
        for (i, item) in arr.iter().enumerate() {
            let text = item.get("text").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let from_ms = item["offsets"]["from"].as_u64().unwrap_or(0);
            let to_ms = item["offsets"]["to"].as_u64().unwrap_or(from_ms + 500);
            if !text.is_empty() {
                segs.push(TranscriptSegment {
                    id: format!("seg_{i}"),
                    start_ms: from_ms,
                    end_ms: to_ms,
                    text,
                    speaker: None,
                    confidence: None,
                });
            }
        }
    }
    Ok(segs)
}

pub fn run_vocal_separation(
    paths: &RuntimePaths,
    audio_path: &Path,
    out_dir: &Path,
) -> AppResult<(String, String)> {
    if !check_python_module("demucs") && !find_cli("demucs") {
        return Err(AppError::Ai(
            "Local Demucs runtime is not installed. Install Python 'demucs' (`pip install demucs`) and verify in Settings -> AI Runtimes.".into(),
        ));
    }
    fs::create_dir_all(out_dir)?;
    let out = new_hidden_command("python")
        .args([
            "-m",
            "demucs",
            "--two-stems=vocals",
            "-o",
            &out_dir.display().to_string(),
            &audio_path.display().to_string(),
        ])
        .output()
        .map_err(|e| AppError::Ai(format!("Demucs launch failed: {e}")))?;

    if !out.status.success() {
        return Err(AppError::Ai(format!(
            "Demucs failed: {}",
            String::from_utf8_lossy(&out.stderr)
        )));
    }

    let stem_folder = audio_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("track");
    let vocals = out_dir.join("htdemucs").join(stem_folder).join("vocals.wav");
    let no_vocals = out_dir.join("htdemucs").join(stem_folder).join("no_vocals.wav");
    if !vocals.is_file() || !no_vocals.is_file() {
        let _ = paths;
        return Err(AppError::Ai("Demucs completed but expected stems were not found".into()));
    }
    Ok((vocals.display().to_string(), no_vocals.display().to_string()))
}

pub async fn run_ai_assistant(
    paths: &RuntimePaths,
    provider_id: &str,
    prompt: &str,
    telemetry: Option<AudioTelemetry>,
) -> AppResult<AssistantResponse> {
    if provider_id == "openai" {
        if let Some(key) = get_api_key(paths, "openai")? {
            if let Ok(resp) = ask_openai_assistant(&key, prompt, telemetry.as_ref()).await {
                return Ok(resp);
            }
        }
    } else if provider_id == "gemini" {
        if let Some(key) = get_api_key(paths, "gemini")? {
            if let Ok(resp) = ask_gemini_assistant(&key, prompt, telemetry.as_ref()).await {
                return Ok(resp);
            }
        }
    }

    // Honest local offline audio engineering planner
    Ok(local_offline_assistant_plan(prompt, telemetry.as_ref()))
}

fn local_offline_assistant_plan(prompt: &str, telemetry: Option<&AudioTelemetry>) -> AssistantResponse {
    let lower = prompt.to_lowercase();
    let mut plan: Vec<AssistantActionStep> = Vec::new();
    let mut notes: Vec<String> = Vec::new();

    if lower.contains("podcast") || lower.contains("wawancara") || lower.contains("interview") {
        notes.push("Applying Professional Podcast Mastering chain (80 Hz HPF, Mud Cut, Voice Presence, Compressor, De-esser, -16 LUFS).".into());
        plan.push(AssistantActionStep {
            id: uuid::Uuid::new_v4().to_string(),
            action_type: "voice_enhancement".into(),
            label: "Voice Clarity & Presence Chain".into(),
            params: json!({ "clarity": 0.72 }),
        });
        plan.push(AssistantActionStep {
            id: uuid::Uuid::new_v4().to_string(),
            action_type: "add_effect".into(),
            label: "Add Broadcast Compressor + De-Esser".into(),
            params: json!({
                "effects": [
                    { "type": "high_pass", "name": "High Pass 80Hz", "category": "equalizer", "params": { "freq": 80, "q": 0.707 } },
                    { "type": "compressor", "name": "Podcast Leveler", "category": "dynamics", "params": { "threshold": -20, "ratio": 3.5, "attack": 10, "release": 160, "makeup": 3, "knee": 5 } },
                    { "type": "de_esser", "name": "De-Esser", "category": "restoration", "params": { "freq": 6500, "threshold": -22, "intensity": 0.42 } }
                ]
            }),
        });
        plan.push(AssistantActionStep {
            id: uuid::Uuid::new_v4().to_string(),
            action_type: "normalize".into(),
            label: "Normalize to -16 LUFS (Podcast Standard)".into(),
            params: json!({ "targetLufs": -16 }),
        });
    } else if lower.contains("youtube") {
        notes.push("Optimizing audio for YouTube (-14 LUFS loudness, crisp presence boost, controlled dynamics).".into());
        plan.push(AssistantActionStep {
            id: uuid::Uuid::new_v4().to_string(),
            action_type: "voice_enhancement".into(),
            label: "YouTube Voice Presence".into(),
            params: json!({ "clarity": 0.8 }),
        });
        plan.push(AssistantActionStep {
            id: uuid::Uuid::new_v4().to_string(),
            action_type: "normalize".into(),
            label: "Loudness Normalize (-14 LUFS)".into(),
            params: json!({ "targetLufs": -14 }),
        });
    }

    if lower.contains("noise") || lower.contains("bersihkan") || lower.contains("kipas") || lower.contains("ac") || lower.contains("dengung") {
        let strength = telemetry
            .map(|t| if t.estimated_noise_floor_dbfs > -42.0 { 22 } else { 14 })
            .unwrap_or(16);
        notes.push(format!("Detected noise cleanup intent -> scheduling {strength} dB spectral noise removal."));
        plan.push(AssistantActionStep {
            id: uuid::Uuid::new_v4().to_string(),
            action_type: "noise_removal".into(),
            label: format!("AI / Spectral Noise Removal ({strength} dB)"),
            params: json!({ "strengthDb": strength }),
        });
    }

    if lower.contains("jernih") || lower.contains("jelas") || lower.contains("clarity") || lower.contains("vokal") {
        notes.push("Boosting vocal intelligibility (cut 240 Hz mud, +3 dB presence at 3.4 kHz).".into());
        plan.push(AssistantActionStep {
            id: uuid::Uuid::new_v4().to_string(),
            action_type: "voice_enhancement".into(),
            label: "Enhance Vocal Clarity".into(),
            params: json!({ "clarity": 0.7 }),
        });
    }

    if lower.contains("naikkan") || lower.contains("keras") || lower.contains("volume") || lower.contains("louder") {
        notes.push("Safely boosting audio loudness with peak protection.".into());
        plan.push(AssistantActionStep {
            id: uuid::Uuid::new_v4().to_string(),
            action_type: "normalize".into(),
            label: "Normalize Peak (-1.0 dBFS)".into(),
            params: json!({ "targetDb": -1.0 }),
        });
    }

    if lower.contains("bass") || lower.contains("low") || lower.contains("gemuruh") {
        notes.push("Reducing low-end rumble and excessive bass below 120 Hz.".into());
        plan.push(AssistantActionStep {
            id: uuid::Uuid::new_v4().to_string(),
            action_type: "add_effect".into(),
            label: "Reduce Bass (Low Shelf -5 dB + HPF 90 Hz)".into(),
            params: json!({
                "effects": [
                    { "type": "high_pass", "name": "HPF 90Hz", "category": "equalizer", "params": { "freq": 90, "q": 0.707 } },
                    { "type": "low_shelf", "name": "Bass Cut -5dB", "category": "equalizer", "params": { "freq": 140, "gain": -5.0 } }
                ]
            }),
        });
    }

    if lower.contains("jeda") || lower.contains("silence") || lower.contains("kosong") || lower.contains("pause") {
        notes.push("Scanning for silent pauses below -42 dB (> 450 ms) for automatic trimming.".into());
        plan.push(AssistantActionStep {
            id: uuid::Uuid::new_v4().to_string(),
            action_type: "silence_removal".into(),
            label: "Auto-Remove Silent Pauses (-42 dB / 450 ms)".into(),
            params: json!({ "thresholdDb": -42, "minDurationMs": 450 }),
        });
    }

    if plan.is_empty() {
        if let Some(t) = telemetry {
            notes.push(format!(
                "Audio Telemetry: Peak {:.1} dBFS, RMS {:.1} dBFS, Noise Floor {:.1} dBFS, Silence {:.0}%.",
                t.peak_dbfs,
                t.rms_dbfs,
                t.estimated_noise_floor_dbfs,
                t.silence_ratio * 100.0
            ));
            if t.estimated_noise_floor_dbfs > -48.0 {
                plan.push(AssistantActionStep {
                    id: uuid::Uuid::new_v4().to_string(),
                    action_type: "noise_removal".into(),
                    label: "Recommended: Background Noise Cleanup".into(),
                    params: json!({ "strengthDb": 16 }),
                });
            }
            if t.rms_dbfs < -22.0 {
                plan.push(AssistantActionStep {
                    id: uuid::Uuid::new_v4().to_string(),
                    action_type: "normalize".into(),
                    label: "Recommended: Normalize to -16 LUFS".into(),
                    params: json!({ "targetLufs": -16 }),
                });
            }
        }
        if plan.is_empty() {
            notes.push("Tell me what you want to achieve (e.g., 'Bersihkan noise audio ini', 'Buat suara seperti podcast profesional', 'Hilangkan jeda panjang', 'Kurangi bass').".into());
        }
    }

    AssistantResponse {
        reply: notes.join(" "),
        provider_used: "Local Offline Intent Engine".into(),
        action_plan: plan,
    }
}

async fn ask_openai_assistant(
    api_key: &str,
    prompt: &str,
    telemetry: Option<&AudioTelemetry>,
) -> AppResult<AssistantResponse> {
    let sys = "You are SONORA AI Audio Engineer. Translate user requests and audio telemetry into JSON: {\"reply\": string, \"actionPlan\": [{\"type\": \"noise_removal\"|\"voice_enhancement\"|\"silence_removal\"|\"normalize\"|\"amplify\"|\"add_effect\", \"label\": string, \"params\": object}]}.";
    let user_msg = format!(
        "Audio telemetry: {}\nUser request: {}",
        serde_json::to_string(&telemetry).unwrap_or_else(|_| "none".into()),
        prompt
    );

    let body = json!({
        "model": "gpt-4o-mini",
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": sys },
            { "role": "user", "content": user_msg }
        ]
    });

    let resp = reqwest::Client::new()
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Ai(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(AppError::Ai("OpenAI API failed".into()));
    }

    let val: Value = resp.json().await.map_err(|e| AppError::Ai(e.to_string()))?;
    let content = val["choices"][0]["message"]["content"].as_str().unwrap_or("{}");
    let parsed: Value = serde_json::from_str(content).unwrap_or_default();
    let reply = parsed["reply"].as_str().unwrap_or("Ready to process.").to_string();
    let steps: Vec<AssistantActionStep> = parsed["actionPlan"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|item| AssistantActionStep {
                    id: uuid::Uuid::new_v4().to_string(),
                    action_type: item["type"].as_str().unwrap_or("normalize").to_string(),
                    label: item["label"].as_str().unwrap_or("Audio Process").to_string(),
                    params: item["params"].clone(),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(AssistantResponse {
        reply,
        provider_used: "OpenAI GPT-4o-mini".into(),
        action_plan: steps,
    })
}

async fn ask_gemini_assistant(
    api_key: &str,
    prompt: &str,
    telemetry: Option<&AudioTelemetry>,
) -> AppResult<AssistantResponse> {
    let sys = "You are SONORA AI Audio Engineer. Return strictly JSON: {\"reply\": string, \"actionPlan\": [{\"type\": \"noise_removal\"|\"voice_enhancement\"|\"silence_removal\"|\"normalize\"|\"amplify\"|\"add_effect\", \"label\": string, \"params\": object}]}.";
    let user_msg = format!(
        "{sys}\nAudio telemetry: {}\nUser request: {}",
        serde_json::to_string(&telemetry).unwrap_or_else(|_| "none".into()),
        prompt
    );

    let body = json!({
        "contents": [{ "parts": [{ "text": user_msg }] }],
        "generationConfig": { "response_mime_type": "application/json" }
    });
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}"
    );
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Ai(e.to_string()))?;

    if !resp.status().is_success() {
        return Err(AppError::Ai("Gemini API failed".into()));
    }
    let val: Value = resp.json().await.map_err(|e| AppError::Ai(e.to_string()))?;
    let content = val["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .unwrap_or("{}");
    let parsed: Value = serde_json::from_str(content).unwrap_or_default();
    let reply = parsed["reply"].as_str().unwrap_or("Ready to process.").to_string();
    let steps: Vec<AssistantActionStep> = parsed["actionPlan"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|item| AssistantActionStep {
                    id: uuid::Uuid::new_v4().to_string(),
                    action_type: item["type"].as_str().unwrap_or("normalize").to_string(),
                    label: item["label"].as_str().unwrap_or("Audio Process").to_string(),
                    params: item["params"].clone(),
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(AssistantResponse {
        reply,
        provider_used: "Google Gemini 2.5 Flash".into(),
        action_plan: steps,
    })
}
