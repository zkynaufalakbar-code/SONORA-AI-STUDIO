pub mod ai;
pub mod audio;
pub mod db;
pub mod error;
pub mod ffmpeg;
pub mod paths;
pub mod updater;

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::ipc::{Channel, Response};
use tauri::utils::config::Color;
use tauri::{State, WebviewUrl, WebviewWindowBuilder};

use crate::ai::models::{AiModelEntry, ModelDownloadProgress, ModelManager};
use crate::ai::providers::{
    probe_ai_providers, run_ai_assistant, run_transcription, run_vocal_separation,
    AiProviderStatus, AssistantResponse, TranscriptSegment,
};
use crate::ai::secrets::{delete_api_key, save_api_key};
use crate::audio::peaks::{
    generate_peak_pyramid, read_pcm_chunk, read_waveform_window, WaveformWindow,
};
use crate::audio::probe::probe_audio_file;
use crate::audio::recorder::{
    AudioDeviceInfo, RecorderManager, RecordingFinishedInfo, RecordingTelemetry,
};
use crate::audio::spectral::{
    align_clips_cross_corr, analyze_audio_and_silence, compute_spectrogram_tile, AudioTelemetry,
    SilenceInterval, SpectrogramTile,
};
use crate::db::{AutosaveRow, Database, PresetRow, RecentProjectRow};
use crate::error::{AppError, AppResult};
use crate::ffmpeg::filtergraph::{
    export_project_mixdown, process_clip_transform, ClipTransformOp, ExportProgressEvent,
    ExportRequest,
};
use crate::ffmpeg::locator::{locate_binary, probe_ffmpeg};
use crate::paths::{DistributionMode, RuntimePaths};
use crate::updater::{
    backup_portable_config, check_for_updates, safe_apply_portable_zip, UpdateCheckResult,
};

