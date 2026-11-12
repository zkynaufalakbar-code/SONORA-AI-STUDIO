import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AiModelEntry,
  ModelDownloadProgress,
  RuntimePathsInfo,
  SystemDiagnosticReport,
  UpdateCheckResult,
} from '@/types/distribution';
import type {
  AiProviderStatus,
  AssistantActionStep,
  AudioTelemetry,
  SilenceInterval,
} from '@/types/ai';
import type { ProjectManifest, TranscriptSegment } from '@/types/project';

export interface ImportedMediaResult {
  id: string;
  name: string;
  originalPath: string;
  storedPath: string;
  resolvedPath: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  codec: string;
  bitrate: number;
  fileSizeBytes: number;
  peakFilePath: string;
  peakDbfs: number;
  rmsDbfs: number;
}

export interface WaveformWindowResult {
  bins: number;
  channels: number;
  data: number[];
}

export interface SpectrogramTileResult {
  width: number;
  height: number;
  minHz: number;
  maxHz: number;
  intensities: number[];
}

export interface AudioDeviceInfo {
  id: string;
  name: string;
  kind: 'input' | 'output';
  isDefault: boolean;
  maxChannels: number;
  defaultSampleRate: number;
}

export interface RecordingTelemetryEvent {
  peakL: number;
  peakR: number;
  rmsL: number;
  rmsR: number;
  clipping: boolean;
  elapsedMs: number;
  waveformSamples: number[];
}

export interface RecordingFinishedResult {
  outputPath: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
}

export interface ExportProgressEvent {
  percent: number;
  stage: string;
  currentFile: string;
}

export interface RecentProjectEntry {
  id: string;
  name: string;
  projectPath: string;
  updatedAt: string;
  durationMs: number;
}

export interface AutosaveSnapshotEntry {
  id: string;
  projectId: string;
  name: string;
  snapshotJson: string;
  savedAt: string;
}

export interface DbPresetRow {
  id: string;
  effectType: string;
  name: string;
  category: string;
  paramsJson: string;
  isFactory: boolean;
}

export async function getSystemDiagnostics(): Promise<SystemDiagnosticReport> {
  return invoke('get_system_diagnostics');
}

export async function completeFirstLaunch(): Promise<void> {
  return invoke('complete_first_launch');
}

export async function setCustomModelsDir(dirPath: string): Promise<RuntimePathsInfo> {
  return invoke('set_custom_models_dir', { dirPath });
}

export async function importAudioFile(filePath: string): Promise<ImportedMediaResult> {
  return invoke('import_audio_file', { filePath, projectMediaDir: null });
}

export async function getWaveformWindow(
  peakFilePath: string,
  startMs: number,
  endMs: number,
  targetBins: number,
): Promise<WaveformWindowResult> {
  return invoke('get_waveform_window', {
    peakFilePath,
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    targetBins: Math.round(targetBins),
  });
}

export async function fetchPcmChunk(
  filePath: string,
  startMs: number,
  durationMs: number,
  sampleRate: number,
  channels: number,
): Promise<Float32Array> {
  const bytes = await invoke<ArrayBuffer>('get_pcm_chunk', {
    filePath,
    startMs: Math.round(startMs),
    durationMs: Math.round(durationMs),
    sampleRate,
    channels,
  });
  return new Float32Array(bytes);
}

export async function computeSpectrogram(
  filePath: string,
  startMs: number,
  durationMs: number,
  width: number,
  height: number,
): Promise<SpectrogramTileResult> {
  return invoke('compute_spectrogram', {
    filePath,
    startMs: Math.round(startMs),
    durationMs: Math.round(durationMs),
    width,
    height,
  });
}

export async function alignClipsCrossCorr(
  refPath: string,
  refStartMs: number,
  targetPath: string,
  targetStartMs: number,
  windowMs = 6000,
): Promise<number> {
  return invoke('align_clips', {
    refPath,
    refStartMs: Math.round(refStartMs),
    targetPath,
    targetStartMs: Math.round(targetStartMs),
    windowMs,
  });
}

export async function analyzeSilenceAndTelemetry(
  filePath: string,
  thresholdDb: number,
  minSilenceMs: number,
): Promise<{ intervals: SilenceInterval[]; telemetry: AudioTelemetry }> {
  return invoke('analyze_silence_and_telemetry', {
    filePath,
    thresholdDb,
    minSilenceMs: Math.round(minSilenceMs),
  });
}

export async function transformClipAudio(
  sourcePath: string,
  op: Record<string, unknown>,
  renderName?: string,
): Promise<ImportedMediaResult> {
  return invoke('transform_clip_audio', {
    sourcePath,
    op,
    renderName: renderName ?? null,
  });
}

export async function exportProjectMixdown(
  request: Record<string, unknown>,
  onProgress: (ev: ExportProgressEvent) => void,
): Promise<string[]> {
  const channel = new Channel<ExportProgressEvent>();
  channel.onmessage = onProgress;
  return invoke('export_project', { request, onProgress: channel });
}

