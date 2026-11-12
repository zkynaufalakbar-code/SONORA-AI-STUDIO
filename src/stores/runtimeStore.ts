import { create } from 'zustand';
import {
  listAiModels,
  probeAiProviders,
  type AudioDeviceInfo,
  type DbPresetRow,
  listAudioDevices,
  listPresets,
  getSystemDiagnostics,
} from '@/lib/tauri';
import type { AiModelEntry, SystemDiagnosticReport } from '@/types/distribution';
import type { AiProviderStatus, AssistantMessage, AudioTelemetry, SilenceInterval } from '@/types/ai';

interface AppRuntimeStore {
  diagnostics: SystemDiagnosticReport | null;
  devices: AudioDeviceInfo[];
  presets: DbPresetRow[];
  providers: AiProviderStatus[];
  models: AiModelEntry[];
  activeAssistantProvider: string;
  activeSttProvider: string;
  assistantMessages: AssistantMessage[];
  detectedSilence: SilenceInterval[];
  lastTelemetry: AudioTelemetry | null;
  busyMessage: string | null;
  progressPct: number | null;
  showFirstLaunch: boolean;
  showSettings: boolean;
  showExport: boolean;
  showModelManager: boolean;
  selectedOutputDevice: string;
  selectedInputDevice: string;
  autosaveEnabled: boolean;

  refreshAll: () => Promise<void>;
  refreshModels: () => Promise<void>;
  refreshProviders: () => Promise<void>;
  refreshPresets: () => Promise<void>;
  setBusy: (msg: string | null, pct?: number | null) => void;
  setShowFirstLaunch: (v: boolean) => void;
  setShowSettings: (v: boolean) => void;
  setShowExport: (v: boolean) => void;
  setShowModelManager: (v: boolean) => void;
  setActiveAssistantProvider: (id: string) => void;
  setActiveSttProvider: (id: string) => void;
  addAssistantMessage: (msg: AssistantMessage) => void;
  markAssistantPlanExecuted: (id: string) => void;
  setSilenceResults: (intervals: SilenceInterval[], telemetry: AudioTelemetry | null) => void;
  setSelectedInputDevice: (name: string) => void;
  setSelectedOutputDevice: (name: string) => void;
}

export const useRuntimeStore = create<AppRuntimeStore>((set) => ({
  diagnostics: null,
  devices: [],
  presets: [],
  providers: [],
  models: [],
  activeAssistantProvider: 'local_ffmpeg',
  activeSttProvider: 'local_whisper',
  assistantMessages: [
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Ready to assist with your audio. Try commands like "Bersihkan noise audio ini", "Buat suara seperti podcast profesional", "Hilangkan jeda panjang", or "Optimalkan audio untuk YouTube".',
      providerUsed: 'Local Offline Intent Engine',
      timestamp: new Date().toISOString(),
    },
  ],
  detectedSilence: [],
  lastTelemetry: null,
  busyMessage: null,
  progressPct: null,
  showFirstLaunch: false,
  showSettings: false,
  showExport: false,
  showModelManager: false,
  selectedOutputDevice: '',
  selectedInputDevice: '',
  autosaveEnabled: true,

  refreshAll: async () => {
    try {
      const [diagnostics, devices, presets, providers, models] = await Promise.all([
        getSystemDiagnostics(),
        listAudioDevices(),
        listPresets(),
        probeAiProviders(),
        listAiModels(),
      ]);
      const defIn = devices.find((d) => d.kind === 'input' && d.isDefault)?.name ?? '';
      const defOut = devices.find((d) => d.kind === 'output' && d.isDefault)?.name ?? '';
      set((s) => ({
        diagnostics,
        devices,
        presets,
        providers,
        models,
        showFirstLaunch: !diagnostics.firstLaunchCompleted,
        selectedInputDevice: s.selectedInputDevice || defIn,
        selectedOutputDevice: s.selectedOutputDevice || defOut,
      }));
    } catch (err) {
      console.error('Failed to load runtime diagnostics:', err);
    }
  },

  refreshModels: async () => {
    const models = await listAiModels();
    set({ models });
  },

  refreshProviders: async () => {
    const providers = await probeAiProviders();
    set({ providers });
  },

  refreshPresets: async () => {
    const presets = await listPresets();
    set({ presets });
  },

  setBusy: (busyMessage, progressPct = null) => set({ busyMessage, progressPct }),
  setShowFirstLaunch: (showFirstLaunch) => set({ showFirstLaunch }),
  setShowSettings: (showSettings) => set({ showSettings }),
  setShowExport: (showExport) => set({ showExport }),
  setShowModelManager: (showModelManager) => set({ showModelManager }),
  setActiveAssistantProvider: (activeAssistantProvider) => set({ activeAssistantProvider }),
  setActiveSttProvider: (activeSttProvider) => set({ activeSttProvider }),
  addAssistantMessage: (msg) =>
    set((s) => ({ assistantMessages: [...s.assistantMessages, msg] })),
  markAssistantPlanExecuted: (id) =>
    set((s) => ({
      assistantMessages: s.assistantMessages.map((m) =>
        m.id === id ? { ...m, executed: true } : m,
      ),
    })),
  setSilenceResults: (detectedSilence, lastTelemetry) =>
    set({ detectedSilence, lastTelemetry }),
  setSelectedInputDevice: (selectedInputDevice) => set({ selectedInputDevice }),
  setSelectedOutputDevice: (selectedOutputDevice) => set({ selectedOutputDevice }),
}));
