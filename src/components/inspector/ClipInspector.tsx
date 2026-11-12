import React from 'react';
import {
  RotateCcw,
  VolumeX,
  TrendingUp,
  Split,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { DawButton, ParamSlider } from '@/components/ui/Controls';
import { formatTimecode } from '@/lib/timecode';
import { transformClipAudio } from '@/lib/tauri';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import type { ChannelRoutingMode, FadeCurveType } from '@/types/project';

export const ClipInspector: React.FC = () => {
  const clips = useProjectStore((s) => s.clips);
  const assets = useProjectStore((s) => s.assets);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const updateClip = useProjectStore((s) => s.updateClip);
  const replaceClipAssetRender = useProjectStore((s) => s.replaceClipAssetRender);
  const addAsset = useProjectStore((s) => s.addAsset);
  const addTrack = useProjectStore((s) => s.addTrack);
  const addClipFromAsset = useProjectStore((s) => s.addClipFromAsset);
  const removeEffectFromTarget = useProjectStore((s) => s.removeEffectFromTarget);

  const setBusy = useRuntimeStore((s) => s.setBusy);

  const clip = clips.find((c) => selectedClipIds.includes(c.id)) ?? null;
  const asset = clip ? assets[clip.renderAssetId ?? clip.assetId] : null;

  if (!clip || !asset) {
    return (
      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-[#687387]">
        Select an audio clip on the timeline to inspect clip gain, fades, speed/pitch, channel routing, and DSP transforms.
      </div>
    );
  }

  const runTransform = async (label: string, op: Record<string, unknown>, resetTrim = false) => {
    setBusy(label);
    try {
      const rendered = await transformClipAudio(
        asset.resolvedPath,
        op,
        `${clip.name} (${label})`,
      );
      replaceClipAssetRender(clip.id, rendered, label, resetTrim);
    } finally {
      setBusy(null);
    }
  };

  const handleSplitStereoToTracks = async () => {
    setBusy('Separating Left & Right channels...');
    try {
      const [leftAsset, rightAsset] = await Promise.all([
        transformClipAudio(asset.resolvedPath, { kind: 'extractChannel', channel: 'left' }, `${clip.name} (L)`),
        transformClipAudio(asset.resolvedPath, { kind: 'extractChannel', channel: 'right' }, `${clip.name} (R)`),
      ]);
      addAsset(leftAsset);
      addAsset(rightAsset);
      const tL = addTrack({ name: `${clip.name} (Left)`, role: 'audio', color: '#22D3EE' });
      const tR = addTrack({ name: `${clip.name} (Right)`, role: 'audio', color: '#3B82F6' });
      addClipFromAsset(leftAsset.id, tL, clip.timelineStartMs);
      addClipFromAsset(rightAsset.id, tR, clip.timelineStartMs);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3 overflow-y-auto pr-1 text-xs">
      {/* Clip Header & Info */}
      <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold text-white">{clip.name}</span>
          <label className="flex items-center gap-1 text-[11px] text-[#9CA6B8] cursor-pointer">
            <input
              type="checkbox"
              checked={clip.muted}
              onChange={(e) => updateClip(clip.id, { muted: e.target.checked }, 'Toggle Clip Mute')}
            />
            Mute
          </label>
        </div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px] text-[#9CA6B8] font-mono-tabular">
          <span>Start: {formatTimecode(clip.timelineStartMs)}</span>
          <span>Dur: {formatTimecode(clip.durationMs)}</span>
          <span>Format: {asset.sampleRate / 1000}kHz · {asset.channels}ch</span>
          <span>Codec: {asset.codec.toUpperCase()} {asset.bitDepth}b</span>
        </div>
      </div>

      {/* Real-time Non-Destructive Properties */}
      <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA6B8]">
          Gain & Fades
        </h3>
        <ParamSlider
          label="Clip Gain"
          value={clip.gainDb}
          min={-24}
          max={24}
          step={0.5}
          unit="dB"
          defaultValue={0}
          onChange={(gainDb) => updateClip(clip.id, { gainDb })}
        />
        <ParamSlider
          label="Fade In"
          value={clip.fadeInMs}
          min={0}
          max={Math.floor(clip.durationMs / 2)}
          step={25}
          unit="ms"
          defaultValue={0}
          onChange={(fadeInMs) => updateClip(clip.id, { fadeInMs })}
        />
        <ParamSlider
          label="Fade Out"
          value={clip.fadeOutMs}
          min={0}
          max={Math.floor(clip.durationMs / 2)}
          step={25}
          unit="ms"
          defaultValue={0}
          onChange={(fadeOutMs) => updateClip(clip.id, { fadeOutMs })}
        />
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-[#9CA6B8]">Fade Curve</span>
          <select
            value={clip.fadeInCurve}
            onChange={(e) =>
              updateClip(
                clip.id,
                {
                  fadeInCurve: e.target.value as FadeCurveType,
                  fadeOutCurve: e.target.value as FadeCurveType,
                },
                'Change Fade Curve',
              )
            }
            className="h-6 rounded border border-[#252B38] bg-[#0B0D11] px-2 text-[11px] text-[#E5E7EB]"
          >
            <option value="linear">Linear</option>
            <option value="logarithmic">Logarithmic</option>
            <option value="exponential">Exponential</option>
            <option value="s_curve">S-Curve Equal Power</option>
          </select>
        </div>
      </div>

      {/* Speed, Pitch & Channel Control */}
      <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA6B8]">
          Time, Pitch & Channels
        </h3>
        <ParamSlider
          label="Playback Speed"
          value={clip.playbackRate}
          min={0.5}
          max={2.0}
          step={0.05}
          defaultValue={1.0}
          formatValue={(v) => `${v.toFixed(2)}x`}
          onChange={(playbackRate) => updateClip(clip.id, { playbackRate })}
        />
        <ParamSlider
          label="Pitch Shift"
          value={clip.pitchSemitones}
          min={-12}
          max={12}
          step={0.5}
          unit="st"
          defaultValue={0}
          onChange={(pitchSemitones) => updateClip(clip.id, { pitchSemitones })}
        />
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="text-[#9CA6B8]">Channel Mode</span>
          <select
            value={clip.channelMode}
            onChange={(e) =>
              updateClip(
                clip.id,
                { channelMode: e.target.value as ChannelRoutingMode },
                'Channel Routing',
              )
            }
            className="h-6 rounded border border-[#252B38] bg-[#0B0D11] px-2 text-[11px] text-[#E5E7EB]"
          >
            <option value="stereo">Stereo</option>
            <option value="mono_mix">Mono Sum</option>
            <option value="left_only">Left Only</option>
            <option value="right_only">Right Only</option>
          </select>
        </div>
        {asset.channels >= 2 && (
          <DawButton size="xs" className="w-full" onClick={() => void handleSplitStereoToTracks()}>
            <Split className="h-3 w-3" />
            Separate Stereo L / R to Tracks
          </DawButton>
        )}
      </div>

      {/* Offline Core DSP & Restoration Transforms (FFmpeg) */}
      <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA6B8]">
          Render Audio Process (Offline)
        </h3>
        <div className="grid grid-cols-2 gap-1.5">
          <DawButton
            size="xs"
            onClick={() => void runTransform('Normalize -1 dBFS', { kind: 'normalizePeak', targetDb: -1.0 })}
          >
            <TrendingUp className="h-3 w-3 text-[#22D3EE]" />
            Norm Peak
          </DawButton>
          <DawButton
            size="xs"
            onClick={() => void runTransform('Normalize -16 LUFS', { kind: 'normalizeLufs', targetLufs: -16.0 })}
          >
            <TrendingUp className="h-3 w-3 text-[#10B981]" />
            -16 LUFS
          </DawButton>
          <DawButton
            size="xs"
            onClick={() => void runTransform('Amplify +3 dB', { kind: 'amplify', gainDb: 3.0 })}
          >
            Amplify +3 dB
          </DawButton>
          <DawButton
            size="xs"
            onClick={() => void runTransform('Reverse Clip', { kind: 'reverse' })}
          >
            <RotateCcw className="h-3 w-3" />
            Reverse
          </DawButton>
          <DawButton
            size="xs"
            onClick={() =>
              void runTransform('Silence Audio', {
                kind: 'silence',
                startMs: clip.sourceOffsetMs,
                endMs: clip.sourceOffsetMs + Math.round(clip.durationMs * clip.playbackRate),
              })
            }
          >
            <VolumeX className="h-3 w-3 text-[#EF4444]" />
            Silence
          </DawButton>
          <DawButton
            size="xs"
            onClick={() =>
              void runTransform(
                'Bake Time Stretch',
                { kind: 'timeStretch', tempo: clip.playbackRate },
                true,
              )
            }
          >
            Bake Stretch
          </DawButton>
          <DawButton
            size="xs"
            onClick={() =>
              void runTransform('Bake Pitch Shift', {
                kind: 'changePitch',
                semitones: clip.pitchSemitones || 2,
              })
            }
          >
            Bake Pitch
          </DawButton>
          <DawButton
            size="xs"
            variant="ai"
            onClick={() =>
              void runTransform('Restore Clean', {
                kind: 'voiceEnhancement',
                clarity: 0.75,
              })
            }
          >
            <Sparkles className="h-3 w-3" />
            Restore
          </DawButton>
        </div>
      </div>

      {/* Clip Insert FX List */}
      {clip.effects.length > 0 && (
        <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-1.5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA6B8]">
            Clip Effects ({clip.effects.length})
          </h3>
          {clip.effects.map((fx) => (
            <div
              key={fx.id}
              className="flex items-center justify-between rounded border border-[#252B38] bg-[#0B0D11] px-2 py-1"
            >
              <span className="text-[11px] text-[#E5E7EB]">{fx.name}</span>
              <button
                type="button"
                onClick={() => removeEffectFromTarget({ kind: 'clip', id: clip.id }, fx.id)}
                className="text-[#687387] hover:text-[#EF4444] cursor-pointer"
                aria-label={`Remove ${fx.name}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
