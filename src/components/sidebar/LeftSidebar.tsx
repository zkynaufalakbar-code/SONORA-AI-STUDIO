import React, { useState } from 'react';
import { FolderOpen, Sliders, Sparkles, Bookmark, History } from 'lucide-react';
import { MediaLibraryPanel } from './MediaLibraryPanel';
import { EffectsBrowserPanel } from './EffectsBrowserPanel';
import { AiToolsPanel } from './AiToolsPanel';
import { PresetsPanel } from './PresetsPanel';
import { HistoryPanel } from './HistoryPanel';

type SidebarTab = 'media' | 'effects' | 'ai' | 'presets' | 'history';

interface LeftSidebarProps {
  onImportAudio: () => void;
}

const TABS: Array<{ id: SidebarTab; label: string; icon: React.ReactNode }> = [
  { id: 'media', label: 'Media', icon: <FolderOpen className="h-4 w-4" /> },
  { id: 'effects', label: 'FX', icon: <Sliders className="h-4 w-4" /> },
  { id: 'ai', label: 'AI Tools', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'presets', label: 'Presets', icon: <Bookmark className="h-4 w-4" /> },
  { id: 'history', label: 'History', icon: <History className="h-4 w-4" /> },
];

export const LeftSidebar: React.FC<LeftSidebarProps> = ({ onImportAudio }) => {
  const [activeTab, setActiveTab] = useState<SidebarTab>('media');

  return (
    <aside
      aria-label="Studio Browser"
      className="flex h-full w-64 lg:w-72 shrink-0 border-r border-[#252B38] bg-[#12151C]"
    >
      {/* Icon Rail */}
      <nav
        aria-label="Sidebar Categories"
        className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-[#252B38] bg-[#0E1117] py-2"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            title={t.label}
            aria-label={t.label}
            className={`flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded text-[9px] font-medium cursor-pointer transition-colors ${
              activeTab === t.id
                ? 'bg-[#202737] text-[#3B82F6] border border-[#3B82F6]/40'
                : 'text-[#687387] hover:bg-[#181C25] hover:text-[#D1D5DB]'
            }`}
          >
            {t.icon}
            <span>{t.label.split(' ')[0]}</span>
          </button>
        ))}
      </nav>

      {/* Active Panel */}
      <div className="flex min-w-0 flex-1 flex-col p-2.5">
        <div className="mb-2 flex items-center justify-between border-b border-[#252B38] pb-1.5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9CA6B8]">
            {TABS.find((t) => t.id === activeTab)?.label}
          </h2>
        </div>
        <div className="min-h-0 flex-1">
          {activeTab === 'media' && <MediaLibraryPanel onImportClick={onImportAudio} />}
          {activeTab === 'effects' && <EffectsBrowserPanel />}
          {activeTab === 'ai' && <AiToolsPanel />}
          {activeTab === 'presets' && <PresetsPanel />}
          {activeTab === 'history' && <HistoryPanel />}
        </div>
      </div>
    </aside>
  );
};
