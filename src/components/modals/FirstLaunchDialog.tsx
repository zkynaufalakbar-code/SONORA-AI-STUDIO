import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, FolderOpen, HardDrive, Cpu } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { DawButton, NativeModal } from '@/components/ui/Controls';
import { completeFirstLaunch, setCustomModelsDir } from '@/lib/tauri';
import { useRuntimeStore } from '@/stores/runtimeStore';

export const FirstLaunchDialog: React.FC = () => {
  const showFirstLaunch = useRuntimeStore((s) => s.showFirstLaunch);
  const setShowFirstLaunch = useRuntimeStore((s) => s.setShowFirstLaunch);
  const setShowModelManager = useRuntimeStore((s) => s.setShowModelManager);
  const diagnostics = useRuntimeStore((s) => s.diagnostics);
  const refreshAll = useRuntimeStore((s) => s.refreshAll);
  const [savingDir, setSavingDir] = useState(false);

  if (!showFirstLaunch || !diagnostics) return null;

  const isPortable = diagnostics.mode === 'portable';

  const handleChooseModelsDir = async () => {
    const dir = await open({
      directory: true,
      multiple: false,
      defaultPath: diagnostics.paths.modelsDir,
    });
    if (!dir || Array.isArray(dir)) return;
    setSavingDir(true);
    try {
      await setCustomModelsDir(dir);
      await refreshAll();
    } finally {
      setSavingDir(false);
    }
  };

  const handleContinue = async () => {
    await completeFirstLaunch();
    setShowFirstLaunch(false);
  };

  const checks = [
    {
      label: isPortable ? 'Portable Mode Storage (Zero AppData)' : 'Installer AppData & Config Storage',
      ok: diagnostics.paths.isWritable,
      detail: diagnostics.paths.configDir,
    },
    {
      label: 'WASAPI Audio Engine & Devices',
      ok: diagnostics.audioOutputDevices > 0,
      detail: `${diagnostics.audioInputDevices} input(s) · ${diagnostics.audioOutputDevices} output(s) detected`,
    },
    {
      label: 'FFmpeg Audio Engine',
      ok: diagnostics.ffmpegAvailable,
      detail: diagnostics.ffmpegAvailable
        ? `${diagnostics.ffmpegVersion ?? 'Ready'} (afftdn=${diagnostics.hasAfftdn ? 'Y' : 'N'}, rubberband=${diagnostics.hasRubberband ? 'Y' : 'N'}, loudnorm=${diagnostics.hasLoudnorm ? 'Y' : 'N'})`
        : 'FFmpeg not found — configure path in Settings',
    },
    {
      label: 'Modular AI Runtime & Models',
      ok: true,
      detail: `${diagnostics.installedModelCount} offline model(s) installed · Python runtime: ${diagnostics.pythonAvailable ? 'Available' : 'Optional (Cloud/FFmpeg ready)'}`,
    },
  ];

  return (
    <NativeModal
      open={showFirstLaunch}
      onClose={() => void handleContinue()}
      title="Welcome to SONORA AI STUDIO — System Verification"
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-4 text-xs">
        <div className="flex items-center justify-between rounded border border-[#252B38] bg-[#181C25] p-3">
          <div className="flex items-center gap-2.5">
            <HardDrive className={`h-5 w-5 ${isPortable ? 'text-[#10B981]' : 'text-[#3B82F6]'}`} />
            <div>
              <div className="font-semibold text-white">
                {isPortable ? 'Portable Edition Active (portable.flag detected)' : 'Windows Studio Edition (Installer Mode)'}
              </div>
              <div className="text-[11px] text-[#9CA6B8] break-all">
                Root: {diagnostics.paths.exeDir}
              </div>
            </div>
          </div>
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
              isPortable ? 'bg-[#10B981]/20 text-[#34D399]' : 'bg-[#3B82F6]/20 text-[#93C5FD]'
            }`}
          >
            {diagnostics.mode}
          </span>
        </div>

        {/* Readiness Checklist */}
        <div className="space-y-2">
          {checks.map((c) => (
            <div
              key={c.label}
              className="flex items-start gap-2.5 rounded border border-[#252B38] bg-[#0E1117] p-2.5"
            >
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#10B981]" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#F59E0B]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-medium text-[#E5E7EB]">{c.label}</div>
                <div className="mt-0.5 text-[11px] text-[#9CA6B8] break-all">{c.detail}</div>
              </div>
            </div>
          ))}
        </div>

        {/* AI Model Storage Selector */}
        <div className="rounded border border-[#252B38] bg-[#181C25] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white">AI Model Storage Folder</span>
            <DawButton
              size="xs"
              disabled={savingDir}
              onClick={() => void handleChooseModelsDir()}
            >
              <FolderOpen className="h-3.5 w-3.5" />
              Change Location
            </DawButton>
          </div>
          <div className="rounded bg-[#0B0D11] px-2.5 py-1.5 font-mono-tabular text-[11px] text-[#22D3EE] break-all">
            {diagnostics.paths.modelsDir}
          </div>
          <p className="text-[11px] text-[#9CA6B8]">
            AI models are separated from the core app so SONORA stays fast and lightweight. Nothing is downloaded automatically without your approval.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#252B38]">
          <DawButton
            size="md"
            variant="ai"
            onClick={() => {
              void handleContinue();
              setShowModelManager(true);
            }}
          >
            <Cpu className="h-4 w-4" />
            Manage AI Models
          </DawButton>
          <DawButton size="md" variant="primary" onClick={() => void handleContinue()}>
            Start Editing
          </DawButton>
        </div>
      </div>
    </NativeModal>
  );
};
