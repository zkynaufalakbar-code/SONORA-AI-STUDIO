import React, { useEffect, useRef, useState } from 'react';
import { Play, Scissors, X, Activity } from 'lucide-react';
import { DawButton } from '@/components/ui/Controls';
import { computeSpectrogram, transformClipAudio, type SpectrogramTileResult } from '@/lib/tauri';
import { formatTimecode } from '@/lib/timecode';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { audioEngine } from '@/audio/audioEngine';

function heatColor(norm: number): [number, number, number] {
  const v = Math.min(1, Math.max(0, norm));
  if (v < 0.25) {
    const t = v / 0.25;
    return [Math.round(9 + t * 18), Math.round(11 + t * 26), Math.round(20 + t * 75)];
  }
  if (v < 0.55) {
    const t = (v - 0.25) / 0.3;
    return [Math.round(27 + t * 112), Math.round(37 + t * 55), Math.round(95 + t * 145)];
  }
  if (v < 0.82) {
    const t = (v - 0.55) / 0.27;
    return [Math.round(139 - t * 105), Math.round(92 + t * 119), Math.round(240 - t * 2)];
  }
  const t = (v - 0.82) / 0.18;
  return [Math.round(34 + t * 221), Math.round(211 + t * 44), Math.round(238 + t * 17)];
}

const HZ_TICKS = [100, 500, 1000, 2000, 5000, 10000, 20000];

