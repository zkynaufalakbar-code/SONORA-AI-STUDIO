import React, { useEffect, useRef, useState } from 'react';
import { ParamSlider } from '@/components/ui/Controls';
import type { ParametricBand } from '@/types/effects';

interface ParametricEqEditorProps {
  bands: ParametricBand[];
  onChange: (bands: ParametricBand[]) => void;
}

const BAND_COLORS = ['#F59E0B', '#22D3EE', '#3B82F6', '#8B5CF6', '#10B981'];

function evalBiquadDb(band: ParametricBand, freq: number, sr = 48000): number {
  if (!band.enabled) return 0;
  const w0 = (2 * Math.PI * Math.min(sr * 0.45, Math.max(20, band.freq))) / sr;
  const w = (2 * Math.PI * freq) / sr;
  const cosw0 = Math.cos(w0);
  const sinw0 = Math.sin(w0);
  const q = Math.max(0.2, band.q);
  const alpha = sinw0 / (2 * q);
  const A = Math.pow(10, band.gain / 40);

  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  if (band.type === 'peaking') {
    b0 = 1 + alpha * A;
    b1 = -2 * cosw0;
    b2 = 1 - alpha * A;
    a0 = 1 + alpha / A;
    a1 = -2 * cosw0;
    a2 = 1 - alpha / A;
  } else if (band.type === 'highpass') {
    b0 = (1 + cosw0) / 2;
    b1 = -(1 + cosw0);
    b2 = (1 + cosw0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else if (band.type === 'lowpass') {
    b0 = (1 - cosw0) / 2;
    b1 = 1 - cosw0;
    b2 = (1 - cosw0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  } else if (band.type === 'lowshelf') {
    const beta = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 - (A - 1) * cosw0 + beta);
    b1 = 2 * A * (A - 1 - (A + 1) * cosw0);
    b2 = A * (A + 1 - (A - 1) * cosw0 - beta);
    a0 = A + 1 + (A - 1) * cosw0 + beta;
    a1 = -2 * (A - 1 + (A + 1) * cosw0);
    a2 = A + 1 + (A - 1) * cosw0 - beta;
  } else if (band.type === 'highshelf') {
    const beta = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cosw0 + beta);
    b1 = -2 * A * (A - 1 + (A + 1) * cosw0);
    b2 = A * (A + 1 + (A - 1) * cosw0 - beta);
    a0 = A + 1 - (A - 1) * cosw0 + beta;
    a1 = 2 * (A - 1 - (A + 1) * cosw0);
    a2 = A + 1 - (A - 1) * cosw0 - beta;
  } else if (band.type === 'notch') {
    b0 = 1;
    b1 = -2 * cosw0;
    b2 = 1;
    a0 = 1 + alpha;
    a1 = -2 * cosw0;
    a2 = 1 - alpha;
  }

  // Evaluate |H(e^jw)|^2
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);

  const numRe = b0 + b1 * cos1 + b2 * cos2;
  const numIm = -b1 * sin1 - b2 * sin2;
  const denRe = a0 + a1 * cos1 + a2 * cos2;
  const denIm = -a1 * sin1 - a2 * sin2;

  const numMag2 = numRe * numRe + numIm * numIm;
  const denMag2 = Math.max(1e-12, denRe * denRe + denIm * denIm);
  return 10 * Math.log10(Math.max(1e-6, numMag2 / denMag2));
}

