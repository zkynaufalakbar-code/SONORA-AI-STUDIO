import React from 'react';
import { Trash2, Power } from 'lucide-react';
import { DawButton, ParamSlider } from '@/components/ui/Controls';
import { ParametricEqEditor } from './ParametricEqEditor';
import { EFFECTS_CATALOG, getEffectDefinition } from '@/lib/effectsCatalog';
import { useProjectStore } from '@/stores/projectStore';
import type { ChannelRoutingMode } from '@/types/project';
import type { EffectInstance, EffectType, ParametricBand } from '@/types/effects';

export const TrackInspector: React.FC = () => {
  const tracks = useProjectStore((s) => s.tracks);
  const selectedTrackId = useProjectStore((s) => s.selectedTrackId);
  const updateTrack = useProjectStore((s) => s.updateTrack);
  const addEffectToTarget = useProjectStore((s) => s.addEffectToTarget);
  const updateEffectParams = useProjectStore((s) => s.updateEffectParams);
  const removeEffectFromTarget = useProjectStore((s) => s.removeEffectFromTarget);

  const track = tracks.find((t) => t.id === selectedTrackId) ?? tracks[0];
  if (!track) return null;

  const renderFxControls = (fx: EffectInstance) => {
    const def = getEffectDefinition(fx.type);
    const p = fx.params;
    const setParam = (key: string, val: number | boolean | ParametricBand[]) =>
      updateEffectParams({ kind: 'track', id: track.id }, fx.id, { [key]: val });

    if (fx.type === 'parametric_eq') {
      return (
        <ParametricEqEditor
          bands={(p.bands as ParametricBand[]) ?? []}
          onChange={(bands) => setParam('bands', bands)}
        />
      );
    }

    if (fx.type === 'eq_10band') {
      const keys = [
        ['b31', '31'], ['b62', '62'], ['b125', '125'], ['b250', '250'], ['b500', '500'],
        ['b1k', '1k'], ['b2k', '2k'], ['b4k', '4k'], ['b8k', '8k'], ['b16k', '16k'],
      ];
      return (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {keys.map(([k, lbl]) => (
            <ParamSlider
              key={k}
              label={`${lbl} Hz`}
              value={Number(p[k] ?? 0)}
              min={-15}
              max={15}
              step={0.5}
              unit="dB"
              defaultValue={0}
              onChange={(v) => setParam(k, v)}
            />
          ))}
        </div>
      );
    }

    if (fx.type === 'eq_5band') {
      return (
        <div className="space-y-1.5">
          {[
            ['b60', '60 Hz'], ['b250', '250 Hz'], ['b1k', '1 kHz'], ['b4k', '4 kHz'], ['b12k', '12 kHz'],
          ].map(([k, lbl]) => (
            <ParamSlider
              key={k}
              label={lbl}
              value={Number(p[k] ?? 0)}
              min={-15}
              max={15}
              step={0.5}
              unit="dB"
              defaultValue={0}
              onChange={(v) => setParam(k, v)}
            />
          ))}
        </div>
      );
    }

    // Generic slider mapping for all remaining effects
    return (
      <div className="space-y-1.5">
        {Object.entries(p).map(([key, val]) => {
          if (typeof val === 'boolean') {
            return (
              <label key={key} className="flex items-center justify-between text-[11px] text-[#D1D5DB]">
                <span>{key === 'freq60' ? '60 Hz Grid (US)' : key}</span>
                <input
                  type="checkbox"
                  checked={val}
                  onChange={(e) => setParam(key, e.target.checked)}
                />
              </label>
            );
          }
          if (typeof val !== 'number') return null;

          let min = -24;
          let max = 24;
          let step = 0.5;
          let unit = '';
          if (key === 'threshold') { min = -60; max = 0; step = 1; unit = 'dB'; }
          else if (key === 'ceiling') { min = -12; max = 0; step = 0.2; unit = 'dB'; }
          else if (key === 'ratio') { min = 1; max = 20; step = 0.5; unit = ':1'; }
          else if (key === 'attack' || key === 'release' || key === 'hold' || key === 'timeMs') {
            min = 1; max = key === 'timeMs' ? 1200 : 500; step = 5; unit = 'ms';
          } else if (key === 'freq') { min = 30; max = 16000; step = 20; unit = 'Hz'; }
          else if (key === 'q') { min = 0.3; max = 10; step = 0.1; }
          else if (key === 'width') { min = 0; max = 200; step = 5; unit = '%'; }
          else if (key === 'mix' || key === 'feedback' || key === 'roomSize' || key === 'damping' || key === 'sensitivity' || key === 'intensity') {
            min = 0; max = 1; step = 0.02;
          } else if (key === 'decay') { min = 0.1; max = 3.0; step = 0.1; unit = 's'; }
          else if (key === 'rate') { min = 0.1; max = 5; step = 0.1; unit = 'Hz'; }
          else if (key === 'depth' || key === 'delay') { min = 0.5; max = 10; step = 0.1; unit = 'ms'; }
          else if (key === 'noiseFloor') { min = -50; max = -15; step = 1; unit = 'dB'; }
          else if (key === 'reduction') { min = fx.type === 'de_hum' ? -45 : 2; max = fx.type === 'de_hum' ? -6 : 36; step = 1; unit = 'dB'; }

          return (
            <ParamSlider
              key={key}
              label={key}
              value={val}
              min={min}
              max={max}
              step={step}
              unit={unit}
              defaultValue={typeof def.defaultParams[key] === 'number' ? Number(def.defaultParams[key]) : undefined}
              onChange={(nv) => setParam(key, nv)}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-3 overflow-y-auto pr-1 text-xs">
      {/* Track Mix Parameters */}
      <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-white truncate">{track.name}</span>
          <span className="rounded bg-[#0B0D11] px-1.5 py-0.5 text-[10px] uppercase text-[#9CA6B8]">
            {track.role}
          </span>
        </div>

        <ParamSlider
          label="Track Volume"
          value={track.volumeDb}
          min={-48}
          max={12}
          step={0.5}
          unit="dB"
          defaultValue={0}
          onChange={(volumeDb) => updateTrack(track.id, { volumeDb })}
        />
        <ParamSlider
          label="Stereo Pan"
          value={track.pan}
          min={-1}
          max={1}
          step={0.02}
          defaultValue={0}
          formatValue={(v) =>
            Math.abs(v) < 0.02 ? 'Center' : v < 0 ? `L ${Math.round(-v * 100)}` : `R ${Math.round(v * 100)}`
          }
          onChange={(pan) => updateTrack(track.id, { pan })}
        />
        <ParamSlider
          label="Input Trim"
          value={track.inputGainDb}
          min={-24}
          max={24}
          step={0.5}
          unit="dB"
          defaultValue={0}
          onChange={(inputGainDb) => updateTrack(track.id, { inputGainDb })}
        />
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#9CA6B8]">Channel Output</span>
          <select
            value={track.channelMode}
            onChange={(e) =>
              updateTrack(track.id, { channelMode: e.target.value as ChannelRoutingMode })
            }
            className="h-6 rounded border border-[#252B38] bg-[#0B0D11] px-2 text-[11px] text-[#E5E7EB]"
          >
            <option value="stereo">Stereo</option>
            <option value="mono_mix">Mono Sum</option>
            <option value="left_only">Left Only</option>
            <option value="right_only">Right Only</option>
          </select>
        </div>
      </div>

      {/* Add Insert FX Selector */}
      <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA6B8]">
            Insert Effects Rack ({track.effects.length})
          </h3>
        </div>
        <div className="flex gap-1.5">
          <select
            defaultValue=""
            onChange={(e) => {
              if (!e.target.value) return;
              addEffectToTarget({ kind: 'track', id: track.id }, e.target.value as EffectType);
              e.target.value = '';
            }}
            aria-label="Add Effect to Track"
            className="h-7 flex-1 rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-[#E5E7EB]"
          >
            <option value="" disabled>
              + Add Effect Slot...
            </option>
            {EFFECTS_CATALOG.map((ef) => (
              <option key={ef.type} value={ef.type}>
                {ef.name} ({ef.category})
              </option>
            ))}
          </select>
        </div>

        {/* Ordered FX Slots */}
        <div className="space-y-2">
          {track.effects.map((fx) => {
            const def = getEffectDefinition(fx.type);
            return (
              <div
                key={fx.id}
                className={`rounded border p-2 space-y-2 ${
                  fx.bypassed
                    ? 'border-[#252B38] bg-[#0B0D11]/60 opacity-65'
                    : 'border-[#333B4D] bg-[#0E1117]'
                }`}
              >
                <div className="flex items-center justify-between gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      updateEffectParams({ kind: 'track', id: track.id }, fx.id, {}, !fx.bypassed)
                    }
                    title={fx.bypassed ? 'Enable Effect' : 'Bypass Effect'}
                    className={`flex h-5 w-5 items-center justify-center rounded cursor-pointer ${
                      fx.bypassed ? 'bg-[#252B38] text-[#687387]' : 'bg-[#3B82F6]/20 text-[#3B82F6]'
                    }`}
                  >
                    <Power className="h-3 w-3" />
                  </button>
                  <span className="flex-1 truncate text-xs font-semibold text-[#E5E7EB]">
                    {fx.name}
                  </span>
                  <select
                    value={fx.presetName ?? ''}
                    onChange={(e) => {
                      const chosen = def.presets.find((pr) => pr.name === e.target.value);
                      if (chosen) {
                        updateEffectParams(
                          { kind: 'track', id: track.id },
                          fx.id,
                          structuredClone(chosen.params),
                        );
                      }
                    }}
                    className="h-5 max-w-28 rounded border border-[#252B38] bg-[#12151C] px-1 text-[10px] text-[#9CA6B8]"
                  >
                    <option value="">Presets</option>
                    {def.presets.map((pr) => (
                      <option key={pr.name} value={pr.name}>
                        {pr.name}
                      </option>
                    ))}
                  </select>
                  <DawButton
                    size="xs"
                    variant="ghost"
                    onClick={() => removeEffectFromTarget({ kind: 'track', id: track.id }, fx.id)}
                    aria-label={`Delete ${fx.name}`}
                  >
                    <Trash2 className="h-3 w-3 text-[#EF4444]" />
                  </DawButton>
                </div>

                {!fx.bypassed && renderFxControls(fx)}
              </div>
            );
          })}
          {track.effects.length === 0 && (
            <p className="py-2 text-center text-[11px] text-[#687387]">
              No effects inserted. Select from above or browse FX sidebar.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
