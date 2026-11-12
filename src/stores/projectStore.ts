import { create } from 'zustand';
import { getEffectDefinition } from '@/lib/effectsCatalog';
import type { EffectInstance, EffectParams, EffectType } from '@/types/effects';
import type {
  AudioClip,
  AudioTrack,
  ChannelRoutingMode,
  EditorTool,
  FadeCurveType,
  FrequencySelection,
  HistoryEntry,
  MediaAsset,
  ProjectManifest,
  TimeSelection,
  TranscriptSegment,
} from '@/types/project';

const TRACK_COLORS = ['#22D3EE', '#3B82F6', '#8B5CF6', '#10B981', '#F59E0B'];

interface ProjectSnapshot {
  name: string;
  tracks: AudioTrack[];
  clips: AudioClip[];
  assets: Record<string, MediaAsset>;
  masterVolumeDb: number;
  transcript: TranscriptSegment[];
}

interface ClipboardState {
  clips: AudioClip[];
}

interface ProjectStoreState {
  projectId: string;
  projectName: string;
  projectPath: string | null;
  sampleRate: number;
  bitDepth: number;
  masterVolumeDb: number;
  dirty: boolean;
  tracks: AudioTrack[];
  clips: AudioClip[];
  assets: Record<string, MediaAsset>;
  transcript: TranscriptSegment[];

  selectedTrackId: string | null;
  selectedClipIds: string[];
  timeSelection: TimeSelection | null;
  freqSelection: FrequencySelection | null;
  activeTool: EditorTool;
  clipboard: ClipboardState | null;

  undoStack: Array<{ entry: HistoryEntry; snapshot: ProjectSnapshot }>;
  redoStack: Array<{ entry: HistoryEntry; snapshot: ProjectSnapshot }>;

  // Actions
  newProject: (name?: string) => void;
  loadManifest: (manifest: ProjectManifest) => void;
  exportManifest: () => ProjectManifest;
  setProjectPath: (path: string) => void;
  markSaved: (path: string) => void;
  setProjectName: (name: string) => void;
  setMasterVolumeDb: (db: number) => void;

  setActiveTool: (tool: EditorTool) => void;
  selectTrack: (trackId: string | null) => void;
  selectClips: (clipIds: string[]) => void;
  setTimeSelection: (sel: TimeSelection | null) => void;
  setFreqSelection: (sel: FrequencySelection | null) => void;

  addAsset: (asset: MediaAsset) => void;
  addTrack: (opts?: Partial<Pick<AudioTrack, 'name' | 'role' | 'color'>>) => string;
  removeTrack: (trackId: string) => void;
  updateTrack: (trackId: string, patch: Partial<AudioTrack>, label?: string) => void;

  addClipFromAsset: (assetId: string, trackId?: string, timelineStartMs?: number) => string;
  updateClip: (clipId: string, patch: Partial<AudioClip>, label?: string) => void;
  moveClip: (clipId: string, newStartMs: number, newTrackId?: string) => void;
  trimClip: (clipId: string, newStartMs: number, newSourceOffsetMs: number, newDurationMs: number) => void;
  splitClipAt: (clipId: string, splitTimelineMs: number) => void;
  cropClipToSelection: (clipId: string, startMs: number, endMs: number) => void;
  duplicateSelectedClips: () => void;
  deleteSelectedClips: (ripple?: boolean) => void;
  copySelectedClips: () => void;
  cutSelectedClips: () => void;
  pasteAtPlayhead: (playheadMs: number) => void;
  applyCrossfadeOverlap: (clipAId: string, clipBId: string, crossfadeMs: number) => void;
  replaceClipAssetRender: (clipId: string, newAsset: MediaAsset, label: string, resetTrim?: boolean) => void;

  addEffectToTarget: (
    target: { kind: 'track' | 'clip'; id: string },
    type: EffectType,
    paramOverrides?: EffectParams,
  ) => void;
  updateEffectParams: (
    target: { kind: 'track' | 'clip'; id: string },
    effectId: string,
    params: EffectParams,
    bypassed?: boolean,
  ) => void;
  removeEffectFromTarget: (target: { kind: 'track' | 'clip'; id: string }, effectId: string) => void;

  setTranscript: (segments: TranscriptSegment[]) => void;
  undo: () => void;
  redo: () => void;
  jumpToHistoryIndex: (index: number) => void;
}

function makeDefaultTrack(index: number, name?: string, role: AudioTrack['role'] = 'audio'): AudioTrack {
  return {
    id: crypto.randomUUID(),
    name: name ?? `Track ${index + 1}`,
    role,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
    volumeDb: 0,
    pan: 0,
    inputGainDb: 0,
    muted: false,
    solo: false,
    armed: index === 0,
    channelMode: 'stereo',
    heightPx: 96,
    effects: [],
  };
}

