import React, { useState } from 'react';
import {
  Download,
  PauseCircle,
  Trash2,
  ShieldCheck,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { DawButton, NativeModal } from '@/components/ui/Controls';
import {
  cancelAiModelDownload,
  downloadAiModel,
  removeAiModel,
  setCustomModelsDir,
  verifyAiModel,
} from '@/lib/tauri';
import { formatBytes } from '@/lib/utils';
import { useRuntimeStore } from '@/stores/runtimeStore';
import type { ModelCategory, ModelDownloadProgress } from '@/types/distribution';

const CATEGORIES: Array<{ id: ModelCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All Models' },
  { id: 'speech_recognition', label: 'Speech Recognition' },
  { id: 'noise_reduction', label: 'Noise Reduction' },
  { id: 'vocal_separation', label: 'Vocal Separation' },
  { id: 'voice_enhancement', label: 'Voice Enhancement' },
  { id: 'audio_classification', label: 'Audio Classification' },
];

export const ModelManagerDialog: React.FC = () => {
  const showModelManager = useRuntimeStore((s) => s.showModelManager);
  const setShowModelManager = useRuntimeStore((s) => s.setShowModelManager);
  const models = useRuntimeStore((s) => s.models);
  const diagnostics = useRuntimeStore((s) => s.diagnostics);
  const refreshModels = useRuntimeStore((s) => s.refreshModels);
  const refreshProviders = useRuntimeStore((s) => s.refreshProviders);
  const refreshAll = useRuntimeStore((s) => s.refreshAll);

  const [category, setCategory] = useState<ModelCategory | 'all'>('all');
  const [downloads, setDownloads] = useState<Record<string, ModelDownloadProgress>>({});
  const [message, setMessage] = useState<string | null>(null);

  if (!showModelManager) return null;

  const filtered =
    category === 'all' ? models : models.filter((m) => m.category === category);

  const handleDownload = async (modelId: string) => {
    setMessage(null);
    try {
      await downloadAiModel(modelId, (prog) => {
        setDownloads((prev) => ({ ...prev, [modelId]: prog }));
      });
      await Promise.all([refreshModels(), refreshProviders()]);
      setMessage(`Model "${modelId}" installed and verified.`);
    } catch (err) {
      setMessage(`Download notice (${modelId}): ${String(err)}`);
      await refreshModels();
    }
  };

  const handlePause = async (modelId: string) => {
    await cancelAiModelDownload(modelId);
    await refreshModels();
  };

  const handleVerify = async (modelId: string) => {
    const ok = await verifyAiModel(modelId);
    setMessage(
      ok
        ? `SHA-256 integrity passed for "${modelId}".`
        : `Integrity verification failed or file missing for "${modelId}".`,
    );
    await refreshModels();
  };

  const handleRemove = async (modelId: string) => {
    await removeAiModel(modelId);
    setMessage(`Removed model "${modelId}".`);
    await Promise.all([refreshModels(), refreshProviders()]);
  };

  const handleChangeDir = async () => {
    const dir = await open({
      directory: true,
      multiple: false,
      defaultPath: diagnostics?.paths.modelsDir,
    });
    if (!dir || Array.isArray(dir)) return;
    await setCustomModelsDir(dir);
    await refreshAll();
  };

  return (
    <NativeModal
      open={showModelManager}
      onClose={() => setShowModelManager(false)}
      title="AI Model Manager — Modular Offline Models"
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-3 text-xs">
        {/* Storage Location Banner */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#252B38] bg-[#181C25] p-2.5">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-[#9CA6B8]">
              Model Directory ({diagnostics?.mode === 'portable' ? 'Portable Default' : 'Installer Mode'})
            </div>
            <div className="font-mono-tabular truncate text-[11px] text-[#22D3EE]">
              {diagnostics?.paths.modelsDir}
            </div>
          </div>
          <DawButton size="xs" onClick={() => void handleChangeDir()}>
            <FolderOpen className="h-3.5 w-3.5" />
            Choose Folder
          </DawButton>
        </div>

        {/* Category Filter Tabs */}
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer ${
                category === c.id
                  ? 'bg-[#8B5CF6] text-white'
                  : 'border border-[#252B38] bg-[#0B0D11] text-[#9CA6B8] hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {message && (
          <div className="rounded border border-[#3B82F6]/40 bg-[#3B82F6]/10 px-3 py-2 text-[11px] text-[#93C5FD]">
            {message}
          </div>
        )}

        {/* Model List */}
        <div className="space-y-2">
          {filtered.map((m) => {
            const prog = downloads[m.id];
            const isDownloading = prog?.status === 'downloading' || m.status === 'downloading';
            const total = prog?.totalBytes || m.sizeBytes;
            const dl = prog?.downloadedBytes ?? m.downloadedBytes ?? 0;
            const pct = total > 0 ? Math.min(100, (dl / total) * 100) : 0;

            return (
              <div
                key={m.id}
                className="rounded border border-[#252B38] bg-[#0E1117] p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-white">{m.name}</span>
                      <span className="rounded bg-[#181C25] px-1.5 py-0.5 text-[10px] text-[#9CA6B8]">
                        v{m.version}
                      </span>
                      <span className="rounded bg-[#181C25] px-1.5 py-0.5 font-mono-tabular text-[10px] text-[#22D3EE]">
                        {formatBytes(m.sizeBytes)}
                      </span>
                      {m.status === 'installed' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-[#10B981]/15 px-1.5 py-0.5 text-[10px] text-[#34D399]">
                          <CheckCircle2 className="h-3 w-3" />
                          Installed
                        </span>
                      ) : m.status === 'update_available' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-[#3B82F6]/20 px-1.5 py-0.5 text-[10px] text-[#93C5FD]">
                          Update Available
                        </span>
                      ) : m.status === 'corrupted' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-[#EF4444]/15 px-1.5 py-0.5 text-[10px] text-[#FCA5A5]">
                          <AlertTriangle className="h-3 w-3" />
                          Corrupted SHA-256
                        </span>
                      ) : m.status === 'incompatible' ? (
                        <span className="inline-flex items-center gap-1 rounded bg-[#F59E0B]/15 px-1.5 py-0.5 text-[10px] text-[#FCD34D]">
                          <AlertTriangle className="h-3 w-3" />
                          Incompatible
                        </span>
                      ) : (
                        <span className="rounded bg-[#252B38] px-1.5 py-0.5 text-[10px] text-[#9CA6B8]">
                          Not Installed
                        </span>
                      )}
                      {!m.compatible && (
                        <span className="rounded bg-[#F59E0B]/15 px-1.5 py-0.5 text-[10px] text-[#FCD34D]">
                          {m.compatibilityNote || 'Check Runtime'}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-[#9CA6B8]">{m.description}</p>
                    <p className="mt-0.5 text-[10px] text-[#687387]">
                      Requirement: {m.runtimeRequirement}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {m.status === 'installed' ? (
                      <>
                        <DawButton size="xs" onClick={() => void handleVerify(m.id)} title="Verify SHA-256 Checksum">
                          <ShieldCheck className="h-3.5 w-3.5 text-[#10B981]" />
                          Verify
                        </DawButton>
                        <DawButton size="xs" variant="danger" onClick={() => void handleRemove(m.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </DawButton>
                      </>
                    ) : isDownloading ? (
                      <DawButton size="xs" variant="danger" onClick={() => void handlePause(m.id)}>
                        <PauseCircle className="h-3.5 w-3.5" />
                        Pause ({pct.toFixed(0)}%)
                      </DawButton>
                    ) : (
                      <DawButton
                        size="xs"
                        variant="ai"
                        onClick={() => void handleDownload(m.id)}
                      >
                        <Download className="h-3.5 w-3.5" />
                        {m.status === 'update_available'
                          ? 'Update'
                          : dl > 0
                            ? `Resume (${pct.toFixed(0)}%)`
                            : 'Download'}
                      </DawButton>
                    )}
                  </div>
                </div>

                {(isDownloading || (dl > 0 && m.status !== 'installed')) && (
                  <div className="space-y-1">
                    <div className="h-1.5 w-full overflow-hidden rounded bg-[#181C25]">
                      <div
                        style={{ width: `${pct}%` }}
                        className="h-full bg-[#8B5CF6] transition-all"
                      />
                    </div>
                    <div className="flex justify-between font-mono-tabular text-[10px] text-[#9CA6B8]">
                      <span>
                        {formatBytes(dl)} / {formatBytes(total)}
                      </span>
                      {prog?.speedBps ? <span>{formatBytes(prog.speedBps)}/s</span> : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </NativeModal>
  );
};
