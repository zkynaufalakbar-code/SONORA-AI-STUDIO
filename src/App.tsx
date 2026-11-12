import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save } from '@tauri-apps/plugin-dialog';
import { TopToolbar } from '@/components/layout/TopToolbar';
import { LeftSidebar } from '@/components/sidebar/LeftSidebar';
import { TimelineWorkspace } from '@/components/timeline/TimelineWorkspace';
import { RightInspector } from '@/components/inspector/RightInspector';
import { TransportBar } from '@/components/layout/TransportBar';
import { RecordingStudioView } from '@/components/modes/RecordingStudioView';
import { PodcastModeView } from '@/components/modes/PodcastModeView';
import { FirstLaunchDialog } from '@/components/modals/FirstLaunchDialog';
import { ModelManagerDialog } from '@/components/modals/ModelManagerDialog';
import { ExportDialog } from '@/components/modals/ExportDialog';
import { SettingsDialog } from '@/components/modals/SettingsDialog';
import { RecoveryDialog } from '@/components/modals/RecoveryDialog';
import {
  getLatestAutosave,
  getStartupFile,
  importAudioFile,
  loadProjectFile,
  saveAutosaveSnapshot,
  saveProjectFile,
  type AutosaveSnapshotEntry,
} from '@/lib/tauri';
import { useProjectStore } from '@/stores/projectStore';
import { useTransportStore } from '@/stores/transportStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { audioEngine } from '@/audio/audioEngine';

const AUDIO_EXTENSIONS = ['wav', 'mp3', 'flac', 'ogg', 'aac', 'm4a', 'opus', 'aiff', 'wma'];

