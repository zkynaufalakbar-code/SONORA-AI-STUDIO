import React, { useState } from 'react';
import { FileAudio, Plus, FolderPlus, Search } from 'lucide-react';
import { DawButton } from '@/components/ui/Controls';
import { useProjectStore } from '@/stores/projectStore';
import { useTransportStore } from '@/stores/transportStore';
import { formatTimecode } from '@/lib/timecode';
import { formatBytes } from '@/lib/utils';

interface MediaLibraryPanelProps {
  onImportClick: () => void;
}

export const MediaLibraryPanel: React.FC<MediaLibraryPanelProps> = ({ onImportClick }) => {
  const [query, setQuery] = useState('');
  const assets = useProjectStore((s) => s.assets);
  const addClipFromAsset = useProjectStore((s) => s.addClipFromAsset);
  const selectedTrackId = useProjectStore((s) => s.selectedTrackId);
  const playheadMs = useTransportStore((s) => s.playheadMs);

  const assetList = Object.values(assets).filter((a) =>
    a.name.toLowerCase().includes(query.trim().toLowerCase()),
  );

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1.5 h-3.5 w-3.5 text-[#687387]" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter media..."
            className="h-7 w-full rounded border border-[#252B38] bg-[#0B0D11] pl-7 pr-2 text-xs text-[#E5E7EB] placeholder-[#687387] focus:border-[#3B82F6] focus:outline-none"
          />
        </div>
        <DawButton size="xs" variant="primary" onClick={onImportClick} title="Import Audio File">
          <FolderPlus className="h-3.5 w-3.5" />
        </DawButton>
      </div>

      {assetList.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded border border-dashed border-[#252B38] bg-[#0B0D11]/40 p-4 text-center">
          <FileAudio className="mb-2 h-7 w-7 text-[#687387]" />
          <p className="text-xs font-medium text-[#D1D5DB]">No media imported</p>
          <p className="mt-1 text-[11px] text-[#687387]">
            Drop WAV, MP3, FLAC, OGG, M4A files anywhere on the timeline or click Import.
          </p>
          <DawButton size="xs" className="mt-3" onClick={onImportClick}>
            Import Audio
          </DawButton>
        </div>
      ) : (
        <ul className="flex-1 space-y-1.5 overflow-y-auto pr-1">
          {assetList.map((asset) => (
            <li
              key={asset.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-sonora-asset', asset.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              className="group rounded border border-[#252B38] bg-[#181C25] p-2 hover:border-[#3B82F6]/60 cursor-grab active:cursor-grabbing"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-[#E5E7EB]" title={asset.name}>
                    {asset.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-[#9CA6B8] font-mono-tabular">
                    <span>{formatTimecode(asset.durationMs, false)}</span>
                    <span>{(asset.sampleRate / 1000).toFixed(1)}kHz</span>
                    <span>{asset.channels === 1 ? 'Mono' : 'Stereo'}</span>
                    <span>{formatBytes(asset.fileSizeBytes)}</span>
                  </div>
                </div>
                <DawButton
                  size="xs"
                  onClick={() => addClipFromAsset(asset.id, selectedTrackId ?? undefined, playheadMs)}
                  title="Insert at Playhead"
                >
                  <Plus className="h-3 w-3" />
                </DawButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
