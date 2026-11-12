import React from 'react';
import { History, RotateCcw, RotateCw } from 'lucide-react';
import { DawButton } from '@/components/ui/Controls';
import { useProjectStore } from '@/stores/projectStore';

export const HistoryPanel: React.FC = () => {
  const undoStack = useProjectStore((s) => s.undoStack);
  const redoStack = useProjectStore((s) => s.redoStack);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const jumpToHistoryIndex = useProjectStore((s) => s.jumpToHistoryIndex);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <DawButton size="xs" className="flex-1" onClick={undo} disabled={undoStack.length === 0}>
          <RotateCcw className="h-3 w-3" />
          Undo ({undoStack.length})
        </DawButton>
        <DawButton size="xs" className="flex-1" onClick={redo} disabled={redoStack.length === 0}>
          <RotateCw className="h-3 w-3" />
          Redo ({redoStack.length})
        </DawButton>
      </div>

      {undoStack.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded border border-dashed border-[#252B38] p-4 text-center">
          <History className="mb-1.5 h-6 w-6 text-[#687387]" />
          <p className="text-xs text-[#9CA6B8]">No edits recorded yet</p>
        </div>
      ) : (
        <ul className="flex-1 space-y-1 overflow-y-auto pr-1">
          {undoStack.map((item, idx) => (
            <li key={item.entry.id}>
              <button
                type="button"
                onClick={() => jumpToHistoryIndex(idx)}
                className="flex w-full items-center justify-between rounded border border-[#252B38] bg-[#181C25] px-2 py-1.5 text-left text-xs hover:border-[#3B82F6] cursor-pointer"
              >
                <span className="truncate text-[#E5E7EB]">{item.entry.label}</span>
                <span className="ml-2 shrink-0 text-[10px] font-mono-tabular text-[#687387]">
                  #{idx + 1}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
