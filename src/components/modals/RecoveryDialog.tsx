import React from 'react';
import { History, Trash2 } from 'lucide-react';
import { DawButton, NativeModal } from '@/components/ui/Controls';
import { clearAutosaveSnapshot, type AutosaveSnapshotEntry } from '@/lib/tauri';
import { useProjectStore } from '@/stores/projectStore';
import type { ProjectManifest } from '@/types/project';

interface RecoveryDialogProps {
  autosave: AutosaveSnapshotEntry | null;
  onDismiss: () => void;
}

export const RecoveryDialog: React.FC<RecoveryDialogProps> = ({ autosave, onDismiss }) => {
  const loadManifest = useProjectStore((s) => s.loadManifest);

  if (!autosave) return null;

  const handleRecover = async () => {
    const manifest = JSON.parse(autosave.snapshotJson) as ProjectManifest;
    loadManifest(manifest);
    onDismiss();
  };

  const handleDiscard = async () => {
    await clearAutosaveSnapshot(autosave.projectId);
    onDismiss();
  };

  return (
    <NativeModal
      open={Boolean(autosave)}
      onClose={() => void handleDiscard()}
      title="Recover Unsaved Session"
      maxWidthClass="max-w-md"
    >
      <div className="space-y-3 text-xs">
        <div className="flex items-start gap-2.5 rounded border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-3 text-[#FDE68A]">
          <History className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            An automatic recovery snapshot was found for <strong>{autosave.name}</strong> (saved{' '}
            {new Date(autosave.savedAt).toLocaleString()}). Would you like to restore it?
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <DawButton size="sm" onClick={() => void handleDiscard()}>
            <Trash2 className="h-3.5 w-3.5" />
            Discard
          </DawButton>
          <DawButton size="sm" variant="primary" onClick={() => void handleRecover()}>
            Restore Project
          </DawButton>
        </div>
      </div>
    </NativeModal>
  );
};
