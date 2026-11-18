import { useState } from 'react';
import { ArrowLeft, Download, Save } from 'lucide-react';
import { AppSettings, CutFlowProject, FinalOutputItem } from '../types/project';
import { cloneProject, projectsEqual } from '../utils/timelineMath';
import { EditorWorkspace } from '../components/EditorWorkspace';
import { ExportModal } from '../components/ExportModal';
import { UnsavedChangesDialog } from '../components/UnsavedChangesDialog';

interface OutputEditorPageProps {
  output: FinalOutputItem;
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onSaveOutputProject: (outputId: string, updatedProject: CutFlowProject) => Promise<void>;
  onClose: () => void;
  onExportedNewOutput: (newOutput: FinalOutputItem) => void;
}

export function OutputEditorPage({
  output,
  settings,
  onUpdateSettings,
  onSaveOutputProject,
  onClose,
  onExportedNewOutput,
}: OutputEditorPageProps) {
  const [baseline, setBaseline] = useState<CutFlowProject>(() =>
    cloneProject(output.editableProjectSnapshot)
  );
  const [draft, setDraft] = useState<CutFlowProject>(() =>
    cloneProject(output.editableProjectSnapshot)
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const isDirty = !projectsEqual(baseline, draft);

  const handleSave = async () => {
    await onSaveOutputProject(output.id, draft);
    setBaseline(cloneProject(draft));
  };

  const handleRequestClose = () => {
    if (isDirty) {
      setConfirmCloseOpen(true);
    } else {
      onClose();
    }
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="h-11 shrink-0 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#101216] px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={handleRequestClose}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7] cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Final Outputs
          </button>
          <span className="text-slate-300 dark:text-white/15">/</span>
          <span className="text-sm font-medium text-slate-900 dark:text-[#F4F5F7] truncate">
            {draft.name}
          </span>
          {isDirty && (
            <span className="text-[11px] font-medium text-amber-400 whitespace-nowrap">
              Unsaved changes
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={!isDirty}
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-white/12 text-xs font-medium text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 disabled:opacity-45 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            Save Project
          </button>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Render Updated Output
          </button>
        </div>
      </div>

      <EditorWorkspace
        project={draft}
        settings={settings}
        onChangeProject={(updater) => setDraft((prev) => updater(prev))}
        onUpdateSettings={onUpdateSettings}
      />

      <ExportModal
        open={exportOpen}
        project={draft}
        onClose={() => setExportOpen(false)}
        onExportedToOutputs={onExportedNewOutput}
      />

      <UnsavedChangesDialog
        open={confirmCloseOpen}
        onCancel={() => setConfirmCloseOpen(false)}
        onDiscard={() => {
          setConfirmCloseOpen(false);
          onClose();
        }}
        onSaveAndClose={async () => {
          await handleSave();
          setConfirmCloseOpen(false);
          onClose();
        }}
      />
    </div>
  );
}