export async function listAudioDevices(): Promise<AudioDeviceInfo[]> {
  return invoke('list_audio_devices');
}

export async function startRecordingSession(
  opts: {
    deviceName: string | null;
    channels: number;
    sampleRate: number;
    bitDepth: number;
    inputGainDb: number;
    monitorEnabled: boolean;
    fileName?: string;
  },
  onTelemetry: (t: RecordingTelemetryEvent) => void,
): Promise<string> {
  const ch = new Channel<RecordingTelemetryEvent>();
  ch.onmessage = onTelemetry;
  return invoke('start_recording', { ...opts, onTelemetry: ch });
}

export async function pauseRecordingSession(paused: boolean): Promise<void> {
  return invoke('pause_recording', { paused });
}

export async function setRecordingGain(gainDb: number): Promise<void> {
  return invoke('set_recording_gain', { gainDb });
}

export async function stopRecordingSession(): Promise<RecordingFinishedResult> {
  return invoke('stop_recording');
}

export async function saveProjectFile(
  projectId: string,
  projectName: string,
  filePath: string | null,
  durationMs: number,
  manifest: ProjectManifest,
): Promise<string> {
  return invoke('save_project_file', {
    projectId,
    projectName,
    filePath,
    durationMs: Math.round(durationMs),
    manifest,
  });
}

export async function loadProjectFile(filePath: string): Promise<ProjectManifest> {
  return invoke('load_project_file', { filePath });
}

export async function listRecentProjects(): Promise<RecentProjectEntry[]> {
  return invoke('list_recent_projects');
}

export async function saveAutosaveSnapshot(
  projectId: string,
  name: string,
  snapshotJson: string,
): Promise<void> {
  return invoke('save_autosave', { projectId, name, snapshotJson });
}

export async function getLatestAutosave(): Promise<AutosaveSnapshotEntry | null> {
  return invoke('get_latest_autosave');
}

export async function clearAutosaveSnapshot(projectId: string): Promise<void> {
  return invoke('clear_autosave', { projectId });
}

export async function listPresets(): Promise<DbPresetRow[]> {
  return invoke('list_presets');
}

export async function savePreset(
  id: string,
  effectType: string,
  name: string,
  category: string,
  paramsJson: string,
): Promise<void> {
  return invoke('save_preset', { id, effectType, name, category, paramsJson });
}

export async function deletePreset(id: string): Promise<void> {
  return invoke('delete_preset', { id });
}

export async function getAppSetting(key: string): Promise<string | null> {
  return invoke('get_app_setting', { key });
}

export async function setAppSetting(key: string, valueJson: string): Promise<void> {
  return invoke('set_app_setting', { key, valueJson });
}

export async function clearAudioCache(): Promise<number> {
  return invoke('clear_audio_cache');
}

export async function listAiModels(): Promise<AiModelEntry[]> {
  return invoke('list_ai_models');
}

export async function downloadAiModel(
  modelId: string,
  onProgress: (p: ModelDownloadProgress) => void,
): Promise<AiModelEntry> {
  const ch = new Channel<ModelDownloadProgress>();
  ch.onmessage = onProgress;
  return invoke('download_ai_model', { modelId, onProgress: ch });
}

export async function cancelAiModelDownload(modelId: string): Promise<void> {
  return invoke('cancel_ai_model_download', { modelId });
}

export async function removeAiModel(modelId: string): Promise<void> {
  return invoke('remove_ai_model', { modelId });
}

export async function verifyAiModel(modelId: string): Promise<boolean> {
  return invoke('verify_ai_model', { modelId });
}

export async function probeAiProviders(): Promise<AiProviderStatus[]> {
  return invoke('probe_ai_providers_cmd');
}

export async function saveProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  return invoke('save_provider_api_key', { providerId, apiKey });
}

export async function deleteProviderApiKey(providerId: string): Promise<void> {
  return invoke('delete_provider_api_key', { providerId });
}

export async function transcribeAudio(
  filePath: string,
  providerId: string,
  language?: string,
): Promise<TranscriptSegment[]> {
  return invoke('transcribe_audio', { filePath, providerId, language: language ?? null });
}

export async function separateVocals(
  filePath: string,
): Promise<{ vocalsPath: string; instrumentalPath: string }> {
  return invoke('separate_vocals', { filePath });
}

export async function askAiAssistant(
  providerId: string,
  prompt: string,
  telemetry: AudioTelemetry | null,
): Promise<{ reply: string; providerUsed: string; actionPlan: AssistantActionStep[] }> {
  return invoke('ask_ai_assistant', { providerId, prompt, telemetry });
}

export async function checkAppUpdates(manifestUrl?: string): Promise<UpdateCheckResult> {
  return invoke('check_app_updates', { manifestUrl: manifestUrl ?? null });
}

export async function backupPortableConfig(): Promise<string> {
  return invoke('backup_portable_config_cmd');
}

export async function applyPortableUpdate(zipPath: string): Promise<string> {
  return invoke('apply_portable_update_cmd', { zipPath });
}

export async function getStartupFile(): Promise<string | null> {
  return invoke('get_startup_file');
}
