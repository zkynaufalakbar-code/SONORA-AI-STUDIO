import React, { useEffect, useRef } from 'react';
import { formatRulerTick } from '@/lib/timecode';
import type { TimeSelection } from '@/types/project';

interface TimeRulerCanvasProps {
  widthPx: number;
  scrollLeftPx: number;
  pixelsPerSecond: number;
  playheadMs: number;
  loopEnabled: boolean;
  loopStartMs: number;
  loopEndMs: number;
  timeSelection: TimeSelection | null;
  onSeekMs: (ms: number) => void;
}

const STEP_CANDIDATES_MS = [
  100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000,
];

export const TimeRulerCanvas: React.FC<TimeRulerCanvasProps> = ({
  widthPx,
  scrollLeftPx,
  pixelsPerSecond,
  playheadMs,
  loopEnabled,
  loopStartMs,
  loopEndMs,
  timeSelection,
  onSeekMs,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);

  const clientXToMs = (clientX: number) => {
    const el = canvasRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, clientX - rect.left + scrollLeftPx);
    return Math.round((x / pixelsPerSecond) * 1000);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const h = 28;
    const w = Math.max(300, Math.floor(widthPx));
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = '#0E1117';
    ctx.fillRect(0, 0, w, h);

    const viewStartMs = (scrollLeftPx / pixelsPerSecond) * 1000;
    const viewEndMs = ((scrollLeftPx + w) / pixelsPerSecond) * 1000;

    // Loop highlight bar
    if (loopEnabled && loopEndMs > loopStartMs) {
      const lx1 = (loopStartMs / 1000) * pixelsPerSecond - scrollLeftPx;
      const lx2 = (loopEndMs / 1000) * pixelsPerSecond - scrollLeftPx;
      ctx.fillStyle = 'rgba(139, 92, 246, 0.25)';
      ctx.fillRect(lx1, 0, Math.max(2, lx2 - lx1), 8);
      ctx.fillStyle = '#8B5CF6';
      ctx.fillRect(lx1, 0, Math.max(2, lx2 - lx1), 2);
    }

    // Active time selection highlight
    if (timeSelection && timeSelection.endMs > timeSelection.startMs) {
      const sx1 = (timeSelection.startMs / 1000) * pixelsPerSecond - scrollLeftPx;
      const sx2 = (timeSelection.endMs / 1000) * pixelsPerSecond - scrollLeftPx;
      ctx.fillStyle = 'rgba(59, 130, 246, 0.22)';
      ctx.fillRect(sx1, 10, Math.max(2, sx2 - sx1), h - 10);
    }

    // Choose major tick spacing so labels are >= 85px apart
    const majorMs =
      STEP_CANDIDATES_MS.find((ms) => (ms / 1000) * pixelsPerSecond >= 85) ?? 300_000;
    const minorMs = majorMs / 5;

    const firstMinor = Math.floor(viewStartMs / minorMs) * minorMs;
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.textBaseline = 'top';

    for (let t = firstMinor; t <= viewEndMs + minorMs; t += minorMs) {
      if (t < 0) continue;
      const x = Math.round((t / 1000) * pixelsPerSecond - scrollLeftPx) + 0.5;
      if (x < -10 || x > w + 10) continue;
      const isMajor = Math.abs(t % majorMs) < 1;

      ctx.strokeStyle = isMajor ? '#4B5565' : '#252B38';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, isMajor ? 11 : 20);
      ctx.lineTo(x, h);
      ctx.stroke();

      if (isMajor) {
        ctx.fillStyle = '#9CA6B8';
        ctx.fillText(formatRulerTick(t, majorMs), x + 4, 4);
      }
    }

    // Bottom border
    ctx.strokeStyle = '#252B38';
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    // Playhead cap
    const px = (playheadMs / 1000) * pixelsPerSecond - scrollLeftPx;
    if (px >= -8 && px <= w + 8) {
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath();
      ctx.moveTo(px - 6, 0);
      ctx.lineTo(px + 6, 0);
      ctx.lineTo(px + 6, 9);
      ctx.lineTo(px, 16);
      ctx.lineTo(px - 6, 9);
      ctx.closePath();
      ctx.fill();
    }
  }, [widthPx, scrollLeftPx, pixelsPerSecond, playheadMs, loopEnabled, loopStartMs, loopEndMs, timeSelection]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${Math.max(300, widthPx)}px`, height: '28px' }}
      className="cursor-pointer shrink-0 select-none"
      onMouseDown={(e) => {
        draggingRef.current = true;
        onSeekMs(clientXToMs(e.clientX));
      }}
      onMouseMove={(e) => {
        if (!draggingRef.current) return;
        onSeekMs(clientXToMs(e.clientX));
      }}
      onMouseUp={() => {
        draggingRef.current = false;
      }}
      onMouseLeave={() => {
        draggingRef.current = false;
      }}
    />
  );
};
