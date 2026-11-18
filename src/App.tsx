import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppRoute,
  AppSettings,
  CutFlowProject,
  FinalOutputItem,
  SetupConfig,
} from './types/project';
import { createEmptyProject } from './utils/timelineMath';
import {
  auditAndCleanSampleRecords,
  DEFAULT_SETTINGS,
  DEFAULT_SETUP_CONFIG,
  deleteOutputItem,
  deleteProject,
  listOutputs,
  listProjects,
  loadSettings,
  loadSetupConfig,
  saveOutputItem,
  saveProject,
  saveSettings,
  saveSetupConfig,
} from './services/storage';
import { BrowserCapabilities, detectBrowserCapabilities } from './services/capabilities';
import { ensureAllLocalFontsLoaded } from './services/fonts';
import { applySetupToAppSettings } from './services/setupManager';
import { mediaUrlRegistry } from './services/mediaEngine';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SetupWizard } from './components/SetupWizard';
import { TopNav } from './components/TopNav';
import { HomePage } from './pages/HomePage';
import { VideoEditPage } from './pages/VideoEditPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { FinalOutputsPage } from './pages/FinalOutputsPage';
import { OutputEditorPage } from './pages/OutputEditorPage';
import { SettingsPage } from './pages/SettingsPage';

const ACTIVE_ROUTE_KEY = 'cutflow_active_route';
const ACTIVE_PROJECT_KEY = 'cutflow_active_project_id';
const ACTIVE_PREP_KEY = 'cutflow_active_prep_id';

