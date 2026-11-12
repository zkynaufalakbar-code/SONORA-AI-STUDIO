import React, { useState } from 'react';
import {
  Wand2,
  VolumeX,
  Mic2,
  Music,
  Scissors,
  FileText,
  Send,
  Play,
  AlertCircle,
  CheckCircle2,
  Download,
  Cpu,
} from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { DawButton, ParamSlider } from '@/components/ui/Controls';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { useTransportStore } from '@/stores/transportStore';
import {
  analyzeSilenceAndTelemetry,
  askAiAssistant,
  importAudioFile,
  separateVocals,
  transcribeAudio,
  transformClipAudio,
} from '@/lib/tauri';
import { formatTimecode } from '@/lib/timecode';
import type { AssistantActionStep } from '@/types/ai';
import type { EffectType } from '@/types/effects';

type AiTab = 'tools' | 'transcribe' | 'assistant';

export const AiToolsPanel: React.FC = () => {
  const [tab, setTab] = useState<AiTab>('tools');
  const [noiseStrength, setNoiseStrength] = useState(16);
  const [voiceClarity, setVoiceClarity] = useState(0.7);
  const [voiceIsoAgg, setVoiceIsoAgg] = useState(0.6);
  const [silenceThresh, setSilenceThresh] = useState(-42);
  const [silenceMinMs, setSilenceMinMs] = useState(450);
  const [sttLanguage, setSttLanguage] = useState('auto');
  const [chatInput, setChatInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const clips = useProjectStore((s) => s.clips);
  const assets = useProjectStore((s) => s.assets);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const selectedTrackId = useProjectStore((s) => s.selectedTrackId);
  const replaceClipAssetRender = useProjectStore((s) => s.replaceClipAssetRender);
  const addAsset = useProjectStore((s) => s.addAsset);
  const addTrack = useProjectStore((s) => s.addTrack);
  const addClipFromAsset = useProjectStore((s) => s.addClipFromAsset);
  const addEffectToTarget = useProjectStore((s) => s.addEffectToTarget);
  const transcript = useProjectStore((s) => s.transcript);
  const setTranscript = useProjectStore((s) => s.setTranscript);

  const providers = useRuntimeStore((s) => s.providers);
  const setBusy = useRuntimeStore((s) => s.setBusy);
  const setShowModelManager = useRuntimeStore((s) => s.setShowModelManager);
  const setShowSettings = useRuntimeStore((s) => s.setShowSettings);
  const activeAssistantProvider = useRuntimeStore((s) => s.activeAssistantProvider);
  const setActiveAssistantProvider = useRuntimeStore((s) => s.setActiveAssistantProvider);
  const activeSttProvider = useRuntimeStore((s) => s.activeSttProvider);
  const setActiveSttProvider = useRuntimeStore((s) => s.setActiveSttProvider);
  const assistantMessages = useRuntimeStore((s) => s.assistantMessages);
  const addAssistantMessage = useRuntimeStore((s) => s.addAssistantMessage);
  const markAssistantPlanExecuted = useRuntimeStore((s) => s.markAssistantPlanExecuted);
  const detectedSilence = useRuntimeStore((s) => s.detectedSilence);
  const setSilenceResults = useRuntimeStore((s) => s.setSilenceResults);

  const setPlayheadMs = useTransportStore((s) => s.setPlayheadMs);

  const activeClip =
    clips.find((c) => selectedClipIds.includes(c.id)) ??
    clips.find((c) => c.trackId === selectedTrackId) ??
    clips[0] ??
    null;
  const activeAsset = activeClip ? assets[activeClip.renderAssetId ?? activeClip.assetId] : null;

  const runClipOp = async (
    label: string,
    op: Record<string, unknown>,
    targetClip = activeClip,
  ) => {
    if (!targetClip) {
      setErrorMsg('Select an audio clip on the timeline first.');
      return;
    }
    const asset = assets[targetClip.renderAssetId ?? targetClip.assetId];
    if (!asset) return;
    setErrorMsg(null);
    setBusy(label);
    try {
      const rendered = await transformClipAudio(asset.resolvedPath, op, `${targetClip.name} (${label})`);
      replaceClipAssetRender(targetClip.id, rendered, label, false);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleScanSilence = async () => {
    if (!activeClip || !activeAsset) {
      setErrorMsg('Select a clip to analyze silence.');
      return;
    }
    setErrorMsg(null);
    setBusy('Analyzing silence & telemetry...');
    try {
      const res = await analyzeSilenceAndTelemetry(
        activeAsset.resolvedPath,
        silenceThresh,
        silenceMinMs,
      );
      setSilenceResults(res.intervals, res.telemetry);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleRemoveDetectedSilence = () => {
    const liveSilence = useRuntimeStore.getState().detectedSilence;
    if (!activeClip || liveSilence.length === 0) return;
    const state = useProjectStore.getState();
    const sorted = [...liveSilence].sort((a, b) => a.startMs - b.startMs);

    // Keep speech segments outside detected silent gaps
    const clipSrcStart = activeClip.sourceOffsetMs;
    const clipSrcEnd = activeClip.sourceOffsetMs + activeClip.durationMs * activeClip.playbackRate;
    const keptRanges: Array<{ start: number; end: number }> = [];
    let cursor = clipSrcStart;
    for (const gap of sorted) {
      const gStart = Math.max(clipSrcStart, gap.startMs + 40);
      const gEnd = Math.min(clipSrcEnd, gap.endMs - 40);
      if (gStart > cursor + 40) {
        keptRanges.push({ start: cursor, end: gStart });
      }
      cursor = Math.max(cursor, gEnd);
    }
    if (clipSrcEnd > cursor + 40) {
      keptRanges.push({ start: cursor, end: clipSrcEnd });
    }
    if (keptRanges.length === 0) return;

    let tlCursor = activeClip.timelineStartMs;
    const newClips = keptRanges.map((r, i) => {
      const dur = Math.round((r.end - r.start) / activeClip.playbackRate);
      const piece = {
        ...structuredClone(activeClip),
        id: i === 0 ? activeClip.id : crypto.randomUUID(),
        timelineStartMs: tlCursor,
        sourceOffsetMs: Math.round(r.start),
        durationMs: Math.max(40, dur),
        fadeInMs: Math.min(15, Math.floor(dur / 4)),
        fadeOutMs: Math.min(15, Math.floor(dur / 4)),
      };
      tlCursor += piece.durationMs;
      return piece;
    });

    useProjectStore.setState({
      clips: state.clips.flatMap((c) => (c.id === activeClip.id ? newClips : [c])),
      selectedClipIds: newClips.map((c) => c.id),
      dirty: true,
    });
    setSilenceResults([], useRuntimeStore.getState().lastTelemetry);
  };

  const handleVocalIsolation = async () => {
    if (!activeAsset) {
      setErrorMsg('Select a clip first.');
      return;
    }
    setErrorMsg(null);
    setBusy('Separating Vocals & Instrumental...');
    try {
      const stems = await separateVocals(activeAsset.resolvedPath);
      const [vAsset, iAsset] = await Promise.all([
        importAudioFile(stems.vocalsPath),
        importAudioFile(stems.instrumentalPath),
      ]);
      addAsset(vAsset);
      addAsset(iAsset);
      const vTrack = addTrack({ name: `${activeAsset.name} (Vocals)`, role: 'stem', color: '#22D3EE' });
      const iTrack = addTrack({ name: `${activeAsset.name} (Instrumental)`, role: 'stem', color: '#8B5CF6' });
      addClipFromAsset(vAsset.id, vTrack, activeClip?.timelineStartMs ?? 0);
      addClipFromAsset(iAsset.id, iTrack, activeClip?.timelineStartMs ?? 0);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleTranscribe = async () => {
    if (!activeAsset) {
      setErrorMsg('Select a clip to transcribe.');
      return;
    }
    setErrorMsg(null);
    setBusy('Transcribing speech...');
    try {
      const segs = await transcribeAudio(activeAsset.resolvedPath, activeSttProvider, sttLanguage);
      const offset = activeClip?.timelineStartMs ?? 0;
      setTranscript(
        segs.map((s) => ({
          ...s,
          startMs: s.startMs + offset,
          endMs: s.endMs + offset,
        })),
      );
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setBusy(null);
    }
  };

  const exportTranscript = async (format: 'srt' | 'txt') => {
    if (transcript.length === 0) return;
    const outPath = await save({
      defaultPath: `transcript.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!outPath) return;

    const toSrtTime = (ms: number) => {
      const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
      const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
      const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
      const mmm = String(ms % 1000).padStart(3, '0');
      return `${h}:${m}:${s},${mmm}`;
    };

    const text =
      format === 'txt'
        ? transcript.map((s) => `[${formatTimecode(s.startMs, false)}] ${s.text}`).join('\n')
        : transcript
            .map(
              (s, i) =>
                `${i + 1}\n${toSrtTime(s.startMs)} --> ${toSrtTime(s.endMs)}\n${s.text}\n`,
            )
            .join('\n');

    await writeTextFile(outPath, text);
  };

  const handleSendAssistant = async () => {
    const prompt = chatInput.trim();
    if (!prompt) return;
    setChatInput('');
    setErrorMsg(null);

    addAssistantMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: prompt,
      providerUsed: 'User',
      timestamp: new Date().toISOString(),
    });

    setBusy('Analyzing audio & planning...');
    try {
      let telemetry = useRuntimeStore.getState().lastTelemetry;
      if (!telemetry && activeAsset) {
        const res = await analyzeSilenceAndTelemetry(
          activeAsset.resolvedPath,
          silenceThresh,
          silenceMinMs,
        );
        telemetry = res.telemetry;
        setSilenceResults(res.intervals, res.telemetry);
      }

      const res = await askAiAssistant(activeAssistantProvider, prompt, telemetry);
      addAssistantMessage({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: res.reply,
        providerUsed: res.providerUsed,
        timestamp: new Date().toISOString(),
        actionPlan: res.actionPlan,
        executed: false,
      });
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setBusy(null);
    }
  };

  const executeAssistantPlan = async (msgId: string, steps: AssistantActionStep[]) => {
    if (!activeClip) {
      setErrorMsg('Select a clip first to apply the AI action plan.');
      return;
    }
    setErrorMsg(null);
    for (const step of steps) {
      const latestClip = useProjectStore.getState().clips.find((c) => c.id === activeClip.id);
      if (!latestClip) break;

      if (step.type === 'noise_removal') {
        await runClipOp(
          step.label,
          { kind: 'noiseRemoval', strengthDb: Number(step.params.strengthDb ?? 16) },
          latestClip,
        );
      } else if (step.type === 'voice_enhancement') {
        await runClipOp(
          step.label,
          { kind: 'voiceEnhancement', clarity: Number(step.params.clarity ?? 0.72) },
          latestClip,
        );
      } else if (step.type === 'normalize') {
        if (typeof step.params.targetLufs === 'number') {
          await runClipOp(
            step.label,
            { kind: 'normalizeLufs', targetLufs: step.params.targetLufs },
            latestClip,
          );
        } else {
          await runClipOp(
            step.label,
            { kind: 'normalizePeak', targetDb: Number(step.params.targetDb ?? -1.0) },
            latestClip,
          );
        }
      } else if (step.type === 'amplify') {
        await runClipOp(
          step.label,
          { kind: 'amplify', gainDb: Number(step.params.gainDb ?? 3) },
          latestClip,
        );
      } else if (step.type === 'silence_removal') {
        await handleScanSilence();
        handleRemoveDetectedSilence();
      } else if (step.type === 'add_effect' && Array.isArray(step.params.effects)) {
        const trackId = latestClip.trackId;
        for (const fx of step.params.effects as Array<{ type: EffectType; params?: Record<string, unknown> }>) {
          const cleanParams = fx.params
            ? (Object.fromEntries(
                Object.entries(fx.params).filter(
                  ([, v]) => typeof v === 'number' || typeof v === 'boolean' || Array.isArray(v),
                ),
              ) as Record<string, number | boolean>)
            : undefined;
          addEffectToTarget({ kind: 'track', id: trackId }, fx.type, cleanParams);
        }
      }
    }
    markAssistantPlanExecuted(msgId);
  };

  const rnnoiseReady = providers.find((p) => p.id === 'local_rnnoise')?.configured;
  const demucsReady = providers.find((p) => p.id === 'local_demucs')?.configured;

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Sub-tabs */}
      <div className="grid grid-cols-3 gap-1 rounded border border-[#252B38] bg-[#0B0D11] p-0.5 text-[11px]">
        <button
          type="button"
          onClick={() => setTab('tools')}
          className={`rounded py-1 font-medium cursor-pointer ${tab === 'tools' ? 'bg-[#8B5CF6] text-white' : 'text-[#9CA6B8]'}`}
        >
          AI Process
        </button>
        <button
          type="button"
          onClick={() => setTab('transcribe')}
          className={`rounded py-1 font-medium cursor-pointer ${tab === 'transcribe' ? 'bg-[#8B5CF6] text-white' : 'text-[#9CA6B8]'}`}
        >
          Transcribe
        </button>
        <button
          type="button"
          onClick={() => setTab('assistant')}
          className={`rounded py-1 font-medium cursor-pointer ${tab === 'assistant' ? 'bg-[#8B5CF6] text-white' : 'text-[#9CA6B8]'}`}
        >
          Assistant
        </button>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-1.5 rounded border border-[#EF4444]/40 bg-[#EF4444]/10 p-2 text-[11px] text-[#FCA5A5]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{errorMsg}</span>
        </div>
      )}

      {tab === 'tools' && (
        <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
          {/* AI Noise Removal */}
          <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <VolumeX className="h-3.5 w-3.5 text-[#22D3EE]" />
                AI Noise Removal
              </span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  rnnoiseReady
                    ? 'bg-[#10B981]/15 text-[#34D399]'
                    : 'bg-[#3B82F6]/15 text-[#93C5FD]'
                }`}
              >
                {rnnoiseReady ? 'RNNoise + FFT' : 'FFmpeg FFT Ready'}
              </span>
            </div>
            <ParamSlider
              label="Suppression Strength"
              value={noiseStrength}
              min={4}
              max={36}
              step={1}
              unit="dB"
              onChange={setNoiseStrength}
            />
            <div className="flex gap-1.5">
              <DawButton
                size="xs"
                variant="ai"
                className="flex-1"
                disabled={!activeClip}
                onClick={() =>
                  void runClipOp('AI Noise Removal', {
                    kind: 'noiseRemoval',
                    strengthDb: noiseStrength,
                  })
                }
              >
                <Wand2 className="h-3 w-3" />
                Remove Noise
              </DawButton>
              {!rnnoiseReady && (
                <DawButton size="xs" onClick={() => setShowModelManager(true)} title="Download RNNoise neural model">
                  <Cpu className="h-3 w-3" />
                </DawButton>
              )}
            </div>
          </div>

          {/* AI Voice Enhancement */}
          <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Mic2 className="h-3.5 w-3.5 text-[#3B82F6]" />
                AI Voice Enhancement
              </span>
              <span className="text-[10px] text-[#34D399]">Offline Ready</span>
            </div>
            <ParamSlider
              label="Vocal Clarity"
              value={voiceClarity}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={setVoiceClarity}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
            <DawButton
              size="xs"
              variant="primary"
              className="w-full"
              disabled={!activeClip}
              onClick={() =>
                void runClipOp('AI Voice Enhance', {
                  kind: 'voiceEnhancement',
                  clarity: voiceClarity,
                })
              }
            >
              Enhance Clarity & Level
            </DawButton>
          </div>

          {/* AI Voice Isolation */}
          <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Mic2 className="h-3.5 w-3.5 text-[#8B5CF6]" />
                AI Voice Isolation
              </span>
              <span className="text-[10px] text-[#9CA6B8]">Speaker Focus</span>
            </div>
            <ParamSlider
              label="Focus Aggressiveness"
              value={voiceIsoAgg}
              min={0.1}
              max={1.0}
              step={0.05}
              onChange={setVoiceIsoAgg}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
            <DawButton
              size="xs"
              variant="ai"
              className="w-full"
              disabled={!activeClip}
              onClick={() =>
                void runClipOp('AI Voice Isolation', {
                  kind: 'voiceIsolation',
                  aggressiveness: voiceIsoAgg,
                })
              }
            >
              Isolate Primary Speaker
            </DawButton>
          </div>

          {/* AI Vocal Isolation (Stems) */}
          <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Music className="h-3.5 w-3.5 text-[#F59E0B]" />
                AI Vocal / Stem Separation
              </span>
              <span
                className={`text-[10px] ${demucsReady ? 'text-[#34D399]' : 'text-[#F59E0B]'}`}
              >
                {demucsReady ? 'Demucs Ready' : 'Not Installed'}
              </span>
            </div>
            <p className="text-[11px] text-[#9CA6B8]">
              Splits vocals & instrumental onto separate timeline tracks via local Demucs.
            </p>
            <div className="flex gap-1.5">
              <DawButton
                size="xs"
                className="flex-1"
                disabled={!activeClip || !demucsReady}
                onClick={() => void handleVocalIsolation()}
              >
                Separate Vocals & Music
              </DawButton>
              {!demucsReady && (
                <DawButton size="xs" onClick={() => setShowModelManager(true)}>
                  Setup
                </DawButton>
              )}
            </div>
          </div>

          {/* AI Silence Removal */}
          <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <Scissors className="h-3.5 w-3.5 text-[#22D3EE]" />
              AI Silence Removal
            </span>
            <ParamSlider
              label="Silence Threshold"
              value={silenceThresh}
              min={-70}
              max={-18}
              step={1}
              unit="dB"
              onChange={setSilenceThresh}
            />
            <ParamSlider
              label="Min Gap Duration"
              value={silenceMinMs}
              min={150}
              max={3000}
              step={50}
              unit="ms"
              onChange={setSilenceMinMs}
            />
            <div className="flex gap-1.5">
              <DawButton size="xs" className="flex-1" disabled={!activeClip} onClick={() => void handleScanSilence()}>
                Scan Pauses
              </DawButton>
              <DawButton
                size="xs"
                variant="primary"
                className="flex-1"
                disabled={detectedSilence.length === 0}
                onClick={handleRemoveDetectedSilence}
              >
                Cut ({detectedSilence.length})
              </DawButton>
            </div>
          </div>
        </div>
      )}

      {tab === 'transcribe' && (
        <div className="flex flex-1 flex-col gap-2 min-h-0">
          <div className="rounded border border-[#252B38] bg-[#181C25] p-2.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-white">Provider</span>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="text-[11px] text-[#3B82F6] hover:underline cursor-pointer"
              >
                Configure Keys / Local
              </button>
            </div>
            <select
              value={activeSttProvider}
              onChange={(e) => setActiveSttProvider(e.target.value)}
              className="h-7 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-[#E5E7EB]"
            >
              {providers
                .filter((p) => ['local_whisper', 'openai', 'gemini'].includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.statusLabel})
                  </option>
                ))}
            </select>
            <div className="flex gap-1.5">
              <select
                value={sttLanguage}
                onChange={(e) => setSttLanguage(e.target.value)}
                className="h-7 w-28 rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-[#E5E7EB]"
              >
                <option value="auto">Auto Lang</option>
                <option value="id">Indonesian</option>
                <option value="en">English</option>
              </select>
              <DawButton
                size="xs"
                variant="ai"
                className="flex-1"
                disabled={!activeClip}
                onClick={() => void handleTranscribe()}
              >
                <FileText className="h-3 w-3" />
                Transcribe Clip
              </DawButton>
            </div>
          </div>

          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] text-[#9CA6B8]">
              {transcript.length} segment(s)
            </span>
            <div className="flex gap-1">
              <DawButton size="xs" disabled={transcript.length === 0} onClick={() => void exportTranscript('srt')}>
                <Download className="h-3 w-3" />
                SRT
              </DawButton>
              <DawButton size="xs" disabled={transcript.length === 0} onClick={() => void exportTranscript('txt')}>
                <Download className="h-3 w-3" />
                TXT
              </DawButton>
            </div>
          </div>

          <ul className="flex-1 space-y-1.5 overflow-y-auto pr-1">
            {transcript.map((seg) => (
              <li key={seg.id}>
                <button
                  type="button"
                  onClick={() => setPlayheadMs(seg.startMs)}
                  className="w-full rounded border border-[#252B38] bg-[#181C25] p-2 text-left hover:border-[#3B82F6] cursor-pointer"
                >
                  <span className="font-mono-tabular text-[10px] text-[#22D3EE]">
                    {formatTimecode(seg.startMs, false)} → {formatTimecode(seg.endMs, false)}
                  </span>
                  <p className="mt-0.5 text-xs text-[#E5E7EB] leading-snug">{seg.text}</p>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'assistant' && (
        <div className="flex flex-1 flex-col gap-2 min-h-0">
          <div className="flex items-center gap-1.5">
            <select
              value={activeAssistantProvider}
              onChange={(e) => setActiveAssistantProvider(e.target.value)}
              aria-label="AI Assistant Provider"
              className="h-7 flex-1 rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-[#E5E7EB]"
            >
              {providers
                .filter((p) => ['local_ffmpeg', 'openai', 'gemini'].includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.statusLabel})
                  </option>
                ))}
            </select>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto pr-1">
            {assistantMessages.map((m) => (
              <div
                key={m.id}
                className={`rounded border p-2 text-xs ${
                  m.role === 'user'
                    ? 'ml-4 border-[#3B82F6]/40 bg-[#3B82F6]/10 text-white'
                    : 'border-[#252B38] bg-[#181C25] text-[#D1D5DB]'
                }`}
              >
                <div className="mb-1 flex items-center justify-between text-[10px] text-[#687387]">
                  <span>{m.providerUsed}</span>
                </div>
                <p className="leading-relaxed">{m.content}</p>
                {m.actionPlan && m.actionPlan.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-[#252B38] pt-2">
                    {m.actionPlan.map((step) => (
                      <div key={step.id} className="flex items-center gap-1.5 text-[11px] text-[#93C5FD]">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        <span>{step.label}</span>
                      </div>
                    ))}
                    <DawButton
                      size="xs"
                      variant={m.executed ? 'default' : 'ai'}
                      className="mt-1.5 w-full"
                      disabled={m.executed}
                      onClick={() => void executeAssistantPlan(m.id, m.actionPlan!)}
                    >
                      <Play className="h-3 w-3" />
                      {m.executed ? 'Applied to Clip' : 'Apply Action Plan'}
                    </DawButton>
                  </div>
                )}
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSendAssistant();
            }}
            className="flex gap-1.5"
          >
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="e.g. Bersihkan noise & buat seperti podcast..."
              className="h-7 flex-1 rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-[#E5E7EB] placeholder-[#687387] focus:border-[#8B5CF6] focus:outline-none"
            />
            <DawButton type="submit" size="xs" variant="ai" aria-label="Send to AI Assistant">
              <Send className="h-3.5 w-3.5" />
            </DawButton>
          </form>
        </div>
      )}
    </div>
  );
};
