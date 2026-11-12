import { create } from 'zustand';
import type { WorkspaceMode } from '@/types/project';

interface TransportState {
  workspaceMode: WorkspaceMode;
  isPlaying: boolean;
  isRecording: boolean;
  playheadMs: number;
  loopEnabled: boolean;
  loopStartMs: number;
  loopEndMs: number;
  pixelsPerSecond: number;
  scrollLeftPx: number;
  snapToGrid: boolean;
  showSpectrogram: boolean;

  setWorkspaceMode: (mode: WorkspaceMode) => void;
  setPlaying: (playing: boolean) => void;
  setRecording: (rec: boolean) => void;
  setPlayheadMs: (ms: number) => void;
  toggleLoop: () => void;
  setLoopRegion: (startMs: number, endMs: number) => void;
  setZoom: (pps: number) => void;
  setScrollLeftPx: (px: number) => void;
  toggleSnap: () => void;
  toggleSpectrogram: () => void;
}

export const useTransportStore = create<TransportState>((set) => ({
  workspaceMode: 'studio',
  isPlaying: false,
  isRecording: false,
  playheadMs: 0,
  loopEnabled: false,
  loopStartMs: 0,
  loopEndMs: 10000,
  pixelsPerSecond: 60,
  scrollLeftPx: 0,
  snapToGrid: true,
  showSpectrogram: false,

  setWorkspaceMode: (workspaceMode) => set({ workspaceMode }),
  setPlaying: (isPlaying) => set({ isPlaying }),
  setRecording: (isRecording) => set({ isRecording }),
  setPlayheadMs: (playheadMs) => set({ playheadMs: Math.max(0, playheadMs) }),
  toggleLoop: () => set((s) => ({ loopEnabled: !s.loopEnabled })),
  setLoopRegion: (loopStartMs, loopEndMs) => set({ loopStartMs, loopEndMs }),
  setZoom: (pps) => set({ pixelsPerSecond: Math.min(800, Math.max(8, pps)) }),
  setScrollLeftPx: (scrollLeftPx) => set({ scrollLeftPx: Math.max(0, scrollLeftPx) }),
  toggleSnap: () => set((s) => ({ snapToGrid: !s.snapToGrid })),
  toggleSpectrogram: () => set((s) => ({ showSpectrogram: !s.showSpectrogram })),
}));
