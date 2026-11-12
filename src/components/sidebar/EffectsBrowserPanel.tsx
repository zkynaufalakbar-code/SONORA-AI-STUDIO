import React, { useState } from 'react';
import { Plus, Sliders, Sparkles, Activity, Waves } from 'lucide-react';
import { EFFECTS_CATALOG } from '@/lib/effectsCatalog';
import { useProjectStore } from '@/stores/projectStore';
import type { EffectCategory } from '@/types/effects';

const CATEGORIES: Array<{ id: EffectCategory; label: string; icon: React.ReactNode }> = [
  { id: 'dynamics', label: 'Dynamics', icon: <Activity className="h-3.5 w-3.5 text-[#10B981]" /> },
  { id: 'equalizer', label: 'Equalizer', icon: <Sliders className="h-3.5 w-3.5 text-[#3B82F6]" /> },
  { id: 'modulation_spatial', label: 'Modulation & Spatial', icon: <Waves className="h-3.5 w-3.5 text-[#22D3EE]" /> },
  { id: 'restoration', label: 'Restoration', icon: <Sparkles className="h-3.5 w-3.5 text-[#8B5CF6]" /> },
];

export const EffectsBrowserPanel: React.FC = () => {
  const [targetKind, setTargetKind] = useState<'track' | 'clip'>('track');
  const selectedTrackId = useProjectStore((s) => s.selectedTrackId);
  const selectedClipIds = useProjectStore((s) => s.selectedClipIds);
  const addEffectToTarget = useProjectStore((s) => s.addEffectToTarget);

  const canAttach =
    targetKind === 'track' ? Boolean(selectedTrackId) : selectedClipIds.length > 0;

  const handleAdd = (type: (typeof EFFECTS_CATALOG)[number]['type']) => {
    if (targetKind === 'track' && selectedTrackId) {
      addEffectToTarget({ kind: 'track', id: selectedTrackId }, type);
    } else if (targetKind === 'clip' && selectedClipIds[0]) {
      addEffectToTarget({ kind: 'clip', id: selectedClipIds[0] }, type);
    }
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between rounded border border-[#252B38] bg-[#0B0D11] p-1 text-[11px]">
        <span className="px-1.5 text-[#9CA6B8]">Target:</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTargetKind('track')}
            className={`rounded px-2 py-0.5 cursor-pointer ${
              targetKind === 'track' ? 'bg-[#3B82F6] text-white' : 'text-[#9CA6B8]'
            }`}
          >
            Selected Track
          </button>
          <button
            type="button"
            onClick={() => setTargetKind('clip')}
            className={`rounded px-2 py-0.5 cursor-pointer ${
              targetKind === 'clip' ? 'bg-[#3B82F6] text-white' : 'text-[#9CA6B8]'
            }`}
          >
            Selected Clip
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto pr-1">
        {CATEGORIES.map((cat) => {
          const items = EFFECTS_CATALOG.filter((e) => e.category === cat.id);
          return (
            <div key={cat.id} className="space-y-1">
              <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-[#9CA6B8]">
                {cat.icon}
                <span>{cat.label}</span>
              </div>
              <div className="space-y-1">
                {items.map((fx) => (
                  <button
                    key={fx.type}
                    type="button"
                    disabled={!canAttach}
                    onClick={() => handleAdd(fx.type)}
                    title={fx.description}
                    className="flex w-full items-center justify-between rounded border border-[#252B38] bg-[#181C25] px-2.5 py-1.5 text-left text-xs text-[#E5E7EB] hover:border-[#3B82F6] hover:bg-[#202531] disabled:opacity-40 cursor-pointer"
                  >
                    <span className="truncate">{fx.name}</span>
                    <Plus className="h-3.5 w-3.5 shrink-0 text-[#687387]" />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
