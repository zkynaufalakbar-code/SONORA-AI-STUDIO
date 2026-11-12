import type { EffectInstance } from './effects';

export type FadeCurveType = 'linear' | 'logarithmic' | 'exponential' | 's_curve';
export type ChannelRoutingMode = 'stereo' | 'mono_mix' | 'left_only' | 'right_only';
export type EditorTool = 'select' | 'range' | 'razor' | 'stretch';
export type WorkspaceMode = 'studio' | 'podcast' | 'recording';

export interface MediaAsset {
  id: string;
  name: string;
  originalPath: string;
  storedPath: string; // Portable-aware path (e.g., ${PORTABLE_ROOT}/... or absolute)
  resolvedPath: string; // Actual filesystem path at runtime
  durationMs: number;
  sampleRate: number;
  channels: number;
  bitDepth: number;
  codec: string;
  bitrate: number;
  fileSizeBytes: number;
  peakFilePath?: string | null;
  peakDbfs?: number;
  lufsIntegrated?: number;
  createdAt?: string;
}

export interface AudioClip {
  id: string;
  trackId: string;
  assetId: string;
  renderAssetId?: string | null; // Non-destructive processed render replacement
  name: string;
  timelineStartMs: number;
  sourceOffsetMs: number;
  durationMs: number;
  gainDb: number;
  fadeInMs: number;
  fadeOutMs: number;
  fadeInCurve: FadeCurveType;
  fadeOutCurve: FadeCurveType;
  playbackRate: number;
  pitchSemitones: number;
  channelMode: ChannelRoutingMode;
  muted: boolean;
  color: string;
  effects: EffectInstance[];
}

export interface AudioTrack {
  id: string;
  name: string;
  role: 'audio' | 'voice' | 'music' | 'stem';
  color: string;
  volumeDb: number;
  pan: number; // -1.0 (L) to +1.0 (R)
  inputGainDb: number;
  muted: boolean;
  solo: boolean;
  armed: boolean;
  channelMode: ChannelRoutingMode;
  heightPx: number;
  effects: EffectInstance[];
}

export interface TimeSelection {
  startMs: number;
  endMs: number;
  trackId?: string | null;
}

export interface FrequencySelection {
  clipId: string;
  startMs: number;
  endMs: number;
  lowHz: number;
  highHz: number;
}

export interface TranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface ProjectManifest {
  schemaVersion: number;
  id: string;
  name: string;
  projectPath?: string | null;
  sampleRate: number;
  bitDepth: number;
  masterVolumeDb: number;
  tracks: AudioTrack[];
  clips: AudioClip[];
  assets: Record<string, MediaAsset>;
  transcript: TranscriptSegment[];
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  label: string;
  timestamp: string;
}
