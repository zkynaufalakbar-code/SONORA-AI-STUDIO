import React, { useState } from 'react';
import { BookmarkPlus, Trash2, PlayCircle } from 'lucide-react';
import { DawButton } from '@/components/ui/Controls';
import { useRuntimeStore } from '@/stores/runtimeStore';
import { useProjectStore } from '@/stores/projectStore';
import { deletePreset, savePreset } from '@/lib/tauri';
import type { EffectInstance, EffectType } from '@/types/effects';

export const PresetsPanel: React.FC = () => {
  const [newName, setNewName] = useState('');
  const presets = useRuntimeStore((s) => s.presets);
  const refreshPresets = useRuntimeStore((s) => s.refreshPresets);

  const selectedTrackId = useProjectStore((s) => s.selectedTrackId);
  const tracks = useProjectStore((s) => s.tracks);
  const addEffectToTarget = useProjectStore((s) => s.addEffectToTarget);
  const updateTrack = useProjectStore((s) => s.updateTrack);

  const selectedTrack = tracks.find((t) => t.id === selectedTrackId);

  const applyPreset = (row: (typeof presets)[number]) => {
    if (!selectedTrackId) return;
    const parsed = JSON.parse(row.paramsJson);
    if (row.effectType === 'chain') {
      if (Array.isArray(parsed)) {
        updateTrack(selectedTrackId, { effects: parsed }, `Apply Chain "${row.name}"`);
      } else {
        // Podcast standard chain preset
        const podcastFx: EffectInstance[] = [
          {
            id: crypto.randomUUID(),
            type: 'high_pass' as EffectType,
            name: 'High Pass 80 Hz',
            category: 'equalizer' as const,
            bypassed: false,
            params: { freq: Number(parsed.hpf ?? 80), q: 0.707 },
          },
          {
            id: crypto.randomUUID(),
            type: 'compressor' as EffectType,
            name: 'Podcast Leveler',
            category: 'dynamics' as const,
            bypassed: false,
            params: { threshold: -20, ratio: Number(parsed.compRatio ?? 3.5), attack: 10, release: 160, makeup: 3, knee: 5 },
          },
          {
            id: crypto.randomUUID(),
            type: 'de_esser' as EffectType,
            name: 'De-Esser',
            category: 'restoration' as const,
            bypassed: false,
            params: { freq: 6500, threshold: -22, intensity: Number(parsed.deEss ?? 0.4) },
          },
        ];
        updateTrack(selectedTrackId, { effects: podcastFx }, `Apply Preset "${row.name}"`);
      }
      return;
    }

    addEffectToTarget({ kind: 'track', id: selectedTrackId }, row.effectType as EffectType);
    const updatedTrack = useProjectStore.getState().tracks.find((t) => t.id === selectedTrackId);
    const lastFx = updatedTrack?.effects[updatedTrack.effects.length - 1];
    if (lastFx) {
      useProjectStore
        .getState()
        .updateEffectParams({ kind: 'track', id: selectedTrackId }, lastFx.id, parsed);
    }
  };

  const handleSaveTrackChain = async () => {
    if (!selectedTrack || !newName.trim() || selectedTrack.effects.length === 0) return;
    await savePreset(
      crypto.randomUUID(),
      'chain',
      newName.trim(),
      'custom',
      JSON.stringify(selectedTrack.effects),
    );
    setNewName('');
    await refreshPresets();
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex gap-1">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Save track FX chain..."
          className="h-7 flex-1 rounded border border-[#252B38] bg-[#0B0D11] px-2 text-xs text-[#E5E7EB] placeholder-[#687387] focus:border-[#3B82F6] focus:outline-none"
        />
        <DawButton
          size="xs"
          onClick={() => void handleSaveTrackChain()}
          disabled={!selectedTrack || selectedTrack.effects.length === 0 || !newName.trim()}
          title="Save Current Track FX Chain"
        >
          <BookmarkPlus className="h-3.5 w-3.5" />
        </DawButton>
      </div>

      <ul className="flex-1 space-y-1.5 overflow-y-auto pr-1">
        {presets.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-2 rounded border border-[#252B38] bg-[#181C25] px-2.5 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-[#E5E7EB]">{p.name}</p>
              <p className="text-[10px] uppercase tracking-wider text-[#687387]">
                {p.category} · {p.isFactory ? 'Factory' : 'User'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <DawButton
                size="xs"
                onClick={() => applyPreset(p)}
                disabled={!selectedTrackId}
                title="Apply to Selected Track"
              >
                <PlayCircle className="h-3.5 w-3.5 text-[#3B82F6]" />
              </DawButton>
              {!p.isFactory && (
                <DawButton
                  size="xs"
                  variant="ghost"
                  onClick={async () => {
                    await deletePreset(p.id);
                    await refreshPresets();
                  }}
                  title="Delete Custom Preset"
                >
                  <Trash2 className="h-3.5 w-3.5 text-[#EF4444]" />
                </DawButton>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
