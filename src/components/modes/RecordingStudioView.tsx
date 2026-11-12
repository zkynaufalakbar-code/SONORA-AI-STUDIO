import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  Square,
  Pause,
  Play,
  RefreshCw,
  Volume2,
  AlertTriangle,
  ArrowLeft,
} from 'lucide-react';
import { DawButton, ParamSlider } from '@/components/ui/Controls';
import {
  importAudioFile,
  listAudioDevices,
  pauseRecordingSession,
  setRecordingGain,
  startRecordingSession,
  stopRecordingSession,
} from '@/lib/tauri';
import { formatTimecode } from '@/lib/timecode';
import { linearToDb } from '@/lib/utils';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { useTransportStore } from '@/stores/transportStore';

export const RecordingStudioView: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ringSamplesRef = useRef<number[]>(new Array(480).fill(0));

  const devices = useRuntimeStore((s) => s.devices);
  const selectedInputDevice = useRuntimeStore((s) => s.selectedInputDevice);
  const setSelectedInputDevice = useRuntimeStore((s) => s.setSelectedInputDevice);
  const setBusy = useRuntimeStore((s) => s.setBusy);

  const tracks = useProjectStore((s) => s.tracks);
  const selectedTrackId = useProjectStore((s) => s.selectedTrackId);
  const addAsset = useProjectStore((s) => s.addAsset);
  const addClipFromAsset = useProjectStore((s) => s.addClipFromAsset);

  const isRecording = useTransportStore((s) => s.isRecording);
  const setRecording = useTransportStore((s) => s.setRecording);
  const setWorkspaceMode = useTransportStore((s) => s.setWorkspaceMode);

  const [paused, setPaused] = useState(false);
  const [channels, setChannels] = useState<1 | 2>(1);
  const [sampleRate, setSampleRate] = useState(48000);
  const [bitDepth, setBitDepth] = useState<16 | 24 | 32>(24);
  const [inputGainDb, setInputGainDb] = useState(0);
  const [monitor, setMonitor] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [peakL, setPeakL] = useState(-96);
  const [peakR, setPeakR] = useState(-96);
  const [clipped, setClipped] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputDevices = devices.filter((d) => d.kind === 'input');

  const drawOscilloscope = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    ctx.fillStyle = '#090B0F';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#1E2430';
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    const arr = ringSamplesRef.current;
    const mid = h / 2;
    const step = w / arr.length;
    ctx.fillStyle = isRecording ? '#22D3EE' : '#3B82F6';
    for (let i = 0; i < arr.length; i++) {
      const amp = Math.min(1, Math.abs(arr[i]));
      const bh = Math.max(2, amp * (h - 16));
      ctx.fillRect(i * step, mid - bh / 2, Math.max(1.5, step - 0.5), bh);
    }
  };

  useEffect(() => {
    drawOscilloscope();
  }, [elapsedMs, isRecording]);

  const handleRefreshDevices = async () => {
    const list = await listAudioDevices();
    useRuntimeStore.setState({ devices: list });
  };

  const handleStart = async () => {
    setErrorMsg(null);
    setClipped(false);
    ringSamplesRef.current.fill(0);
    setPaused(false);
    try {
      const targetPath = await startRecordingSession(
        {
          deviceName: selectedInputDevice || null,
          channels,
          sampleRate,
          bitDepth,
          inputGainDb,
          monitorEnabled: monitor,
        },
        (ev) => {
          setElapsedMs(ev.elapsedMs);
          setPeakL(linearToDb(ev.peakL));
          setPeakR(linearToDb(ev.peakR));
          if (ev.clipping) setClipped(true);
          if (ev.waveformSamples?.length) {
            const next = [...ringSamplesRef.current.slice(ev.waveformSamples.length), ...ev.waveformSamples];
            ringSamplesRef.current = next.slice(-480);
          }
          drawOscilloscope();
        },
      );
      setRecording(true);
      setStatusNote(`Recording stream -> ${targetPath}`);
    } catch (err) {
      setErrorMsg(String(err));
    }
  };

  const handlePauseResume = async () => {
    const next = !paused;
    await pauseRecordingSession(next);
    setPaused(next);
  };

  const handleStopAndInsert = async () => {
    setBusy('Finalizing recording & computing waveform...');
    try {
      const finished = await stopRecordingSession();
      setRecording(false);
      setPaused(false);
      const imported = await importAudioFile(finished.outputPath);
      addAsset(imported);
      const armedTrack =
        tracks.find((t) => t.armed) ??
        tracks.find((t) => t.id === selectedTrackId) ??
        tracks[0];
      if (armedTrack) {
        addClipFromAsset(imported.id, armedTrack.id, 0);
      }
      setStatusNote(`Saved & imported recording (${formatTimecode(finished.durationMs)}).`);
      setWorkspaceMode('studio');
    } catch (err) {
      setErrorMsg(String(err));
      setRecording(false);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-1 flex-col bg-[#0B0D11] p-6 overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#252B38] pb-3">
          <div>
            <h1 className="text-base font-semibold text-white flex items-center gap-2">
              <Mic className="h-4 w-4 text-[#EF4444]" />
              WASAPI Studio Recording Booth
            </h1>
            <p className="text-xs text-[#9CA6B8]">
              Low-latency native Rust microphone & USB interface capture directly to multi-track timeline.
            </p>
          </div>
          <DawButton size="sm" onClick={() => setWorkspaceMode('studio')} disabled={isRecording}>
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Timeline
          </DawButton>
        </div>

        {errorMsg && (
          <div className="rounded border border-[#EF4444]/40 bg-[#EF4444]/10 p-3 text-xs text-[#FCA5A5]">
            {errorMsg}
          </div>
        )}

        {/* Hardware & Format Configuration */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded border border-[#252B38] bg-[#12151C] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9CA6B8]">
                Input Device & Monitoring
              </h2>
              <DawButton size="xs" onClick={() => void handleRefreshDevices()} disabled={isRecording}>
                <RefreshCw className="h-3 w-3" />
                Scan
              </DawButton>
            </div>
            <select
              value={selectedInputDevice}
              onChange={(e) => setSelectedInputDevice(e.target.value)}
              disabled={isRecording}
              className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2.5 text-xs text-[#E5E7EB]"
            >
              {inputDevices.length === 0 && <option value="">Default System Microphone</option>}
              {inputDevices.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name} ({d.maxChannels}ch · {d.defaultSampleRate} Hz){d.isDefault ? ' [Default]' : ''}
                </option>
              ))}
            </select>

            <ParamSlider
              label="Input Gain Trim"
              value={inputGainDb}
              min={-18}
              max={24}
              step={0.5}
              unit="dB"
              defaultValue={0}
              onChange={(g) => {
                setInputGainDb(g);
                if (isRecording) void setRecordingGain(g);
              }}
            />

            <label className="flex items-center justify-between rounded border border-[#252B38] bg-[#0B0D11] px-3 py-2 text-xs text-[#D1D5DB] cursor-pointer">
              <span className="flex items-center gap-2">
                <Volume2 className="h-3.5 w-3.5 text-[#22D3EE]" />
                Direct Output Monitoring
              </span>
              <input
                type="checkbox"
                checked={monitor}
                disabled={isRecording}
                onChange={(e) => setMonitor(e.target.checked)}
              />
            </label>
          </div>

          <div className="rounded border border-[#252B38] bg-[#12151C] p-4 space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9CA6B8]">
              Capture Format
            </h2>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] text-[#9CA6B8] mb-1">Channels</label>
                <select
                  value={channels}
                  disabled={isRecording}
                  onChange={(e) => setChannels(Number(e.target.value) as 1 | 2)}
                  className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-[#E5E7EB]"
                >
                  <option value={1}>Mono (1ch)</option>
                  <option value={2}>Stereo (2ch)</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#9CA6B8] mb-1">Sample Rate</label>
                <select
                  value={sampleRate}
                  disabled={isRecording}
                  onChange={(e) => setSampleRate(Number(e.target.value))}
                  className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-[#E5E7EB]"
                >
                  <option value={44100}>44.1 kHz</option>
                  <option value={48000}>48.0 kHz</option>
                  <option value={96000}>96.0 kHz</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#9CA6B8] mb-1">Bit Depth</label>
                <select
                  value={bitDepth}
                  disabled={isRecording}
                  onChange={(e) => setBitDepth(Number(e.target.value) as 16 | 24 | 32)}
                  className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-[#E5E7EB]"
                >
                  <option value={16}>16-bit PCM</option>
                  <option value={24}>24-bit PCM</option>
                  <option value={32}>32-bit Float</option>
                </select>
              </div>
            </div>

            <div className="rounded border border-[#252B38] bg-[#0B0D11] p-2.5 text-[11px] text-[#9CA6B8]">
              Target Timeline Track:{' '}
              <span className="font-semibold text-white">
                {(tracks.find((t) => t.armed) ?? tracks.find((t) => t.id === selectedTrackId) ?? tracks[0])?.name}
              </span>
            </div>
          </div>
        </div>

        {/* Live Waveform Scope & Level Meters */}
        <div className="rounded border border-[#252B38] bg-[#12151C] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="font-mono-tabular text-2xl font-bold text-white">
                {formatTimecode(elapsedMs)}
              </span>
              {clipped && (
                <button
                  type="button"
                  onClick={() => setClipped(false)}
                  className="inline-flex items-center gap-1 rounded bg-[#EF4444] px-2 py-0.5 text-[11px] font-bold text-white cursor-pointer"
                >
                  <AlertTriangle className="h-3 w-3" />
                  CLIPPING DETECTED (Click to reset)
                </button>
              )}
            </div>
            <div className="font-mono-tabular text-xs text-[#22D3EE]">
              L: {peakL <= -90 ? '-inf' : peakL.toFixed(1)} dB · R: {peakR <= -90 ? '-inf' : peakR.toFixed(1)} dB
            </div>
          </div>

          <canvas
            ref={canvasRef}
            width={820}
            height={170}
            className="w-full rounded border border-[#252B38]"
          />

          <div className="flex items-center justify-center gap-3 pt-2">
            {!isRecording ? (
              <DawButton size="md" variant="danger" onClick={() => void handleStart()} className="px-6">
                <Mic className="h-4 w-4" />
                Start Recording
              </DawButton>
            ) : (
              <>
                <DawButton size="md" onClick={() => void handlePauseResume()}>
                  {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  {paused ? 'Resume' : 'Pause'}
                </DawButton>
                <DawButton size="md" variant="primary" onClick={() => void handleStopAndInsert()}>
                  <Square className="h-4 w-4" />
                  Stop & Insert to Timeline
                </DawButton>
              </>
            )}
          </div>

          {statusNote && (
            <p className="text-center text-[11px] text-[#687387] truncate">{statusNote}</p>
          )}
        </div>
      </div>
    </section>
  );
};
