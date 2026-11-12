import React from 'react';
import {
  Podcast,
  Wand2,
  Scissors,
  Download,
  FileText,
  ArrowLeft,
  Sliders,
} from 'lucide-react';
import { DawButton } from '@/components/ui/Controls';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { useTransportStore } from '@/stores/transportStore';
import { analyzeSilenceAndTelemetry, transformClipAudio } from '@/lib/tauri';
import { formatTimecode } from '@/lib/timecode';

interface PodcastModeViewProps {
  onQuickExportPreset: (preset: {
    format: string;
    bitrateKbps: number;
    targetLufs: number;
    presetLabel: string;
  }) => void;
}

export const PodcastModeView: React.FC<PodcastModeViewProps> = ({ onQuickExportPreset }) => {
  const tracks = useProjectStore((s) => s.tracks);
  const clips = useProjectStore((s) => s.clips);
  const assets = useProjectStore((s) => s.assets);
  const selectedTrackId = useProjectStore((s) => s.selectedTrackId);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const transcript = useProjectStore((s) => s.transcript);
  const addTrack = useProjectStore((s) => s.addTrack);
  const updateTrack = useProjectStore((s) => s.updateTrack);
  const replaceClipAssetRender = useProjectStore((s) => s.replaceClipAssetRender);
  const setTranscript = useProjectStore((s) => s.setTranscript);

  const detectedSilence = useRuntimeStore((s) => s.detectedSilence);
  const setSilenceResults = useRuntimeStore((s) => s.setSilenceResults);
  const setBusy = useRuntimeStore((s) => s.setBusy);

  const setWorkspaceMode = useTransportStore((s) => s.setWorkspaceMode);
  const setPlayheadMs = useTransportStore((s) => s.setPlayheadMs);

  const activeClip = clips.find((c) => selectedClipIds.includes(c.id)) ?? clips[0] ?? null;
  const activeAsset = activeClip ? assets[activeClip.renderAssetId ?? activeClip.assetId] : null;
  const targetTrack = tracks.find((t) => t.id === selectedTrackId) ?? tracks[0];

  const setupPodcastLanes = () => {
    if (!tracks.some((t) => t.name.includes('Host'))) {
      addTrack({ name: 'Host Mic', role: 'voice', color: '#22D3EE' });
    }
    if (!tracks.some((t) => t.name.includes('Guest'))) {
      addTrack({ name: 'Guest Mic', role: 'voice', color: '#3B82F6' });
    }
    if (!tracks.some((t) => t.name.includes('Music'))) {
      addTrack({ name: 'Intro / Music Bed', role: 'music', color: '#8B5CF6' });
    }
  };

  const applyBroadcastChain = () => {
    if (!targetTrack) return;
    updateTrack(
      targetTrack.id,
      {
        effects: [
          {
            id: crypto.randomUUID(),
            type: 'high_pass',
            name: 'High Pass Filter',
            category: 'equalizer',
            bypassed: false,
            params: { freq: 85, q: 0.707 },
          },
          {
            id: crypto.randomUUID(),
            type: 'compressor',
            name: 'Podcast Leveler',
            category: 'dynamics',
            bypassed: false,
            params: { threshold: -19, ratio: 3.5, attack: 10, release: 150, makeup: 3, knee: 5 },
          },
          {
            id: crypto.randomUUID(),
            type: 'de_esser',
            name: 'De-Esser',
            category: 'restoration',
            bypassed: false,
            params: { freq: 6500, threshold: -22, intensity: 0.42 },
          },
          {
            id: crypto.randomUUID(),
            type: 'limiter',
            name: 'Limiter',
            category: 'dynamics',
            bypassed: false,
            params: { ceiling: -1.0, attack: 2, release: 80 },
          },
        ],
      },
      'Apply Podcast Broadcast Chain',
    );
  };

  const runVoiceClean = async () => {
    if (!activeClip || !activeAsset) return;
    setBusy('Enhancing dialogue clarity & leveling...');
    try {
      const step1 = await transformClipAudio(
        activeAsset.resolvedPath,
        { kind: 'noiseRemoval', strengthDb: 16 },
        `${activeClip.name} (Clean)`,
      );
      const step2 = await transformClipAudio(
        step1.resolvedPath,
        { kind: 'voiceEnhancement', clarity: 0.75 },
        `${activeClip.name} (Podcast Ready)`,
      );
      replaceClipAssetRender(activeClip.id, step2, 'Podcast Voice Clean & Enhance', false);
    } finally {
      setBusy(null);
    }
  };

  const scanAndCutSilence = async () => {
    if (!activeAsset || !activeClip) return;
    setBusy('Detecting dead air & pauses...');
    try {
      const res = await analyzeSilenceAndTelemetry(activeAsset.resolvedPath, -42, 500);
      setSilenceResults(res.intervals, res.telemetry);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-1 flex-col bg-[#0B0D11] p-5 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#252B38] pb-3">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-white">
              <Podcast className="h-4 w-4 text-[#8B5CF6]" />
              Podcast Production Mode
            </h1>
            <p className="text-xs text-[#9CA6B8]">
              Streamlined voice cleanup, pause cutting, transcript editing, and -16 LUFS podcast mastering.
            </p>
          </div>
          <DawButton size="sm" onClick={() => setWorkspaceMode('studio')}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Full Studio Timeline
          </DawButton>
        </div>

        {/* 1-Click Podcast Chain Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded border border-[#252B38] bg-[#12151C] p-3.5 space-y-2">
            <h2 className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-[#3B82F6]" />
              1. Multi-Speaker Routing
            </h2>
            <p className="text-[11px] text-[#9CA6B8]">
              Creates dedicated Host, Guest, and Music Bed tracks + inserts Broadcast Compressor/HPF/De-Esser chain.
            </p>
            <div className="flex gap-1.5">
              <DawButton size="xs" onClick={setupPodcastLanes}>
                Create Show Lanes
              </DawButton>
              <DawButton size="xs" variant="primary" onClick={applyBroadcastChain}>
                Insert Voice Chain
              </DawButton>
            </div>
          </div>

          <div className="rounded border border-[#252B38] bg-[#12151C] p-3.5 space-y-2">
            <h2 className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Wand2 className="h-3.5 w-3.5 text-[#8B5CF6]" />
              2. AI Voice Polish
            </h2>
            <p className="text-[11px] text-[#9CA6B8]">
              Removes room fan/AC hum and boosts vocal presence while taming harsh sibilance.
            </p>
            <DawButton
              size="xs"
              variant="ai"
              className="w-full"
              disabled={!activeClip}
              onClick={() => void runVoiceClean()}
            >
              Clean & Enhance Selected Clip
            </DawButton>
          </div>

          <div className="rounded border border-[#252B38] bg-[#12151C] p-3.5 space-y-2">
            <h2 className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Scissors className="h-3.5 w-3.5 text-[#22D3EE]" />
              3. Dead Air & Silence
            </h2>
            <p className="text-[11px] text-[#9CA6B8]">
              Scan awkward pauses longer than 500 ms ({detectedSilence.length} detected).
            </p>
            <DawButton
              size="xs"
              className="w-full"
              disabled={!activeClip}
              onClick={() => void scanAndCutSilence()}
            >
              Scan Clip Pauses
            </DawButton>
          </div>
        </div>

        {/* Transcript Sync Editor */}
        <div className="rounded border border-[#252B38] bg-[#12151C] p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[#9CA6B8]">
              <FileText className="h-3.5 w-3.5 text-[#22D3EE]" />
              Episode Transcript ({transcript.length} segments)
            </h2>
            <span className="text-[11px] text-[#687387]">
              Edit text directly or generate via AI Tools → Transcribe
            </span>
          </div>
          {transcript.length === 0 ? (
            <p className="py-6 text-center text-xs text-[#687387]">
              No transcript generated yet. Open AI Tools → Transcribe tab on the left sidebar to transcribe dialogue.
            </p>
          ) : (
            <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
              {transcript.map((seg, idx) => (
                <div
                  key={seg.id}
                  className="flex items-center gap-2 rounded border border-[#252B38] bg-[#0B0D11] p-2"
                >
                  <button
                    type="button"
                    onClick={() => setPlayheadMs(seg.startMs)}
                    className="font-mono-tabular shrink-0 rounded bg-[#181C25] px-2 py-1 text-[10px] text-[#22D3EE] hover:text-white cursor-pointer"
                  >
                    {formatTimecode(seg.startMs, false)}
                  </button>
                  <input
                    type="text"
                    value={seg.text}
                    onChange={(e) => {
                      const next = transcript.map((s, i) =>
                        i === idx ? { ...s, text: e.target.value } : s,
                      );
                      setTranscript(next);
                    }}
                    className="flex-1 bg-transparent text-xs text-[#E5E7EB] focus:outline-none"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Mastering & Quick Publish Presets */}
        <div className="rounded border border-[#252B38] bg-[#12151C] p-4 space-y-2.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9CA6B8]">
            Broadcast Export Presets
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {[
              { presetLabel: 'Podcast Standard (-16 LUFS)', format: 'mp3', bitrateKbps: 128, targetLufs: -16, desc: 'MP3 128 kbps · Mono/Stereo' },
              { presetLabel: 'Podcast High Quality (-16 LUFS)', format: 'mp3', bitrateKbps: 320, targetLufs: -16, desc: 'MP3 320 kbps · Apple/Spotify' },
              { presetLabel: 'YouTube Voice (-14 LUFS)', format: 'aac', bitrateKbps: 256, targetLufs: -14, desc: 'AAC 256 kbps · Broadcast Loud' },
              { presetLabel: 'Professional Interview Archive', format: 'flac', bitrateKbps: 0, targetLufs: -16, desc: 'FLAC Lossless · -16 LUFS' },
            ].map((p) => (
              <button
                key={p.presetLabel}
                type="button"
                onClick={() => onQuickExportPreset(p)}
                className="flex flex-col justify-between rounded border border-[#252B38] bg-[#181C25] p-3 text-left hover:border-[#3B82F6] hover:bg-[#202531] cursor-pointer"
              >
                <div>
                  <div className="text-xs font-semibold text-white">{p.presetLabel}</div>
                  <div className="mt-1 text-[11px] text-[#9CA6B8]">{p.desc}</div>
                </div>
                <div className="mt-2 flex items-center gap-1 text-[11px] font-medium text-[#3B82F6]">
                  <Download className="h-3 w-3" />
                  Export Master
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
