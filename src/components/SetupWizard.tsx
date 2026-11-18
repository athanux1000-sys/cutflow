import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  WifiOff,
  XCircle,
} from 'lucide-react';
import {
  AspectRatio,
  InstalledAssetEntry,
  PerformanceMode,
  RomanizationStyle,
  SetupConfig,
} from '../types/project';
import { BrowserCapabilities } from '../services/capabilities';
import { getModelDefinition, getRecommendedBundleForProfile } from '../services/ai/modelRegistry';
import {
  buildSetupInstallPlan,
  createInitialSetupDraft,
  runSingleSetupItem,
  saveSetupConfig,
  SetupInstallItemProgress,
  verifyOfflineReadiness,
} from '../services/setupManager';
import { formatBytes } from '../utils/timelineMath';
import { BrandMark } from './BrandMark';

interface SetupWizardProps {
  existingConfig: SetupConfig;
  capabilities: BrowserCapabilities;
  isRerun?: boolean;
  onCancelRerun?: () => void;
  onComplete: (finalConfig: SetupConfig) => void;
}

type WizardStep = 'welcome' | 'configure' | 'summary' | 'installing' | 'complete';

export function SetupWizard({
  existingConfig,
  capabilities,
  isRerun = false,
  onCancelRerun,
  onComplete,
}: SetupWizardProps) {
  const [step, setStep] = useState<WizardStep>(isRerun ? 'configure' : 'welcome');
  const [draft, setDraft] = useState<SetupConfig>(() =>
    createInitialSetupDraft(existingConfig, capabilities)
  );
  const [itemStates, setItemStates] = useState<Record<string, SetupInstallItemProgress>>({});
  const [installing, setInstalling] = useState(false);
  const [installDone, setInstallDone] = useState(false);
  const [offlineCheck, setOfflineCheck] = useState<{
    serviceWorkerActive: boolean;
    localWasmAccessible: boolean;
    fontsReady: boolean;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const plan = useMemo(() => buildSetupInstallPlan(draft, capabilities), [draft, capabilities]);
  const totalEstimatedMb = useMemo(
    () => plan.reduce((acc, item) => acc + item.sizeMb, 0),
    [plan]
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleProfileChange = (profile: PerformanceMode) => {
    const bundle = getRecommendedBundleForProfile(profile);
    setDraft((prev) => ({
      ...prev,
      performanceProfile: profile,
      selectedAsrModelId: bundle.asrModelId,
      selectedVisionModelIds: bundle.visionModelIds,
    }));
  };

  const toggleVisionModel = (id: string) => {
    setDraft((prev) => {
      const exists = prev.selectedVisionModelIds.includes(id);
      return {
        ...prev,
        selectedVisionModelIds: exists
          ? prev.selectedVisionModelIds.filter((x) => x !== id)
          : [...prev.selectedVisionModelIds, id],
      };
    });
  };

  const startInstallation = async () => {
    setStep('installing');
    setInstalling(true);
    setInstallDone(false);

    const initial: Record<string, SetupInstallItemProgress> = {};
    for (const item of plan) {
      initial[item.id] = {
        id: item.id,
        status: 'pending',
        progress: 0,
        detail: 'Waiting in queue',
      };
    }
    setItemStates(initial);

    const controller = new AbortController();
    abortRef.current = controller;
    const manifestEntries: InstalledAssetEntry[] = [];

    for (const item of plan) {
      if (controller.signal.aborted) {
        setItemStates((prev) => ({
          ...prev,
          [item.id]: { id: item.id, status: 'skipped', progress: 0, detail: 'Cancelled' },
        }));
        manifestEntries.push({
          id: item.id,
          name: item.name,
          kind: item.kind,
          status: 'skipped',
          sizeBytes: 0,
        });
        continue;
      }

      try {
        const entry = await runSingleSetupItem({
          item,
          signal: controller.signal,
          onUpdate: (patch) => {
            setItemStates((prev) => ({
              ...prev,
              [item.id]: { ...prev[item.id], ...patch },
            }));
          },
        });
        manifestEntries.push(entry);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Download or verification failed.';
        setItemStates((prev) => ({
          ...prev,
          [item.id]: {
            ...prev[item.id],
            status: 'failed',
            progress: 0,
            detail: msg,
            error: msg,
          },
        }));
        manifestEntries.push({
          id: item.id,
          name: item.name,
          kind: item.kind,
          status: 'failed',
          sizeBytes: 0,
          error: msg,
        });
      }
    }

    const readiness = await verifyOfflineReadiness();
    setOfflineCheck(readiness);

    const asrEntry = manifestEntries.find((m) => m.kind === 'asr');
    const updatedConfig: SetupConfig = {
      ...draft,
      installedManifest: manifestEntries,
      offlineReady: readiness.localWasmAccessible && readiness.fontsReady,
      verifiedProviderReport: {
        asrProvider: asrEntry?.provider ?? 'Not installed',
        asrVerified: asrEntry?.status === 'ready',
        visionProvider: capabilities.webGL2
          ? 'MediaPipe Local WASM + WebGL2'
          : 'MediaPipe Local WASM CPU',
        offlineReady: readiness.localWasmAccessible && readiness.fontsReady,
        checkedAt: Date.now(),
      },
    };
    setDraft(updatedConfig);
    setInstalling(false);
    setInstallDone(true);
  };

  const retrySingleItem = async (itemId: string) => {
    const item = plan.find((p) => p.id === itemId);
    if (!item || installing) return;
    setInstalling(true);
    try {
      const entry = await runSingleSetupItem({
        item,
        onUpdate: (patch) => {
          setItemStates((prev) => ({
            ...prev,
            [item.id]: { ...prev[item.id], ...patch },
          }));
        },
      });
      setDraft((prev) => ({
        ...prev,
        installedManifest: [
          ...prev.installedManifest.filter((m) => m.id !== item.id),
          entry,
        ],
      }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Retry failed.';
      setItemStates((prev) => ({
        ...prev,
        [item.id]: { ...prev[item.id], status: 'failed', detail: msg, error: msg },
      }));
    } finally {
      setInstalling(false);
    }
  };

  const handleFinishSetup = async (skipAiDownloads = false) => {
    const readiness = offlineCheck ?? (await verifyOfflineReadiness());
    const finalConfig: SetupConfig = {
      ...draft,
      setupComplete: true,
      completedAt: Date.now(),
      offlineReady: readiness.localWasmAccessible && readiness.fontsReady,
      installedManifest: skipAiDownloads
        ? [
            {
              id: 'local-editorial-fonts',
              name: 'Bundled Offline Editorial Font Pack',
              kind: 'fonts',
              status: readiness.fontsReady ? 'ready' : 'skipped',
              sizeBytes: 2 * 1024 * 1024,
              verifiedAt: Date.now(),
            },
            {
              id: 'builtin-templates-v1',
              name: '8 Curated Composition Templates',
              kind: 'templates',
              status: 'ready',
              sizeBytes: 100 * 1024,
              verifiedAt: Date.now(),
            },
          ]
        : draft.installedManifest,
    };
    await saveSetupConfig(finalConfig);
    onComplete(finalConfig);
  };

  return (
    <div
      className="min-h-screen bg-[#0B0C0E] text-[#F4F5F7] flex flex-col"
      data-testid="setup-wizard"
    >
      <header className="h-14 border-b border-white/8 bg-[#121418] px-6 flex items-center justify-between shrink-0">
        <BrandMark />
        <div className="flex items-center gap-4 text-xs text-[#8E95A5]">
          <span className="font-mono-tabular">
            Step{' '}
            {step === 'welcome'
              ? '1'
              : step === 'configure'
                ? '2'
                : step === 'summary'
                  ? '3'
                  : step === 'installing'
                    ? '4'
                    : '5'}{' '}
            / 5
          </span>
          {isRerun && onCancelRerun && !installing && (
            <button
              type="button"
              onClick={onCancelRerun}
              className="px-3 py-1 rounded border border-white/10 hover:bg-white/6 text-[#F4F5F7] cursor-pointer"
            >
              Return to App
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 py-10 flex items-start justify-center">
        <div className="w-full max-w-3xl space-y-8">
          {step === 'welcome' && (
            <section className="rounded-2xl border border-white/10 bg-[#121418] p-8 space-y-6">
              <div className="space-y-3">
                <p className="text-xs font-mono-tabular uppercase tracking-wider text-teal-400">
                  Local-First Workstation Setup
                </p>
                <h1 className="text-3xl font-semibold tracking-tight text-[#F4F5F7]">
                  Welcome to CUTflow
                </h1>
                <p className="text-sm text-[#A5ACBA] leading-relaxed">
                  CUTflow combines a manual multi-track video editor with an offline-capable
                  intelligent template workstation. Your source footage, transcriptions, vision
                  analysis, and final MP4 renders stay locally on your device.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="rounded-xl border border-white/8 bg-[#191C22]/70 p-4 space-y-1.5">
                  <p className="font-semibold text-[#F4F5F7]">1. Manual Video Edit</p>
                  <p className="text-[#8E95A5]">
                    Cut, trim, crop, color-grade, mix audio, layer overlays, and export MP4 locally
                    up to 20 minutes.
                  </p>
                </div>
                <div className="rounded-xl border border-white/8 bg-[#191C22]/70 p-4 space-y-1.5">
                  <p className="font-semibold text-[#F4F5F7]">2. Smart Template Production</p>
                  <p className="text-[#8E95A5]">
                    Transcribe speech with Whisper ONNX, map speaker faces & negative space with
                    MediaPipe, and batch-apply curated editorial templates.
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-teal-500/25 bg-teal-500/8 p-4 flex items-start gap-3 text-xs">
                <ShieldCheck className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5 text-[#CBD5E1]">
                  <p className="font-medium text-[#F4F5F7]">
                    No accounts, no subscriptions, no automatic cloud uploads
                  </p>
                  <p className="text-[#8E95A5]">
                    After downloading open-source AI weights once, CUTflow caches the app shell,
                    fonts, WASM runtimes, and models locally for offline studio sessions.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => handleFinishSetup(true)}
                  className="text-xs text-[#8E95A5] hover:text-[#F4F5F7] underline cursor-pointer"
                >
                  Skip AI downloads & open manual editor
                </button>
                <button
                  type="button"
                  data-testid="setup-start-btn"
                  onClick={() => setStep('configure')}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium cursor-pointer"
                >
                  Set Up CUTflow
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </section>
          )}

          {step === 'configure' && (
            <section className="rounded-2xl border border-white/10 bg-[#121418] p-7 space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-[#F4F5F7]">Workspace Configuration</h2>
                <p className="text-xs text-[#8E95A5] mt-1">
                  Configure your defaults and choose the local AI bundle suited for your hardware.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <label className="space-y-1.5">
                  <span className="text-[#8E95A5] block">Primary Workflow</span>
                  <select
                    aria-label="Primary workflow"
                    value={draft.preferredWorkflow}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        preferredWorkflow: e.target.value as SetupConfig['preferredWorkflow'],
                      }))
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#191C22] px-3 py-2 text-[#F4F5F7]"
                  >
                    <option value="both">Both Video Editing & Templates (Recommended)</option>
                    <option value="video-edit">Video Editing Focus</option>
                    <option value="templates">Template Production Focus</option>
                  </select>
                </label>

                <div className="space-y-1.5">
                  <span className="text-[#8E95A5] block">Default Aspect Ratio</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['9:16', '1:1', '16:9'] as AspectRatio[]).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, defaultAspectRatio: ratio }))}
                        className={`py-2 rounded-lg border font-mono-tabular cursor-pointer ${
                          draft.defaultAspectRatio === ratio
                            ? 'border-teal-500 bg-teal-500/15 text-teal-400 font-semibold'
                            : 'border-white/10 bg-[#191C22] text-[#8E95A5]'
                        }`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="space-y-1.5">
                  <span className="text-[#8E95A5] block">Speech & Romanization Style</span>
                  <select
                    aria-label="Romanization style"
                    value={draft.romanizationStyle}
                    onChange={(e) =>
                      setDraft((p) => ({
                        ...p,
                        romanizationStyle: e.target.value as RomanizationStyle,
                      }))
                    }
                    className="w-full rounded-lg border border-white/10 bg-[#191C22] px-3 py-2 text-[#F4F5F7]"
                  >
                    <option value="natural-hinglish">Natural Roman Hinglish + English</option>
                    <option value="phonetic-roman">Phonetic Roman Hindi + English</option>
                    <option value="preserve-english">English Only / Preserve Script</option>
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1.5">
                    <span className="text-[#8E95A5] block">Export Resolution</span>
                    <select
                      aria-label="Export resolution"
                      value={draft.exportResolution}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          exportResolution: e.target.value as '1080p' | '720p',
                        }))
                      }
                      className="w-full rounded-lg border border-white/10 bg-[#191C22] px-3 py-2 text-[#F4F5F7]"
                    >
                      <option value="1080p">1080p HD</option>
                      <option value="720p">720p Fast</option>
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[#8E95A5] block">Frame Rate</span>
                    <select
                      aria-label="Frame rate"
                      value={draft.exportFps}
                      onChange={(e) =>
                        setDraft((p) => ({
                          ...p,
                          exportFps: Number(e.target.value) as 30 | 60,
                        }))
                      }
                      className="w-full rounded-lg border border-white/10 bg-[#191C22] px-3 py-2 text-[#F4F5F7]"
                    >
                      <option value={30}>30 FPS</option>
                      <option value={60}>60 FPS</option>
                    </select>
                  </label>
                </div>
              </div>

              {/* Performance Profile Selection */}
              <div className="space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[#F4F5F7]">
                    Hardware & Performance Profile
                  </span>
                  <span className="font-mono-tabular text-[11px] text-[#8E95A5]">
                    {capabilities.hardwareConcurrency} cores ·{' '}
                    {capabilities.deviceMemoryGb ? `~${capabilities.deviceMemoryGb} GB RAM` : 'RAM undisclosed'} ·{' '}
                    {capabilities.webGPU ? 'WebGPU Active' : 'WASM SIMD CPU'}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(
                    [
                      {
                        id: 'low-memory' as PerformanceMode,
                        title: 'Lightweight',
                        size: '~79 MB',
                        desc: 'Whisper Base (73 MB) + FaceLandmarker + Silero VAD. Safe for 4 GB VRAM / 8 GB RAM.',
                      },
                      {
                        id: 'balanced' as PerformanceMode,
                        title: 'Balanced (Recommended)',
                        size: '~250 MB',
                        desc: 'Whisper Small (237 MB) + Silero VAD + Face, Pose & Selfie Segmenter.',
                      },
                      {
                        id: 'quality' as PerformanceMode,
                        title: 'Quality-focused',
                        size: '~623 MB',
                        desc: 'Whisper Large v3 Turbo (q4f16) + Full MediaPipe Vision Suite + Tesseract OCR.',
                      },
                    ] as const
                  ).map((prof) => {
                    const active = draft.performanceProfile === prof.id;
                    return (
                      <button
                        key={prof.id}
                        type="button"
                        onClick={() => handleProfileChange(prof.id)}
                        className={`text-left rounded-xl border p-3.5 space-y-1 transition-colors cursor-pointer ${
                          active
                            ? 'border-teal-500 bg-teal-500/12'
                            : 'border-white/10 bg-[#191C22]/60 hover:border-white/25'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-[#F4F5F7]">{prof.title}</span>
                          <span className="font-mono-tabular text-[11px] text-teal-400 shrink-0 whitespace-nowrap">
                            {prof.size}
                          </span>
                        </div>
                        <p className="text-[11px] text-[#8E95A5] leading-relaxed">{prof.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Optional Vision / OCR toggles */}
              <div className="space-y-2 text-xs">
                <span className="font-medium text-[#F4F5F7] block">
                  AI Vision & Speech Components Included
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    'silero-vad-onnx',
                    'mediapipe-face-landmarker',
                    'mediapipe-pose-landmarker',
                    'mediapipe-image-segmenter',
                    'mediapipe-object-detector',
                    'tesseract-ocr-eng',
                  ].map((id) => {
                    const def = getModelDefinition(id);
                    if (!def) return null;
                    const checked = draft.selectedVisionModelIds.includes(id);
                    return (
                      <label
                        key={id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/8 bg-[#191C22]/50 px-3 py-2 cursor-pointer"
                      >
                        <div className="min-w-0">
                          <p className="font-medium text-[#F4F5F7] truncate">{def.name}</p>
                          <p className="text-[10px] font-mono-tabular text-[#8E95A5]">
                            {def.sizeMb} MB · {def.license.split(' ')[0]}
                          </p>
                        </div>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleVisionModel(id)}
                          className="w-4 h-4 accent-teal-500 shrink-0"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Local Storage & Honest Hardware Capabilities */}
              <div className="rounded-xl border border-white/8 bg-[#0E1014] p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px]">
                <div className="flex items-start gap-2">
                  <HardDrive className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-[#F4F5F7]">Local Storage Location</p>
                    <p className="text-[#8E95A5]">
                      Projects & transcripts persist in browser IndexedDB; exports use{' '}
                      {capabilities.opfs ? 'OPFS + IndexedDB' : 'IndexedDB'}.
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2">
                  <Cpu className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-[#F4F5F7]">Detected Runtimes</p>
                    <p className="text-[#8E95A5]">
                      Speech: {capabilities.webGPU ? 'WebGPU + WASM fallback' : 'WASM SIMD CPU'} ·
                      Export:{' '}
                      {capabilities.webCodecsH264Supported
                        ? 'WebCodecs MP4 (H.264)'
                        : 'MediaRecorder Fallback'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => (isRerun && onCancelRerun ? onCancelRerun() : setStep('welcome'))}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/10 text-xs text-[#CBD5E1] hover:bg-white/6 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>
                <button
                  type="button"
                  data-testid="setup-review-btn"
                  onClick={() => setStep('summary')}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
                >
                  Review Installation Summary
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </section>
          )}

          {step === 'summary' && (
            <section className="rounded-2xl border border-white/10 bg-[#121418] p-7 space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-[#F4F5F7]">
                    Installation & Preparation Summary
                  </h2>
                  <p className="text-xs text-[#8E95A5] mt-1">
                    Review every local model, runtime asset, and template pack before downloading.
                  </p>
                </div>
                <span className="font-mono-tabular text-xs px-2.5 py-1 rounded-md bg-teal-500/15 text-teal-400">
                  ~{totalEstimatedMb.toFixed(0)} MB total
                </span>
              </div>

              <div className="divide-y divide-white/8 rounded-xl border border-white/10 bg-[#0E1014]">
                {plan.map((item) => (
                  <div key={item.id} className="px-4 py-3 flex items-center justify-between gap-4 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-[#F4F5F7] truncate">{item.name}</p>
                      <p className="text-[11px] text-[#8E95A5] truncate">
                        {item.id} · {item.runtimeLabel}
                      </p>
                    </div>
                    <span className="font-mono-tabular text-[#CBD5E1] shrink-0">
                      {item.sizeMb >= 1 ? `${item.sizeMb} MB` : 'Bundled'}
                    </span>
                  </div>
                ))}
              </div>

              {!capabilities.webGPU && draft.selectedAsrModelId === 'whisper-large-v3-turbo-multi' && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2.5 text-xs text-amber-300">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    WebGPU is unavailable in this browser. Whisper Large v3 Turbo will run on CPU
                    WASM and may be slow; consider switching to Balanced (Whisper Small) or
                    Lightweight (Whisper Base).
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('configure')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-white/10 text-xs text-[#CBD5E1] hover:bg-white/6 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Adjust Configuration
                </button>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    data-testid="setup-skip-downloads-btn"
                    onClick={() => handleFinishSetup(true)}
                    className="px-3.5 py-2 rounded-lg border border-white/10 text-xs text-[#8E95A5] hover:text-white cursor-pointer"
                  >
                    Prepare Offline Shell Only
                  </button>
                  <button
                    type="button"
                    data-testid="setup-install-btn"
                    onClick={startInstallation}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    Install and Prepare CUTflow
                  </button>
                </div>
              </div>
            </section>
          )}

          {step === 'installing' && (
            <section className="rounded-2xl border border-white/10 bg-[#121418] p-7 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-xl font-semibold text-[#F4F5F7]">
                    Downloading & Verifying Local Components
                  </h2>
                  <p className="text-xs text-[#8E95A5] mt-1">
                    Caching weights, verifying offline WASM assets, and running an ASR initialization check.
                  </p>
                </div>
                {installing && (
                  <button
                    type="button"
                    onClick={() => abortRef.current?.abort()}
                    className="px-3 py-1.5 rounded-lg border border-red-500/30 text-xs text-red-400 hover:bg-red-500/10 cursor-pointer"
                  >
                    Cancel
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {plan.map((item) => {
                  const st = itemStates[item.id] ?? {
                    id: item.id,
                    status: 'pending',
                    progress: 0,
                    detail: 'Waiting',
                  };
                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-white/10 bg-[#0E1014] p-3.5 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {st.status === 'ready' && (
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                            )}
                            {st.status === 'failed' && (
                              <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                            )}
                            {st.status === 'running' && (
                              <RefreshCw className="w-4 h-4 text-teal-400 animate-spin shrink-0" />
                            )}
                            <span className="font-medium text-[#F4F5F7] truncate">{item.name}</span>
                          </div>
                          <p className="text-[11px] text-[#8E95A5] mt-0.5 truncate">{st.detail}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {st.loadedBytes !== undefined && st.totalBytes ? (
                            <span className="font-mono-tabular text-[11px] text-[#8E95A5]">
                              {formatBytes(st.loadedBytes)} / {formatBytes(st.totalBytes)}
                            </span>
                          ) : (
                            <span className="font-mono-tabular text-[11px] text-[#8E95A5]">
                              {Math.round(st.progress * 100)}%
                            </span>
                          )}
                          {st.status === 'failed' && !installing && (
                            <button
                              type="button"
                              onClick={() => retrySingleItem(item.id)}
                              className="px-2 py-1 rounded bg-teal-600 text-white text-[11px] cursor-pointer"
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            st.status === 'failed'
                              ? 'bg-red-500'
                              : st.status === 'ready'
                                ? 'bg-emerald-500'
                                : 'bg-teal-500'
                          }`}
                          style={{ width: `${Math.round(st.progress * 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {installDone && (
                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    data-testid="setup-to-complete-btn"
                    onClick={() => setStep('complete')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-medium cursor-pointer"
                  >
                    Continue to Verification Summary
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </section>
          )}

          {step === 'complete' && (
            <section className="rounded-2xl border border-white/10 bg-[#121418] p-7 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-[#F4F5F7]">CUTflow Workstation Ready</h2>
                  <p className="text-xs text-[#8E95A5]">
                    Verified components and offline readiness status on this browser.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-white/10 bg-[#0E1014] p-3.5 space-y-1">
                  <p className="text-[#8E95A5]">Speech Recognition Runtime</p>
                  <p className="font-medium text-[#F4F5F7]">
                    {draft.verifiedProviderReport?.asrVerified
                      ? draft.verifiedProviderReport.asrProvider
                      : 'Not verified (download in Settings when online)'}
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#0E1014] p-3.5 space-y-1">
                  <p className="text-[#8E95A5]">Offline App Shell & Fonts</p>
                  <p className="font-medium text-[#F4F5F7] flex items-center gap-1.5">
                    <WifiOff className="w-3.5 h-3.5 text-teal-400" />
                    {offlineCheck?.fontsReady && offlineCheck?.localWasmAccessible
                      ? 'Fonts & Local WASM Verified'
                      : 'Partially cached'}
                  </p>
                </div>
              </div>

              <div className="divide-y divide-white/8 rounded-xl border border-white/10 bg-[#0E1014] text-xs">
                {draft.installedManifest.map((entry) => (
                  <div key={entry.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                    <span className="text-[#F4F5F7] truncate">{entry.name}</span>
                    <span
                      className={`font-mono-tabular shrink-0 ${
                        entry.status === 'ready'
                          ? 'text-emerald-400'
                          : entry.status === 'failed'
                            ? 'text-red-400'
                            : 'text-amber-400'
                      }`}
                    >
                      {entry.status === 'ready'
                        ? `Ready${entry.provider ? ` · ${entry.provider}` : ''}`
                        : entry.status === 'failed'
                          ? `Failed (${entry.error ?? 'Error'})`
                          : 'Skipped'}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  data-testid="setup-finish-btn"
                  onClick={() => handleFinishSetup(false)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium cursor-pointer"
                >
                  Open CUTflow
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
