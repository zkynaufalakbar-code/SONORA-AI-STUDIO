import React, { useEffect, useState } from 'react';
import { Download, CheckCircle2, FolderOpen, AlertCircle } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';
import { DawButton, NativeModal } from '@/components/ui/Controls';
import { exportProjectMixdown } from '@/lib/tauri';
import { useProjectStore } from '@/stores/projectStore';
import { useRuntimeStore } from '@/stores/runtimeStore';

interface ExportDialogProps {
  initialPreset?: {
    format?: string;
    bitrateKbps?: number;
    targetLufs?: number | null;
    presetLabel?: string;
  } | null;
}

export const ExportDialog: React.FC<ExportDialogProps> = ({ initialPreset }) => {
  const showExport = useRuntimeStore((s) => s.showExport);
  const setShowExport = useRuntimeStore((s) => s.setShowExport);
  const diagnostics = useRuntimeStore((s) => s.diagnostics);

  const projectName = useProjectStore((s) => s.projectName);
  const tracks = useProjectStore((s) => s.tracks);
  const clips = useProjectStore((s) => s.clips);
  const assets = useProjectStore((s) => s.assets);
  const masterVolumeDb = useProjectStore((s) => s.masterVolumeDb);
  const timeSelection = useProjectStore((s) => s.timeSelection);

  const [format, setFormat] = useState<'wav' | 'mp3' | 'flac' | 'ogg' | 'aac' | 'm4a'>('wav');
  const [sampleRate, setSampleRate] = useState(48000);
  const [bitDepth, setBitDepth] = useState<16 | 24 | 32>(24);
  const [bitrateKbps, setBitrateKbps] = useState(256);
  const [channels, setChannels] = useState<1 | 2>(2);
  const [loudnessLufs, setLoudnessLufs] = useState<number | null>(null);
  const [rangeMode, setRangeMode] = useState<'full' | 'selection'>('full');
  const [exportStems, setExportStems] = useState(false);
  const [outputPath, setOutputPath] = useState('');

  const [exporting, setExporting] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [stageText, setStageText] = useState('');
  const [exportedFiles, setExportedFiles] = useState<string[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!showExport) return;
    setExportedFiles(null);
    setErrorMsg(null);
    setProgressPct(0);
    if (initialPreset?.format) {
      setFormat(initialPreset.format as typeof format);
    }
    if (initialPreset?.bitrateKbps) {
      setBitrateKbps(initialPreset.bitrateKbps);
    }
    if (initialPreset?.targetLufs !== undefined) {
      setLoudnessLufs(initialPreset.targetLufs);
    }
    const baseDir = diagnostics?.paths.exportsDir ?? '';
    const safeName = (projectName || 'sonora_mixdown').replace(/[^a-zA-Z0-9_-]+/g, '_');
    const sep = baseDir.endsWith('\\') || baseDir.endsWith('/') ? '' : '\\';
    setOutputPath(`${baseDir}${sep}${safeName}.${initialPreset?.format ?? format}`);
  }, [showExport, initialPreset]);

  useEffect(() => {
    if (!outputPath) return;
    setOutputPath((prev) => prev.replace(/\.[^.\\/]+$/, `.${format}`));
  }, [format]);

  if (!showExport) return null;

  const handleBrowse = async () => {
    const picked = await save({
      defaultPath: outputPath || `${projectName}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (picked) setOutputPath(picked);
  };

  const handleExport = async () => {
    if (!outputPath.trim()) {
      setErrorMsg('Choose an output file path first.');
      return;
    }
    if (clips.length === 0) {
      setErrorMsg('Project has no audio clips to export.');
      return;
    }
    setErrorMsg(null);
    setExporting(true);
    setProgressPct(5);
    setStageText('Preparing FFmpeg multitrack filter graph...');

    try {
      const requestTracks = tracks.map((t) => ({
        id: t.id,
        name: t.name,
        volumeDb: t.volumeDb,
        pan: t.pan,
        muted: t.muted,
        solo: t.solo,
        channelMode: t.channelMode,
        effects: t.effects.map((fx) => ({
          id: fx.id,
          type: fx.type,
          bypassed: fx.bypassed,
          params: fx.params,
        })),
        clips: clips
          .filter((c) => c.trackId === t.id && !c.muted)
          .map((c) => {
            const a = assets[c.renderAssetId ?? c.assetId];
            return {
              sourcePath: a?.resolvedPath ?? '',
              sourceOffsetMs: c.sourceOffsetMs,
              durationMs: c.durationMs,
              timelineStartMs: c.timelineStartMs,
              gainDb: c.gainDb,
              fadeInMs: c.fadeInMs,
              fadeOutMs: c.fadeOutMs,
              fadeInCurve: c.fadeInCurve,
              fadeOutCurve: c.fadeOutCurve,
              playbackRate: c.playbackRate,
              pitchSemitones: c.pitchSemitones,
              channelMode: c.channelMode,
              effects: c.effects.map((fx) => ({
                id: fx.id,
                type: fx.type,
                bypassed: fx.bypassed,
                params: fx.params,
              })),
            };
          })
          .filter((c) => c.sourcePath.length > 0),
      }));

      const files = await exportProjectMixdown(
        {
          outputPath,
          format,
          sampleRate,
          bitrateKbps,
          bitDepth,
          channels,
          loudnessLufs,
          peakNormalizeDb: null,
          selectionStartMs: rangeMode === 'selection' && timeSelection ? timeSelection.startMs : null,
          selectionEndMs: rangeMode === 'selection' && timeSelection ? timeSelection.endMs : null,
          masterVolumeDb,
          tracks: requestTracks,
          exportStems,
        },
        (ev) => {
          setProgressPct(ev.percent);
          setStageText(ev.stage);
        },
      );
      setExportedFiles(files);
      setProgressPct(100);
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <NativeModal
      open={showExport}
      onClose={() => !exporting && setShowExport(false)}
      title={`Export Audio Mixdown${initialPreset?.presetLabel ? ` — ${initialPreset.presetLabel}` : ''}`}
      maxWidthClass="max-w-xl"
    >
      <div className="space-y-3.5 text-xs">
        {/* Format & Quality Presets */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-[11px] text-[#9CA6B8] mb-1">Format</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
              className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-white"
            >
              <option value="wav">WAV (PCM)</option>
              <option value="mp3">MP3 (LAME)</option>
              <option value="flac">FLAC (Lossless)</option>
              <option value="ogg">OGG (Vorbis)</option>
              <option value="aac">AAC (ADTS)</option>
              <option value="m4a">M4A (MP4 Audio)</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-[#9CA6B8] mb-1">Sample Rate</label>
            <select
              value={sampleRate}
              onChange={(e) => setSampleRate(Number(e.target.value))}
              className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-white"
            >
              <option value={44100}>44,100 Hz</option>
              <option value={48000}>48,000 Hz</option>
              <option value={96000}>96,000 Hz</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-[#9CA6B8] mb-1">
              {format === 'wav' || format === 'flac' ? 'Bit Depth' : 'Bitrate'}
            </label>
            {format === 'wav' || format === 'flac' ? (
              <select
                value={bitDepth}
                onChange={(e) => setBitDepth(Number(e.target.value) as 16 | 24 | 32)}
                className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-white"
              >
                <option value={16}>16-bit</option>
                <option value={24}>24-bit</option>
                {format === 'wav' && <option value={32}>32-bit Float</option>}
              </select>
            ) : (
              <select
                value={bitrateKbps}
                onChange={(e) => setBitrateKbps(Number(e.target.value))}
                className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-white"
              >
                <option value={128}>128 kbps</option>
                <option value={192}>192 kbps</option>
                <option value={256}>256 kbps</option>
                <option value={320}>320 kbps</option>
              </select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[11px] text-[#9CA6B8] mb-1">Channels</label>
            <select
              value={channels}
              onChange={(e) => setChannels(Number(e.target.value) as 1 | 2)}
              className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-white"
            >
              <option value={2}>Stereo (L/R)</option>
              <option value={1}>Mono Downmix</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] text-[#9CA6B8] mb-1">Loudness Standard</label>
            <select
              value={loudnessLufs ?? ''}
              onChange={(e) => setLoudnessLufs(e.target.value ? Number(e.target.value) : null)}
              className="h-8 w-full rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-white"
            >
              <option value="">Off (Keep Mix Balance)</option>
              <option value="-16">-16 LUFS (Podcast / Spoken)</option>
              <option value="-14">-14 LUFS (YouTube / Spotify)</option>
              <option value="-23">-23 LUFS (EBU R128 Broadcast)</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-[#252B38] bg-[#0B0D11] p-2.5 space-y-1">
            <div className="text-[11px] text-[#9CA6B8]">Export Scope</div>
            <div className="flex gap-3">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  checked={rangeMode === 'full'}
                  onChange={() => setRangeMode('full')}
                />
                Full Timeline
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  disabled={!timeSelection || timeSelection.endMs <= timeSelection.startMs}
                  checked={rangeMode === 'selection'}
                  onChange={() => setRangeMode('selection')}
                />
                Selection
              </label>
            </div>
          </div>

          <label className="flex items-center gap-2 rounded border border-[#252B38] bg-[#0B0D11] p-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={exportStems}
              onChange={(e) => setExportStems(e.target.checked)}
            />
            <span>Export Multi-Track Stems separately</span>
          </label>
        </div>

        {/* Output Destination */}
        <div>
          <label className="block text-[11px] text-[#9CA6B8] mb-1">Destination File</label>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={outputPath}
              onChange={(e) => setOutputPath(e.target.value)}
              className="h-8 flex-1 rounded border border-[#252B38] bg-[#0B0D11] px-2.5 font-mono-tabular text-[11px] text-[#E5E7EB]"
            />
            <DawButton size="sm" onClick={() => void handleBrowse()}>
              <FolderOpen className="h-3.5 w-3.5" />
              Browse
            </DawButton>
          </div>
        </div>

        {errorMsg && (
          <div className="flex items-start gap-2 rounded border border-[#EF4444]/40 bg-[#EF4444]/10 p-2.5 text-[11px] text-[#FCA5A5]">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {(exporting || progressPct > 0) && (
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] text-[#9CA6B8]">
              <span>{stageText}</span>
              <span className="font-mono-tabular">{progressPct.toFixed(0)}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-[#181C25]">
              <div
                style={{ width: `${progressPct}%` }}
                className="h-full bg-[#3B82F6] transition-all"
              />
            </div>
          </div>
        )}

        {exportedFiles && (
          <div className="rounded border border-[#10B981]/40 bg-[#10B981]/10 p-2.5 space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-[#34D399]">
              <CheckCircle2 className="h-4 w-4" />
              Export Completed ({exportedFiles.length} file(s))
            </div>
            {exportedFiles.map((f) => (
              <div key={f} className="font-mono-tabular text-[10px] text-[#D1D5DB] break-all">
                {f}
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-[#252B38]">
          <DawButton size="md" disabled={exporting} onClick={() => setShowExport(false)}>
            Close
          </DawButton>
          <DawButton
            size="md"
            variant="primary"
            disabled={exporting}
            onClick={() => void handleExport()}
          >
            <Download className="h-4 w-4" />
            {exporting ? 'Rendering...' : 'Export Audio'}
          </DawButton>
        </div>
      </div>
    </NativeModal>
  );
};
