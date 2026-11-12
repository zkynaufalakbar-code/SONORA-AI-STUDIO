import React, { useEffect, useRef, useState } from 'react';
import { audioEngine } from '@/audio/audioEngine';

function dbToNorm(db: number): number {
  const clamped = Math.max(-60, Math.min(0, db));
  return (clamped + 60) / 60;
}

export const MetersPanel: React.FC = () => {
  const meterCanvasRef = useRef<HTMLCanvasElement>(null);
  const specCanvasRef = useRef<HTMLCanvasElement>(null);
  const peakHoldRef = useRef<{ l: number; r: number }>({ l: -96, r: -96 });
  const [readout, setReadout] = useState({
    peakDb: -96,
    rmsDb: -96,
    lufs: -70,
    clipping: false,
  });

  useEffect(() => {
    let raf = 0;
    let tick = 0;

    const draw = () => {
      const m = audioEngine.getLiveMeters();
      peakHoldRef.current.l = Math.max(m.peakLeftDb, peakHoldRef.current.l - 0.35);
      peakHoldRef.current.r = Math.max(m.peakRightDb, peakHoldRef.current.r - 0.35);

      tick++;
      if (tick % 4 === 0) {
        setReadout({
          peakDb: Math.max(m.peakLeftDb, m.peakRightDb),
          rmsDb: (m.rmsLeftDb + m.rmsRightDb) * 0.5,
          lufs: m.lufsApprox,
          clipping: m.clipping,
        });
      }

      // Draw Stereo L/R Level Meters
      const mc = meterCanvasRef.current;
      if (mc) {
        const ctx = mc.getContext('2d');
        if (ctx) {
          const w = mc.width;
          const h = mc.height;
          ctx.fillStyle = '#090B0F';
          ctx.fillRect(0, 0, w, h);

          const barH = 14;
          const channels = [
            { label: 'L', pk: m.peakLeftDb, rms: m.rmsLeftDb, hold: peakHoldRef.current.l, y: 8 },
            { label: 'R', pk: m.peakRightDb, rms: m.rmsRightDb, hold: peakHoldRef.current.r, y: 28 },
          ];

          const grad = ctx.createLinearGradient(18, 0, w - 6, 0);
          grad.addColorStop(0, '#10B981');
          grad.addColorStop(0.75, '#22D3EE');
          grad.addColorStop(0.9, '#F59E0B');
          grad.addColorStop(1, '#EF4444');

          for (const ch of channels) {
            ctx.fillStyle = '#687387';
            ctx.font = '10px monospace';
            ctx.fillText(ch.label, 4, ch.y + 11);

            const trackW = w - 24;
            ctx.fillStyle = '#181C25';
            ctx.fillRect(18, ch.y, trackW, barH);

            const pkNorm = dbToNorm(ch.pk);
            ctx.fillStyle = grad;
            ctx.fillRect(18, ch.y, trackW * pkNorm, barH);

            const holdX = 18 + trackW * dbToNorm(ch.hold);
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(holdX, ch.y, 2, barH);
          }
        }
      }

      // Draw Real-Time FFT Spectrum Curve
      const sc = specCanvasRef.current;
      if (sc) {
        const ctx = sc.getContext('2d');
        if (ctx) {
          const w = sc.width;
          const h = sc.height;
          ctx.fillStyle = '#090B0F';
          ctx.fillRect(0, 0, w, h);

          ctx.strokeStyle = '#1E2430';
          ctx.beginPath();
          ctx.moveTo(0, h / 2);
          ctx.lineTo(w, h / 2);
          ctx.stroke();

          const bins = m.spectrum.length;
          const barW = w / bins;
          for (let i = 0; i < bins; i++) {
            const v = m.spectrum[i] / 255;
            const bh = v * (h - 6);
            ctx.fillStyle = v > 0.8 ? '#8B5CF6' : '#22D3EE';
            ctx.fillRect(i * barW, h - bh, Math.max(1, barW - 0.5), bh);
          }
        }
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="space-y-3 text-xs">
      <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA6B8]">
            Master Output Meters
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
              readout.clipping
                ? 'bg-[#EF4444] text-white'
                : 'bg-[#0B0D11] text-[#687387]'
            }`}
          >
            {readout.clipping ? 'CLIP' : 'SAFE'}
          </span>
        </div>

        <canvas
          ref={meterCanvasRef}
          width={256}
          height={50}
          className="w-full rounded border border-[#252B38]"
        />

        <div className="grid grid-cols-3 gap-1.5 font-mono-tabular text-[11px]">
          <div className="rounded border border-[#252B38] bg-[#0B0D11] p-1.5 text-center">
            <div className="text-[9px] text-[#687387]">PEAK</div>
            <div className="text-[#22D3EE]">
              {readout.peakDb <= -90 ? '-inf' : `${readout.peakDb.toFixed(1)}`} dB
            </div>
          </div>
          <div className="rounded border border-[#252B38] bg-[#0B0D11] p-1.5 text-center">
            <div className="text-[9px] text-[#687387]">RMS</div>
            <div className="text-[#E5E7EB]">
              {readout.rmsDb <= -90 ? '-inf' : `${readout.rmsDb.toFixed(1)}`} dB
            </div>
          </div>
          <div className="rounded border border-[#252B38] bg-[#0B0D11] p-1.5 text-center">
            <div className="text-[9px] text-[#687387]">LUFS</div>
            <div className="text-[#10B981]">
              {readout.lufs <= -69 ? '-inf' : `${readout.lufs.toFixed(1)}`}
            </div>
          </div>
        </div>
      </div>

      <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA6B8]">
            Live FFT Spectrum
          </span>
          <span className="text-[10px] text-[#687387]">20 Hz – 20 kHz</span>
        </div>
        <canvas
          ref={specCanvasRef}
          width={256}
          height={120}
          className="w-full rounded border border-[#252B38]"
        />
      </div>
    </div>
  );
};
