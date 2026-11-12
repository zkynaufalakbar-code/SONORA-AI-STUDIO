import React, { useEffect, useRef, useState } from 'react';
import {
  MousePointer2,
  Type,
  Scissors,
  StretchHorizontal,
  Copy,
  ClipboardPaste,
  Trash2,
  Layers,
  Magnet,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Activity,
  Plus,
  GitMerge,
  AlignHorizontalSpaceAround,
} from 'lucide-react';
import { DawButton } from '@/components/ui/Controls';
import { TimeRulerCanvas } from './TimeRulerCanvas';
import { TrackLaneRow } from './TrackLaneRow';
import { SpectrogramView } from './SpectrogramView';
import { useProjectStore } from '@/stores/projectStore';
import { useTransportStore } from '@/stores/transportStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { alignClipsCrossCorr } from '@/lib/tauri';
import { audioEngine } from '@/audio/audioEngine';

export const TimelineWorkspace: React.FC = () => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(800);

  const tracks = useProjectStore((s) => s.tracks);
  const clips = useProjectStore((s) => s.clips);
  const assets = useProjectStore((s) => s.assets);
  const selectedTrackId = useProjectStore((s) => s.selectedTrackId);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const activeTool = useProjectStore((s) => s.activeTool);
  const timeSelection = useProjectStore((s) => s.timeSelection);
  const clipboard = useProjectStore((s) => s.clipboard);

  const setActiveTool = useProjectStore((s) => s.setActiveTool);
  const addTrack = useProjectStore((s) => s.addTrack);
  const splitClipAt = useProjectStore((s) => s.splitClipAt);
  const cropClipToSelection = useProjectStore((s) => s.cropClipToSelection);
  const duplicateSelectedClips = useProjectStore((s) => s.duplicateSelectedClips);
  const deleteSelectedClips = useProjectStore((s) => s.deleteSelectedClips);
  const copySelectedClips = useProjectStore((s) => s.copySelectedClips);
  const cutSelectedClips = useProjectStore((s) => s.cutSelectedClips);
  const pasteAtPlayhead = useProjectStore((s) => s.pasteAtPlayhead);
  const applyCrossfadeOverlap = useProjectStore((s) => s.applyCrossfadeOverlap);
  const moveClip = useProjectStore((s) => s.moveClip);

  const isPlaying = useTransportStore((s) => s.isPlaying);
  const playheadMs = useTransportStore((s) => s.playheadMs);
  const loopEnabled = useTransportStore((s) => s.loopEnabled);
  const loopStartMs = useTransportStore((s) => s.loopStartMs);
  const loopEndMs = useTransportStore((s) => s.loopEndMs);
  const pixelsPerSecond = useTransportStore((s) => s.pixelsPerSecond);
  const scrollLeftPx = useTransportStore((s) => s.scrollLeftPx);
  const snapToGrid = useTransportStore((s) => s.snapToGrid);
  const showSpectrogram = useTransportStore((s) => s.showSpectrogram);

  const setPlayheadMs = useTransportStore((s) => s.setPlayheadMs);
  const setZoom = useTransportStore((s) => s.setZoom);
  const setScrollLeftPx = useTransportStore((s) => s.setScrollLeftPx);
  const toggleSnap = useTransportStore((s) => s.toggleSnap);
  const toggleSpectrogram = useTransportStore((s) => s.toggleSpectrogram);

  const setBusy = useRuntimeStore((s) => s.setBusy);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        // Subtract track header width (224px = w-56)
        setViewportWidth(Math.max(320, Math.floor(entry.contentRect.width - 224)));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const maxClipEndMs = clips.reduce((acc, c) => Math.max(acc, c.timelineStartMs + c.durationMs), 30_000);
  const timelineTotalSec = Math.max(60, Math.ceil(maxClipEndMs / 1000) + 15);
  const totalCanvasWidthPx = Math.max(viewportWidth, Math.ceil(timelineTotalSec * pixelsPerSecond));

  const handleSeek = (ms: number) => {
    setPlayheadMs(ms);
    if (isPlaying) {
      void audioEngine.play(ms);
    }
  };

  const handleSplitAtPlayhead = () => {
    const targets = selectedClipIds.length
      ? clips.filter((c) => selectedClipIds.includes(c.id))
      : clips.filter((c) => playheadMs > c.timelineStartMs && playheadMs < c.timelineStartMs + c.durationMs);
    for (const c of targets) {
      splitClipAt(c.id, playheadMs);
    }
  };

  const handleCropToSelection = () => {
    if (!timeSelection || selectedClipIds.length === 0) return;
    cropClipToSelection(selectedClipIds[0], timeSelection.startMs, timeSelection.endMs);
  };

  const handleAutoAlign = async () => {
    if (selectedClipIds.length < 2) return;
    const c1 = clips.find((c) => c.id === selectedClipIds[0]);
    const c2 = clips.find((c) => c.id === selectedClipIds[1]);
    if (!c1 || !c2) return;
    const a1 = assets[c1.renderAssetId ?? c1.assetId];
    const a2 = assets[c2.renderAssetId ?? c2.assetId];
    if (!a1 || !a2) return;

    setBusy('Cross-correlating phase alignment...');
    try {
      const offsetMs = await alignClipsCrossCorr(
        a1.resolvedPath,
        c1.sourceOffsetMs,
        a2.resolvedPath,
        c2.sourceOffsetMs,
        6000,
      );
      moveClip(c2.id, Math.max(0, c1.timelineStartMs + offsetMs));
    } finally {
      setBusy(null);
    }
  };

  const handleFitZoom = () => {
    const targetDurSec = Math.max(5, maxClipEndMs / 1000);
    setZoom((viewportWidth - 40) / targetDurSec);
    setScrollLeftPx(0);
  };

  const onLaneWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 0.85;
      setZoom(pixelsPerSecond * factor);
    } else if (Math.abs(e.deltaX) > 0 || e.shiftKey) {
      const delta = Math.abs(e.deltaX) > 0 ? e.deltaX : e.deltaY;
      setScrollLeftPx(Math.min(Math.max(0, totalCanvasWidthPx - viewportWidth), scrollLeftPx + delta));
    }
  };

  return (
    <section
      aria-label="Multi-track Timeline Workspace"
      className="flex min-w-0 flex-1 flex-col bg-[#0B0D11]"
    >
      {/* Timeline Edit & Tool Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#252B38] bg-[#12151C] px-2.5 py-1.5">
        {/* Left: Tools */}
        <div className="flex items-center gap-1">
          <DawButton
            size="xs"
            active={activeTool === 'select'}
            onClick={() => setActiveTool('select')}
            title="Select / Move / Trim Tool (V)"
          >
            <MousePointer2 className="h-3.5 w-3.5" />
          </DawButton>
          <DawButton
            size="xs"
            active={activeTool === 'range'}
            onClick={() => setActiveTool('range')}
            title="Time Range Selection Tool (R)"
          >
            <Type className="h-3.5 w-3.5" />
          </DawButton>
          <DawButton
            size="xs"
            active={activeTool === 'razor'}
            onClick={() => setActiveTool('razor')}
            title="Razor Split Tool (C)"
          >
            <Scissors className="h-3.5 w-3.5" />
          </DawButton>
          <DawButton
            size="xs"
            active={activeTool === 'stretch'}
            onClick={() => setActiveTool('stretch')}
            title="Time Stretch Clip Tool (T)"
          >
            <StretchHorizontal className="h-3.5 w-3.5" />
          </DawButton>

          <div className="mx-1 h-4 w-px bg-[#252B38]" />

          <DawButton
            size="xs"
            onClick={handleSplitAtPlayhead}
            disabled={clips.length === 0}
            title="Split Clip at Playhead"
          >
            Split
          </DawButton>
          <DawButton
            size="xs"
            onClick={handleCropToSelection}
            disabled={!timeSelection || selectedClipIds.length === 0}
            title="Crop Clip to Time Selection"
          >
            Crop
          </DawButton>
          <DawButton
            size="xs"
            onClick={cutSelectedClips}
            disabled={selectedClipIds.length === 0}
            title="Cut (Ctrl+X)"
          >
            Cut
          </DawButton>
          <DawButton
            size="xs"
            onClick={copySelectedClips}
            disabled={selectedClipIds.length === 0}
            title="Copy (Ctrl+C)"
            aria-label="Copy"
          >
            <Copy className="h-3.5 w-3.5" />
          </DawButton>
          <DawButton
            size="xs"
            onClick={() => pasteAtPlayhead(playheadMs)}
            disabled={!clipboard?.clips.length}
            title="Paste at Playhead (Ctrl+V)"
            aria-label="Paste"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
          </DawButton>
          <DawButton
            size="xs"
            onClick={duplicateSelectedClips}
            disabled={selectedClipIds.length === 0}
            title="Duplicate Clip"
          >
            Dup
          </DawButton>
          <DawButton
            size="xs"
            onClick={() => deleteSelectedClips(false)}
            disabled={selectedClipIds.length === 0}
            title="Delete Selected (Del)"
            aria-label="Delete Selected Clips"
          >
            <Trash2 className="h-3.5 w-3.5 text-[#EF4444]" />
          </DawButton>
          <DawButton
            size="xs"
            onClick={() => deleteSelectedClips(true)}
            disabled={selectedClipIds.length !== 1}
            title="Ripple Delete (closes gap)"
          >
            Ripple
          </DawButton>

          <div className="mx-1 h-4 w-px bg-[#252B38]" />

          <DawButton
            size="xs"
            disabled={selectedClipIds.length !== 2}
            onClick={() => applyCrossfadeOverlap(selectedClipIds[0], selectedClipIds[1], 350)}
            title="Crossfade 2 Selected Clips (S-Curve)"
          >
            <GitMerge className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Crossfade</span>
          </DawButton>
          <DawButton
            size="xs"
            disabled={selectedClipIds.length !== 2}
            onClick={() => void handleAutoAlign()}
            title="Phase Align 2 Selected Clips (Cross-Correlation)"
          >
            <AlignHorizontalSpaceAround className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Align</span>
          </DawButton>
        </div>

        {/* Right: View, Snap, Zoom */}
        <div className="flex items-center gap-1">
          <DawButton
            size="xs"
            active={showSpectrogram}
            onClick={toggleSpectrogram}
            title="Toggle STFT Spectral Frequency View"
          >
            <Activity className="h-3.5 w-3.5 text-[#22D3EE]" />
            <span className="hidden lg:inline">Spectral</span>
          </DawButton>
          <DawButton
            size="xs"
            active={snapToGrid}
            onClick={toggleSnap}
            title="Snap to Grid"
            aria-label="Snap to Grid"
          >
            <Magnet className="h-3.5 w-3.5" />
          </DawButton>

          <div className="mx-1 h-4 w-px bg-[#252B38]" />

          <DawButton
            size="xs"
            onClick={() => setZoom(pixelsPerSecond * 0.78)}
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </DawButton>
          <DawButton
            size="xs"
            onClick={() => setZoom(pixelsPerSecond * 1.28)}
            title="Zoom In"
            aria-label="Zoom In"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </DawButton>
          <DawButton size="xs" onClick={handleFitZoom} title="Zoom to Fit Project" aria-label="Fit Zoom">
            <Maximize2 className="h-3.5 w-3.5" />
          </DawButton>
        </div>
      </div>

      {/* Main Scrollable Multitrack Viewport */}
      <div
        ref={viewportRef}
        onWheel={onLaneWheel}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* Sticky Ruler Row */}
        <div className="flex h-7 shrink-0 border-b border-[#252B38] bg-[#0E1117]">
          <div className="flex w-56 shrink-0 items-center justify-between border-r border-[#252B38] px-2.5 text-[10px] font-semibold uppercase tracking-wider text-[#687387]">
            <span className="flex items-center gap-1">
              <Layers className="h-3 w-3 text-[#3B82F6]" />
              Tracks ({tracks.length})
            </span>
            <DawButton size="xs" onClick={() => addTrack()} title="Add Audio Track">
              <Plus className="h-3 w-3" />
              Track
            </DawButton>
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <TimeRulerCanvas
              widthPx={viewportWidth}
              scrollLeftPx={scrollLeftPx}
              pixelsPerSecond={pixelsPerSecond}
              playheadMs={playheadMs}
              loopEnabled={loopEnabled}
              loopStartMs={loopStartMs}
              loopEndMs={loopEndMs}
              timeSelection={timeSelection}
              onSeekMs={handleSeek}
            />
          </div>
        </div>

        {/* Vertical Scrolling Tracks */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden">
          {tracks.map((track) => (
            <TrackLaneRow
              key={track.id}
              track={track}
              clips={clips.filter((c) => c.trackId === track.id)}
              assets={assets}
              selectedTrackId={selectedTrackId}
              selectedClipIds={selectedClipIds}
              activeTool={activeTool}
              pixelsPerSecond={pixelsPerSecond}
              scrollLeftPx={scrollLeftPx}
              laneWidthPx={viewportWidth}
              playheadMs={playheadMs}
              timeSelection={timeSelection}
              snapToGrid={snapToGrid}
              canRemoveTrack={tracks.length > 1}
            />
          ))}

          {clips.length === 0 && (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <p className="text-xs font-medium text-[#9CA6B8]">
                Drop audio files (WAV, MP3, FLAC, OGG, M4A) anywhere here or click{' '}
                <span className="text-[#22D3EE]">Open Audio</span>
              </p>
              <p className="mt-1 text-[11px] text-[#687387]">
                Or drag imported clips from the Media Library onto any track lane.
              </p>
            </div>
          )}
        </div>

        {/* Horizontal Timeline Scrollbar */}
        <div className="flex h-5 shrink-0 items-center border-t border-[#252B38] bg-[#0E1117]">
          <div className="w-56 shrink-0 border-r border-[#252B38] px-2.5 text-[10px] text-[#687387]">
            Zoom: {Math.round(pixelsPerSecond)} px/s
          </div>
          <div className="flex flex-1 items-center px-2">
            <input
              type="range"
              aria-label="Timeline Horizontal Scroll"
              min={0}
              max={Math.max(0, totalCanvasWidthPx - viewportWidth)}
              step={10}
              value={scrollLeftPx}
              onChange={(e) => setScrollLeftPx(parseFloat(e.target.value))}
              className="daw-slider w-full"
            />
          </div>
        </div>
      </div>

      {/* Collapsible Spectral Editor */}
      {showSpectrogram && <SpectrogramView />}
    </section>
  );
};
