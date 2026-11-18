import { useState } from 'react';
import { ArrowLeft, Check, Download } from 'lucide-react';
import { AppSettings, CutFlowProject, FinalOutputItem } from '../types/project';
import { EditorWorkspace } from '../components/EditorWorkspace';
import { ExportModal } from '../components/ExportModal';

interface VideoEditPageProps {
  project: CutFlowProject;
  settings: AppSettings;
  saveState: 'saved' | 'saving';
  onChangeProject: (updater: (prev: CutFlowProject) => CutFlowProject) => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onBackHome: () => void;
  onExportedToOutputs: (output: FinalOutputItem) => void;
}

export function VideoEditPage({
  project,
  settings,
  saveState,
  onChangeProject,
  onUpdateSettings,
  onBackHome,
  onExportedToOutputs,
}: VideoEditPageProps) {
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* Compact Editor Sub-bar */}
      <div className="h-11 shrink-0 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#101216] px-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBackHome}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7] cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Projects
          </button>
          <span className="text-slate-300 dark:text-white/15">/</span>
          <input
            type="text"
            aria-label="Project title"
            value={project.name}
            onChange={(e) => onChangeProject((prev) => ({ ...prev, name: e.target.value }))}
            className="bg-transparent text-sm font-medium text-slate-900 dark:text-[#F4F5F7] focus:outline-none focus:ring-1 focus:ring-teal-500 rounded px-1.5 py-0.5 min-w-[140px]"
          />
          <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-[#8E95A5] hidden sm:inline">
            {project.aspectRatio} · {project.fps} fps
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-[#8E95A5]">
            <Check className="w-3 h-3 text-teal-500" />
            {saveState === 'saving' ? 'Saving...' : 'Saved locally'}
          </span>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>

      <EditorWorkspace
        project={project}
        settings={settings}
        onChangeProject={onChangeProject}
        onUpdateSettings={onUpdateSettings}
      />

      <ExportModal
        open={exportOpen}
        project={project}
        onClose={() => setExportOpen(false)}
        onExportedToOutputs={onExportedToOutputs}
      />
    </div>
  );
}