export const App: React.FC = () => {
  const [autosaveCandidate, setAutosaveCandidate] = useState<AutosaveSnapshotEntry | null>(null);
  const [exportPreset, setExportPreset] = useState<{
    format?: string;
    bitrateKbps?: number;
    targetLufs?: number | null;
    presetLabel?: string;
  } | null>(null);

  const tracks = useProjectStore((s) => s.tracks);
  const clips = useProjectStore((s) => s.clips);
  const assets = useProjectStore((s) => s.assets);
  const masterVolumeDb = useProjectStore((s) => s.masterVolumeDb);

  const workspaceMode = useTransportStore((s) => s.workspaceMode);
  const isPlaying = useTransportStore((s) => s.isPlaying);
  const loopEnabled = useTransportStore((s) => s.loopEnabled);
  const loopStartMs = useTransportStore((s) => s.loopStartMs);
  const loopEndMs = useTransportStore((s) => s.loopEndMs);
  const setPlayheadMs = useTransportStore((s) => s.setPlayheadMs);
  const setPlaying = useTransportStore((s) => s.setPlaying);

  const refreshAll = useRuntimeStore((s) => s.refreshAll);
  const setBusy = useRuntimeStore((s) => s.setBusy);
  const setShowExport = useRuntimeStore((s) => s.setShowExport);

  const importAndPlaceAudioFiles = async (filePaths: string[], targetTrackId?: string) => {
    if (filePaths.length === 0) return;
    setBusy(`Importing ${filePaths.length} audio file(s)...`);
    try {
      for (const fp of filePaths) {
        if (fp.toLowerCase().endsWith('.sonora')) {
          const manifest = await loadProjectFile(fp);
          useProjectStore.getState().loadManifest(manifest);
          continue;
        }
        const imported = await importAudioFile(fp);
        useProjectStore.getState().addAsset(imported);
        const state = useProjectStore.getState();
        const tid = targetTrackId ?? state.selectedTrackId ?? state.tracks[0]?.id;
        const trackEnd = state.clips
          .filter((c) => c.trackId === tid)
          .reduce((m, c) => Math.max(m, c.timelineStartMs + c.durationMs), 0);
        state.addClipFromAsset(imported.id, tid, trackEnd);
      }
    } catch (err) {
      console.error('Import error:', err);
    } finally {
      setBusy(null);
    }
  };

  const handleNewProject = () => {
    audioEngine.stop();
    setPlaying(false);
    setPlayheadMs(0);
    useProjectStore.getState().newProject();
  };

  const handleOpenAudio = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: 'Audio Files', extensions: AUDIO_EXTENSIONS }],
    });
    if (!picked) return;
    const list = Array.isArray(picked) ? picked : [picked];
    await importAndPlaceAudioFiles(list);
  };

  const handleOpenProject = async () => {
    const picked = await open({
      multiple: false,
      defaultPath: useRuntimeStore.getState().diagnostics?.paths.projectsDir,
      filters: [{ name: 'SONORA Project', extensions: ['sonora'] }],
    });
    if (!picked || Array.isArray(picked)) return;
    setBusy('Loading project...');
    try {
      const manifest = await loadProjectFile(picked);
      audioEngine.stop();
      setPlaying(false);
      setPlayheadMs(0);
      useProjectStore.getState().loadManifest(manifest);
    } finally {
      setBusy(null);
    }
  };

  const handleSaveProject = async () => {
    const st = useProjectStore.getState();
    let target = st.projectPath;
    if (!target) {
      const diag = useRuntimeStore.getState().diagnostics;
      const base = diag?.paths.projectsDir ?? '';
      const sep = base.endsWith('\\') || base.endsWith('/') ? '' : '\\';
      const picked = await save({
        defaultPath: `${base}${sep}${st.projectName || 'Untitled'}.sonora`,
        filters: [{ name: 'SONORA Project', extensions: ['sonora'] }],
      });
      if (!picked) return;
      target = picked;
    }
    const manifest = st.exportManifest();
    const durationMs = st.clips.reduce(
      (max, c) => Math.max(max, c.timelineStartMs + c.durationMs),
      0,
    );
    const savedPath = await saveProjectFile(
      st.projectId,
      st.projectName,
      target,
      durationMs,
      manifest,
    );
    st.markSaved(savedPath);
  };

  // Boot diagnostics, CLI startup file (.sonora or audio), + autosave recovery check
  useEffect(() => {
    void refreshAll();
    void getStartupFile()
      .then((file) => {
        if (file) {
          void importAndPlaceAudioFiles([file]);
        } else {
          void getLatestAutosave()
            .then((snap) => {
              if (snap) setAutosaveCandidate(snap);
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  // Keep Web Audio engine synchronized with non-destructive state
  useEffect(() => {
    audioEngine.updateProjectSnapshot(tracks, clips, assets, masterVolumeDb);
  }, [tracks, clips, assets, masterVolumeDb]);

  useEffect(() => {
    audioEngine.setLoop(loopEnabled, loopStartMs, loopEndMs);
  }, [loopEnabled, loopStartMs, loopEndMs]);

  // 60fps smooth playhead ticker
  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      setPlayheadMs(audioEngine.getCurrentTimeMs());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // 30-second periodic background autosave
  useEffect(() => {
    const id = window.setInterval(() => {
      const st = useProjectStore.getState();
      if (!st.dirty) return;
      const manifest = st.exportManifest();
      void saveAutosaveSnapshot(st.projectId, st.projectName, JSON.stringify(manifest)).catch(
        () => {},
      );
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // OS Native File Drag & Drop from Explorer
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent((ev) => {
        if (ev.payload.type === 'drop') {
          const valid = ev.payload.paths.filter((p) => {
            const ext = p.split('.').pop()?.toLowerCase() ?? '';
            return AUDIO_EXTENSIONS.includes(ext) || ext === 'sonora';
          });
          if (valid.length > 0) {
            void importAndPlaceAudioFiles(valid);
          }
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  // Global DAW Keyboard Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      const ps = useProjectStore.getState();
      const ts = useTransportStore.getState();

      if (e.code === 'Space') {
        e.preventDefault();
        if (ts.isPlaying) {
          const pos = audioEngine.pause();
          ts.setPlaying(false);
          ts.setPlayheadMs(pos);
        } else {
          ts.setPlaying(true);
          void audioEngine.play(ts.playheadMs, () => {
            ts.setPlaying(false);
            ts.setPlayheadMs(0);
          });
        }
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        ps.undo();
      } else if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) {
        e.preventDefault();
        ps.redo();
      } else if (e.ctrlKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSaveProject();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        handleNewProject();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        ps.copySelectedClips();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'x') {
        e.preventDefault();
        ps.cutSelectedClips();
      } else if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        ps.pasteAtPlayhead(ts.playheadMs);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        ps.deleteSelectedClips(e.shiftKey);
      } else if (!e.ctrlKey && e.key.toLowerCase() === 'v') {
        ps.setActiveTool('select');
      } else if (!e.ctrlKey && e.key.toLowerCase() === 'r') {
        ps.setActiveTool('range');
      } else if (!e.ctrlKey && e.key.toLowerCase() === 'c') {
        ps.setActiveTool('razor');
      } else if (!e.ctrlKey && e.key.toLowerCase() === 't') {
        ps.setActiveTool('stretch');
      } else if (!e.ctrlKey && e.key.toLowerCase() === 'l') {
        ts.toggleLoop();
      } else if (!e.ctrlKey && e.key.toLowerCase() === 's') {
        const target = ps.clips.find(
          (c) =>
            (ps.selectedClipIds.length === 0 || ps.selectedClipIds.includes(c.id)) &&
            ts.playheadMs > c.timelineStartMs &&
            ts.playheadMs < c.timelineStartMs + c.durationMs,
        );
        if (target) ps.splitClipAt(target.id, ts.playheadMs);
      } else if (e.key === 'Home') {
        ts.setPlayheadMs(0);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#0B0D11] text-[#EEF1F6]">
      <TopToolbar
        onNewProject={handleNewProject}
        onOpenAudio={() => void handleOpenAudio()}
        onOpenProject={() => void handleOpenProject()}
        onSaveProject={() => void handleSaveProject()}
      />

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <LeftSidebar onImportAudio={() => void handleOpenAudio()} />

        {workspaceMode === 'studio' && <TimelineWorkspace />}
        {workspaceMode === 'recording' && <RecordingStudioView />}
        {workspaceMode === 'podcast' && (
          <PodcastModeView
            onQuickExportPreset={(preset) => {
              setExportPreset(preset);
              setShowExport(true);
            }}
          />
        )}

        <RightInspector />
      </main>

      <TransportBar />

      {/* Native Accessible Modals */}
      <FirstLaunchDialog />
      <ModelManagerDialog />
      <ExportDialog initialPreset={exportPreset} />
      <SettingsDialog />
      <RecoveryDialog
        autosave={autosaveCandidate}
        onDismiss={() => setAutosaveCandidate(null)}
      />
    </div>
  );
};
export default App;