export default function App() {
  const [ready, setReady] = useState(false);
  const [route, setRoute] = useState<AppRoute>('home');
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [setupConfig, setSetupConfig] = useState<SetupConfig>(DEFAULT_SETUP_CONFIG);
  const [browserCaps, setBrowserCaps] = useState<BrowserCapabilities | null>(null);
  const [setupWizardMode, setSetupWizardMode] = useState<'first-launch' | 'rerun' | null>(null);
  const [ambiguousProjects, setAmbiguousProjects] = useState<CutFlowProject[]>([]);

  const [projects, setProjects] = useState<CutFlowProject[]>([]);
  const [outputs, setOutputs] = useState<FinalOutputItem[]>([]);
  const [activeEditProject, setActiveEditProject] = useState<CutFlowProject | null>(null);
  const [activePrepProject, setActivePrepProject] = useState<CutFlowProject | null>(null);
  const [editingOutput, setEditingOutput] = useState<FinalOutputItem | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [storageError, setStorageError] = useState<string>('');
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', settings.theme === 'dark');
  }, [settings.theme]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Conservative startup audit + font hydration before reading project lists
        const [auditReport, loadedSetup, caps, loadedSettings] = await Promise.all([
          auditAndCleanSampleRecords(),
          loadSetupConfig(),
          detectBrowserCapabilities(),
          loadSettings(),
        ]);
        await ensureAllLocalFontsLoaded().catch(() => {});

        const [loadedProjects, loadedOutputs] = await Promise.all([
          listProjects(),
          listOutputs(),
        ]);

        if (!mounted) return;
        setSettings(loadedSettings);
        setSetupConfig(loadedSetup);
        setBrowserCaps(caps);
        setAmbiguousProjects(auditReport.ambiguousEmptyProjects);
        setProjects(loadedProjects);
        setOutputs(loadedOutputs);

        if (!loadedSetup.setupComplete) {
          setSetupWizardMode('first-launch');
        }

        const savedRoute = localStorage.getItem(ACTIVE_ROUTE_KEY) as AppRoute | null;
        const savedEditId = localStorage.getItem(ACTIVE_PROJECT_KEY);
        const savedPrepId = localStorage.getItem(ACTIVE_PREP_KEY);

        if (savedEditId) {
          const found = loadedProjects.find((p) => p.id === savedEditId);
          if (found) setActiveEditProject(found);
        }
        if (savedPrepId) {
          const foundPrep = loadedProjects.find((p) => p.id === savedPrepId);
          if (foundPrep) setActivePrepProject(foundPrep);
        }
        if (
          savedRoute &&
          ['home', 'video-edit', 'templates', 'outputs', 'settings'].includes(savedRoute)
        ) {
          setRoute(savedRoute);
        }
      } catch (err) {
        if (!mounted) return;
        setStorageError(
          err instanceof Error ? err.message : 'Local browser storage could not be initialized.'
        );
      } finally {
        if (mounted) setReady(true);
      }
    })();

    return () => {
      mounted = false;
      mediaUrlRegistry.revokeAll();
    };
  }, []);

  const navigate = useCallback((nextRoute: AppRoute) => {
    setRoute(nextRoute);
    if (nextRoute !== 'output-edit') {
      try {
        localStorage.setItem(ACTIVE_ROUTE_KEY, nextRoute);
      } catch {
        // ignore
      }
    }
  }, []);

  const persistProjectDebounced = useCallback(
    (proj: CutFlowProject) => {
      setProjects((prev) => {
        const exists = prev.some((p) => p.id === proj.id);
        const updated = exists
          ? prev.map((p) => (p.id === proj.id ? proj : p))
          : [proj, ...prev];
        return updated.sort((a, b) => b.updatedAt - a.updatedAt);
      });

      if (!settings.autoSaveEnabled) return;
      setSaveState('saving');
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(async () => {
        try {
          await saveProject(proj);
          setSaveState('saved');
        } catch (err) {
          setStorageError(
            err instanceof Error ? err.message : 'Failed to save project to IndexedDB.'
          );
        }
      }, 350);
    },
    [settings.autoSaveEnabled]
  );

  const handleCreateNewEdit = async () => {
    const count = projects.filter((p) => p.type === 'edit').length + 1;
    const newProj = createEmptyProject({
      name: `Video Edit ${count}`,
      type: 'edit',
      aspectRatio: '16:9',
      resolution: settings.defaultResolution,
      fps: settings.defaultFps,
    });
    await saveProject(newProj);
    setProjects((prev) => [newProj, ...prev]);
    setActiveEditProject(newProj);
    try {
      localStorage.setItem(ACTIVE_PROJECT_KEY, newProj.id);
    } catch {
      // ignore
    }
    navigate('video-edit');
  };

  const handleCreateTemplatePrep = async () => {
    const count = projects.filter((p) => p.type === 'template-prep').length + 1;
    const prep = createEmptyProject({
      name: `Template Reel ${count}`,
      type: 'template-prep',
      aspectRatio: settings.defaultAspectRatio ?? '9:16',
      resolution: settings.defaultResolution,
      fps: settings.defaultFps,
    });
    await saveProject(prep);
    setProjects((prev) => [prep, ...prev]);
    setActivePrepProject(prep);
    try {
      localStorage.setItem(ACTIVE_PREP_KEY, prep.id);
    } catch {
      // ignore
    }
    navigate('templates');
  };

  const handleOpenProject = (proj: CutFlowProject) => {
    if (proj.type === 'template-prep') {
      setActivePrepProject(proj);
      try {
        localStorage.setItem(ACTIVE_PREP_KEY, proj.id);
      } catch {
        // ignore
      }
      navigate('templates');
    } else {
      setActiveEditProject(proj);
      try {
        localStorage.setItem(ACTIVE_PROJECT_KEY, proj.id);
      } catch {
        // ignore
      }
      navigate('video-edit');
    }
  };

  const handleDeleteProject = async (id: string) => {
    await deleteProject(id);
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setAmbiguousProjects((prev) => prev.filter((p) => p.id !== id));
    if (activeEditProject?.id === id) setActiveEditProject(null);
    if (activePrepProject?.id === id) setActivePrepProject(null);
  };

  const refreshOutputs = async () => {
    const latest = await listOutputs();
    setOutputs(latest);
  };

  const handleUpdateOutputApproval = async (
    id: string,
    approvalStatus: 'pending' | 'approved' | 'rejected'
  ) => {
    const item = outputs.find((o) => o.id === id);
    if (!item) return;
    const updated: FinalOutputItem = { ...item, approvalStatus, updatedAt: Date.now() };
    await saveOutputItem(updated);
    setOutputs((prev) => prev.map((o) => (o.id === id ? updated : o)));
  };

  const handleRenameOutput = async (id: string, name: string) => {
    const item = outputs.find((o) => o.id === id);
    if (!item) return;
    const updated: FinalOutputItem = { ...item, name, updatedAt: Date.now() };
    await saveOutputItem(updated);
    setOutputs((prev) => prev.map((o) => (o.id === id ? updated : o)));
  };

  const handleDeleteOutputPermanent = async (id: string) => {
    await deleteOutputItem(id);
    setOutputs((prev) => prev.filter((o) => o.id !== id));
  };

  const handleUpdateSettings = async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next).catch(() => undefined);
  };

  const handleSetupComplete = async (finalSetup: SetupConfig) => {
    setSetupConfig(finalSetup);
    await saveSetupConfig(finalSetup).catch(() => undefined);
    const updatedSettings = applySetupToAppSettings(settings, finalSetup);
    setSettings(updatedSettings);
    await saveSettings(updatedSettings).catch(() => undefined);
    setSetupWizardMode(null);

    if (finalSetup.preferredWorkflow === 'video-edit' && route === 'home') {
      handleCreateNewEdit();
    } else if (finalSetup.preferredWorkflow === 'templates' && route === 'home') {
      handleCreateTemplatePrep();
    }
  };

  // Ensure active edit/prep project exists if user clicks directly on nav tab
  useEffect(() => {
    if (!ready || setupWizardMode) return;
    if (route === 'video-edit' && !activeEditProject) {
      const existing = projects.find((p) => p.type === 'edit');
      if (existing) {
        setActiveEditProject(existing);
      } else {
        handleCreateNewEdit();
      }
    } else if (route === 'templates' && !activePrepProject) {
      const existing = projects.find((p) => p.type === 'template-prep');
      if (existing) {
        setActivePrepProject(existing);
      } else {
        handleCreateTemplatePrep();
      }
    }
  }, [ready, route, activeEditProject, activePrepProject, setupWizardMode]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#0B0C0E] text-[#F4F5F7] flex items-center justify-center text-sm">
        Loading CutFlow workspace...
      </div>
    );
  }

  return (
    <ErrorBoundary onReset={() => navigate('home')}>
      <div className="h-screen flex flex-col overflow-hidden bg-[#F6F7F9] dark:bg-[#0B0C0E] text-slate-900 dark:text-[#F4F5F7]">
        {setupWizardMode && browserCaps && (
          <SetupWizard
            existingConfig={setupConfig}
            capabilities={browserCaps}
            isRerun={setupWizardMode === 'rerun'}
            onCancelRerun={
              setupWizardMode === 'rerun' ? () => setSetupWizardMode(null) : undefined
            }
            onComplete={handleSetupComplete}
          />
        )}

        <TopNav
          activeRoute={route}
          onNavigate={navigate}
          primaryAction={
            route === 'home' || route === 'outputs' || route === 'settings'
              ? { label: 'New Video Edit', onClick: handleCreateNewEdit }
              : undefined
          }
        />

        {storageError && (
          <div className="bg-red-500/15 border-b border-red-500/30 px-4 py-2 text-xs text-red-300 flex items-center justify-between">
            <span>{storageError}</span>
            <button
              type="button"
              onClick={() => setStorageError('')}
              className="underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {route === 'home' && (
          <HomePage
            projects={projects}
            outputs={outputs}
            ambiguousEmptyProjects={ambiguousProjects}
            onDismissAmbiguous={() => setAmbiguousProjects([])}
            onCreateNewEdit={handleCreateNewEdit}
            onCreateWithTemplates={handleCreateTemplatePrep}
            onOpenProject={handleOpenProject}
            onDeleteProject={handleDeleteProject}
            onOpenOutputs={() => navigate('outputs')}
            onPreviewOutput={() => navigate('outputs')}
          />
        )}

        {route === 'video-edit' && activeEditProject && (
          <VideoEditPage
            project={activeEditProject}
            settings={settings}
            saveState={saveState}
            onChangeProject={(updater) => {
              setActiveEditProject((prev) => {
                if (!prev) return prev;
                const next = { ...updater(prev), updatedAt: Date.now() };
                persistProjectDebounced(next);
                return next;
              });
            }}
            onUpdateSettings={handleUpdateSettings}
            onBackHome={() => navigate('home')}
            onExportedToOutputs={() => {
              refreshOutputs();
            }}
          />
        )}

        {route === 'templates' && activePrepProject && (
          <TemplatesPage
            prepProject={activePrepProject}
            settings={settings}
            onChangePrepProject={(updater) => {
              setActivePrepProject((prev) => {
                if (!prev) return prev;
                const next = { ...updater(prev), updatedAt: Date.now() };
                persistProjectDebounced(next);
                return next;
              });
            }}
            onUpdateSettings={handleUpdateSettings}
            onOutputsGenerated={() => {
              refreshOutputs();
            }}
            onGoToOutputs={() => navigate('outputs')}
          />
        )}

        {route === 'outputs' && (
          <FinalOutputsPage
            outputs={outputs}
            onApprove={(id) => handleUpdateOutputApproval(id, 'approved')}
            onReject={(id) => handleUpdateOutputApproval(id, 'rejected')}
            onRestore={(id) => handleUpdateOutputApproval(id, 'pending')}
            onDeletePermanent={handleDeleteOutputPermanent}
            onRename={handleRenameOutput}
            onOpenEditor={(out) => {
              setEditingOutput(out);
              navigate('output-edit');
            }}
          />
        )}

        {route === 'output-edit' && editingOutput && (
          <OutputEditorPage
            output={editingOutput}
            settings={settings}
            onUpdateSettings={handleUpdateSettings}
            onSaveOutputProject={async (outputId, updatedProject) => {
              const target = outputs.find((o) => o.id === outputId);
              if (!target) return;
              const updated: FinalOutputItem = {
                ...target,
                name: updatedProject.name,
                editableProjectSnapshot: updatedProject,
                updatedAt: Date.now(),
              };
              await saveOutputItem(updated);
              setOutputs((prev) => prev.map((o) => (o.id === outputId ? updated : o)));
              setEditingOutput(updated);
            }}
            onClose={() => {
              setEditingOutput(null);
              navigate('outputs');
            }}
            onExportedNewOutput={() => {
              refreshOutputs();
            }}
          />
        )}

        {route === 'settings' && (
          <SettingsPage
            settings={settings}
            setupConfig={setupConfig}
            onUpdateSettings={handleUpdateSettings}
            onRerunSetup={() => setSetupWizardMode('rerun')}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}
