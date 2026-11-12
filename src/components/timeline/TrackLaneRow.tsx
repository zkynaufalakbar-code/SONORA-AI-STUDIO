import React, { useEffect, useRef, useState } from 'react';
import { Trash2, Volume2, VolumeX } from 'lucide-react';
import { getWaveformWindow, type WaveformWindowResult } from '@/lib/tauri';
import { useProjectStore } from '@/stores/projectStore';
import type { AudioClip, AudioTrack, ChannelRoutingMode, EditorTool, MediaAsset, TimeSelection } from '@/types/project';

interface TrackLaneRowProps {
  track: AudioTrack;
  clips: AudioClip[];
  assets: Record<string, MediaAsset>;
  selectedTrackId: string | null;
  selectedClipIds: string[];
  activeTool: EditorTool;
  pixelsPerSecond: number;
  scrollLeftPx: number;
  laneWidthPx: number;
  playheadMs: number;
  timeSelection: TimeSelection | null;
  snapToGrid: boolean;
  canRemoveTrack: boolean;
  onImportDropPath?: (assetId: string, trackId: string, startMs: number) => void;
}

const CHANNEL_MODES: ChannelRoutingMode[] = ['stereo', 'mono_mix', 'left_only', 'right_only'];
const CHANNEL_BADGES: Record<ChannelRoutingMode, string> = {
  stereo: 'ST',
  mono_mix: 'M',
  left_only: 'L',
  right_only: 'R',
};

