import React, { useState } from 'react';
import {
  FolderOpen,
  Trash2,
  KeyRound,
  RefreshCw,
  HardDrive,
  Archive,
  Keyboard,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { DawButton, NativeModal } from '@/components/ui/Controls';
import {
  applyPortableUpdate,
  backupPortableConfig,
  checkAppUpdates,
  clearAudioCache,
  deleteProviderApiKey,
  saveProviderApiKey,
  setCustomModelsDir,
} from '@/lib/tauri';
import { formatBytes } from '@/lib/utils';
import { audioEngine } from '@/audio/audioEngine';
import { useRuntimeStore } from '@/stores/runtimeStore';
import type { UpdateCheckResult } from '@/types/distribution';

type SettingsTab = 'general' | 'audio' | 'ai' | 'updates';

export const SettingsDialog: React.FC = () => {
  const showSettings = useRuntimeStore((s) => s.showSettings);
  const setShowSettings = useRuntimeStore((s) => s.setShowSettings);
  const diagnostics = useRuntimeStore((s) => s.diagnostics);
  const devices = useRuntimeStore((s) => s.devices);
  const providers = useRuntimeStore((s) => s.providers);
  const selectedInputDevice = useRuntimeStore((s) => s.selectedInputDevice);
  const setSelectedInputDevice = useRuntimeStore((s) => s.setSelectedInputDevice);
  const selectedOutputDevice = useRuntimeStore((s) => s.selectedOutputDevice);
  const setSelectedOutputDevice = useRuntimeStore((s) => s.setSelectedOutputDevice);
  const refreshAll = useRuntimeStore((s) => s.refreshAll);
  const refreshProviders = useRuntimeStore((s) => s.refreshProviders);

  const [tab, setTab] = useState<SettingsTab>('general');
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [manifestUrl, setManifestUrl] = useState('');
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (!showSettings || !diagnostics) return null;

  const isPortable = diagnostics.mode === 'portable';

  const handleSaveKey = async (providerId: 'openai' | 'gemini', key: string) => {
    if (!key.trim()) return;
    await saveProviderApiKey(providerId, key.trim());
    if (providerId === 'openai') setOpenaiKey('');
    else setGeminiKey('');
    await refreshProviders();
    setStatusMsg(`Saved ${providerId.toUpperCase()} API key cleanly in encrypted vault.`);
  };

  const handleClearCache = async () => {
    const bytes = await clearAudioCache();
    setStatusMsg(`Cleared ${formatBytes(bytes)} from temporary peaks & render cache.`);
  };

  const handleChooseModelsDir = async () => {
    const dir = await open({ directory: true, defaultPath: diagnostics.paths.modelsDir });
    if (!dir || Array.isArray(dir)) return;
    await setCustomModelsDir(dir);
    await refreshAll();
    setStatusMsg(`Model storage moved to: ${dir}`);
  };

  const handleBackupPortable = async () => {
    const out = await backupPortableConfig();
    setStatusMsg(`Portable config & presets backed up to: ${out}`);
  };

  const handleApplyPortableZip = async () => {
    const file = await open({
      multiple: false,
      filters: [{ name: 'Portable Release ZIP', extensions: ['zip'] }],
    });
    if (!file || Array.isArray(file)) return;
    const msg = await applyPortableUpdate(file);
    setStatusMsg(msg);
  };

  return (
    <NativeModal
      open={showSettings}
      onClose={() => setShowSettings(false)}
      title="SONORA AI STUDIO Settings"
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-4 text-xs">
        <div className="flex gap-1 border-b border-[#252B38] pb-2">
          {[
            ['general', 'Paths & Storage'],
            ['audio', 'Audio & FFmpeg'],
            ['ai', 'AI Providers & Keys'],
            ['updates', 'Shortcuts & Updates'],
          ].map(([id, lbl]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id as SettingsTab)}
              className={`rounded px-3 py-1.5 font-medium cursor-pointer ${
                tab === id
                  ? 'bg-[#3B82F6] text-white'
                  : 'text-[#9CA6B8] hover:bg-[#181C25] hover:text-white'
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        {statusMsg && (
          <div className="rounded border border-[#10B981]/40 bg-[#10B981]/10 px-3 py-2 text-[11px] text-[#34D399]">
            {statusMsg}
          </div>
        )}

        {tab === 'general' && (
          <div className="space-y-3">
            <div className="rounded border border-[#252B38] bg-[#181C25] p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white flex items-center gap-1.5">
                  <HardDrive className="h-4 w-4 text-[#22D3EE]" />
                  Active Distribution Mode: {isPortable ? 'Portable Edition' : 'Installer Edition'}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1 pt-1 font-mono-tabular text-[11px] text-[#9CA6B8]">
                <div>Config: {diagnostics.paths.configDir}</div>
                <div>Projects: {diagnostics.paths.projectsDir}</div>
                <div>Cache: {diagnostics.paths.cacheDir}</div>
                <div>Exports: {diagnostics.paths.exportsDir}</div>
                <div>Logs: {diagnostics.paths.logsDir}</div>
              </div>
            </div>

            <div className="flex items-center justify-between rounded border border-[#252B38] bg-[#181C25] p-3">
              <div className="min-w-0 flex-1 pr-3">
                <div className="font-semibold text-white">AI Models Location</div>
                <div className="font-mono-tabular truncate text-[11px] text-[#22D3EE]">
                  {diagnostics.paths.modelsDir}
                </div>
              </div>
              <DawButton size="xs" onClick={() => void handleChooseModelsDir()}>
                <FolderOpen className="h-3.5 w-3.5" />
                Change Folder
              </DawButton>
            </div>

            <div className="flex items-center justify-between rounded border border-[#252B38] bg-[#181C25] p-3">
              <div>
                <div className="font-semibold text-white">Audio Peaks & Render Cache</div>
                <div className="text-[11px] text-[#9CA6B8]">
                  Safely clear cached waveform pyramids and rendered intermediate clips.
                </div>
              </div>
              <DawButton size="xs" variant="danger" onClick={() => void handleClearCache()}>
                <Trash2 className="h-3.5 w-3.5" />
                Clear Cache
              </DawButton>
            </div>
          </div>
        )}

        {tab === 'audio' && (
          <div className="space-y-3">
            <div className="rounded border border-[#252B38] bg-[#181C25] p-3 space-y-2.5">
              <div>
                <label className="block text-[11px] text-[#9CA6B8] mb-1">Default Recording Input</label>
                <select
                  value={selectedInputDevice}
                  onChange={(e) => setSelectedInputDevice(e.target.value)}
                  className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-white"
                >
                  {devices
                    .filter((d) => d.kind === 'input')
                    .map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name} ({d.defaultSampleRate} Hz)
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#9CA6B8] mb-1">Playback Output</label>
                <select
                  value={selectedOutputDevice}
                  onChange={(e) => {
                    setSelectedOutputDevice(e.target.value);
                    void audioEngine.setOutputDevice(e.target.value);
                  }}
                  className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-white"
                >
                  {devices
                    .filter((d) => d.kind === 'output')
                    .map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="rounded border border-[#252B38] bg-[#181C25] p-3 space-y-1">
              <div className="font-semibold text-white">FFmpeg Processing Engine</div>
              <div className="font-mono-tabular text-[11px] text-[#9CA6B8] break-all">
                Binary: {diagnostics.ffmpegPath ?? 'Not Found'}
              </div>
              <div className="flex flex-wrap gap-2 pt-1 text-[10px]">
                <span className="rounded bg-[#0B0D11] px-2 py-0.5 text-[#34D399]">
                  afftdn: {diagnostics.hasAfftdn ? 'Yes' : 'No'}
                </span>
                <span className="rounded bg-[#0B0D11] px-2 py-0.5 text-[#34D399]">
                  librubberband: {diagnostics.hasRubberband ? 'Yes' : 'No'}
                </span>
                <span className="rounded bg-[#0B0D11] px-2 py-0.5 text-[#34D399]">
                  loudnorm: {diagnostics.hasLoudnorm ? 'Yes' : 'No'}
                </span>
                <span className="rounded bg-[#0B0D11] px-2 py-0.5 text-[#93C5FD]">
                  arnndn: {diagnostics.hasArnndn ? 'Yes' : 'No'}
                </span>
              </div>
            </div>
          </div>
        )}

        {tab === 'ai' && (
          <div className="space-y-3">
            <div className="rounded border border-[#252B38] bg-[#181C25] p-3 space-y-2.5">
              <div className="font-semibold text-white flex items-center gap-1.5">
                <KeyRound className="h-4 w-4 text-[#8B5CF6]" />
                Cloud AI Keys ({isPortable ? 'AES-256-GCM Portable Vault' : 'Windows Credential Manager'})
              </div>

              <div className="flex gap-2">
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="OpenAI API Key (sk-...)"
                  className="h-8 flex-1 rounded border border-[#252B38] bg-[#0B0D11] px-2.5 text-xs text-white"
                />
                <DawButton size="sm" variant="ai" onClick={() => void handleSaveKey('openai', openaiKey)}>
                  Save OpenAI
                </DawButton>
                <DawButton
                  size="sm"
                  onClick={async () => {
                    await deleteProviderApiKey('openai');
                    await refreshProviders();
                    setStatusMsg('Removed OpenAI API key.');
                  }}
                >
                  Clear
                </DawButton>
              </div>

              <div className="flex gap-2">
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="Google Gemini API Key (AIza...)"
                  className="h-8 flex-1 rounded border border-[#252B38] bg-[#0B0D11] px-2.5 text-xs text-white"
                />
                <DawButton size="sm" variant="ai" onClick={() => void handleSaveKey('gemini', geminiKey)}>
                  Save Gemini
                </DawButton>
                <DawButton
                  size="sm"
                  onClick={async () => {
                    await deleteProviderApiKey('gemini');
                    await refreshProviders();
                    setStatusMsg('Removed Gemini API key.');
                  }}
                >
                  Clear
                </DawButton>
              </div>
            </div>

            <div className="space-y-1.5">
              {providers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded border border-[#252B38] bg-[#0E1117] px-3 py-2"
                >
                  <div>
                    <div className="font-medium text-white">{p.name}</div>
                    <div className="text-[11px] text-[#9CA6B8]">{p.details}</div>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                      p.configured
                        ? 'bg-[#10B981]/15 text-[#34D399]'
                        : 'bg-[#252B38] text-[#9CA6B8]'
                    }`}
                  >
                    {p.statusLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'updates' && (
          <div className="space-y-3">
            {/* Update Controls */}
            <div className="rounded border border-[#252B38] bg-[#181C25] p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-white">Application Updates</span>
                <DawButton
                  size="xs"
                  onClick={async () => {
                    const res = await checkAppUpdates(manifestUrl);
                    setUpdateInfo(res);
                  }}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Check Updates
                </DawButton>
              </div>
              <input
                type="text"
                value={manifestUrl}
                onChange={(e) => setManifestUrl(e.target.value)}
                placeholder="Optional update manifest JSON URL or local path..."
                className="h-7 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-[11px] text-white"
              />
              {updateInfo && (
                <div className="rounded border border-[#252B38] bg-[#0B0D11] p-2 text-[11px] text-[#D1D5DB]">
                  Current: v{updateInfo.currentVersion} · Latest: v{updateInfo.latestVersion} —{' '}
                  {updateInfo.releaseNotes}
                </div>
              )}

              {isPortable && (
                <div className="flex flex-wrap gap-2 pt-1 border-t border-[#252B38]">
                  <DawButton size="xs" onClick={() => void handleBackupPortable()}>
                    <Archive className="h-3.5 w-3.5 text-[#10B981]" />
                    Backup Portable Config & Presets
                  </DawButton>
                  <DawButton size="xs" variant="primary" onClick={() => void handleApplyPortableZip()}>
                    Safe Apply Portable Update ZIP
                  </DawButton>
                </div>
              )}
            </div>

            {/* Keyboard Shortcuts */}
            <div className="rounded border border-[#252B38] bg-[#181C25] p-3 space-y-2">
              <div className="font-semibold text-white flex items-center gap-1.5">
                <Keyboard className="h-4 w-4 text-[#22D3EE]" />
                DAW Keyboard Shortcuts
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px] text-[#9CA6B8]">
                {[
                  ['Space', 'Play / Pause'],
                  ['L', 'Toggle Loop Playback'],
                  ['V / R / C / T', 'Select / Range / Razor / Stretch Tool'],
                  ['S', 'Split Clip at Playhead'],
                  ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'],
                  ['Ctrl+C / X / V', 'Copy / Cut / Paste Clip'],
                  ['Del / Backspace', 'Delete Selected Clip'],
                  ['Ctrl+S', 'Save Project (.sonora)'],
                ].map(([k, desc]) => (
                  <div key={k} className="flex justify-between rounded bg-[#0B0D11] px-2 py-1">
                    <span className="font-mono-tabular text-[#22D3EE]">{k}</span>
                    <span>{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </NativeModal>
  );
};