function takeSnapshot(s: ProjectStoreState): ProjectSnapshot {
  return structuredClone({
    name: s.projectName,
    tracks: s.tracks,
    clips: s.clips,
    assets: s.assets,
    masterVolumeDb: s.masterVolumeDb,
    transcript: s.transcript,
  });
}

function pushHistory(
  s: ProjectStoreState,
  label: string,
): Pick<ProjectStoreState, 'undoStack' | 'redoStack' | 'dirty'> {
  const entry: HistoryEntry = {
    id: crypto.randomUUID(),
    label,
    timestamp: new Date().toISOString(),
  };
  const nextUndo = [...s.undoStack.slice(-49), { entry, snapshot: takeSnapshot(s) }];
  return { undoStack: nextUndo, redoStack: [], dirty: true };
}

const initialTrack = makeDefaultTrack(0, 'Audio 1');

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projectId: crypto.randomUUID(),
  projectName: 'Untitled Project',
  projectPath: null,
  sampleRate: 48000,
  bitDepth: 24,
  masterVolumeDb: 0,
  dirty: false,
  tracks: [initialTrack],
  clips: [],
  assets: {},
  transcript: [],

  selectedTrackId: initialTrack.id,
  selectedClipIds: [],
  timeSelection: null,
  freqSelection: null,
  activeTool: 'select',
  clipboard: null,
  undoStack: [],
  redoStack: [],

  newProject: (name = 'Untitled Project') => {
    const t1 = makeDefaultTrack(0, 'Audio 1');
    set({
      projectId: crypto.randomUUID(),
      projectName: name,
      projectPath: null,
      masterVolumeDb: 0,
      dirty: false,
      tracks: [t1],
      clips: [],
      assets: {},
      transcript: [],
      selectedTrackId: t1.id,
      selectedClipIds: [],
      timeSelection: null,
      freqSelection: null,
      undoStack: [],
      redoStack: [],
    });
  },

  loadManifest: (m) => {
    set({
      projectId: m.id,
      projectName: m.name,
      projectPath: m.projectPath ?? null,
      sampleRate: m.sampleRate || 48000,
      bitDepth: m.bitDepth || 24,
      masterVolumeDb: m.masterVolumeDb ?? 0,
      dirty: false,
      tracks: m.tracks.length ? m.tracks : [makeDefaultTrack(0)],
      clips: m.clips ?? [],
      assets: m.assets ?? {},
      transcript: m.transcript ?? [],
      selectedTrackId: m.tracks[0]?.id ?? null,
      selectedClipIds: [],
      timeSelection: null,
      freqSelection: null,
      undoStack: [],
      redoStack: [],
    });
  },

  exportManifest: () => {
    const s = get();
    const now = new Date().toISOString();
    return {
      schemaVersion: 1,
      id: s.projectId,
      name: s.projectName,
      projectPath: s.projectPath,
      sampleRate: s.sampleRate,
      bitDepth: s.bitDepth,
      masterVolumeDb: s.masterVolumeDb,
      tracks: s.tracks,
      clips: s.clips,
      assets: s.assets,
      transcript: s.transcript,
      createdAt: now,
      updatedAt: now,
    };
  },

  setProjectPath: (path) => set({ projectPath: path }),
  markSaved: (path) => set({ projectPath: path, dirty: false }),
  setProjectName: (name) => set({ projectName: name, dirty: true }),
  setMasterVolumeDb: (db) => set({ masterVolumeDb: db }),

  setActiveTool: (tool) => set({ activeTool: tool }),
  selectTrack: (trackId) => set({ selectedTrackId: trackId }),
  selectClips: (clipIds) => set({ selectedClipIds: clipIds }),
  setTimeSelection: (sel) => set({ timeSelection: sel }),
  setFreqSelection: (sel) => set({ freqSelection: sel }),

  addAsset: (asset) =>
    set((s) => ({
      assets: { ...s.assets, [asset.id]: asset },
    })),

  addTrack: (opts) => {
    const s = get();
    const hist = pushHistory(s, `Add Track ${opts?.name ?? s.tracks.length + 1}`);
    const track = makeDefaultTrack(s.tracks.length, opts?.name, opts?.role ?? 'audio');
    if (opts?.color) track.color = opts.color;
    set({
      ...hist,
      tracks: [...s.tracks, track],
      selectedTrackId: track.id,
    });
    return track.id;
  },

  removeTrack: (trackId) => {
    const s = get();
    if (s.tracks.length <= 1) return;
    const hist = pushHistory(s, 'Remove Track');
    const nextTracks = s.tracks.filter((t) => t.id !== trackId);
    set({
      ...hist,
      tracks: nextTracks,
      clips: s.clips.filter((c) => c.trackId !== trackId),
      selectedTrackId: s.selectedTrackId === trackId ? nextTracks[0]?.id ?? null : s.selectedTrackId,
    });
  },

  updateTrack: (trackId, patch, label) => {
    const s = get();
    const hist = label ? pushHistory(s, label) : { dirty: true };
    set({
      ...hist,
      tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
    });
  },

  addClipFromAsset: (assetId, trackId, timelineStartMs = 0) => {
    const s = get();
    const asset = s.assets[assetId];
    if (!asset) return '';
    const targetTrackId = trackId ?? s.selectedTrackId ?? s.tracks[0]?.id;
    const track = s.tracks.find((t) => t.id === targetTrackId);
    if (!targetTrackId || !track) return '';

    const hist = pushHistory(s, `Add Clip "${asset.name}"`);
    const clip: AudioClip = {
      id: crypto.randomUUID(),
      trackId: targetTrackId,
      assetId: asset.id,
      renderAssetId: null,
      name: asset.name,
      timelineStartMs: Math.max(0, Math.round(timelineStartMs)),
      sourceOffsetMs: 0,
      durationMs: Math.max(50, asset.durationMs),
      gainDb: 0,
      fadeInMs: 0,
      fadeOutMs: 0,
      fadeInCurve: 'linear',
      fadeOutCurve: 'linear',
      playbackRate: 1.0,
      pitchSemitones: 0,
      channelMode: 'stereo',
      muted: false,
      color: track.color,
      effects: [],
    };
    set({
      ...hist,
      clips: [...s.clips, clip],
      selectedClipIds: [clip.id],
      selectedTrackId: targetTrackId,
    });
    return clip.id;
  },

  updateClip: (clipId, patch, label) => {
    const s = get();
    const hist = label ? pushHistory(s, label) : { dirty: true };
    set({
      ...hist,
      clips: s.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)),
    });
  },

  moveClip: (clipId, newStartMs, newTrackId) => {
    const s = get();
    const clip = s.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const hist = pushHistory(s, `Move "${clip.name}"`);
    set({
      ...hist,
      clips: s.clips.map((c) =>
        c.id === clipId
          ? {
              ...c,
              timelineStartMs: Math.max(0, Math.round(newStartMs)),
              trackId: newTrackId ?? c.trackId,
            }
          : c,
      ),
    });
  },

  trimClip: (clipId, newStartMs, newSourceOffsetMs, newDurationMs) => {
    const s = get();
    const clip = s.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const hist = pushHistory(s, `Trim "${clip.name}"`);
    set({
      ...hist,
      clips: s.clips.map((c) =>
        c.id === clipId
          ? {
              ...c,
              timelineStartMs: Math.max(0, Math.round(newStartMs)),
              sourceOffsetMs: Math.max(0, Math.round(newSourceOffsetMs)),
              durationMs: Math.max(40, Math.round(newDurationMs)),
            }
          : c,
      ),
    });
  },

  splitClipAt: (clipId, splitTimelineMs) => {
    const s = get();
    const clip = s.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const rel = splitTimelineMs - clip.timelineStartMs;
    if (rel <= 30 || rel >= clip.durationMs - 30) return;

    const hist = pushHistory(s, `Split "${clip.name}"`);
    const left: AudioClip = {
      ...clip,
      durationMs: Math.round(rel),
      fadeOutMs: 0,
    };
    const right: AudioClip = {
      ...structuredClone(clip),
      id: crypto.randomUUID(),
      timelineStartMs: Math.round(splitTimelineMs),
      sourceOffsetMs: Math.round(clip.sourceOffsetMs + rel * clip.playbackRate),
      durationMs: Math.round(clip.durationMs - rel),
      fadeInMs: 0,
    };
    set({
      ...hist,
      clips: s.clips.flatMap((c) => (c.id === clipId ? [left, right] : [c])),
      selectedClipIds: [right.id],
    });
  },

  cropClipToSelection: (clipId, startMs, endMs) => {
    const s = get();
    const clip = s.clips.find((c) => c.id === clipId);
    if (!clip) return;
    const cStart = Math.max(clip.timelineStartMs, startMs);
    const cEnd = Math.min(clip.timelineStartMs + clip.durationMs, endMs);
    if (cEnd - cStart < 30) return;

    const hist = pushHistory(s, `Crop "${clip.name}"`);
    const delta = cStart - clip.timelineStartMs;
    set({
      ...hist,
      clips: s.clips.map((c) =>
        c.id === clipId
          ? {
              ...c,
              timelineStartMs: Math.round(cStart),
              sourceOffsetMs: Math.round(c.sourceOffsetMs + delta * c.playbackRate),
              durationMs: Math.round(cEnd - cStart),
            }
          : c,
      ),
    });
  },

  duplicateSelectedClips: () => {
    const s = get();
    const selected = s.clips.filter((c) => s.selectedClipIds.includes(c.id));
    if (selected.length === 0) return;
    const hist = pushHistory(s, `Duplicate ${selected.length} clip(s)`);
    const copies = selected.map((c) => ({
      ...structuredClone(c),
      id: crypto.randomUUID(),
      timelineStartMs: c.timelineStartMs + c.durationMs + 200,
    }));
    set({
      ...hist,
      clips: [...s.clips, ...copies],
      selectedClipIds: copies.map((c) => c.id),
    });
  },

  deleteSelectedClips: (ripple = false) => {
    const s = get();
    if (s.selectedClipIds.length === 0) return;
    const hist = pushHistory(s, ripple ? 'Ripple Delete Clips' : 'Delete Clips');
    const deleted = s.clips.filter((c) => s.selectedClipIds.includes(c.id));
    let remaining = s.clips.filter((c) => !s.selectedClipIds.includes(c.id));

    if (ripple && deleted.length === 1) {
      const target = deleted[0];
      const gapEnd = target.timelineStartMs + target.durationMs;
      remaining = remaining.map((c) =>
        c.trackId === target.trackId && c.timelineStartMs >= gapEnd
          ? { ...c, timelineStartMs: Math.max(0, c.timelineStartMs - target.durationMs) }
          : c,
      );
    }

    set({
      ...hist,
      clips: remaining,
      selectedClipIds: [],
    });
  },

  copySelectedClips: () => {
    const s = get();
    const selected = s.clips.filter((c) => s.selectedClipIds.includes(c.id));
    if (selected.length === 0) return;
    set({ clipboard: { clips: structuredClone(selected) } });
  },

  cutSelectedClips: () => {
    const s = get();
    const selected = s.clips.filter((c) => s.selectedClipIds.includes(c.id));
    if (selected.length === 0) return;
    const hist = pushHistory(s, `Cut ${selected.length} clip(s)`);
    set({
      ...hist,
      clipboard: { clips: structuredClone(selected) },
      clips: s.clips.filter((c) => !s.selectedClipIds.includes(c.id)),
      selectedClipIds: [],
    });
  },

  pasteAtPlayhead: (playheadMs) => {
    const s = get();
    if (!s.clipboard || s.clipboard.clips.length === 0) return;
    const minStart = Math.min(...s.clipboard.clips.map((c) => c.timelineStartMs));
    const hist = pushHistory(s, 'Paste Clips');
    const pasted = s.clipboard.clips.map((c) => ({
      ...structuredClone(c),
      id: crypto.randomUUID(),
      trackId: s.selectedTrackId ?? c.trackId,
      timelineStartMs: Math.max(0, Math.round(playheadMs + (c.timelineStartMs - minStart))),
    }));
    set({
      ...hist,
      clips: [...s.clips, ...pasted],
      selectedClipIds: pasted.map((c) => c.id),
    });
  },

  applyCrossfadeOverlap: (clipAId, clipBId, crossfadeMs) => {
    const s = get();
    const a = s.clips.find((c) => c.id === clipAId);
    const b = s.clips.find((c) => c.id === clipBId);
    if (!a || !b) return;
    const first = a.timelineStartMs <= b.timelineStartMs ? a : b;
    const second = first.id === a.id ? b : a;
    const cf = Math.min(crossfadeMs, Math.floor(first.durationMs / 2), Math.floor(second.durationMs / 2));
    if (cf < 20) return;

    const hist = pushHistory(s, `Crossfade (${cf} ms)`);
    const newSecondStart = Math.max(0, first.timelineStartMs + first.durationMs - cf);
    set({
      ...hist,
      clips: s.clips.map((c) => {
        if (c.id === first.id) return { ...c, fadeOutMs: cf, fadeOutCurve: 's_curve' as FadeCurveType };
        if (c.id === second.id)
          return {
            ...c,
            timelineStartMs: newSecondStart,
            fadeInMs: cf,
            fadeInCurve: 's_curve' as FadeCurveType,
          };
        return c;
      }),
    });
  },

  replaceClipAssetRender: (clipId, newAsset, label, resetTrim = true) => {
    const s = get();
    const hist = pushHistory(s, label);
    set({
      ...hist,
      assets: { ...s.assets, [newAsset.id]: newAsset },
      clips: s.clips.map((c) =>
        c.id === clipId
          ? {
              ...c,
              renderAssetId: newAsset.id,
              ...(resetTrim
                ? {
                    sourceOffsetMs: 0,
                    durationMs: Math.max(40, newAsset.durationMs),
                    playbackRate: 1.0,
                    pitchSemitones: 0,
                  }
                : {}),
            }
          : c,
      ),
    });
  },

  addEffectToTarget: (target, type, paramOverrides) => {
    const s = get();
    const def = getEffectDefinition(type);
    const fx: EffectInstance = {
      id: crypto.randomUUID(),
      type: def.type,
      name: def.name,
      category: def.category,
      bypassed: false,
      params: {
        ...structuredClone(def.defaultParams),
        ...(paramOverrides ? structuredClone(paramOverrides) : {}),
      },
    };
    const hist = pushHistory(s, `Add ${def.name}`);
    if (target.kind === 'track') {
      set({
        ...hist,
        tracks: s.tracks.map((t) =>
          t.id === target.id ? { ...t, effects: [...t.effects, fx] } : t,
        ),
      });
    } else {
      set({
        ...hist,
        clips: s.clips.map((c) =>
          c.id === target.id ? { ...c, effects: [...c.effects, fx] } : c,
        ),
      });
    }
  },

  updateEffectParams: (target, effectId, params, bypassed) => {
    const s = get();
    if (target.kind === 'track') {
      set({
        dirty: true,
        tracks: s.tracks.map((t) =>
          t.id === target.id
            ? {
                ...t,
                effects: t.effects.map((e) =>
                  e.id === effectId
                    ? { ...e, params: { ...e.params, ...params }, bypassed: bypassed ?? e.bypassed }
                    : e,
                ),
              }
            : t,
        ),
      });
    } else {
      set({
        dirty: true,
        clips: s.clips.map((c) =>
          c.id === target.id
            ? {
                ...c,
                effects: c.effects.map((e) =>
                  e.id === effectId
                    ? { ...e, params: { ...e.params, ...params }, bypassed: bypassed ?? e.bypassed }
                    : e,
                ),
              }
            : c,
        ),
      });
    }
  },

  removeEffectFromTarget: (target, effectId) => {
    const s = get();
    const hist = pushHistory(s, 'Remove Effect');
    if (target.kind === 'track') {
      set({
        ...hist,
        tracks: s.tracks.map((t) =>
          t.id === target.id
            ? { ...t, effects: t.effects.filter((e) => e.id !== effectId) }
            : t,
        ),
      });
    } else {
      set({
        ...hist,
        clips: s.clips.map((c) =>
          c.id === target.id
            ? { ...c, effects: c.effects.filter((e) => e.id !== effectId) }
            : c,
        ),
      });
    }
  },

  setTranscript: (segments) => set({ transcript: segments, dirty: true }),

  undo: () => {
    const s = get();
    if (s.undoStack.length === 0) return;
    const prev = s.undoStack[s.undoStack.length - 1];
    const currentSnap = takeSnapshot(s);
    set({
      projectName: prev.snapshot.name,
      tracks: prev.snapshot.tracks,
      clips: prev.snapshot.clips,
      assets: prev.snapshot.assets,
      masterVolumeDb: prev.snapshot.masterVolumeDb,
      transcript: prev.snapshot.transcript,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, { entry: prev.entry, snapshot: currentSnap }],
      dirty: true,
    });
  },

  redo: () => {
    const s = get();
    if (s.redoStack.length === 0) return;
    const next = s.redoStack[s.redoStack.length - 1];
    const currentSnap = takeSnapshot(s);
    set({
      projectName: next.snapshot.name,
      tracks: next.snapshot.tracks,
      clips: next.snapshot.clips,
      assets: next.snapshot.assets,
      masterVolumeDb: next.snapshot.masterVolumeDb,
      transcript: next.snapshot.transcript,
      redoStack: s.redoStack.slice(0, -1),
      undoStack: [...s.undoStack, { entry: next.entry, snapshot: currentSnap }],
      dirty: true,
    });
  },

  jumpToHistoryIndex: (targetIdx) => {
    const s = get();
    const steps = s.undoStack.length - 1 - targetIdx;
    for (let i = 0; i < steps; i++) {
      get().undo();
    }
  },
}));

export type { ChannelRoutingMode };
