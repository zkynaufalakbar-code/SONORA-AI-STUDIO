import React from 'react';
import {
  FilePlus2,
  FolderOpen,
  Save,
  Undo2,
  Redo2,
  Import,
  Download,
  Settings,
  Mic,
  Podcast,
  Sliders,
  Cpu,
  HardDrive,
} from 'lucide-react';
import { DawButton } from '@/components/ui/Controls';
import { useProjectStore } from '@/stores/projectStore';
import { useTransportStore } from '@/stores/transportStore';
import { useRuntimeStore } from '@/stores/runtimeStore';

interface TopToolbarProps {
  onNewProject: () => void;
  onOpenAudio: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
}

export const TopToolbar: React.FC<TopToolbarProps> = ({
  onNewProject,
  onOpenAudio,
  onOpenProject,
  onSaveProject,
}) => {
  const projectName = useProjectStore((s) => s.projectName);
  const dirty = useProjectStore((s) => s.dirty);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const undoStackLen = useProjectStore((s) => s.undoStack.length);
  const redoStackLen = useProjectStore((s) => s.redoStack.length);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);

  const workspaceMode = useTransportStore((s) => s.workspaceMode);
  const setWorkspaceMode = useTransportStore((s) => s.setWorkspaceMode);

  const diagnostics = useRuntimeStore((s) => s.diagnostics);
  const setShowExport = useRuntimeStore((s) => s.setShowExport);
  const setShowSettings = useRuntimeStore((s) => s.setShowSettings);
  const setShowModelManager = useRuntimeStore((s) => s.setShowModelManager);
  const busyMessage = useRuntimeStore((s) => s.busyMessage);
  const progressPct = useRuntimeStore((s) => s.progressPct);

  return (
    <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-[#252B38] bg-[#12151C] px-3">
      {/* Left: Brand & Project Actions */}
      <div className="flex items-center gap-1.5 min-w-0">
        <div className="flex items-center gap-2 pr-2 border-r border-[#252B38]">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-[#3B82F6]/20 border border-[#3B82F6]/50">
            <span className="text-[11px] font-bold tracking-tight text-[#22D3EE]">S</span>
          </div>
          <div className="hidden lg:flex flex-col leading-none">
            <span className="text-xs font-semibold tracking-wide text-white">
              SONORA <span className="text-[#3B82F6]">AI</span>
            </span>
            <span className="text-[9px] uppercase tracking-widest text-[#687387]">
              {diagnostics?.mode === 'portable' ? 'Portable Edition' : 'Studio Edition'}
            </span>
          </div>
        </div>

        <DawButton size="xs" onClick={onNewProject} title="New Project (Ctrl+N)">
          <FilePlus2 className="h-3.5 w-3.5 text-[#9CA6B8]" />
          <span className="hidden xl:inline">New</span>
        </DawButton>
        <DawButton size="xs" onClick={onOpenAudio} title="Open Audio File">
          <Import className="h-3.5 w-3.5 text-[#22D3EE]" />
          <span className="hidden sm:inline">Open Audio</span>
        </DawButton>
        <DawButton size="xs" onClick={onOpenProject} title="Open Project (.sonora)">
          <FolderOpen className="h-3.5 w-3.5 text-[#9CA6B8]" />
          <span className="hidden xl:inline">Open</span>
        </DawButton>
        <DawButton size="xs" onClick={onSaveProject} title="Save Project (Ctrl+S)">
          <Save className="h-3.5 w-3.5 text-[#9CA6B8]" />
          <span className="hidden sm:inline">Save{dirty ? '*' : ''}</span>
        </DawButton>

        <div className="mx-1 h-4 w-px bg-[#252B38]" />

        <DawButton
          size="xs"
          onClick={undo}
          disabled={undoStackLen === 0}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </DawButton>
        <DawButton
          size="xs"
          onClick={redo}
          disabled={redoStackLen === 0}
          title="Redo (Ctrl+Y)"
          aria-label="Redo"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </DawButton>

        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          aria-label="Project Name"
          className="ml-2 hidden md:block w-36 lg:w-44 rounded border border-transparent bg-[#0B0D11]/60 px-2 py-0.5 text-xs font-medium text-[#E5E7EB] hover:border-[#252B38] focus:border-[#3B82F6] focus:outline-none truncate"
        />
      </div>

      {/* Center: Mode Switcher + Busy Progress */}
      <div className="flex items-center gap-2">
        {busyMessage && (
          <div className="flex items-center gap-2 rounded border border-[#3B82F6]/40 bg-[#3B82F6]/10 px-2.5 py-0.5 text-[11px] text-[#93C5FD]">
            <span className="h-2 w-2 rounded-full bg-[#3B82F6] animate-pulse" />
            <span className="truncate max-w-44">{busyMessage}</span>
            {progressPct !== null && (
              <span className="font-mono-tabular">{progressPct.toFixed(0)}%</span>
            )}
          </div>
        )}

        <nav aria-label="Workspace Modes" className="flex items-center rounded border border-[#252B38] bg-[#0B0D11] p-0.5">
          <button
            type="button"
            onClick={() => setWorkspaceMode('studio')}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors ${
              workspaceMode === 'studio'
                ? 'bg-[#3B82F6] text-white'
                : 'text-[#9CA6B8] hover:text-white'
            }`}
          >
            <Sliders className="h-3 w-3" />
            Studio
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceMode('podcast')}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors ${
              workspaceMode === 'podcast'
                ? 'bg-[#8B5CF6] text-white'
                : 'text-[#9CA6B8] hover:text-white'
            }`}
          >
            <Podcast className="h-3 w-3" />
            Podcast
          </button>
          <button
            type="button"
            onClick={() => setWorkspaceMode('recording')}
            className={`flex items-center gap-1 rounded px-2.5 py-1 text-[11px] font-medium cursor-pointer transition-colors ${
              workspaceMode === 'recording'
                ? 'bg-[#EF4444] text-white'
                : 'text-[#9CA6B8] hover:text-white'
            }`}
          >
            <Mic className="h-3 w-3" />
            Record
          </button>
        </nav>
      </div>

      {/* Right: Models, Export, Settings */}
      <div className="flex items-center gap-1.5">
        {diagnostics?.mode === 'portable' && (
          <span
            title={`Portable Root: ${diagnostics.paths.exeDir}`}
            className="hidden xl:inline-flex items-center gap-1 rounded border border-[#10B981]/40 bg-[#10B981]/10 px-2 py-0.5 text-[10px] font-medium text-[#34D399]"
          >
            <HardDrive className="h-3 w-3" />
            PORTABLE
          </span>
        )}
        <DawButton
          size="xs"
          variant="ai"
          onClick={() => setShowModelManager(true)}
          title="AI Model Manager"
        >
          <Cpu className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">AI Models</span>
        </DawButton>
        <DawButton size="xs" variant="primary" onClick={() => setShowExport(true)}>
          <Download className="h-3.5 w-3.5" />
          <span>Export</span>
        </DawButton>
        <DawButton
          size="xs"
          onClick={() => setShowSettings(true)}
          title="Settings"
          aria-label="Settings"
        >
          <Settings className="h-3.5 w-3.5" />
        </DawButton>
      </div>
    </header>
  );
};
