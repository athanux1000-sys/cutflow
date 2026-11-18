import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileArchive,
  FolderOutput,
  Heart,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import {
  AppSettings,
  AspectRatio,
  CutFlowProject,
  FinalOutputItem,
  RenderJob,
  SourceAnalysisBundle,
  TemplateDefinition,
} from '../types/project';
import {
  computeProjectDuration,
  createId,
  formatDuration,
  getDimensionsForAspectRatio,
} from '../utils/timelineMath';
import {
  applyTemplateToProject,
  duplicateTemplate,
  exportTemplateAsJson,
  getAllTemplates,
  removeCustomTemplate,
  setTemplateFavoriteLocal,
} from '../services/templates';
import {
  commitParsedTemplateImport,
  exportTemplateAsCFTemplateZip,
  ParsedTemplateImportPreview,
  parseTemplateFileForPreview,
} from '../services/templatePackage';
import {
  CUTFLOW_TEMPLATE_JSON_SCHEMA,
  GEMINI_EXAMPLE_TEMPLATE_MANIFEST,
  GEMINI_TEMPLATE_PROMPT,
  manifestToTemplateDefinition,
  templateDefinitionToManifest,
} from '../services/templateSchema';
import { executeRenderJobQueue } from '../services/renderer';
import {
  findAnalysisByMediaId,
  listUserFontRecords,
  saveCustomTemplate,
} from '../services/storage';
import { analyzeVideoSceneComposition } from '../services/ai/visionService';
import {
  ClonedTemplateResult,
  cloneTemplateFromReferenceVideo,
} from '../services/ai/templateCloner';
import { EditorWorkspace } from '../components/EditorWorkspace';
import { TemplatePreviewRenderer } from '../components/TemplatePreviewRenderer';
import { TemplateCreatorModal } from '../components/TemplateCreatorModal';

interface TemplatesPageProps {
  prepProject: CutFlowProject;
  settings: AppSettings;
  onChangePrepProject: (updater: (prev: CutFlowProject) => CutFlowProject) => void;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onOutputsGenerated: (outputs: FinalOutputItem[]) => void;
  onGoToOutputs: () => void;
}