export const ParametricEqEditor: React.FC<ParametricEqEditorProps> = ({ bands, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [selectedBandId, setSelectedBandId] = useState<string>(bands[0]?.id ?? 'b1');
  const dragBandRef = useRef<string | null>(null);

  const freqToX = (hz: number, w: number) => {
    const min = Math.log10(20);
    const max = Math.log10(20000);
    return ((Math.log10(Math.max(20, Math.min(20000, hz))) - min) / (max - min)) * w;
  };

  const xToFreq = (x: number, w: number) => {
    const min = Math.log10(20);
    const max = Math.log10(20000);
    const norm = Math.min(1, Math.max(0, x / w));
    return Math.round(Math.pow(10, min + norm * (max - min)));
  };

  const dbToY = (db: number, h: number) => h / 2 - (Math.max(-18, Math.min(18, db)) / 18) * (h / 2 - 8);
  const yToDb = (y: number, h: number) => ((h / 2 - y) / (h / 2 - 8)) * 18;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = 260;
    const h = 112;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#090B0F';
    ctx.fillRect(0, 0, w, h);

    // Frequency grid
    ctx.strokeStyle = '#1E2430';
    ctx.lineWidth = 1;
    for (const hz of [50, 100, 250, 500, 1000, 2500, 5000, 10000]) {
      const x = Math.round(freqToX(hz, w)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }

    // 0 dB center line
    ctx.strokeStyle = '#2E3647';
    ctx.beginPath();
    ctx.moveTo(0, h / 2 + 0.5);
    ctx.lineTo(w, h / 2 + 0.5);
    ctx.stroke();

    // Total magnitude curve
    ctx.strokeStyle = '#22D3EE';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const hz = xToFreq(x, w);
      let totalDb = 0;
      for (const b of bands) {
        totalDb += evalBiquadDb(b, hz);
      }
      const y = dbToY(totalDb, h);
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Band control dots
    bands.forEach((b, i) => {
      const x = freqToX(b.freq, w);
      const y = b.type === 'highpass' || b.type === 'lowpass' ? dbToY(0, h) : dbToY(b.gain, h);
      ctx.fillStyle = b.enabled ? BAND_COLORS[i % BAND_COLORS.length] : '#4B5565';
      ctx.beginPath();
      ctx.arc(x, y, b.id === selectedBandId ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (b.id === selectedBandId) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }, [bands, selectedBandId]);

  const activeBand = bands.find((b) => b.id === selectedBandId) ?? bands[0];

  const updateBand = (id: string, patch: Partial<ParametricBand>) => {
    onChange(bands.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '112px' }}
        className="rounded border border-[#252B38] cursor-crosshair"
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 260;
          const y = ((e.clientY - rect.top) / rect.height) * 112;
          let nearest = bands[0];
          let minD = 9999;
          for (const b of bands) {
            const bx = freqToX(b.freq, 260);
            const by = b.type === 'highpass' || b.type === 'lowpass' ? dbToY(0, 112) : dbToY(b.gain, 112);
            const d = Math.hypot(x - bx, y - by);
            if (d < minD) {
              minD = d;
              nearest = b;
            }
          }
          if (nearest) {
            setSelectedBandId(nearest.id);
            dragBandRef.current = nearest.id;
          }
        }}
        onMouseMove={(e) => {
          if (!dragBandRef.current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - rect.left) / rect.width) * 260;
          const y = ((e.clientY - rect.top) / rect.height) * 112;
          const freq = xToFreq(x, 260);
          const gain = Math.round(Math.max(-18, Math.min(18, yToDb(y, 112))) * 2) / 2;
          updateBand(dragBandRef.current, { freq, gain });
        }}
        onMouseUp={() => {
          dragBandRef.current = null;
        }}
        onMouseLeave={() => {
          dragBandRef.current = null;
        }}
      />

      <div className="flex gap-1">
        {bands.map((b, i) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setSelectedBandId(b.id)}
            className={`flex-1 rounded border py-0.5 text-[10px] font-medium cursor-pointer ${
              b.id === activeBand?.id
                ? 'border-[#3B82F6] bg-[#202737] text-white'
                : 'border-[#252B38] bg-[#0B0D11] text-[#9CA6B8]'
            }`}
            style={{ borderTop: `2px solid ${BAND_COLORS[i % BAND_COLORS.length]}` }}
          >
            B{i + 1}
          </button>
        ))}
      </div>

      {activeBand && (
        <div className="space-y-1.5 rounded border border-[#252B38] bg-[#0B0D11] p-2">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <label className="flex items-center gap-1.5 text-[#D1D5DB]">
              <input
                type="checkbox"
                checked={activeBand.enabled}
                onChange={(e) => updateBand(activeBand.id, { enabled: e.target.checked })}
              />
              Enable Band
            </label>
            <select
              value={activeBand.type}
              onChange={(e) =>
                updateBand(activeBand.id, { type: e.target.value as ParametricBand['type'] })
              }
              className="h-6 rounded border border-[#252B38] bg-[#12151C] px-1.5 text-[11px] text-[#E5E7EB]"
            >
              <option value="peaking">Bell / Peak</option>
              <option value="highpass">High Pass</option>
              <option value="lowpass">Low Pass</option>
              <option value="lowshelf">Low Shelf</option>
              <option value="highshelf">High Shelf</option>
              <option value="notch">Notch</option>
            </select>
          </div>
          <ParamSlider
            label="Frequency"
            value={activeBand.freq}
            min={20}
            max={18000}
            step={10}
            unit="Hz"
            onChange={(freq) => updateBand(activeBand.id, { freq })}
          />
          {activeBand.type !== 'highpass' && activeBand.type !== 'lowpass' && (
            <ParamSlider
              label="Gain"
              value={activeBand.gain}
              min={-18}
              max={18}
              step={0.5}
              unit="dB"
              onChange={(gain) => updateBand(activeBand.id, { gain })}
            />
          )}
          <ParamSlider
            label="Q Width"
            value={activeBand.q}
            min={0.3}
            max={12}
            step={0.1}
            onChange={(q) => updateBand(activeBand.id, { q })}
          />
        </div>
      )}
    </div>
  );
};
