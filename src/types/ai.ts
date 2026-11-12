export type AiProviderId =
  | 'local_ffmpeg'
  | 'local_rnnoise'
  | 'local_whisper'
  | 'local_demucs'
  | 'local_deepfilternet'
  | 'openai'
  | 'gemini';

export interface AiProviderStatus {
  id: AiProviderId;
  name: string;
  kind: 'local' | 'cloud';
  configured: boolean;
  available: boolean;
  statusLabel: string;
  details: string;
  modelName?: string;
}

export interface SilenceInterval {
  startMs: number;
  endMs: number;
  durationMs: number;
  avgDb: number;
}

export interface AudioTelemetry {
  durationMs: number;
  peakDbfs: number;
  rmsDbfs: number;
  estimatedNoiseFloorDbfs: number;
  clippingSamples: number;
  silenceRatio: number;
  lowEnergyRatio: number;
  highEnergyRatio: number;
}

export interface AssistantActionStep {
  id: string;
  type:
    | 'add_effect'
    | 'noise_removal'
    | 'voice_enhancement'
    | 'silence_removal'
    | 'normalize'
    | 'amplify';
  label: string;
  params: Record<string, unknown>;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  providerUsed: string;
  timestamp: string;
  actionPlan?: AssistantActionStep[];
  executed?: boolean;
}
