export type DistributionMode = 'installer' | 'portable';

export interface RuntimePathsInfo {
  mode: DistributionMode;
  exeDir: string;
  configDir: string;
  projectsDir: string;
  cacheDir: string;
  presetsDir: string;
  pluginsDir: string;
  modelsDir: string;
  exportsDir: string;
  logsDir: string;
  dbPath: string;
  isWritable: boolean;
  writeError?: string | null;
}

export interface SystemDiagnosticReport {
  mode: DistributionMode;
  paths: RuntimePathsInfo;
  ffmpegAvailable: boolean;
  ffmpegPath?: string | null;
  ffmpegVersion?: string | null;
  hasRubberband: boolean;
  hasAfftdn: boolean;
  hasArnndn: boolean;
  hasLoudnorm: boolean;
  audioInputDevices: number;
  audioOutputDevices: number;
  pythonAvailable: boolean;
  pythonPath?: string | null;
  installedModelCount: number;
  firstLaunchCompleted: boolean;
}

export type ModelCategory =
  | 'speech_recognition'
  | 'noise_reduction'
  | 'vocal_separation'
  | 'voice_enhancement'
  | 'audio_classification';

export type ModelStatus =
  | 'not_installed'
  | 'downloading'
  | 'installed'
  | 'update_available'
  | 'corrupted'
  | 'incompatible';

export interface AiModelEntry {
  id: string;
  name: string;
  category: ModelCategory;
  version: string;
  sizeBytes: number;
  description: string;
  runtimeRequirement: string;
  downloadUrl: string;
  sha256: string;
  localPath?: string | null;
  status: ModelStatus;
  compatible: boolean;
  compatibilityNote?: string | null;
  downloadedBytes?: number;
}

export interface ModelDownloadProgress {
  modelId: string;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  status: 'downloading' | 'verifying' | 'completed' | 'paused' | 'error';
  error?: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes: string;
  installerUrl?: string | null;
  portableZipUrl?: string | null;
  sha256?: string | null;
  mode: DistributionMode;
}