export const SpectrogramView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tile, setTile] = useState<SpectrogramTileResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dragBox, setDragBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(
    null,
  );

  const clips = useProjectStore((s) => s.clips);
  const assets = useProjectStore((s) => s.assets);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const freqSelection = useProjectStore((s) => s.freqSelection);
  const setFreqSelection = useProjectStore((s) => s.setFreqSelection);
  const replaceClipAssetRender = useProjectStore((s) => s.replaceClipAssetRender);
  const setBusy = useRuntimeStore((s) => s.setBusy);

  const activeClip = clips.find((c) => selectedClipIds.includes(c.id)) ?? clips[0] ?? null;
  const activeAsset = activeClip ? assets[activeClip.renderAssetId ?? activeClip.assetId] : null;

  useEffect(() => {
    if (!activeClip || !activeAsset) {
      setTile(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const dur = Math.min(activeAsset.durationMs - activeClip.sourceOffsetMs, activeClip.durationMs * activeClip.playbackRate);
    void computeSpectrogram(
      activeAsset.resolvedPath,
      activeClip.sourceOffsetMs,
      Math.max(200, dur),
      480,
      160,
    )
      .then((res) => {
        if (!cancelled) setTile(res);
      })
      .catch(() => {
        if (!cancelled) setTile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeClip?.id,
    activeClip?.sourceOffsetMs,
    activeClip?.durationMs,
    activeClip?.playbackRate,
    activeAsset?.resolvedPath,
  ]);

  const yToFreq = (y: number, h: number, minHz: number, maxHz: number) => {
    const ratio = 1 - Math.min(1, Math.max(0, y / h));
    const logMin = Math.log10(Math.max(20, minHz));
    const logMax = Math.log10(Math.max(200, maxHz));
    return Math.round(Math.pow(10, logMin + ratio * (logMax - logMin)));
  };

  const freqToY = (hz: number, h: number, minHz: number, maxHz: number) => {
    const logMin = Math.log10(Math.max(20, minHz));
    const logMax = Math.log10(Math.max(200, maxHz));
    const norm = (Math.log10(Math.max(minHz, Math.min(maxHz, hz))) - logMin) / (logMax - logMin);
    return h * (1 - norm);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !tile) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = tile.width;
    const h = tile.height;
    canvas.width = w;
    canvas.height = h;

    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      // Backend writes row 0 = maxHz (20 kHz, top) down to row h-1 = minHz (20 Hz, bottom)
      const srcRow = y;
      for (let x = 0; x < w; x++) {
        const val = tile.intensities[srcRow * w + x] ?? 0;
        const [r, g, b] = heatColor(val / 255);
        const idx = (y * w + x) * 4;
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Draw log Hz guide lines
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(238,241,246,0.75)';
    for (const hz of HZ_TICKS) {
      if (hz > tile.maxHz) continue;
      const y = freqToY(hz, h, tile.minHz, tile.maxHz);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
      ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : `${hz}Hz`, 4, Math.max(8, y - 2));
    }
  }, [tile]);

  const finalizeSelection = (box: { x1: number; y1: number; x2: number; y2: number }) => {
    if (!activeClip || !tile || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const xMin = Math.min(box.x1, box.x2);
    const xMax = Math.max(box.x1, box.x2);
    const yMin = Math.min(box.y1, box.y2);
    const yMax = Math.max(box.y1, box.y2);
    if (xMax - xMin < 6 || yMax - yMin < 6) {
      setFreqSelection(null);
      return;
    }

    const dur = activeClip.durationMs * activeClip.playbackRate;
    const startMs = Math.round(activeClip.sourceOffsetMs + (xMin / rect.width) * dur);
    const endMs = Math.round(activeClip.sourceOffsetMs + (xMax / rect.width) * dur);
    const highHz = yToFreq(yMin, rect.height, tile.minHz, tile.maxHz);
    const lowHz = yToFreq(yMax, rect.height, tile.minHz, tile.maxHz);
    setFreqSelection({
      clipId: activeClip.id,
      startMs,
      endMs: Math.max(startMs + 40, endMs),
      lowHz: Math.max(20, lowHz),
      highHz: Math.max(lowHz + 40, highHz),
    });
  };

  const applySpectralAttenuate = async (gainDb: number) => {
    if (!activeClip || !activeAsset || !freqSelection) return;
    setBusy(`Spectral Repair (${freqSelection.lowHz}-${freqSelection.highHz} Hz)`);
    try {
      const res = await transformClipAudio(
        activeAsset.resolvedPath,
        {
          kind: 'spectralAttenuate',
          startMs: freqSelection.startMs,
          endMs: freqSelection.endMs,
          lowHz: freqSelection.lowHz,
          highHz: freqSelection.highHz,
          attenuationDb: gainDb,
        },
        `${activeClip.name} (Spectral)`,
      );
      replaceClipAssetRender(activeClip.id, res, `Spectral Attenuate ${gainDb} dB`, false);
      setFreqSelection(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-48 shrink-0 flex-col border-t border-[#252B38] bg-[#0B0D11]">
      <div className="flex h-7 items-center justify-between border-b border-[#252B38] bg-[#12151C] px-3 text-[11px]">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-[#22D3EE]" />
          <span className="font-semibold text-[#E5E7EB]">
            Spectral Frequency View {activeClip ? `— ${activeClip.name}` : ''}
          </span>
          {loading && <span className="text-[#3B82F6]">Computing STFT...</span>}
          {freqSelection && (
            <span className="font-mono-tabular rounded bg-[#8B5CF6]/20 px-1.5 py-0.5 text-[10px] text-[#DDD6FE]">
              {formatTimecode(freqSelection.startMs)}–{formatTimecode(freqSelection.endMs)} · {freqSelection.lowHz} Hz–{freqSelection.highHz} Hz
            </span>
          )}
        </div>

        {freqSelection && (
          <div className="flex items-center gap-1.5">
            <DawButton
              size="xs"
              onClick={() => {
                if (!activeClip) return;
                const tlStart =
                  activeClip.timelineStartMs +
                  (freqSelection.startMs - activeClip.sourceOffsetMs) / activeClip.playbackRate;
                void audioEngine.play(Math.max(0, tlStart));
              }}
            >
              <Play className="h-3 w-3" />
              Audition
            </DawButton>
            <DawButton size="xs" variant="ai" onClick={() => void applySpectralAttenuate(-18)}>
              <Scissors className="h-3 w-3" />
              Attenuate -18 dB
            </DawButton>
            <DawButton size="xs" variant="danger" onClick={() => void applySpectralAttenuate(-36)}>
              Notch -36 dB
            </DawButton>
            <DawButton size="xs" variant="ghost" onClick={() => setFreqSelection(null)}>
              <X className="h-3 w-3" />
            </DawButton>
          </div>
        )}
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden cursor-crosshair select-none"
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          setDragBox({ x1: x, y1: y, x2: x, y2: y });
        }}
        onMouseMove={(e) => {
          if (!dragBox) return;
          const rect = e.currentTarget.getBoundingClientRect();
          setDragBox({
            ...dragBox,
            x2: Math.min(rect.width, Math.max(0, e.clientX - rect.left)),
            y2: Math.min(rect.height, Math.max(0, e.clientY - rect.top)),
          });
        }}
        onMouseUp={() => {
          if (dragBox) {
            finalizeSelection(dragBox);
            setDragBox(null);
          }
        }}
      >
        {!activeClip ? (
          <div className="flex h-full items-center justify-center text-xs text-[#687387]">
            Select an audio clip on the timeline to inspect its STFT spectrogram.
          </div>
        ) : (
          <canvas ref={canvasRef} className="h-full w-full" />
        )}

        {/* Active or dragging 2D frequency selection marquee */}
        {(dragBox || (freqSelection && tile && activeClip && containerRef.current)) && (() => {
          if (dragBox) {
            const left = Math.min(dragBox.x1, dragBox.x2);
            const top = Math.min(dragBox.y1, dragBox.y2);
            const w = Math.abs(dragBox.x2 - dragBox.x1);
            const h = Math.abs(dragBox.y2 - dragBox.y1);
            return (
              <div
                style={{ left, top, width: w, height: h }}
                className="pointer-events-none absolute border border-[#22D3EE] bg-[#22D3EE]/15"
              />
            );
          }
          if (freqSelection && tile && activeClip && containerRef.current) {
            const cw = containerRef.current.clientWidth;
            const ch = containerRef.current.clientHeight;
            const dur = Math.max(1, activeClip.durationMs * activeClip.playbackRate);
            const x1 = ((freqSelection.startMs - activeClip.sourceOffsetMs) / dur) * cw;
            const x2 = ((freqSelection.endMs - activeClip.sourceOffsetMs) / dur) * cw;
            const y1 = freqToY(freqSelection.highHz, ch, tile.minHz, tile.maxHz);
            const y2 = freqToY(freqSelection.lowHz, ch, tile.minHz, tile.maxHz);
            return (
              <div
                style={{
                  left: x1,
                  top: y1,
                  width: Math.max(2, x2 - x1),
                  height: Math.max(2, y2 - y1),
                }}
                className="pointer-events-none absolute border border-[#8B5CF6] bg-[#8B5CF6]/20"
              />
            );
          }
          return null;
        })()}
      </div>
    </div>
  );
};
