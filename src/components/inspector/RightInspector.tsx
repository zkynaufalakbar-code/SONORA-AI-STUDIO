import React, { useState } from 'react';
import { Sliders, Scissors, BarChart3 } from 'lucide-react';
import { ClipInspector } from './ClipInspector';
import { TrackInspector } from './TrackInspector';
import { MetersPanel } from './MetersPanel';

type InspectorTab = 'track' | 'clip' | 'meters';

export const RightInspector: React.FC = () => {
  const [tab, setTab] = useState<InspectorTab>('track');

  return (
    <aside
      aria-label="Audio Inspector"
      className="flex h-full w-72 lg:w-80 shrink-0 flex-col border-l border-[#252B38] bg-[#12151C]"
    >
      <div className="grid grid-cols-3 border-b border-[#252B38] bg-[#0E1117] p-1 text-[11px]">
        <button
          type="button"
          onClick={() => setTab('track')}
          className={`flex items-center justify-center gap-1 rounded py-1.5 font-medium cursor-pointer transition-colors ${
            tab === 'track' ? 'bg-[#202737] text-[#3B82F6]' : 'text-[#9CA6B8] hover:text-white'
          }`}
        >
          <Sliders className="h-3.5 w-3.5" />
          Track FX
        </button>
        <button
          type="button"
          onClick={() => setTab('clip')}
          className={`flex items-center justify-center gap-1 rounded py-1.5 font-medium cursor-pointer transition-colors ${
            tab === 'clip' ? 'bg-[#202737] text-[#22D3EE]' : 'text-[#9CA6B8] hover:text-white'
          }`}
        >
          <Scissors className="h-3.5 w-3.5" />
          Clip
        </button>
        <button
          type="button"
          onClick={() => setTab('meters')}
          className={`flex items-center justify-center gap-1 rounded py-1.5 font-medium cursor-pointer transition-colors ${
            tab === 'meters' ? 'bg-[#202737] text-[#10B981]' : 'text-[#9CA6B8] hover:text-white'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Meters
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {tab === 'track' && <TrackInspector />}
        {tab === 'clip' && <ClipInspector />}
        {tab === 'meters' && <MetersPanel />}
      </div>
    </aside>
  );
};