export const TrackLaneRow: React.FC<TrackLaneRowProps> = ({
  track,
  clips,
  assets,
  selectedTrackId,
  selectedClipIds,
  activeTool,
  pixelsPerSecond,
  scrollLeftPx,
  laneWidthPx,
  playheadMs,
  timeSelection,
  snapToGrid,
  canRemoveTrack,
  onImportDropPath,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const peakCacheRef = useRef<Map<string, WaveformWindowResult>>(new Map());
  const [peakTick, setPeakTick] = useState(0);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(track.name);

  const selectTrack = useProjectStore((s) => s.selectTrack);
  const selectClips = useProjectStore((s) => s.selectClips);
  const updateTrack = useProjectStore((s) => s.updateTrack);
  const removeTrack = useProjectStore((s) => s.removeTrack);
  const moveClip = useProjectStore((s) => s.moveClip);
  const trimClip = useProjectStore((s) => s.trimClip);
  const updateClip = useProjectStore((s) => s.updateClip);
  const splitClipAt = useProjectStore((s) => s.splitClipAt);
  const setTimeSelection = useProjectStore((s) => s.setTimeSelection);
  const addClipFromAsset = useProjectStore((s) => s.addClipFromAsset);

  const dragStateRef = useRef<{
    kind: 'move' | 'trim_left' | 'trim_right' | 'stretch' | 'fade_in' | 'fade_out' | 'range';
    clipId?: string;
    startClientX: number;
    startClientY: number;
    origStartMs: number;
    origOffsetMs: number;
    origDurMs: number;
    origRate: number;
    anchorMs: number;
  } | null>(null);

  const snapMs = (ms: number) => {
    if (!snapToGrid) return Math.max(0, Math.round(ms));
    const gridMs = pixelsPerSecond > 120 ? 100 : pixelsPerSecond > 50 ? 250 : 500;
    return Math.max(0, Math.round(ms / gridMs) * gridMs);
  };

  // Prefetch waveform peaks lazily for visible clips
  useEffect(() => {
    let cancelled = false;
    for (const clip of clips) {
      const asset = assets[clip.renderAssetId ?? clip.assetId];
      if (!asset?.peakFilePath) continue;
      const clipWidthPx = Math.max(16, Math.round((clip.durationMs / 1000) * pixelsPerSecond));
      const targetBins = Math.min(2000, Math.max(24, Math.floor(clipWidthPx / 2)));
      const srcStart = Math.round(clip.sourceOffsetMs);
      const srcEnd = Math.round(clip.sourceOffsetMs + clip.durationMs * clip.playbackRate);
      const key = `${asset.peakFilePath}|${srcStart}|${srcEnd}|${targetBins}`;
      if (peakCacheRef.current.has(key)) continue;

      void getWaveformWindow(asset.peakFilePath, srcStart, srcEnd, targetBins).then((win) => {
        if (cancelled) return;
        peakCacheRef.current.set(key, win);
        setPeakTick((n) => n + 1);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [clips, assets, pixelsPerSecond]);

  // Draw lane canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(300, Math.floor(laneWidthPx));
    const h = track.heightPx;
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Track lane base
    const isSelTrack = selectedTrackId === track.id;
    ctx.fillStyle = isSelTrack ? '#0E1219' : '#0B0D11';
    ctx.fillRect(0, 0, w, h);

    // Center zero line
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Render each clip
    for (const clip of clips) {
      const cx = (clip.timelineStartMs / 1000) * pixelsPerSecond - scrollLeftPx;
      const cw = Math.max(4, (clip.durationMs / 1000) * pixelsPerSecond);
      if (cx + cw < 0 || cx > w) continue;

      const isSelected = selectedClipIds.includes(clip.id);
      const headerH = 18;
      const bodyTop = headerH;
      const bodyH = h - headerH - 2;

      // Clip box background
      ctx.fillStyle = clip.muted ? '#161922' : '#131924';
      ctx.fillRect(cx, 2, cw, h - 4);

      // Clip header strip
      ctx.fillStyle = isSelected ? '#2563EB' : `${track.color}33`;
      ctx.fillRect(cx, 2, cw, headerH - 2);

      // Border
      ctx.strokeStyle = isSelected ? '#3B82F6' : track.color;
      ctx.lineWidth = isSelected ? 1.5 : 1;
      ctx.strokeRect(cx + 0.5, 2.5, cw - 1, h - 5);

      // Clip label
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx + 2, 2, cw - 4, headerH);
      ctx.clip();
      ctx.font = '10px Inter, "Segoe UI", sans-serif';
      ctx.fillStyle = isSelected ? '#FFFFFF' : '#E5E7EB';
      const meta =
        clip.playbackRate !== 1 || clip.pitchSemitones !== 0
          ? ` [${clip.playbackRate.toFixed(2)}x]`
          : '';
      ctx.fillText(`${clip.name}${meta}`, cx + 5, 13);
      ctx.restore();

      // Waveform inside clip body
      const asset = assets[clip.renderAssetId ?? clip.assetId];
      const clipWidthPx = Math.max(16, Math.round((clip.durationMs / 1000) * pixelsPerSecond));
      const targetBins = Math.min(2000, Math.max(24, Math.floor(clipWidthPx / 2)));
      const srcStart = Math.round(clip.sourceOffsetMs);
      const srcEnd = Math.round(clip.sourceOffsetMs + clip.durationMs * clip.playbackRate);
      const cacheKey = asset?.peakFilePath
        ? `${asset.peakFilePath}|${srcStart}|${srcEnd}|${targetBins}`
        : '';
      const peaks = cacheKey ? peakCacheRef.current.get(cacheKey) : undefined;

      const midY = bodyTop + bodyH / 2;
      const maxAmp = (bodyH / 2) * 0.9;
      const gainMul = Math.min(2.2, Math.pow(10, clip.gainDb / 20));

      ctx.save();
      ctx.beginPath();
      ctx.rect(cx + 1, bodyTop, Math.max(1, cw - 2), bodyH);
      ctx.clip();

      if (peaks && peaks.bins > 0) {
        const stride = peaks.channels * 3;
        const binW = cw / peaks.bins;

        // 1. Peak envelope (min..max across mono or stereo L/R)
        ctx.fillStyle = clip.muted ? 'rgba(75, 85, 101, 0.5)' : 'rgba(34, 211, 238, 0.45)';
        for (let i = 0; i < peaks.bins; i++) {
          const base = i * stride;
          let minV = peaks.data[base] ?? 0;
          let maxV = peaks.data[base + 1] ?? 0;
          if (peaks.channels > 1) {
            minV = Math.min(minV, peaks.data[base + 3] ?? minV);
            maxV = Math.max(maxV, peaks.data[base + 4] ?? maxV);
          }
          const topY = midY - Math.min(1, Math.max(-1, maxV * gainMul)) * maxAmp;
          const botY = midY - Math.min(1, Math.max(-1, minV * gainMul)) * maxAmp;
          const bx = cx + i * binW;
          ctx.fillRect(bx, topY, Math.max(1, binW + 0.3), Math.max(1, botY - topY));
        }

        // 2. RMS energy inner core
        ctx.fillStyle = clip.muted ? '#6B7280' : '#22D3EE';
        for (let i = 0; i < peaks.bins; i++) {
          const base = i * stride;
          let rmsV = peaks.data[base + 2] ?? 0;
          if (peaks.channels > 1) {
            rmsV = Math.max(rmsV, peaks.data[base + 5] ?? rmsV);
          }
          const clampedRms = Math.min(1, Math.max(0, rmsV * gainMul));
          const rmsH = Math.max(1, clampedRms * maxAmp * 2);
          const bx = cx + i * binW;
          ctx.fillRect(bx, midY - rmsH / 2, Math.max(1, binW + 0.3), rmsH);
        }
      } else {
        // Fallback center bar while peak computes
        ctx.fillStyle = '#0891B2';
        ctx.fillRect(cx + 2, midY - 1, Math.max(1, cw - 4), 2);
      }

      // Fade In overlay
      if (clip.fadeInMs > 0) {
        const fw = Math.min(cw, (clip.fadeInMs / 1000) * pixelsPerSecond);
        ctx.fillStyle = 'rgba(11, 13, 17, 0.55)';
        ctx.beginPath();
        ctx.moveTo(cx, bodyTop);
        ctx.lineTo(cx + fw, bodyTop);
        ctx.lineTo(cx, bodyTop + bodyH);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#F59E0B';
        ctx.beginPath();
        ctx.moveTo(cx, bodyTop + bodyH);
        ctx.lineTo(cx + fw, bodyTop);
        ctx.stroke();
      }

      // Fade Out overlay
      if (clip.fadeOutMs > 0) {
        const fw = Math.min(cw, (clip.fadeOutMs / 1000) * pixelsPerSecond);
        ctx.fillStyle = 'rgba(11, 13, 17, 0.55)';
        ctx.beginPath();
        ctx.moveTo(cx + cw - fw, bodyTop);
        ctx.lineTo(cx + cw, bodyTop);
        ctx.lineTo(cx + cw, bodyTop + bodyH);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#F59E0B';
        ctx.beginPath();
        ctx.moveTo(cx + cw - fw, bodyTop);
        ctx.lineTo(cx + cw, bodyTop + bodyH);
        ctx.stroke();
      }

      // Selected Fade Handles
      if (isSelected) {
        const fhIn = cx + Math.min(cw / 2, (clip.fadeInMs / 1000) * pixelsPerSecond);
        const fhOut = cx + cw - Math.min(cw / 2, (clip.fadeOutMs / 1000) * pixelsPerSecond);
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(fhIn - 3, bodyTop, 6, 6);
        ctx.fillRect(fhOut - 3, bodyTop, 6, 6);
      }

      ctx.restore();
    }

    // Time Selection highlight
    if (timeSelection && timeSelection.endMs > timeSelection.startMs) {
      const sx1 = (timeSelection.startMs / 1000) * pixelsPerSecond - scrollLeftPx;
      const sx2 = (timeSelection.endMs / 1000) * pixelsPerSecond - scrollLeftPx;
      ctx.fillStyle = 'rgba(59, 130, 246, 0.16)';
      ctx.fillRect(sx1, 0, Math.max(2, sx2 - sx1), h);
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.65)';
      ctx.strokeRect(sx1 + 0.5, 0.5, Math.max(1, sx2 - sx1 - 1), h - 1);
    }

    // Playhead line
    const px = (playheadMs / 1000) * pixelsPerSecond - scrollLeftPx;
    if (px >= 0 && px <= w) {
      ctx.strokeStyle = '#3B82F6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, 0);
      ctx.lineTo(px + 0.5, h);
      ctx.stroke();
    }
  }, [
    track,
    clips,
    assets,
    selectedTrackId,
    selectedClipIds,
    pixelsPerSecond,
    scrollLeftPx,
    laneWidthPx,
    playheadMs,
    timeSelection,
    peakTick,
  ]);

  const xToMs = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.round(((clientX - rect.left + scrollLeftPx) / pixelsPerSecond) * 1000));
  };

  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    selectTrack(track.id);
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    const clickMs = xToMs(e.clientX);

    if (activeTool === 'range') {
      dragStateRef.current = {
        kind: 'range',
        startClientX: e.clientX,
        startClientY: e.clientY,
        origStartMs: 0,
        origOffsetMs: 0,
        origDurMs: 0,
        origRate: 1,
        anchorMs: clickMs,
      };
      setTimeSelection({ startMs: clickMs, endMs: clickMs, trackId: track.id });
      return;
    }

    // Hit test clips top-to-bottom (reversed so last painted wins)
    const hitClip = [...clips].reverse().find((c) => {
      const cx = (c.timelineStartMs / 1000) * pixelsPerSecond - scrollLeftPx;
      const cw = Math.max(4, (c.durationMs / 1000) * pixelsPerSecond);
      return localX >= cx && localX <= cx + cw;
    });

    if (!hitClip) {
      selectClips([]);
      return;
    }

    if (activeTool === 'razor') {
      splitClipAt(hitClip.id, clickMs);
      return;
    }

    if (e.shiftKey) {
      const exists = selectedClipIds.includes(hitClip.id);
      selectClips(
        exists ? selectedClipIds.filter((id) => id !== hitClip.id) : [...selectedClipIds, hitClip.id],
      );
    } else if (!selectedClipIds.includes(hitClip.id)) {
      selectClips([hitClip.id]);
    }

    const cx = (hitClip.timelineStartMs / 1000) * pixelsPerSecond - scrollLeftPx;
    const cw = Math.max(4, (hitClip.durationMs / 1000) * pixelsPerSecond);

    // Check fade handles near body top (18..28px)
    const fhInX = cx + Math.min(cw / 2, (hitClip.fadeInMs / 1000) * pixelsPerSecond);
    const fhOutX = cx + cw - Math.min(cw / 2, (hitClip.fadeOutMs / 1000) * pixelsPerSecond);
    let kind: NonNullable<typeof dragStateRef.current>['kind'] = 'move';

    if (localY >= 16 && localY <= 30 && Math.abs(localX - fhInX) <= 8) {
      kind = 'fade_in';
    } else if (localY >= 16 && localY <= 30 && Math.abs(localX - fhOutX) <= 8) {
      kind = 'fade_out';
    } else if (localX - cx <= 8) {
      kind = 'trim_left';
    } else if (cx + cw - localX <= 8) {
      kind = activeTool === 'stretch' ? 'stretch' : 'trim_right';
    } else if (activeTool === 'stretch') {
      kind = 'stretch';
    }

    dragStateRef.current = {
      kind,
      clipId: hitClip.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origStartMs: hitClip.timelineStartMs,
      origOffsetMs: hitClip.sourceOffsetMs,
      origDurMs: hitClip.durationMs,
      origRate: hitClip.playbackRate,
      anchorMs: clickMs,
    };
  };

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const deltaMs = Math.round(((ev.clientX - drag.startClientX) / pixelsPerSecond) * 1000);

      if (drag.kind === 'range') {
        const curMs = drag.anchorMs + deltaMs;
        setTimeSelection({
          startMs: Math.max(0, Math.min(drag.anchorMs, curMs)),
          endMs: Math.max(0, Math.max(drag.anchorMs, curMs)),
          trackId: track.id,
        });
        return;
      }

      if (!drag.clipId) return;
      const clip = useProjectStore.getState().clips.find((c) => c.id === drag.clipId);
      if (!clip) return;
      const asset = useProjectStore.getState().assets[clip.renderAssetId ?? clip.assetId];
      const maxAssetDur = asset?.durationMs ?? 3_600_000;

      if (drag.kind === 'move') {
        const targetStart = snapMs(drag.origStartMs + deltaMs);
        // Hit-test track under pointer Y for cross-track dragging
        const elBelow = document.elementFromPoint(ev.clientX, ev.clientY);
        const trackContainer = elBelow?.closest('[data-track-id]') as HTMLElement | null;
        const targetTrackId = trackContainer?.dataset.trackId ?? track.id;
        useProjectStore.setState((s) => ({
          dirty: true,
          clips: s.clips.map((c) =>
            c.id === drag.clipId ? { ...c, timelineStartMs: targetStart, trackId: targetTrackId } : c,
          ),
        }));
      } else if (drag.kind === 'trim_left') {
        const clampedDelta = Math.max(
          -drag.origOffsetMs / drag.origRate,
          Math.min(drag.origDurMs - 60, deltaMs),
        );
        const newStart = Math.max(0, Math.round(drag.origStartMs + clampedDelta));
        const newOffset = Math.max(0, Math.round(drag.origOffsetMs + clampedDelta * drag.origRate));
        const newDur = Math.max(60, Math.round(drag.origDurMs - clampedDelta));
        useProjectStore.setState((s) => ({
          dirty: true,
          clips: s.clips.map((c) =>
            c.id === drag.clipId
              ? { ...c, timelineStartMs: newStart, sourceOffsetMs: newOffset, durationMs: newDur }
              : c,
          ),
        }));
      } else if (drag.kind === 'trim_right') {
        const maxRemainMs = Math.max(60, (maxAssetDur - drag.origOffsetMs) / drag.origRate);
        const newDur = Math.min(maxRemainMs, Math.max(60, Math.round(drag.origDurMs + deltaMs)));
        useProjectStore.setState((s) => ({
          dirty: true,
          clips: s.clips.map((c) => (c.id === drag.clipId ? { ...c, durationMs: newDur } : c)),
        }));
      } else if (drag.kind === 'stretch') {
        const newDur = Math.max(100, Math.round(drag.origDurMs + deltaMs));
        const sourceSpan = drag.origDurMs * drag.origRate;
        const newRate = Math.min(4.0, Math.max(0.25, sourceSpan / newDur));
        useProjectStore.setState((s) => ({
          dirty: true,
          clips: s.clips.map((c) =>
            c.id === drag.clipId ? { ...c, durationMs: newDur, playbackRate: newRate } : c,
          ),
        }));
      } else if (drag.kind === 'fade_in') {
        const fadeMs = Math.min(Math.floor(drag.origDurMs / 2), Math.max(0, deltaMs + clip.fadeInMs));
        useProjectStore.setState((s) => ({
          dirty: true,
          clips: s.clips.map((c) => (c.id === drag.clipId ? { ...c, fadeInMs: Math.round(fadeMs) } : c)),
        }));
      } else if (drag.kind === 'fade_out') {
        const fadeMs = Math.min(Math.floor(drag.origDurMs / 2), Math.max(0, -deltaMs + clip.fadeOutMs));
        useProjectStore.setState((s) => ({
          dirty: true,
          clips: s.clips.map((c) => (c.id === drag.clipId ? { ...c, fadeOutMs: Math.round(fadeMs) } : c)),
        }));
      }
    };

    const onUp = () => {
      const drag = dragStateRef.current;
      if (!drag) return;
      dragStateRef.current = null;
      if (drag.clipId && drag.kind === 'move') {
        const c = useProjectStore.getState().clips.find((x) => x.id === drag.clipId);
        if (c && (c.timelineStartMs !== drag.origStartMs || c.trackId !== track.id)) {
          moveClip(c.id, c.timelineStartMs, c.trackId);
        }
      } else if (drag.clipId && (drag.kind === 'trim_left' || drag.kind === 'trim_right')) {
        const c = useProjectStore.getState().clips.find((x) => x.id === drag.clipId);
        if (c) trimClip(c.id, c.timelineStartMs, c.sourceOffsetMs, c.durationMs);
      } else if (drag.clipId && drag.kind === 'stretch') {
        const c = useProjectStore.getState().clips.find((x) => x.id === drag.clipId);
        if (c) updateClip(c.id, { durationMs: c.durationMs, playbackRate: c.playbackRate }, 'Time Stretch Clip');
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [pixelsPerSecond, snapToGrid, track.id]);

  const cycleChannelMode = () => {
    const idx = CHANNEL_MODES.indexOf(track.channelMode);
    const next = CHANNEL_MODES[(idx + 1) % CHANNEL_MODES.length];
    updateTrack(track.id, { channelMode: next }, `Track Channel -> ${next}`);
  };

  return (
    <div
      data-track-id={track.id}
      style={{ height: `${track.heightPx}px` }}
      className={`flex shrink-0 border-b border-[#252B38] ${
        selectedTrackId === track.id ? 'bg-[#141822]' : 'bg-[#101319]'
      }`}
    >
      {/* Left Sticky Track Header */}
      <div
        onClick={() => selectTrack(track.id)}
        className={`flex w-56 shrink-0 flex-col justify-between border-r border-[#252B38] p-2 cursor-pointer ${
          selectedTrackId === track.id ? 'bg-[#171C27]' : 'bg-[#12151C]'
        }`}
        style={{ borderLeft: `3px solid ${track.color}` }}
      >
        <div className="flex items-center justify-between gap-1">
          {editingName ? (
            <input
              type="text"
              value={nameDraft}
              autoFocus
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                setEditingName(false);
                if (nameDraft.trim()) updateTrack(track.id, { name: nameDraft.trim() }, 'Rename Track');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setEditingName(false);
                  if (nameDraft.trim()) updateTrack(track.id, { name: nameDraft.trim() }, 'Rename Track');
                }
              }}
              className="h-5 w-full rounded border border-[#3B82F6] bg-[#0B0D11] px-1 text-xs text-white focus:outline-none"
            />
          ) : (
            <span
              onDoubleClick={() => {
                setNameDraft(track.name);
                setEditingName(true);
              }}
              title="Double-click to rename track"
              className="truncate text-xs font-semibold text-[#E5E7EB]"
            >
              {track.name}
            </span>
          )}

          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                updateTrack(track.id, { muted: !track.muted });
              }}
              title="Mute"
              className={`h-5 w-5 rounded text-[10px] font-bold cursor-pointer ${
                track.muted
                  ? 'bg-[#EF4444] text-white'
                  : 'bg-[#181C25] text-[#9CA6B8] hover:text-white'
              }`}
            >
              M
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                updateTrack(track.id, { solo: !track.solo });
              }}
              title="Solo"
              className={`h-5 w-5 rounded text-[10px] font-bold cursor-pointer ${
                track.solo
                  ? 'bg-[#F59E0B] text-black'
                  : 'bg-[#181C25] text-[#9CA6B8] hover:text-white'
              }`}
            >
              S
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                updateTrack(track.id, { armed: !track.armed });
              }}
              title="Arm Track for Recording"
              className={`h-5 w-5 rounded text-[10px] font-bold cursor-pointer ${
                track.armed
                  ? 'bg-[#EF4444]/25 border border-[#EF4444] text-[#FCA5A5]'
                  : 'bg-[#181C25] text-[#9CA6B8] hover:text-white'
              }`}
            >
              R
            </button>
          </div>
        </div>

        {/* Bottom row: Volume / Pan / Channel / Delete */}
        <div className="flex items-center gap-1.5 text-[10px] text-[#9CA6B8]">
          {track.muted ? (
            <VolumeX className="h-3 w-3 text-[#EF4444] shrink-0" />
          ) : (
            <Volume2 className="h-3 w-3 text-[#22D3EE] shrink-0" />
          )}
          <input
            type="range"
            min={-48}
            max={12}
            step={0.5}
            value={track.volumeDb}
            onChange={(e) => updateTrack(track.id, { volumeDb: parseFloat(e.target.value) })}
            title={`Volume: ${track.volumeDb.toFixed(1)} dB`}
            aria-label={`${track.name} Volume`}
            className="daw-slider w-20"
          />
          <span className="font-mono-tabular w-9 text-right text-[10px]">
            {track.volumeDb > 0 ? `+${track.volumeDb.toFixed(0)}` : track.volumeDb.toFixed(0)}dB
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              cycleChannelMode();
            }}
            title={`Channel mode: ${track.channelMode}`}
            className="rounded border border-[#252B38] bg-[#0B0D11] px-1 py-0.5 text-[9px] font-semibold text-[#D1D5DB] hover:border-[#3B82F6] cursor-pointer"
          >
            {CHANNEL_BADGES[track.channelMode]}
          </button>
          {canRemoveTrack && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeTrack(track.id);
              }}
              title="Remove Track"
              aria-label={`Remove ${track.name}`}
              className="ml-auto text-[#687387] hover:text-[#EF4444] cursor-pointer"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Right Timeline Waveform Canvas */}
      <div
        className="relative flex-1 overflow-hidden"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const assetId = e.dataTransfer.getData('application/sonora-asset');
          if (!assetId) return;
          const dropMs = snapMs(xToMs(e.clientX));
          if (onImportDropPath) {
            onImportDropPath(assetId, track.id, dropMs);
          } else {
            addClipFromAsset(assetId, track.id, dropMs);
          }
        }}
      >
        <canvas
          ref={canvasRef}
          onMouseDown={handleCanvasMouseDown}
          style={{ width: `${Math.max(300, laneWidthPx)}px`, height: `${track.heightPx}px` }}
          className={
            activeTool === 'razor'
              ? 'cursor-col-resize'
              : activeTool === 'range'
                ? 'cursor-text'
                : 'cursor-default'
          }
        />
      </div>
    </div>
  );
};
