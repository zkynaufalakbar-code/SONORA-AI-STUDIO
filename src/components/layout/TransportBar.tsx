import React from 'react';
import {
  Play,
  Pause,
  Square,
  Circle,
  Repeat,
  SkipBack,
  SkipForward,
  Volume2,
} from 'lucide-react';
import { DawButton } from '@/components/ui/Controls';
import { formatTimecode } from '@/lib/timecode';
import { useProjectStore } from '@/stores/projectStore';
import { useTransportStore } from '@/stores/transportStore';
import { audioEngine } from '@/audio/audioEngine';

export const TransportBar: React.FC = () => {
  const clips = useProjectStore((s) => s.clips);
  const timeSelection = useProjectStore((s) => s.timeSelection);
  const masterVolumeDb = useProjectStore((s) => s.masterVolumeDb);
  const setMasterVolumeDb = useProjectStore((s) => s.setMasterVolumeDb);

  const isPlaying = useTransportStore((s) => s.isPlaying);
  const isRecording = useTransportStore((s) => s.isRecording);
  const playheadMs = useTransportStore((s) => s.playheadMs);
  const loopEnabled = useTransportStore((s) => s.loopEnabled);
  const loopStartMs = useTransportStore((s) => s.loopStartMs);
  const loopEndMs = useTransportStore((s) => s.loopEndMs);
  const setPlaying = useTransportStore((s) => s.setPlaying);
  const setPlayheadMs = useTransportStore((s) => s.setPlayheadMs);
  const toggleLoop = useTransportStore((s) => s.toggleLoop);
  const setLoopRegion = useTransportStore((s) => s.setLoopRegion);
  const setWorkspaceMode = useTransportStore((s) => s.setWorkspaceMode);

  const totalDurationMs = clips.reduce(
    (max, c) => Math.max(max, c.timelineStartMs + c.durationMs),
    0,
  );

  const handlePlayPause = async () => {
    if (isPlaying) {
      const pos = audioEngine.pause();
      setPlaying(false);
      setPlayheadMs(pos);
    } else {
      const start =
        playheadMs >= totalDurationMs && totalDurationMs > 0 ? 0 : playheadMs;
      setPlayheadMs(start);
      setPlaying(true);
      await audioEngine.play(start, () => {
        setPlaying(false);
        setPlayheadMs(0);
      });
    }
  };

  const handleStop = () => {
    audioEngine.stop();
    setPlaying(false);
    setPlayheadMs(0);
  };

  const handleToggleLoop = () => {
    if (!loopEnabled && timeSelection && timeSelection.endMs > timeSelection.startMs) {
      setLoopRegion(timeSelection.startMs, timeSelection.endMs);
    } else if (!loopEnabled && totalDurationMs > 0 && loopEndMs <= loopStartMs) {
      setLoopRegion(0, totalDurationMs);
    }
    toggleLoop();
  };

  return (
    <footer
      aria-label="Transport Controls"
      className="flex h-12 shrink-0 items-center justify-between gap-4 border-t border-[#252B38] bg-[#12151C] px-4"
    >
      {/* Left: Selection & Loop Info */}
      <div className="hidden md:flex items-center gap-3 text-[11px] text-[#9CA6B8] font-mono-tabular">
        <div>
          <span className="text-[#687387] mr-1">SEL</span>
          {timeSelection && timeSelection.endMs > timeSelection.startMs
            ? `${formatTimecode(timeSelection.startMs)} – ${formatTimecode(timeSelection.endMs)}`
            : 'None'}
        </div>
        {loopEnabled && (
          <div className="rounded bg-[#8B5CF6]/15 px-1.5 py-0.5 text-[10px] text-[#DDD6FE]">
            LOOP {formatTimecode(loopStartMs, false)}→{formatTimecode(loopEndMs, false)}
          </div>
        )}
      </div>

      {/* Center: Primary Transport & Timecode */}
      <div className="flex items-center gap-2">
        <DawButton
          size="sm"
          onClick={() => {
            setPlayheadMs(0);
            if (isPlaying) void audioEngine.play(0);
          }}
          title="Jump to Start (Home)"
          aria-label="Jump to Start"
        >
          <SkipBack className="h-3.5 w-3.5" />
        </DawButton>

        <DawButton
          size="md"
          variant={isPlaying ? 'primary' : 'default'}
          onClick={() => void handlePlayPause()}
          title="Play / Pause (Space)"
          aria-label={isPlaying ? 'Pause' : 'Play'}
          className="w-10"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </DawButton>

        <DawButton size="sm" onClick={handleStop} title="Stop" aria-label="Stop">
          <Square className="h-3.5 w-3.5" />
        </DawButton>

        <DawButton
          size="sm"
          variant={isRecording ? 'danger' : 'default'}
          onClick={() => setWorkspaceMode('recording')}
          title="Open Recording Studio"
          aria-label="Record Audio"
        >
          <Circle className={`h-3.5 w-3.5 ${isRecording ? 'fill-[#EF4444] animate-pulse' : 'text-[#EF4444]'}`} />
        </DawButton>

        <DawButton
          size="sm"
          active={loopEnabled}
          onClick={handleToggleLoop}
          title="Toggle Loop Playback (L)"
          aria-label="Loop Playback"
        >
          <Repeat className="h-3.5 w-3.5" />
        </DawButton>

        <DawButton
          size="sm"
          onClick={() => {
            setPlayheadMs(totalDurationMs);
            if (isPlaying) audioEngine.pause();
            setPlaying(false);
          }}
          title="Jump to End (End)"
          aria-label="Jump to End"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </DawButton>

        {/* Precision Tabular Timecode */}
        <div className="ml-2 flex items-baseline gap-1.5 rounded border border-[#252B38] bg-[#090B0F] px-3 py-1 font-mono-tabular">
          <span className="text-sm font-semibold text-[#22D3EE]">
            {formatTimecode(playheadMs)}
          </span>
          <span className="text-[11px] text-[#687387]">/</span>
          <span className="text-xs text-[#9CA6B8]">{formatTimecode(totalDurationMs)}</span>
        </div>
      </div>

      {/* Right: Master Volume */}
      <div className="flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-[#22D3EE]" />
        <span className="hidden sm:inline text-[11px] text-[#9CA6B8]">Master</span>
        <input
          type="range"
          min={-48}
          max={6}
          step={0.5}
          value={masterVolumeDb}
          onChange={(e) => {
            const db = parseFloat(e.target.value);
            setMasterVolumeDb(db);
            audioEngine.setMasterVolumeDb(db);
          }}
          aria-label="Master Volume"
          className="daw-slider w-24"
        />
        <span className="font-mono-tabular w-12 text-right text-[11px] text-[#E5E7EB]">
          {masterVolumeDb > 0 ? `+${masterVolumeDb.toFixed(1)}` : masterVolumeDb.toFixed(1)} dB
        </span>
      </div>
    </footer>
  );
};