pub struct AppState {
    pub paths: Mutex<RuntimePaths>,
    pub db: Database,
    pub recorder: RecorderManager,
    pub models: ModelManager,
    pub startup_file: Mutex<Option<String>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemDiagnosticReport {
    pub mode: DistributionMode,
    pub paths: RuntimePaths,
    pub ffmpeg_available: bool,
    pub ffmpeg_path: Option<String>,
    pub ffmpeg_version: Option<String>,
    pub has_rubberband: bool,
    pub has_afftdn: bool,
    pub has_arnndn: bool,
    pub has_loudnorm: bool,
    pub audio_input_devices: usize,
    pub audio_output_devices: usize,
    pub python_available: bool,
    pub python_path: Option<String>,
    pub installed_model_count: usize,
    pub first_launch_completed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedMediaResponse {
    pub id: String,
    pub name: String,
    pub original_path: String,
    pub stored_path: String,
    pub resolved_path: String,
    pub duration_ms: u64,
    pub sample_rate: u32,
    pub channels: u32,
    pub bit_depth: u32,
    pub codec: String,
    pub bitrate: u64,
    pub file_size_bytes: u64,
    pub peak_file_path: String,
    pub peak_dbfs: f64,
    pub rms_dbfs: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SilenceAnalysisResponse {
    pub intervals: Vec<SilenceInterval>,
    pub telemetry: AudioTelemetry,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VocalSeparationResponse {
    pub vocals_path: String,
    pub instrumental_path: String,
}

fn get_ffmpeg_bins(state: &AppState) -> AppResult<(PathBuf, PathBuf, bool)> {
    let paths = state.paths.lock().expect("paths lock").clone();
    let custom = state
        .db
        .get_setting("ffmpeg_path")?
        .and_then(|s| serde_json::from_str::<String>(&s).ok());
    let caps = probe_ffmpeg(&paths.exe_dir, custom.as_deref());
    let ffmpeg = caps
        .ffmpeg_path
        .map(PathBuf::from)
        .ok_or_else(|| AppError::Ffmpeg("FFmpeg executable not found".into()))?;
    let ffprobe = caps
        .ffprobe_path
        .map(PathBuf::from)
        .or_else(|| locate_binary(&paths.exe_dir, custom.as_deref(), "ffprobe"))
        .ok_or_else(|| AppError::Ffmpeg("FFprobe executable not found".into()))?;
    Ok((ffmpeg, ffprobe, caps.has_rubberband))
}

#[tauri::command]
fn get_system_diagnostics(state: State<'_, AppState>) -> AppResult<SystemDiagnosticReport> {
    let paths = state.paths.lock().expect("paths lock").clone();
    let custom_ff = state
        .db
        .get_setting("ffmpeg_path")?
        .and_then(|s| serde_json::from_str::<String>(&s).ok());
    let ff = probe_ffmpeg(&paths.exe_dir, custom_ff.as_deref());
    let devices = state.recorder.list_devices().unwrap_or_default();
    let in_count = devices.iter().filter(|d| d.kind == "input").count();
    let out_count = devices.iter().filter(|d| d.kind == "output").count();

    let py_path = locate_binary(&paths.exe_dir, None, "python");
    let installed_count = state.db.list_installed_models()?.len();
    let first_done = state
        .db
        .get_setting("first_launch_completed")?
        .and_then(|s| serde_json::from_str::<bool>(&s).ok())
        .unwrap_or(false);

    Ok(SystemDiagnosticReport {
        mode: paths.mode,
        paths,
        ffmpeg_available: ff.available,
        ffmpeg_path: ff.ffmpeg_path,
        ffmpeg_version: ff.version,
        has_rubberband: ff.has_rubberband,
        has_afftdn: ff.has_afftdn,
        has_arnndn: ff.has_arnndn,
        has_loudnorm: ff.has_loudnorm,
        audio_input_devices: in_count,
        audio_output_devices: out_count,
        python_available: py_path.is_some(),
        python_path: py_path.map(|p| p.display().to_string()),
        installed_model_count: installed_count,
        first_launch_completed: first_done,
    })
}

#[tauri::command]
fn complete_first_launch(state: State<'_, AppState>) -> AppResult<()> {
    state.db.set_setting("first_launch_completed", "true")
}

#[tauri::command]
fn set_custom_models_dir(state: State<'_, AppState>, dir_path: String) -> AppResult<RuntimePaths> {
    let mut guard = state.paths.lock().expect("paths lock");
    guard.save_custom_models_dir(&dir_path)?;
    Ok(guard.clone())
}

#[tauri::command]
async fn import_audio_file(
    state: State<'_, AppState>,
    file_path: String,
    project_media_dir: Option<String>,
) -> AppResult<ImportedMediaResponse> {
    let (ffmpeg, ffprobe, _) = get_ffmpeg_bins(&state)?;
    let paths = state.paths.lock().expect("paths lock").clone();

    let src = paths.resolve_stored_path(&file_path);
    let info = tokio::task::spawn_blocking(move || probe_audio_file(&ffprobe, &src))
        .await
        .map_err(|e| AppError::Invalid(e.to_string()))??;

    let src_resolved = paths.resolve_stored_path(&file_path);
    let peak_path = paths
        .cache_dir
        .join("peaks")
        .join(format!("{}.peaks", info.file_hash));

    let peak_stats = if peak_path.is_file() {
        crate::audio::peaks::PeakStats {
            peak_dbfs: -1.0,
            rms_dbfs: -18.0,
            total_frames: (info.duration_ms * info.sample_rate as u64) / 1000,
        }
    } else {
        let src_c = src_resolved.clone();
        let pk_c = peak_path.clone();
        let sr = info.sample_rate;
        let ch = info.channels;
        tokio::task::spawn_blocking(move || generate_peak_pyramid(&ffmpeg, &src_c, &pk_c, sr, ch))
            .await
            .map_err(|e| AppError::Invalid(e.to_string()))??
    };

    let _ = project_media_dir;
    let file_name = src_resolved
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("audio")
        .to_string();

    Ok(ImportedMediaResponse {
        id: uuid::Uuid::new_v4().to_string(),
        name: file_name,
        original_path: src_resolved.display().to_string(),
        stored_path: paths.to_stored_path(&src_resolved),
        resolved_path: src_resolved.display().to_string(),
        duration_ms: info.duration_ms,
        sample_rate: info.sample_rate,
        channels: info.channels,
        bit_depth: info.bit_depth,
        codec: info.codec,
        bitrate: info.bitrate,
        file_size_bytes: info.file_size_bytes,
        peak_file_path: paths.to_stored_path(&peak_path),
        peak_dbfs: peak_stats.peak_dbfs,
        rms_dbfs: peak_stats.rms_dbfs,
    })
}

#[tauri::command]
fn get_waveform_window(
    state: State<'_, AppState>,
    peak_file_path: String,
    start_ms: u64,
    end_ms: u64,
    target_bins: usize,
) -> AppResult<WaveformWindow> {
    let paths = state.paths.lock().expect("paths lock").clone();
    let resolved = paths.resolve_stored_path(&peak_file_path);
    read_waveform_window(&resolved, start_ms, end_ms, target_bins)
}

#[tauri::command]
async fn get_pcm_chunk(
    state: State<'_, AppState>,
    file_path: String,
    start_ms: u64,
    duration_ms: u64,
    sample_rate: u32,
    channels: u32,
) -> AppResult<Response> {
    let (ffmpeg, _, _) = get_ffmpeg_bins(&state)?;
    let paths = state.paths.lock().expect("paths lock").clone();
    let resolved = paths.resolve_stored_path(&file_path);
    let bytes = tokio::task::spawn_blocking(move || {
        read_pcm_chunk(&ffmpeg, &resolved, start_ms, duration_ms, sample_rate, channels)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))??;
    Ok(Response::new(bytes))
}

#[tauri::command]
async fn compute_spectrogram(
    state: State<'_, AppState>,
    file_path: String,
    start_ms: u64,
    duration_ms: u64,
    width: usize,
    height: usize,
) -> AppResult<SpectrogramTile> {
    let (ffmpeg, _, _) = get_ffmpeg_bins(&state)?;
    let paths = state.paths.lock().expect("paths lock").clone();
    let resolved = paths.resolve_stored_path(&file_path);
    tokio::task::spawn_blocking(move || {
        compute_spectrogram_tile(&ffmpeg, &resolved, start_ms, duration_ms, width, height)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))?
}

#[tauri::command]
async fn align_clips(
    state: State<'_, AppState>,
    ref_path: String,
    ref_start_ms: u64,
    target_path: String,
    target_start_ms: u64,
    window_ms: u64,
) -> AppResult<i64> {
    let (ffmpeg, _, _) = get_ffmpeg_bins(&state)?;
    let paths = state.paths.lock().expect("paths lock").clone();
    let r_p = paths.resolve_stored_path(&ref_path);
    let t_p = paths.resolve_stored_path(&target_path);
    tokio::task::spawn_blocking(move || {
        align_clips_cross_corr(&ffmpeg, &r_p, ref_start_ms, &t_p, target_start_ms, window_ms)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))?
}

#[tauri::command]
async fn analyze_silence_and_telemetry(
    state: State<'_, AppState>,
    file_path: String,
    threshold_db: f64,
    min_silence_ms: u64,
) -> AppResult<SilenceAnalysisResponse> {
    let (ffmpeg, _, _) = get_ffmpeg_bins(&state)?;
    let paths = state.paths.lock().expect("paths lock").clone();
    let resolved = paths.resolve_stored_path(&file_path);
    let (intervals, telemetry) = tokio::task::spawn_blocking(move || {
        analyze_audio_and_silence(&ffmpeg, &resolved, threshold_db, min_silence_ms)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))??;
    Ok(SilenceAnalysisResponse {
        intervals,
        telemetry,
    })
}

#[tauri::command]
async fn transform_clip_audio(
    state: State<'_, AppState>,
    source_path: String,
    op: ClipTransformOp,
    render_name: Option<String>,
) -> AppResult<ImportedMediaResponse> {
    let (ffmpeg, ffprobe, has_rb) = get_ffmpeg_bins(&state)?;
    let paths = state.paths.lock().expect("paths lock").clone();
    let resolved_src = paths.resolve_stored_path(&source_path);
    let render_dir = paths.cache_dir.join("renders");
    fs::create_dir_all(&render_dir)?;
    let out_file = render_dir.join(format!("render_{}.wav", uuid::Uuid::new_v4()));

    // Check if RNNoise model is installed for NoiseRemoval
    let rnnoise_path = state
        .db
        .list_installed_models()?
        .into_iter()
        .find(|m| m.id == "rnnoise-std")
        .map(|m| paths.resolve_stored_path(&m.local_path).display().to_string());

    let final_op = match op {
        ClipTransformOp::NoiseRemoval { strength_db, .. } => ClipTransformOp::NoiseRemoval {
            strength_db,
            rnnoise_model: rnnoise_path,
        },
        other => other,
    };

    let ff_c = ffmpeg.clone();
    let src_c = resolved_src.clone();
    let out_c = out_file.clone();
    tokio::task::spawn_blocking(move || {
        process_clip_transform(&ff_c, has_rb, &src_c, &out_c, final_op)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))??;

    let info = tokio::task::spawn_blocking({
        let fp = ffprobe.clone();
        let oc = out_file.clone();
        move || probe_audio_file(&fp, &oc)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))??;

    let peak_path = paths
        .cache_dir
        .join("peaks")
        .join(format!("{}.peaks", info.file_hash));
    let stats = tokio::task::spawn_blocking({
        let ff = ffmpeg.clone();
        let oc = out_file.clone();
        let pk = peak_path.clone();
        let sr = info.sample_rate;
        let ch = info.channels;
        move || generate_peak_pyramid(&ff, &oc, &pk, sr, ch)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))??;

    let display_name = render_name.unwrap_or_else(|| {
        resolved_src
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("processed.wav")
            .to_string()
    });

    Ok(ImportedMediaResponse {
        id: uuid::Uuid::new_v4().to_string(),
        name: display_name,
        original_path: out_file.display().to_string(),
        stored_path: paths.to_stored_path(&out_file),
        resolved_path: out_file.display().to_string(),
        duration_ms: info.duration_ms,
        sample_rate: info.sample_rate,
        channels: info.channels,
        bit_depth: info.bit_depth,
        codec: info.codec,
        bitrate: info.bitrate,
        file_size_bytes: info.file_size_bytes,
        peak_file_path: paths.to_stored_path(&peak_path),
        peak_dbfs: stats.peak_dbfs,
        rms_dbfs: stats.rms_dbfs,
    })
}

#[tauri::command]
async fn export_project(
    state: State<'_, AppState>,
    mut request: ExportRequest,
    on_progress: Channel<ExportProgressEvent>,
) -> AppResult<Vec<String>> {
    let (ffmpeg, _, has_rb) = get_ffmpeg_bins(&state)?;
    let paths = state.paths.lock().expect("paths lock").clone();

    // Resolve all stored clip paths at runtime
    for track in &mut request.tracks {
        for clip in &mut track.clips {
            clip.source_path = paths.resolve_stored_path(&clip.source_path).display().to_string();
        }
    }
    request.output_path = paths.resolve_stored_path(&request.output_path).display().to_string();
    let temp_dir = paths.cache_dir.join("export_tmp");

    tokio::task::spawn_blocking(move || {
        export_project_mixdown(&ffmpeg, has_rb, &temp_dir, &request, &on_progress)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))?
}

#[tauri::command]
fn list_audio_devices(state: State<'_, AppState>) -> AppResult<Vec<AudioDeviceInfo>> {
    state.recorder.list_devices()
}

#[tauri::command]
fn start_recording(
    state: State<'_, AppState>,
    device_name: Option<String>,
    channels: u16,
    sample_rate: u32,
    bit_depth: u16,
    input_gain_db: f32,
    monitor_enabled: bool,
    file_name: Option<String>,
    on_telemetry: Channel<RecordingTelemetry>,
) -> AppResult<String> {
    let paths = state.paths.lock().expect("paths lock").clone();
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let fname = file_name.unwrap_or_else(|| format!("recording_{ts}.wav"));
    let out_path = paths.projects_dir.join("Recordings").join(fname);
    state.recorder.start_recording(
        device_name,
        channels,
        sample_rate,
        bit_depth,
        input_gain_db,
        monitor_enabled,
        out_path.clone(),
        on_telemetry,
    )?;
    Ok(out_path.display().to_string())
}

#[tauri::command]
fn pause_recording(state: State<'_, AppState>, paused: bool) -> AppResult<()> {
    state.recorder.set_paused(paused)
}

#[tauri::command]
fn set_recording_gain(state: State<'_, AppState>, gain_db: f32) -> AppResult<()> {
    state.recorder.set_input_gain(gain_db)
}

#[tauri::command]
fn stop_recording(state: State<'_, AppState>) -> AppResult<RecordingFinishedInfo> {
    state.recorder.stop_recording()
}

#[tauri::command]
fn save_project_file(
    state: State<'_, AppState>,
    project_id: String,
    project_name: String,
    file_path: Option<String>,
    duration_ms: i64,
    mut manifest: Value,
) -> AppResult<String> {
    let paths = state.paths.lock().expect("paths lock").clone();
    let target_path = if let Some(fp) = file_path.filter(|s| !s.trim().is_empty()) {
        paths.resolve_stored_path(&fp)
    } else {
        let safe: String = project_name
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' { c } else { '_' })
            .collect();
        paths.projects_dir.join(format!("{safe}.sonora"))
    };

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)?;
    }

    // Rewrite asset storedPaths cleanly for portable cross-drive safety
    if let Some(assets_obj) = manifest.get_mut("assets").and_then(|a| a.as_object_mut()) {
        for (_, asset) in assets_obj.iter_mut() {
            if let Some(resolved) = asset.get("resolvedPath").and_then(|v| v.as_str()).map(str::to_string) {
                let stored = paths.to_stored_path(Path::new(&resolved));
                if let Some(obj) = asset.as_object_mut() {
                    obj.insert("storedPath".into(), Value::String(stored));
                }
            }
        }
    }
    let stored_proj = paths.to_stored_path(&target_path);
    if let Some(obj) = manifest.as_object_mut() {
        obj.insert("projectPath".into(), Value::String(stored_proj.clone()));
    }

    fs::write(&target_path, serde_json::to_string_pretty(&manifest)?)?;
    state
        .db
        .upsert_recent_project(&project_id, &project_name, &stored_proj, duration_ms)?;
    state.db.clear_autosave(&project_id)?;

    Ok(target_path.display().to_string())
}

#[tauri::command]
fn load_project_file(state: State<'_, AppState>, file_path: String) -> AppResult<Value> {
    let paths = state.paths.lock().expect("paths lock").clone();
    let resolved = paths.resolve_stored_path(&file_path);
    let raw = fs::read_to_string(&resolved)?;
    let mut manifest: Value = serde_json::from_str(&raw)?;

    if let Some(assets_obj) = manifest.get_mut("assets").and_then(|a| a.as_object_mut()) {
        for (_, asset) in assets_obj.iter_mut() {
            let stored = asset
                .get("storedPath")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            if let Some(st) = stored {
                let live = paths.resolve_stored_path(&st).display().to_string();
                if let Some(obj) = asset.as_object_mut() {
                    obj.insert("resolvedPath".into(), Value::String(live));
                }
            }
            if let Some(pk) = asset.get("peakFilePath").and_then(|v| v.as_str()).map(str::to_string) {
                let live_pk = paths.resolve_stored_path(&pk).display().to_string();
                if let Some(obj) = asset.as_object_mut() {
                    obj.insert("peakFilePath".into(), Value::String(live_pk));
                }
            }
        }
    }
    if let Some(obj) = manifest.as_object_mut() {
        obj.insert(
            "projectPath".into(),
            Value::String(resolved.display().to_string()),
        );
    }

    Ok(manifest)
}

#[tauri::command]
fn list_recent_projects(state: State<'_, AppState>) -> AppResult<Vec<RecentProjectRow>> {
    let paths = state.paths.lock().expect("paths lock").clone();
    let mut rows = state.db.list_recent_projects()?;
    for r in &mut rows {
        r.project_path = paths.resolve_stored_path(&r.project_path).display().to_string();
    }
    Ok(rows)
}

#[tauri::command]
fn save_autosave(
    state: State<'_, AppState>,
    project_id: String,
    name: String,
    snapshot_json: String,
) -> AppResult<()> {
    state.db.save_autosave(&project_id, &name, &snapshot_json)
}

#[tauri::command]
fn get_latest_autosave(state: State<'_, AppState>) -> AppResult<Option<AutosaveRow>> {
    state.db.get_latest_autosave()
}

#[tauri::command]
fn clear_autosave(state: State<'_, AppState>, project_id: String) -> AppResult<()> {
    state.db.clear_autosave(&project_id)
}

#[tauri::command]
fn list_presets(state: State<'_, AppState>) -> AppResult<Vec<PresetRow>> {
    state.db.list_presets()
}

#[tauri::command]
fn save_preset(
    state: State<'_, AppState>,
    id: String,
    effect_type: String,
    name: String,
    category: String,
    params_json: String,
) -> AppResult<()> {
    state
        .db
        .save_preset(&id, &effect_type, &name, &category, &params_json)
}

#[tauri::command]
fn delete_preset(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.db.delete_preset(&id)
}

#[tauri::command]
fn get_app_setting(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    state.db.get_setting(&key)
}

#[tauri::command]
fn set_app_setting(state: State<'_, AppState>, key: String, value_json: String) -> AppResult<()> {
    state.db.set_setting(&key, &value_json)
}

#[tauri::command]
fn clear_audio_cache(state: State<'_, AppState>) -> AppResult<u64> {
    let paths = state.paths.lock().expect("paths lock").clone();
    let mut freed = 0u64;
    for sub in ["peaks", "renders", "export_tmp"] {
        let dir = paths.cache_dir.join(sub);
        if dir.is_dir() {
            for entry in fs::read_dir(&dir)? {
                if let Ok(e) = entry {
                    if let Ok(m) = e.metadata() {
                        freed += m.len();
                    }
                    let _ = fs::remove_file(e.path());
                }
            }
        }
    }
    Ok(freed)
}

#[tauri::command]
fn list_ai_models(state: State<'_, AppState>) -> AppResult<Vec<AiModelEntry>> {
    let paths = state.paths.lock().expect("paths lock").clone();
    state.models.list_models(&paths, &state.db)
}

#[tauri::command]
async fn download_ai_model(
    state: State<'_, AppState>,
    model_id: String,
    on_progress: Channel<ModelDownloadProgress>,
) -> AppResult<AiModelEntry> {
    let paths = state.paths.lock().expect("paths lock").clone();
    state
        .models
        .download_model(&paths, &state.db, &model_id, on_progress)
        .await
}

#[tauri::command]
fn cancel_ai_model_download(state: State<'_, AppState>, model_id: String) {
    state.models.cancel_download(&model_id);
}

#[tauri::command]
fn remove_ai_model(state: State<'_, AppState>, model_id: String) -> AppResult<()> {
    let paths = state.paths.lock().expect("paths lock").clone();
    state.models.remove_model(&paths, &state.db, &model_id)
}

#[tauri::command]
fn verify_ai_model(state: State<'_, AppState>, model_id: String) -> AppResult<bool> {
    let paths = state.paths.lock().expect("paths lock").clone();
    state.models.verify_model(&paths, &state.db, &model_id)
}

#[tauri::command]
fn probe_ai_providers_cmd(state: State<'_, AppState>) -> AppResult<Vec<AiProviderStatus>> {
    let paths = state.paths.lock().expect("paths lock").clone();
    probe_ai_providers(&paths, &state.db)
}

#[tauri::command]
fn save_provider_api_key(
    state: State<'_, AppState>,
    provider_id: String,
    api_key: String,
) -> AppResult<()> {
    let paths = state.paths.lock().expect("paths lock").clone();
    save_api_key(&paths, &provider_id, &api_key)
}

#[tauri::command]
fn delete_provider_api_key(state: State<'_, AppState>, provider_id: String) -> AppResult<()> {
    let paths = state.paths.lock().expect("paths lock").clone();
    delete_api_key(&paths, &provider_id)
}

#[tauri::command]
async fn transcribe_audio(
    state: State<'_, AppState>,
    file_path: String,
    provider_id: String,
    language: Option<String>,
) -> AppResult<Vec<TranscriptSegment>> {
    let (ffmpeg, _, _) = get_ffmpeg_bins(&state)?;
    let paths = state.paths.lock().expect("paths lock").clone();
    let resolved = paths.resolve_stored_path(&file_path);
    run_transcription(&paths, &state.db, &ffmpeg, &resolved, &provider_id, language).await
}

#[tauri::command]
async fn separate_vocals(
    state: State<'_, AppState>,
    file_path: String,
) -> AppResult<VocalSeparationResponse> {
    let paths = state.paths.lock().expect("paths lock").clone();
    let resolved = paths.resolve_stored_path(&file_path);
    let out_dir = paths.cache_dir.join("stems");
    let (vocals_path, instrumental_path) = tokio::task::spawn_blocking(move || {
        run_vocal_separation(&paths, &resolved, &out_dir)
    })
    .await
    .map_err(|e| AppError::Invalid(e.to_string()))??;
    Ok(VocalSeparationResponse {
        vocals_path,
        instrumental_path,
    })
}

#[tauri::command]
async fn ask_ai_assistant(
    state: State<'_, AppState>,
    provider_id: String,
    prompt: String,
    telemetry: Option<AudioTelemetry>,
) -> AppResult<AssistantResponse> {
    let paths = state.paths.lock().expect("paths lock").clone();
    run_ai_assistant(&paths, &provider_id, &prompt, telemetry).await
}

#[tauri::command]
async fn check_app_updates(
    state: State<'_, AppState>,
    manifest_url: Option<String>,
) -> AppResult<UpdateCheckResult> {
    let paths = state.paths.lock().expect("paths lock").clone();
    check_for_updates(&paths, manifest_url).await
}

#[tauri::command]
fn backup_portable_config_cmd(state: State<'_, AppState>) -> AppResult<String> {
    let paths = state.paths.lock().expect("paths lock").clone();
    backup_portable_config(&paths)
}

#[tauri::command]
fn apply_portable_update_cmd(state: State<'_, AppState>, zip_path: String) -> AppResult<String> {
    let paths = state.paths.lock().expect("paths lock").clone();
    safe_apply_portable_zip(&paths, Path::new(&zip_path))
}

#[tauri::command]
fn get_startup_file(state: State<'_, AppState>) -> Option<String> {
    state.startup_file.lock().ok().and_then(|mut g| g.take())
}

fn show_fatal_startup_dialog(msg: &str) {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        let text: Vec<u16> = OsStr::new(msg).encode_wide().chain(std::iter::once(0)).collect();
        let cap: Vec<u16> = OsStr::new("SONORA AI STUDIO - Startup Error")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            MessageBoxW(std::ptr::null_mut(), text.as_ptr(), cap.as_ptr(), MB_OK | MB_ICONERROR);
        }
    }
    #[cfg(not(windows))]
    {
        eprintln!("{msg}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = match RuntimePaths::initialize() {
        Ok(p) => p,
        Err(e) => {
            show_fatal_startup_dialog(&format!("{e}"));
            std::process::exit(1);
        }
    };

    paths.append_log(
        "INFO",
        &format!("Starting SONORA AI STUDIO in {:?} mode", paths.mode),
    );

    let db = match Database::open(&paths.db_path) {
        Ok(d) => d,
        Err(e) => {
            show_fatal_startup_dialog(&format!("Failed to initialize SQLite database: {e}"));
            std::process::exit(1);
        }
    };

    let wv_data_dir = paths.cache_dir.join("webview2");
    let is_portable = paths.mode == DistributionMode::Portable;

    let startup_arg = std::env::args_os()
        .skip(1)
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .map(|p| p.display().to_string());

    let app_state = AppState {
        paths: Mutex::new(paths),
        db,
        recorder: RecorderManager::new(),
        models: ModelManager::new(),
        startup_file: Mutex::new(startup_arg),
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .setup(move |app| {
            let mut win_builder =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("SONORA AI STUDIO")
                    .inner_size(1440.0, 900.0)
                    .min_inner_size(1024.0, 680.0)
                    .background_color(Color(11, 13, 17, 255));

            // Guarantee Portable Edition never writes WebView2 EBWebView cache into AppData
            if is_portable {
                win_builder = win_builder.data_directory(wv_data_dir.clone());
            }

            win_builder.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_system_diagnostics,
            complete_first_launch,
            set_custom_models_dir,
            import_audio_file,
            get_waveform_window,
            get_pcm_chunk,
            compute_spectrogram,
            align_clips,
            analyze_silence_and_telemetry,
            transform_clip_audio,
            export_project,
            list_audio_devices,
            start_recording,
            pause_recording,
            set_recording_gain,
            stop_recording,
            save_project_file,
            load_project_file,
            list_recent_projects,
            save_autosave,
            get_latest_autosave,
            clear_autosave,
            list_presets,
            save_preset,
            delete_preset,
            get_app_setting,
            set_app_setting,
            clear_audio_cache,
            list_ai_models,
            download_ai_model,
            cancel_ai_model_download,
            remove_ai_model,
            verify_ai_model,
            probe_ai_providers_cmd,
            save_provider_api_key,
            delete_provider_api_key,
            transcribe_audio,
            separate_vocals,
            ask_ai_assistant,
            check_app_updates,
            backup_portable_config_cmd,
            apply_portable_update_cmd,
            get_startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