export function TemplatesPage({
  prepProject,
  settings,
  onChangePrepProject,
  onUpdateSettings,
  onOutputsGenerated,
  onGoToOutputs,
}: TemplatesPageProps) {
  const [step, setStep] = useState<'prep' | 'select'>('prep');
  const [templates, setTemplates] = useState<TemplateDefinition[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'single' | 'multi'>('single');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateDefinition | null>(null);
  const [importError, setImportError] = useState('');
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [exportRes, setExportRes] = useState<'1080p' | '720p'>(
    settings.performanceMode === 'low-memory' ? '720p' : prepProject.exportSettings.resolution
  );
  const [analysisBusy, setAnalysisBusy] = useState('');
  const [cachedAnalysis, setCachedAnalysis] = useState<SourceAnalysisBundle | null>(null);

  // Clone Style from Video modal state
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [cloneBusy, setCloneBusy] = useState('');
  const [cloneError, setCloneError] = useState('');
  const [clonedResult, setClonedResult] = useState<ClonedTemplateResult | null>(null);
  const [clonedNameDraft, setClonedNameDraft] = useState('');

  // Template Creator & Edit modal
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [creatorInitial, setCreatorInitial] = useState<TemplateDefinition | null>(null);

  // Create Template with Gemini modal
  const [geminiModalOpen, setGeminiModalOpen] = useState(false);
  const [geminiCopied, setGeminiCopied] = useState(false);
  const [showGeminiExample, setShowGeminiExample] = useState(false);

  // Import Preview & Ajv Validation modal
  const [importPreview, setImportPreview] = useState<ParsedTemplateImportPreview | null>(null);

  const importInputRef = useRef<HTMLInputElement | null>(null);
  const cloneInputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const primaryVideo = prepProject.media.find((m) => m.type === 'video') ?? null;

  const loadTemplates = async () => {
    const list = await getAllTemplates();
    setTemplates(list);
    setSelectedIds((prev) => (prev.length === 0 && list.length > 0 ? [list[0].id] : prev));
  };

  useEffect(() => {
    loadTemplates();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!primaryVideo) {
      setCachedAnalysis(null);
      return;
    }
    findAnalysisByMediaId(primaryVideo.id)
      .then((bundle) => setCachedAnalysis(bundle))
      .catch(() => setCachedAnalysis(null));
  }, [primaryVideo?.id]);

  const categories = useMemo(() => {
    const cats = new Set<string>(['All']);
    templates.forEach((t) => cats.add(t.category));
    return [...cats];
  }, [templates]);

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return templates.filter((t) => {
      if (favoritesOnly && !t.isFavorite) return false;
      if (categoryFilter !== 'All' && t.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [templates, searchQuery, categoryFilter, favoritesOnly]);

  const toggleTemplateSelection = (id: string) => {
    if (selectionMode === 'single') {
      setSelectedIds([id]);
    } else {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    }
  };

  const handleToggleFavorite = (tpl: TemplateDefinition) => {
    const next = !tpl.isFavorite;
    setTemplateFavoriteLocal(tpl.id, next);
    setTemplates((prev) => prev.map((t) => (t.id === tpl.id ? { ...t, isFavorite: next } : t)));
  };

  const handleSelectImportFile = async (files: FileList | null) => {
    if (!files?.[0]) return;
    setImportError('');
    try {
      const customFonts = await listUserFontRecords().catch(() => []);
      const parsed = await parseTemplateFileForPreview(
        files[0],
        customFonts.map((f) => f.familyName)
      );
      setImportPreview(parsed);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to read template file.');
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const handleCommitImportPreview = async () => {
    if (!importPreview || !importPreview.valid) return;
    try {
      const saved = await commitParsedTemplateImport(importPreview);
      await loadTemplates();
      setSelectedIds((prev) =>
        selectionMode === 'single' ? [saved.id] : [...prev, saved.id]
      );
      setImportPreview(null);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to save imported template.');
    }
  };

  const handleAnalyzeSourceOnce = async () => {
    if (!primaryVideo) return;
    setImportError('');
    setAnalysisBusy('Analyzing source scenes & faces...');
    try {
      const sceneMap = await analyzeVideoSceneComposition({
        asset: primaryVideo,
        performanceMode: settings.performanceMode,
        includeOcr: false,
        onProgress: (_p, stage) => setAnalysisBusy(stage),
      });
      onChangePrepProject((prev) => ({ ...prev, sceneMap }));
      const bundle = await findAnalysisByMediaId(primaryVideo.id);
      setCachedAnalysis(bundle);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Source analysis failed.');
    } finally {
      setAnalysisBusy('');
    }
  };

  const handleCloneVideoFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setCloneError('');
    setClonedResult(null);
    setCloneBusy('Inspecting reference video style...');
    try {
      const result = await cloneTemplateFromReferenceVideo({
        file,
        onProgress: (_p, stage) => setCloneBusy(stage),
      });
      setClonedResult(result);
      setClonedNameDraft(result.template.name);
    } catch (err) {
      setCloneError(err instanceof Error ? err.message : 'Failed to analyze reference video.');
    } finally {
      setCloneBusy('');
      if (cloneInputRef.current) cloneInputRef.current.value = '';
    }
  };

  const handleSaveClonedTemplate = async () => {
    if (!clonedResult) return;
    const base: TemplateDefinition = {
      ...clonedResult.template,
      name: clonedNameDraft.trim() || clonedResult.template.name,
    };
    const manifest = templateDefinitionToManifest(base);
    manifest.metadata.source = 'video-cloned';
    const toSave: TemplateDefinition = { ...base, manifest };
    await saveCustomTemplate(toSave);
    await loadTemplates();
    setSelectedIds((prev) =>
      selectionMode === 'single' ? [toSave.id] : [...prev, toSave.id]
    );
    setCloneModalOpen(false);
    setClonedResult(null);
  };

  const handleStartGeneration = async () => {
    const chosen = templates.filter((t) => selectedIds.includes(t.id));
    if (chosen.length === 0) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setIsGenerating(true);

    // Load cached SourceAnalysisBundle once so all selected templates reuse it cleanly
    const analysisBundle = primaryVideo
      ? await findAnalysisByMediaId(primaryVideo.id).catch(() => null)
      : null;

    const queue = chosen.map((tpl) => {
      const appliedProject = applyTemplateToProject(prepProject, tpl, exportRes, {
        aspectRatioOverride: tpl.manifest?.aspectRatios.includes(prepProject.aspectRatio)
          ? prepProject.aspectRatio
          : tpl.aspectRatio,
        analysisBundle,
        enableSoundDesign: settings.autoSoundDesign,
      });
      const job: RenderJob = {
        id: createId('job'),
        projectId: appliedProject.id,
        sourceProjectId: prepProject.id,
        templateId: tpl.id,
        templateName: tpl.name,
        outputName: `${prepProject.name} · ${tpl.name}`,
        status: 'queued',
        progress: 0,
        stage: analysisBundle ? 'Reusing cached source analysis' : 'Queued',
        createdAt: Date.now(),
      };
      return { job, project: appliedProject };
    });

    setJobs(queue.map((q) => q.job));

    await executeRenderJobQueue({
      jobs: queue,
      signal: controller.signal,
      onJobUpdate: (updated) => {
        setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
      },
    });

    setIsGenerating(false);
    onOutputsGenerated([]);
  };

  const handleDownloadSchemaFile = () => {
    const blob = new Blob([JSON.stringify(CUTFLOW_TEMPLATE_JSON_SCHEMA, null, 2)], {
      type: 'application/schema+json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cutflow.template-1.0.0.schema.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (step === 'prep') {
    const durationSec = computeProjectDuration(prepProject);
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="h-12 shrink-0 border-b border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#101216] px-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs font-semibold text-teal-500 whitespace-nowrap">
              Step 1 · Source Preparation
            </span>
            <span className="text-slate-300 dark:text-white/15">|</span>
            <input
              type="text"
              aria-label="Template source project name"
              value={prepProject.name}
              onChange={(e) =>
                onChangePrepProject((prev) => ({ ...prev, name: e.target.value }))
              }
              className="bg-transparent text-sm font-medium text-slate-900 dark:text-[#F4F5F7] focus:outline-none focus:ring-1 focus:ring-teal-500 rounded px-1.5 py-0.5 min-w-[140px]"
            />
            <div className="hidden sm:flex items-center gap-1 rounded-md border border-slate-200 dark:border-white/10 p-0.5 text-[11px]">
              {(['9:16', '1:1', '16:9'] as AspectRatio[]).map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => {
                    const dims = getDimensionsForAspectRatio(
                      ratio,
                      prepProject.exportSettings.resolution
                    );
                    onChangePrepProject((prev) => ({
                      ...prev,
                      aspectRatio: ratio,
                      width: dims.width,
                      height: dims.height,
                    }));
                  }}
                  className={`px-2 py-0.5 rounded font-mono-tabular cursor-pointer ${
                    prepProject.aspectRatio === ratio
                      ? 'bg-teal-600 text-white'
                      : 'text-slate-500 dark:text-[#8E95A5]'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
            <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-[#8E95A5] hidden md:inline">
              {formatDuration(durationSec)} / 05:00 max
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {primaryVideo && (
              <button
                type="button"
                disabled={Boolean(analysisBusy)}
                onClick={handleAnalyzeSourceOnce}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-white/12 text-xs font-medium text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer disabled:opacity-45"
              >
                <Eye className="w-3.5 h-3.5 text-sky-400" />
                {analysisBusy
                  ? analysisBusy
                  : cachedAnalysis?.sceneMap
                    ? 'Source Mapped'
                    : 'Analyze Source Once'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setStep('select')}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              Continue to Templates
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <EditorWorkspace
          project={prepProject}
          settings={settings}
          hideCaptionTools={true}
          onChangeProject={onChangePrepProject}
          onUpdateSettings={onUpdateSettings}
        />
      </div>
    );
  }

  return (
    <main className="flex-1 overflow-y-auto px-6 py-6 max-w-7xl w-full mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 dark:border-white/8 pb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStep('prep')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Source Prep
          </button>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-[#F4F5F7]">
              Template Library
            </h1>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5] font-mono-tabular">
              Source: {prepProject.name} · {prepProject.aspectRatio} ·{' '}
              {formatDuration(Math.max(1, computeProjectDuration(prepProject)))}
              {cachedAnalysis?.sceneMap ? ' · Cached Scene Map Active' : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-slate-200 dark:border-white/10 p-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setSelectionMode('single');
                if (selectedIds.length > 1) setSelectedIds([selectedIds[0]]);
              }}
              className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                selectionMode === 'single'
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-600 dark:text-[#8E95A5]'
              }`}
            >
              Single
            </button>
            <button
              type="button"
              onClick={() => setSelectionMode('multi')}
              className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                selectionMode === 'multi'
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-600 dark:text-[#8E95A5]'
              }`}
            >
              Batch
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setCreatorInitial(null);
              setCreatorOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-teal-500/40 bg-teal-500/10 hover:bg-teal-500/20 text-xs font-medium text-teal-400 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Create Template
          </button>

          <button
            type="button"
            onClick={() => {
              setGeminiCopied(false);
              setShowGeminiExample(false);
              setGeminiModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-sky-500/40 bg-sky-500/10 hover:bg-sky-500/20 text-xs font-medium text-sky-400 cursor-pointer"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Create with Gemini
          </button>

          <button
            type="button"
            onClick={() => {
              setCloneError('');
              setClonedResult(null);
              setCloneModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-xs font-medium text-indigo-400 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Clone Style
          </button>

          <input
            ref={importInputRef}
            type="file"
            accept=".cftemplate,.cutflow-template.json,.cftemplate.json,.json,.zip"
            className="hidden"
            onChange={(e) => handleSelectImportFile(e.target.files)}
          />
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Import
          </button>
        </div>
      </div>

      {importError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-400 flex items-center justify-between">
          <span>{importError}</span>
          <button type="button" onClick={() => setImportError('')} className="underline cursor-pointer">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              placeholder="Search templates, fonts, tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-md border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] text-xs text-slate-900 dark:text-[#F4F5F7] w-56"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategoryFilter(cat)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                  categoryFilter === cat
                    ? 'bg-slate-200 dark:bg-white/12 text-slate-900 dark:text-[#F4F5F7]'
                    : 'text-slate-500 dark:text-[#8E95A5] hover:text-slate-900 dark:hover:text-[#F4F5F7]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setFavoritesOnly((f) => !f)}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium cursor-pointer ${
            favoritesOnly
              ? 'border-teal-500 bg-teal-500/15 text-teal-400'
              : 'border-slate-200 dark:border-white/10 text-slate-600 dark:text-[#8E95A5]'
          }`}
        >
          <Heart className="w-3.5 h-3.5" />
          Favorites
        </button>
      </div>

      {jobs.length > 0 && (
        <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
              Render Jobs ({jobs.filter((j) => j.status === 'completed').length}/{jobs.length})
            </h2>
            {!isGenerating && jobs.some((j) => j.status === 'completed') && (
              <button
                type="button"
                onClick={onGoToOutputs}
                className="px-3 py-1 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
              >
                Open Final Outputs →
              </button>
            )}
          </div>
          <div className="divide-y divide-slate-200 dark:divide-white/8">
            {jobs.map((job) => (
              <div key={job.id} className="py-2.5 flex items-center justify-between gap-4 text-xs">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900 dark:text-[#F4F5F7] truncate">
                    {job.outputName}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-[#8E95A5]">
                    {job.error ? job.error : job.stage}
                  </p>
                </div>
                <div className="w-36 shrink-0 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        job.status === 'failed'
                          ? 'bg-red-500'
                          : job.status === 'completed'
                            ? 'bg-emerald-500'
                            : 'bg-teal-500'
                      }`}
                      style={{ width: `${Math.round(job.progress * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono-tabular w-9 text-right text-[11px] text-slate-600 dark:text-[#8E95A5]">
                    {Math.round(job.progress * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-500 dark:text-[#8E95A5]">Selected templates: </span>
            <span className="font-mono-tabular font-semibold text-slate-900 dark:text-[#F4F5F7]">
              {selectedIds.length}
            </span>
          </div>
          <span className="text-slate-300 dark:text-white/15">·</span>
          <div>
            <span className="text-slate-500 dark:text-[#8E95A5]">Expected outputs: </span>
            <span className="font-mono-tabular font-semibold text-teal-500">
              {selectedIds.length}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center rounded-md border border-slate-200 dark:border-white/10 p-0.5 text-[11px]">
            {(['720p', '1080p'] as const).map((res) => (
              <button
                key={res}
                type="button"
                disabled={isGenerating}
                onClick={() => setExportRes(res)}
                className={`px-2 py-1 rounded font-mono-tabular cursor-pointer ${
                  exportRes === res
                    ? 'bg-slate-200 dark:bg-white/12 text-slate-900 dark:text-[#F4F5F7] font-semibold'
                    : 'text-slate-500 dark:text-[#8E95A5]'
                }`}
              >
                {res}
              </button>
            ))}
          </div>
          {isGenerating ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="px-3.5 py-2 rounded-md border border-red-500/30 text-xs font-medium text-red-400 hover:bg-red-500/10 cursor-pointer"
            >
              Cancel Queue
            </button>
          ) : (
            <button
              type="button"
              disabled={selectedIds.length === 0}
              onClick={handleStartGeneration}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-teal-600 hover:bg-teal-500 disabled:opacity-45 text-white text-xs font-medium cursor-pointer"
            >
              <FolderOutput className="w-3.5 h-3.5" />
              {selectionMode === 'single'
                ? 'Generate Output'
                : `Generate ${selectedIds.length} Outputs`}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filteredTemplates.map((tpl) => {
          const isSelected = selectedIds.includes(tpl.id);
          return (
            <div
              key={tpl.id}
              className={`rounded-xl border overflow-hidden bg-white dark:bg-[#121418] transition-colors flex flex-col ${
                isSelected
                  ? 'border-teal-500 ring-1 ring-teal-500'
                  : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
              }`}
            >
              <div className="aspect-[9/12] bg-[#0B0C0E] relative overflow-hidden">
                <TemplatePreviewRenderer template={tpl} className="w-full h-full object-cover" />

                <button
                  type="button"
                  onClick={() => toggleTemplateSelection(tpl.id)}
                  aria-label={`Select template ${tpl.name}`}
                  className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent flex items-end justify-between p-3 text-left cursor-pointer"
                >
                  <span className="text-xs font-mono-tabular text-white/90">
                    {tpl.aspectRatio} · {tpl.config.typography?.preferredAnimation ?? 'spring'}
                  </span>
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center border ${
                      isSelected
                        ? 'bg-teal-500 border-teal-400 text-white'
                        : 'bg-black/40 border-white/40 text-transparent'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </span>
                </button>
              </div>

              <div className="p-3.5 flex-1 flex flex-col justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
                      {tpl.name}
                    </h3>
                    <button
                      type="button"
                      onClick={() => handleToggleFavorite(tpl)}
                      aria-label={`Favorite ${tpl.name}`}
                      className="text-slate-400 hover:text-rose-400 cursor-pointer"
                    >
                      <Heart
                        className={`w-4 h-4 ${tpl.isFavorite ? 'fill-rose-500 text-rose-500' : ''}`}
                      />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-[#8E95A5] line-clamp-2">
                    {tpl.description}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-[#8E95A5] pt-0.5 truncate">
                    {tpl.category} · {tpl.manifest?.typography.pairingName ?? tpl.config.typography?.heroFont}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-white/6 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setPreviewTemplate(tpl)}
                    className="text-teal-500 hover:text-teal-400 font-medium cursor-pointer"
                  >
                    Inspect Schema
                  </button>
                  <div className="flex items-center gap-1">
                    {!tpl.isBuiltIn && (
                      <button
                        type="button"
                        title="Edit custom template"
                        aria-label={`Edit ${tpl.name}`}
                        onClick={() => {
                          setCreatorInitial(tpl);
                          setCreatorOpen(true);
                        }}
                        className="p-1 text-slate-400 hover:text-teal-400 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      title="Export .cutflow-template.json"
                      aria-label={`Export ${tpl.name} JSON`}
                      onClick={() => exportTemplateAsJson(tpl)}
                      className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-[#F4F5F7] cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Export .cftemplate ZIP package"
                      aria-label={`Export ${tpl.name} package`}
                      onClick={async () => {
                        const fonts = await listUserFontRecords().catch(() => []);
                        await exportTemplateAsCFTemplateZip(tpl, fonts);
                      }}
                      className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-[#F4F5F7] cursor-pointer"
                    >
                      <FileArchive className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      title="Duplicate template"
                      aria-label={`Duplicate ${tpl.name}`}
                      onClick={async () => {
                        await duplicateTemplate(tpl);
                        await loadTemplates();
                      }}
                      className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-[#F4F5F7] cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    {!tpl.isBuiltIn && (
                      <button
                        type="button"
                        title="Delete custom template"
                        aria-label={`Delete ${tpl.name}`}
                        onClick={async () => {
                          await removeCustomTemplate(tpl.id);
                          setSelectedIds((prev) => prev.filter((x) => x !== tpl.id));
                          await loadTemplates();
                        }}
                        className="p-1 text-slate-400 hover:text-red-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Template Config / Schema Inspection Modal */}
      {previewTemplate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
                {previewTemplate.name} — cutflow.template 1.0.0
              </h3>
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                aria-label="Close template details"
                className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs text-slate-500 dark:text-[#8E95A5] space-y-1 font-mono-tabular">
              <p>ID: {previewTemplate.id} · Version {previewTemplate.version}</p>
              <p>
                Aspect Ratios: {previewTemplate.manifest?.aspectRatios.join(', ') ?? previewTemplate.aspectRatio}
              </p>
              <p>
                Fonts: {previewTemplate.manifest?.typography.pairingName ?? previewTemplate.config.typography?.heroFont}
              </p>
            </div>
            <pre className="rounded-lg bg-slate-100 dark:bg-[#0B0C0E] p-3 text-[11px] font-mono-tabular overflow-x-auto max-h-64 text-slate-700 dark:text-[#8E95A5]">
              {JSON.stringify(templateDefinitionToManifest(previewTemplate), null, 2)}
            </pre>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => exportTemplateAsJson(previewTemplate)}
                className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-xs text-slate-700 dark:text-[#F4F5F7] cursor-pointer"
              >
                Export .json
              </button>
              <button
                type="button"
                onClick={async () => {
                  const fonts = await listUserFontRecords().catch(() => []);
                  await exportTemplateAsCFTemplateZip(previewTemplate, fonts);
                }}
                className="px-3 py-1.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
              >
                Export .cftemplate ZIP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Preview & Validation Modal */}
      {importPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Template Import Preview"
        >
          <div className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
                  Template Import Preview
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-[#8E95A5] font-mono-tabular">
                  {importPreview.fileName} · Format: {importPreview.sourceFormat}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                aria-label="Close import preview"
                className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {!importPreview.valid ? (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3.5 space-y-2 text-xs text-red-300">
                <p className="font-semibold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  Schema Validation Failed ({importPreview.errors.length} error(s))
                </p>
                <ul className="list-disc pl-5 space-y-1 font-mono-tabular text-[11px] max-h-48 overflow-y-auto">
                  {importPreview.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : (
              importPreview.template && (
                <div className="grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-4 text-xs">
                  <div className="aspect-[9/12] rounded-lg overflow-hidden border border-slate-200 dark:border-white/10 bg-[#0B0C0E]">
                    <TemplatePreviewRenderer
                      template={importPreview.template}
                      manifest={importPreview.manifest}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="font-semibold text-sm text-slate-900 dark:text-[#F4F5F7] flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      {importPreview.template.name}
                    </p>
                    <p className="text-slate-500 dark:text-[#8E95A5]">
                      {importPreview.template.description}
                    </p>
                    <div className="rounded bg-slate-50 dark:bg-[#191C22] p-2.5 space-y-1 text-[11px] font-mono-tabular">
                      <p>Category: {importPreview.template.category}</p>
                      <p>
                        Aspect Ratios:{' '}
                        {importPreview.manifest?.aspectRatios.join(', ') ??
                          importPreview.template.aspectRatio}
                      </p>
                      <p>
                        Animation: {importPreview.template.config.typography?.preferredAnimation}
                      </p>
                      <p>
                        Fonts: {importPreview.template.manifest?.typography.pairingName}
                      </p>
                      {importPreview.extractedFontFiles.length > 0 && (
                        <p className="text-emerald-400">
                          Bundled Font Assets: {importPreview.extractedFontFiles.map((f) => f.name).join(', ')}
                        </p>
                      )}
                    </div>

                    {importPreview.fontWarnings.length > 0 && (
                      <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-300 space-y-1">
                        {importPreview.fontWarnings.map((w, idx) => (
                          <p key={idx}>{w}</p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-white/10">
              <button
                type="button"
                onClick={() => setImportPreview(null)}
                className="px-3.5 py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-[#8E95A5] cursor-pointer"
              >
                Cancel
              </button>
              {importPreview.valid && (
                <button
                  type="button"
                  onClick={handleCommitImportPreview}
                  className="px-4 py-1.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
                >
                  Save to Template Library
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create Template with Gemini Modal */}
      {geminiModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Create Template with Gemini"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
                  Create Template with Gemini (External Workflow)
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
                  Copy CUTflow’s prompt + schema, attach a reference video inside Gemini externally, then import the resulting JSON here.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGeminiModalOpen(false)}
                aria-label="Close Gemini template helper"
                className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-lg border border-sky-500/25 bg-sky-500/8 p-3 text-xs text-slate-600 dark:text-[#CBD5E1] space-y-1.5">
              <p className="font-medium text-sky-400">How this workflow works (100% transparent):</p>
              <ol className="list-decimal pl-4 space-y-1 text-[11px]">
                <li>Copy the prompt below and optionally download the schema JSON.</li>
                <li>Open Gemini outside CUTflow, upload or link your reference video, and paste the prompt.</li>
                <li>Save Gemini’s JSON response and import it here — CUTflow validates every field with AJV and renders it as an editable rule-based template.</li>
              </ol>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(GEMINI_TEMPLATE_PROMPT);
                  setGeminiCopied(true);
                  setTimeout(() => setGeminiCopied(false), 2500);
                }}
                className="px-3 py-2 rounded-md bg-teal-600 hover:bg-teal-500 text-white font-medium cursor-pointer"
              >
                {geminiCopied ? 'Copied Prompt!' : 'Copy Gemini Prompt'}
              </button>
              <button
                type="button"
                onClick={handleDownloadSchemaFile}
                className="px-3 py-2 rounded-md border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 font-medium cursor-pointer"
              >
                Download Schema
              </button>
              <button
                type="button"
                onClick={() => {
                  setGeminiModalOpen(false);
                  importInputRef.current?.click();
                }}
                className="px-3 py-2 rounded-md border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 font-medium cursor-pointer"
              >
                Open Import
              </button>
              <button
                type="button"
                onClick={() => setShowGeminiExample((v) => !v)}
                className="px-3 py-2 rounded-md border border-slate-200 dark:border-white/10 text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 font-medium cursor-pointer"
              >
                {showGeminiExample ? 'Hide Example' : 'View Example Template'}
              </button>
            </div>

            {showGeminiExample && (
              <div className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#0E1014] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-900 dark:text-[#F4F5F7]">
                    Example: {GEMINI_EXAMPLE_TEMPLATE_MANIFEST.name}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const tpl = manifestToTemplateDefinition(GEMINI_EXAMPLE_TEMPLATE_MANIFEST, {
                        id: createId('tpl'),
                        isBuiltIn: false,
                        createdAt: Date.now(),
                      });
                      await saveCustomTemplate(tpl);
                      await loadTemplates();
                      setSelectedIds([tpl.id]);
                      setGeminiModalOpen(false);
                    }}
                    className="px-2.5 py-1 rounded bg-teal-600 text-white text-[11px] font-medium cursor-pointer"
                  >
                    Import Example to Library
                  </button>
                </div>
                <pre className="text-[10px] font-mono-tabular text-slate-600 dark:text-[#8E95A5] max-h-44 overflow-auto">
                  {JSON.stringify(GEMINI_EXAMPLE_TEMPLATE_MANIFEST, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Template Creator / Editor Modal */}
      {creatorOpen && (
        <TemplateCreatorModal
          initialTemplate={creatorInitial}
          onClose={() => {
            setCreatorOpen(false);
            setCreatorInitial(null);
          }}
          onSave={async (tpl) => {
            await saveCustomTemplate(tpl);
            await loadTemplates();
            setSelectedIds((prev) =>
              selectionMode === 'single' ? [tpl.id] : [...prev, tpl.id]
            );
          }}
        />
      )}

      {/* Clone Style from Video Modal */}
      {cloneModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Clone Style from Reference Video"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
                  Clone Style from Reference Video
                </h3>
                <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
                  Locally measures aspect ratio, framing insets, color balance, and cut pacing to create an editable rule approximation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCloneModalOpen(false)}
                aria-label="Close clone dialog"
                className="p-1 rounded text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              ref={cloneInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => handleCloneVideoFile(e.target.files)}
            />

            <button
              type="button"
              disabled={Boolean(cloneBusy)}
              onClick={() => cloneInputRef.current?.click()}
              className="w-full py-3 rounded-lg border border-dashed border-slate-300 dark:border-white/15 bg-slate-50 dark:bg-[#191C22] hover:border-indigo-400 flex items-center justify-center gap-2 text-xs font-medium text-slate-700 dark:text-[#F4F5F7] cursor-pointer"
            >
              <Video className="w-4 h-4 text-indigo-400" />
              {cloneBusy ? cloneBusy : 'Select Local Reference Video (.mp4 / .webm)'}
            </button>

            {cloneError && (
              <div className="rounded border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
                {cloneError}
              </div>
            )}

            {clonedResult && (
              <div className="space-y-3 border-t border-slate-200 dark:border-white/8 pt-3">
                <label className="block space-y-1 text-xs">
                  <span className="text-slate-500 dark:text-[#8E95A5]">New Template Name</span>
                  <input
                    type="text"
                    value={clonedNameDraft}
                    onChange={(e) => setClonedNameDraft(e.target.value)}
                    className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5 text-sm text-slate-900 dark:text-[#F4F5F7]"
                  />
                </label>

                <div className="space-y-1.5 text-xs">
                  {clonedResult.measurements.map((m) => (
                    <div
                      key={m.property}
                      className="flex items-center justify-between gap-2 rounded bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-slate-800 dark:text-[#F4F5F7]">{m.property}</p>
                        <p className="text-[11px] text-slate-500 dark:text-[#8E95A5] truncate">
                          {m.value}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-mono-tabular ${
                          m.confidence === 'Measured'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-amber-500/15 text-amber-400'
                        }`}
                      >
                        {m.confidence}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCloneModalOpen(false)}
                    className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-[#8E95A5] cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveClonedTemplate}
                    className="px-4 py-1.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
                  >
                    Save to Template Library
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
