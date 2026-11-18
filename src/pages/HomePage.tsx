import { AlertCircle, ArrowRight, Film, FolderOpen, Layers, Plus, Trash2 } from 'lucide-react';
import { CutFlowProject, FinalOutputItem } from '../types/project';
import { computeProjectDuration, formatBytes, formatDuration } from '../utils/timelineMath';

interface HomePageProps {
  projects: CutFlowProject[];
  outputs: FinalOutputItem[];
  ambiguousEmptyProjects?: CutFlowProject[];
  onDismissAmbiguous?: () => void;
  onCreateNewEdit: () => void;
  onCreateWithTemplates: () => void;
  onOpenProject: (project: CutFlowProject) => void;
  onDeleteProject: (projectId: string) => void;
  onOpenOutputs: () => void;
  onPreviewOutput: (output: FinalOutputItem) => void;
}

export function HomePage({
  projects,
  outputs,
  ambiguousEmptyProjects = [],
  onDismissAmbiguous,
  onCreateNewEdit,
  onCreateWithTemplates,
  onOpenProject,
  onDeleteProject,
  onOpenOutputs,
  onPreviewOutput,
}: HomePageProps) {
  const recentProjects = projects.slice(0, 6);
  const recentOutputs = outputs.slice(0, 6);

  return (
    <main className="flex-1 overflow-y-auto px-6 py-10 max-w-6xl w-full mx-auto space-y-12">
      {/* Studio Launch Header */}
      <section className="space-y-6">
        <div className="space-y-2 max-w-2xl">
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-[#F4F5F7] text-balance">
            Local-first video editing and template production
          </h1>
          <p className="text-sm text-slate-600 dark:text-[#8E95A5]">
            Edit timeline footage, prepare vertical templates, and export finished videos directly in your browser. Your media stays on your device.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={onCreateNewEdit}
            className="group text-left rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] hover:border-teal-500/60 p-6 transition-colors cursor-pointer flex items-center justify-between gap-4"
          >
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-[#F4F5F7]">
                <Plus className="w-4 h-4 text-teal-500" />
                New Video Edit
              </div>
              <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
                Multi-track timeline up to 20 minutes, 1080p, 30 or 60 FPS.
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-teal-500 transition-colors shrink-0" />
          </button>

          <button
            type="button"
            onClick={onCreateWithTemplates}
            className="group text-left rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] hover:border-teal-500/60 p-6 transition-colors cursor-pointer flex items-center justify-between gap-4"
          >
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-[#F4F5F7]">
                <Layers className="w-4 h-4 text-teal-500" />
                Create with Templates
              </div>
              <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
                Prepare a 9:16, 1:1, or 16:9 clip and generate one or batch outputs.
              </p>
            </div>
            <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-teal-500 transition-colors shrink-0" />
          </button>
        </div>
      </section>

      {ambiguousEmptyProjects.length > 0 && (
        <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-300">
                Found {ambiguousEmptyProjects.length} empty project draft(s) without clips or media
              </p>
              <p className="text-amber-200/80">
                Preserved safely in IndexedDB. You can inspect or remove unused empty drafts from Recent Projects below.
              </p>
            </div>
          </div>
          {onDismissAmbiguous && (
            <button
              type="button"
              onClick={onDismissAmbiguous}
              className="px-2.5 py-1 rounded border border-amber-500/30 text-amber-300 hover:bg-amber-500/15 cursor-pointer"
            >
              Dismiss
            </button>
          )}
        </section>
      )}

      {/* Recent Projects */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F5F7]">
            Recent Projects
          </h2>
          <span className="text-xs font-mono-tabular text-slate-500 dark:text-[#8E95A5]">
            {projects.length} saved locally
          </span>
        </div>

        {recentProjects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/10 p-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-[#F4F5F7]">
              Create your first project.
            </p>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
              Start a New Video Edit or prepare a source clip in Templates. Projects save locally to IndexedDB.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-white/8 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] overflow-hidden">
            {recentProjects.map((proj) => {
              const dur = computeProjectDuration(proj);
              return (
                <div
                  key={proj.id}
                  className="px-4 py-3 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onOpenProject(proj)}
                    className="flex items-center gap-3 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <div className="w-9 h-9 rounded-md bg-slate-100 dark:bg-[#191C22] flex items-center justify-center shrink-0">
                      <Film className="w-4 h-4 text-teal-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 dark:text-[#F4F5F7] truncate">
                        {proj.name}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-[#8E95A5] font-mono-tabular">
                        {proj.type === 'template-prep' ? 'Template Prep' : 'Video Edit'} · {proj.aspectRatio} ·{' '}
                        {formatDuration(dur)} · Updated {new Date(proj.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenProject(proj)}
                      aria-label={`Open ${proj.name}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/8 cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteProject(proj.id)}
                      aria-label={`Delete ${proj.name}`}
                      className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recently Exported Videos */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-[#F4F5F7]">
            Recently Exported Videos
          </h2>
          {outputs.length > 0 && (
            <button
              type="button"
              onClick={onOpenOutputs}
              className="text-xs font-medium text-teal-500 hover:text-teal-400 cursor-pointer"
            >
              View all ({outputs.length})
            </button>
          )}
        </div>

        {recentOutputs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/10 p-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-[#F4F5F7]">
              No exported videos yet
            </p>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
              Export from Video Edit or generate outputs from Templates to review them in Final Outputs.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {recentOutputs.map((out) => (
              <button
                key={out.id}
                type="button"
                onClick={() => onPreviewOutput(out)}
                className="group text-left rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] overflow-hidden hover:border-teal-500/60 transition-colors cursor-pointer"
              >
                <div className="aspect-[9/12] bg-[#0B0C0E] relative overflow-hidden">
                  {out.posterDataUrl ? (
                    <img
                      src={out.posterDataUrl}
                      alt={out.name}
                      className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Film className="w-6 h-6 text-[#8E95A5]" />
                    </div>
                  )}
                </div>
                <div className="p-2.5 space-y-0.5">
                  <p className="text-xs font-medium text-slate-900 dark:text-[#F4F5F7] truncate">
                    {out.name}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-[#8E95A5] font-mono-tabular truncate">
                    {formatDuration(out.durationSec)} · {formatBytes(out.sizeBytes)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
