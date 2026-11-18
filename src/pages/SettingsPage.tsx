import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  MousePointer2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import {
  AppSettings,
  CustomVocabEntry,
  PerformanceMode,
  RomanizationStyle,
  SetupConfig,
  TimelineTool,
  UserFontRecord,
} from '../types/project';
import { BrowserCapabilities, detectBrowserCapabilities } from '../services/capabilities';
import {
  CURATED_BUNDLED_FONTS,
  importCustomFontFile,
  removeCustomFont,
} from '../services/fonts';
import {
  clearTemporaryCache,
  getStorageUsageReport,
  listUserFontRecords,
  StorageUsageReport,
} from '../services/storage';
import { verifyOfflineReadiness } from '../services/setupManager';
import { createId, formatBytes } from '../utils/timelineMath';
import {
  deleteDownloadedModel,
  downloadModelExplicitly,
  getAllModelStatuses,
  ModelStatusEntry,
  subscribeModelManager,
} from '../services/ai/modelManager';
import { evaluateModelCompatibility } from '../services/ai/modelRegistry';
import { GovernorSnapshot, resourceGovernor } from '../services/ai/resourceGovernor';

interface SettingsPageProps {
  settings: AppSettings;
  setupConfig?: SetupConfig;
  onUpdateSettings: (patch: Partial<AppSettings>) => void;
  onRerunSetup?: () => void;
}

export function SettingsPage({
  settings,
  setupConfig,
  onUpdateSettings,
  onRerunSetup,
}: SettingsPageProps) {
  const [caps, setCaps] = useState<BrowserCapabilities | null>(null);
  const [storageReport, setStorageReport] = useState<StorageUsageReport | null>(null);
  const [modelStatuses, setModelStatuses] = useState<ModelStatusEntry[]>([]);
  const [govSnap, setGovSnap] = useState<GovernorSnapshot>(resourceGovernor.getSnapshot());
  const [userFonts, setUserFonts] = useState<UserFontRecord[]>([]);
  const [offlineStatus, setOfflineStatus] = useState<{
    serviceWorkerActive: boolean;
    localWasmAccessible: boolean;
    fontsReady: boolean;
  } | null>(null);
  const [fontMsg, setFontMsg] = useState('');
  const [cacheMessage, setCacheMessage] = useState('');
  const [modelMsg, setModelMsg] = useState('');
  const [vocabSpoken, setVocabSpoken] = useState('');
  const [vocabTarget, setVocabTarget] = useState('');
  const fontInputRef = useRef<HTMLInputElement | null>(null);

  const refreshDiagnostics = async () => {
    const [c, s, m, uf, off] = await Promise.all([
      detectBrowserCapabilities(),
      getStorageUsageReport(),
      getAllModelStatuses(),
      listUserFontRecords(),
      verifyOfflineReadiness(),
    ]);
    setCaps(c);
    setStorageReport(s);
    setModelStatuses(m);
    setUserFonts(uf);
    setOfflineStatus(off);
  };

  useEffect(() => {
    refreshDiagnostics();
    const unsubModels = subscribeModelManager(() => {
      getAllModelStatuses().then(setModelStatuses).catch(() => {});
    });
    const unsubGov = resourceGovernor.subscribe(setGovSnap);
    return () => {
      unsubModels();
      unsubGov();
    };
  }, []);

  const handleClearCache = async () => {
    const res = await clearTemporaryCache();
    setCacheMessage(`Cleared ${res.removedBlobs} orphaned temporary files.`);
    await refreshDiagnostics();
  };

  const handleDownloadModel = async (modelId: string) => {
    setModelMsg('');
    try {
      await downloadModelExplicitly(modelId);
      await refreshDiagnostics();
    } catch (err) {
      setModelMsg(err instanceof Error ? err.message : 'Download failed.');
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    setModelMsg('');
    await deleteDownloadedModel(modelId);
    await refreshDiagnostics();
  };

  const handleUploadCustomFont = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setFontMsg('');
    try {
      const rec = await importCustomFontFile(file);
      setFontMsg(`Imported font "${rec.familyName}" locally into IndexedDB.`);
      await refreshDiagnostics();
    } catch (err) {
      setFontMsg(err instanceof Error ? err.message : 'Font upload failed.');
    } finally {
      if (fontInputRef.current) fontInputRef.current.value = '';
    }
  };

  const handleAddVocab = () => {
    if (!vocabSpoken.trim() || !vocabTarget.trim()) return;
    const entry: CustomVocabEntry = {
      id: createId('voc'),
      spokenForm: vocabSpoken.trim(),
      preferredSpelling: vocabTarget.trim(),
      caseSensitive: false,
    };
    onUpdateSettings({
      customVocabulary: [...settings.customVocabulary, entry],
    });
    setVocabSpoken('');
    setVocabTarget('');
  };

  return (
    <main className="flex-1 overflow-y-auto px-6 py-8 max-w-4xl w-full mx-auto space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 dark:text-[#F4F5F7]">Settings</h1>
        <p className="text-xs text-slate-500 dark:text-[#8E95A5] mt-1">
          Setup & offline readiness, local AI runtimes, bundled/custom fonts, Hinglish vocabulary, input preferences, and hardware diagnostics.
        </p>
      </div>

      {/* First-Launch Setup Manifest & Offline Readiness */}
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-teal-500" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
                First-Launch Setup & Offline Package Status
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
                {setupConfig?.setupComplete
                  ? `Completed ${setupConfig.completedAt ? new Date(setupConfig.completedAt).toLocaleString() : ''}`
                  : 'Setup not completed yet'}
              </p>
            </div>
          </div>

          {onRerunSetup && (
            <button
              type="button"
              onClick={onRerunSetup}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-teal-500/40 bg-teal-500/10 hover:bg-teal-500/20 text-xs font-medium text-teal-400 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Run Setup Again
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
          <div className="rounded-lg border border-slate-200 dark:border-white/8 px-3 py-2">
            <p className="text-slate-500 dark:text-[#8E95A5] text-[11px]">App Shell Cache (PWA)</p>
            <p className="font-medium text-slate-900 dark:text-[#F4F5F7]">
              {offlineStatus?.serviceWorkerActive ? 'Offline Ready' : 'Online / Dev Mode'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-white/8 px-3 py-2">
            <p className="text-slate-500 dark:text-[#8E95A5] text-[11px]">Local MediaPipe WASM</p>
            <p className="font-medium text-slate-900 dark:text-[#F4F5F7]">
              {offlineStatus?.localWasmAccessible ? 'Bundled Locally ✓' : 'Unavailable'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-white/8 px-3 py-2">
            <p className="text-slate-500 dark:text-[#8E95A5] text-[11px]">Verified Runtime Provider</p>
            <p className="font-medium text-slate-900 dark:text-[#F4F5F7] truncate">
              {setupConfig?.verifiedProviderReport?.asrProvider ??
                (caps?.webGPU ? 'WebGPU / WASM' : 'WASM SIMD CPU')}
            </p>
          </div>
        </div>

        {setupConfig?.installedManifest && setupConfig.installedManifest.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-white/8 text-[11px]">
            <p className="font-medium text-slate-700 dark:text-[#F4F5F7]">Installed Asset Manifest</p>
            <div className="divide-y divide-slate-200 dark:divide-white/6 rounded-lg border border-slate-200 dark:border-white/8">
              {setupConfig.installedManifest.map((entry) => (
                <div key={entry.id} className="px-3 py-1.5 flex items-center justify-between gap-2">
                  <span className="text-slate-800 dark:text-[#F4F5F7] truncate">{entry.name}</span>
                  <span className="font-mono-tabular text-emerald-400 shrink-0">
                    {entry.status} · {entry.provider ?? entry.kind}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* General & Export Preferences */}
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] divide-y divide-slate-200 dark:divide-white/8">
        <div className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-[#F4F5F7]">Theme</p>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
              Restrained dark studio mode is recommended for color accuracy.
            </p>
          </div>
          <div className="flex items-center rounded-md border border-slate-200 dark:border-white/10 p-0.5 text-xs">
            {(['dark', 'light'] as const).map((theme) => (
              <button
                key={theme}
                type="button"
                onClick={() => onUpdateSettings({ theme })}
                className={`px-3 py-1 rounded capitalize cursor-pointer ${
                  settings.theme === theme
                    ? 'bg-teal-600 text-white'
                    : 'text-slate-600 dark:text-[#8E95A5]'
                }`}
              >
                {theme}
              </button>
            ))}
          </div>
        </div>

        <div className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-[#F4F5F7]">
              Default Export Resolution
            </p>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
              Applied to new projects and batch template outputs.
            </p>
          </div>
          <select
            aria-label="Default export resolution"
            value={settings.defaultResolution}
            onChange={(e) =>
              onUpdateSettings({ defaultResolution: e.target.value as '1080p' | '720p' })
            }
            className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-3 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
          >
            <option value="1080p">1080p</option>
            <option value="720p">720p</option>
          </select>
        </div>

        <div className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-[#F4F5F7]">
              Default Frame Rate
            </p>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
              Target frames per second for new timelines.
            </p>
          </div>
          <select
            aria-label="Default frame rate"
            value={settings.defaultFps}
            onChange={(e) => onUpdateSettings({ defaultFps: Number(e.target.value) as 30 | 60 })}
            className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-3 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
          >
            <option value={30}>30 FPS</option>
            <option value={60}>60 FPS</option>
          </select>
        </div>

        <div className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-[#F4F5F7]">
              Performance & Memory Mode
            </p>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
              Adjusts preview resolution and AI frame/chunk budgets (Low-Memory recommended for 4 GB VRAM / 8 GB RAM).
            </p>
          </div>
          <select
            aria-label="Performance mode"
            value={settings.performanceMode}
            onChange={(e) =>
              onUpdateSettings({ performanceMode: e.target.value as PerformanceMode })
            }
            className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-3 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
          >
            <option value="balanced">Balanced (Recommended)</option>
            <option value="quality">Full Quality</option>
            <option value="low-memory">Low-Memory Proxy</option>
          </select>
        </div>

        <div className="p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-[#F4F5F7]">
              Automatic Project Recovery
            </p>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
              Automatically saves timeline edits to IndexedDB for reload recovery.
            </p>
          </div>
          <input
            type="checkbox"
            aria-label="Automatic project recovery"
            checked={settings.autoSaveEnabled}
            onChange={(e) => onUpdateSettings({ autoSaveEnabled: e.target.checked })}
            className="w-4 h-4 accent-teal-500 cursor-pointer"
          />
        </div>
      </section>

      {/* Local Fonts & Custom Font Upload */}
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Type className="w-4 h-4 text-teal-500" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
                Local Bundled Fonts & Custom Imports
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
                All 9 open-license editorial fonts are bundled offline. Upload custom .ttf/.otf/.woff/.woff2 fonts to store them in IndexedDB.
              </p>
            </div>
          </div>
          <input
            ref={fontInputRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            className="hidden"
            onChange={(e) => handleUploadCustomFont(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fontInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            Import Local Font
          </button>
        </div>

        {fontMsg && <p className="text-xs text-teal-400">{fontMsg}</p>}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
          {CURATED_BUNDLED_FONTS.map((f) => (
            <div
              key={f.family}
              className="rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#191C22]/60 p-2.5 space-y-0.5"
            >
              <p className="font-semibold text-slate-900 dark:text-[#F4F5F7]" style={{ fontFamily: f.family }}>
                {f.label}
              </p>
              <p className="text-[10px] text-slate-500 dark:text-[#8E95A5]">
                {f.category} · {f.license}
              </p>
            </div>
          ))}
        </div>

        {userFonts.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-white/8 text-xs">
            <p className="font-medium text-slate-700 dark:text-[#F4F5F7]">User-Imported Fonts</p>
            {userFonts.map((uf) => (
              <div
                key={uf.id}
                className="flex items-center justify-between rounded border border-white/8 bg-[#191C22] px-3 py-1.5"
              >
                <div>
                  <span className="font-medium text-[#F4F5F7]">{uf.familyName}</span>
                  <span className="text-[11px] text-[#8E95A5] ml-2">
                    ({uf.fileName} · {formatBytes(uf.sizeBytes)})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await removeCustomFont(uf.id);
                    await refreshDiagnostics();
                  }}
                  className="text-slate-400 hover:text-red-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Input, Mouse & Touch Bar Preferences */}
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
        <div className="flex items-center gap-2">
          <MousePointer2 className="w-4 h-4 text-teal-500" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
            Input, Mouse & Touch Bar Preferences
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <label className="space-y-1.5">
            <span className="text-slate-500 dark:text-[#8E95A5] block">
              Mouse Wheel / Trackpad Gesture on Timeline
            </span>
            <select
              aria-label="Timeline scroll mode"
              value={settings.inputPreferences.scrollMode}
              onChange={(e) =>
                onUpdateSettings({
                  inputPreferences: {
                    ...settings.inputPreferences,
                    scrollMode: e.target.value as 'zoom' | 'pan',
                  },
                })
              }
              className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-3 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
            >
              <option value="pan">Horizontal Scrub / Pan (Ctrl+Wheel Zooms)</option>
              <option value="zoom">Timeline Zoom (Standard Wheel Zooms)</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <span className="text-slate-500 dark:text-[#8E95A5] block">
              Default Timeline Tool
            </span>
            <select
              aria-label="Default timeline tool"
              value={settings.inputPreferences.defaultTimelineTool}
              onChange={(e) =>
                onUpdateSettings({
                  inputPreferences: {
                    ...settings.inputPreferences,
                    defaultTimelineTool: e.target.value as TimelineTool,
                  },
                })
              }
              className="w-full rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-3 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
            >
              <option value="select">Select Tool (V)</option>
              <option value="razor">Razor / Cut Tool (C)</option>
              <option value="trim">Trim Tool (B)</option>
              <option value="hand">Hand Pan Tool (H)</option>
            </select>
          </label>

          <label className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-[#8E95A5]">
                Touch Bar / Trackpad Scrub Sensitivity
              </span>
              <span className="font-mono-tabular text-slate-900 dark:text-[#F4F5F7]">
                {settings.inputPreferences.touchBarScrubSensitivity.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              aria-label="Touchbar scrub sensitivity"
              min={0.5}
              max={2.5}
              step={0.1}
              value={settings.inputPreferences.touchBarScrubSensitivity}
              onChange={(e) =>
                onUpdateSettings({
                  inputPreferences: {
                    ...settings.inputPreferences,
                    touchBarScrubSensitivity: Number(e.target.value),
                  },
                })
              }
              className="w-full accent-teal-500"
            />
          </label>

          <label className="flex items-center justify-between rounded-lg border border-slate-200 dark:border-white/8 px-3 py-2 cursor-pointer">
            <span className="text-slate-700 dark:text-[#F4F5F7]">Invert Scroll / Scrub Direction</span>
            <input
              type="checkbox"
              aria-label="Invert scroll direction"
              checked={settings.inputPreferences.invertScroll}
              onChange={(e) =>
                onUpdateSettings({
                  inputPreferences: {
                    ...settings.inputPreferences,
                    invertScroll: e.target.checked,
                  },
                })
              }
              className="w-4 h-4 accent-teal-500 cursor-pointer"
            />
          </label>
        </div>
      </section>

      {/* Local AI Models & Manager */}
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
              Local AI Models & Runtimes
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5] mt-0.5">
              Explicitly manage verified open-source ONNX, MediaPipe, and OCR models cached locally. Nothing is uploaded to external clouds.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.autoSoundDesign}
                onChange={(e) => onUpdateSettings({ autoSoundDesign: e.target.checked })}
                className="w-4 h-4 accent-teal-500 cursor-pointer"
              />
              <span className="text-slate-700 dark:text-[#F4F5F7]">Auto Sound Cues</span>
            </label>
            <select
              aria-label="Preferred Whisper model"
              value={settings.preferredWhisperModelId}
              onChange={(e) => onUpdateSettings({ preferredWhisperModelId: e.target.value })}
              className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
            >
              <option value="whisper-base-multi">Whisper Base (73 MB · q8)</option>
              <option value="whisper-small-multi">Whisper Small (237 MB · q8)</option>
              <option value="whisper-large-v3-turbo-multi">Whisper Large V3 Turbo (~590 MB)</option>
            </select>
          </div>
        </div>

        {modelMsg && (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-400">
            {modelMsg}
          </div>
        )}

        <div className="space-y-2.5">
          {modelStatuses.map((entry) => {
            const def = entry.definition;
            const compat = evaluateModelCompatibility(def, caps, settings.performanceMode);
            return (
              <div
                key={def.id}
                className="rounded-lg border border-slate-200 dark:border-white/8 bg-slate-50 dark:bg-[#191C22]/60 p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-900 dark:text-[#F4F5F7]">
                      {def.name}
                    </span>
                    <span className="text-[10px] font-mono-tabular text-slate-400">
                      {def.builtIn ? 'Built-in' : `${def.sizeMb} MB`}
                    </span>
                    {(entry.state === 'ready' || entry.state === 'built-in') && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
                        <CheckCircle2 className="w-3 h-3" />
                        Ready Offline
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-[#8E95A5]">
                    {def.description} ({compat.provider})
                  </p>
                  {compat.warning && (
                    <p className="text-[11px] text-amber-400">{compat.warning}</p>
                  )}
                  {entry.error && <p className="text-[11px] text-red-400">{entry.error}</p>}
                  {entry.state === 'downloading' && (
                    <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden mt-1">
                      <div
                        className="h-full bg-teal-500 transition-all"
                        style={{ width: `${Math.round(entry.progress * 100)}%` }}
                      />
                    </div>
                  )}
                </div>

                {!def.builtIn && (
                  <div className="flex items-center gap-2 shrink-0">
                    {entry.state === 'ready' ? (
                      <button
                        type="button"
                        onClick={() => handleDeleteModel(def.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-red-500/30 text-red-400 hover:bg-red-500/10 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete Cache
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={entry.state === 'downloading'}
                        onClick={() => handleDownloadModel(def.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-medium cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {entry.state === 'downloading'
                          ? `${Math.round(entry.progress * 100)}%`
                          : 'Download'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Roman Hinglish & Custom Vocabulary */}
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
              Roman Hinglish & Custom Vocabulary
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#8E95A5]">
              Controls Devanagari-to-Roman conversion and brand/slang spelling overrides.
            </p>
          </div>
          <select
            aria-label="Romanization style"
            value={settings.romanizationStyle}
            onChange={(e) =>
              onUpdateSettings({ romanizationStyle: e.target.value as RomanizationStyle })
            }
            className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-3 py-1.5 text-xs text-slate-900 dark:text-[#F4F5F7]"
          >
            <option value="natural-hinglish">Natural Hinglish</option>
            <option value="phonetic-roman">Phonetic Roman</option>
            <option value="preserve-english">Preserve English</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="text"
            placeholder="Spoken / raw form (e.g. cut flow)"
            value={vocabSpoken}
            onChange={(e) => setVocabSpoken(e.target.value)}
            className="flex-1 min-w-[160px] rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5 text-slate-900 dark:text-[#F4F5F7]"
          />
          <input
            type="text"
            placeholder="Preferred spelling (e.g. CutFlow)"
            value={vocabTarget}
            onChange={(e) => setVocabTarget(e.target.value)}
            className="flex-1 min-w-[160px] rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1.5 text-slate-900 dark:text-[#F4F5F7]"
          />
          <button
            type="button"
            onClick={handleAddVocab}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-teal-600 hover:bg-teal-500 text-white font-medium cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Word
          </button>
        </div>

        {settings.customVocabulary.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {settings.customVocabulary.map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-[#191C22] px-2.5 py-1 text-xs"
              >
                <span className="text-slate-400">{v.spokenForm}</span>
                <span>→</span>
                <span className="font-medium text-teal-400">{v.preferredSpelling}</span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateSettings({
                      customVocabulary: settings.customVocabulary.filter((x) => x.id !== v.id),
                    })
                  }
                  className="text-slate-400 hover:text-red-400 cursor-pointer"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Local Storage Usage */}
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-teal-500" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
                Local Storage Usage
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#8E95A5] font-mono-tabular mt-0.5">
                {storageReport
                  ? `${formatBytes(storageReport.usageBytes)} used of ${formatBytes(storageReport.quotaBytes)} · ${storageReport.projectCount} projects · ${storageReport.outputCount} outputs`
                  : 'Measuring local storage...'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClearCache}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-200 dark:border-white/10 text-xs font-medium text-slate-700 dark:text-[#F4F5F7] hover:bg-slate-100 dark:hover:bg-white/6 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear Temporary Cache
          </button>
        </div>
        {cacheMessage && <p className="text-xs text-teal-500">{cacheMessage}</p>}
      </section>

      {/* Hardware Governor & Browser Compatibility Matrix */}
      <section className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-[#121418] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-teal-500" />
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#F4F5F7]">
              Hardware Compatibility & Resource Governor
            </h2>
          </div>
          <span className="text-[11px] font-mono-tabular text-slate-500 dark:text-[#8E95A5]">
            {govSnap.busy ? `Active: ${govSnap.activeTaskName}` : 'Governor Idle (Sequential Queue)'}
          </span>
        </div>

        {caps ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <CapabilityRow label="WebCodecs VideoEncoder" supported={caps.webCodecsVideoEncoder} />
            <CapabilityRow label="WebCodecs H.264 Export" supported={caps.webCodecsH264Supported} />
            <CapabilityRow
              label="WebGPU Compute"
              supported={caps.webGPU}
              note={caps.webGPU ? 'ONNX WebGPU acceleration available' : 'WASM SIMD CPU fallback'}
            />
            <CapabilityRow
              label="WebGL2 Acceleration"
              supported={caps.webGL2}
              note={caps.webGL2Renderer}
            />
            <CapabilityRow
              label="CPU Threads & Memory"
              supported={true}
              note={`${caps.hardwareConcurrency} cores${caps.deviceMemoryGb ? ` · ~${caps.deviceMemoryGb} GB RAM` : ''}`}
            />
            <CapabilityRow label="OPFS Asset Storage" supported={caps.opfs} />
            <CapabilityRow label="IndexedDB Persistence" supported={caps.indexedDB} />
            <CapabilityRow
              label="MediaRecorder Fallback"
              supported={caps.mediaRecorder}
              note={caps.mediaRecorderMimeType || 'Unavailable'}
            />
          </div>
        ) : (
          <p className="text-xs text-slate-500 dark:text-[#8E95A5]">Probing browser APIs...</p>
        )}

        {govSnap.recentTimings.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-slate-200 dark:border-white/8">
            <p className="text-xs font-medium text-slate-700 dark:text-[#F4F5F7]">
              Recent Local Task Timings
            </p>
            <div className="space-y-1 text-[11px] font-mono-tabular text-slate-500 dark:text-[#8E95A5]">
              {govSnap.recentTimings.slice(0, 6).map((t) => (
                <div key={t.id} className="flex items-center justify-between">
                  <span className="truncate">{t.name}</span>
                  <span>
                    {t.durationMs} ms · {t.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function CapabilityRow({
  label,
  supported,
  note,
}: {
  label: string;
  supported: boolean;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/8 px-3 py-2 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="font-medium text-slate-900 dark:text-[#F4F5F7] truncate">{label}</p>
        {note && <p className="text-[11px] text-slate-500 dark:text-[#8E95A5] truncate">{note}</p>}
      </div>
      <span
        className={`text-[11px] font-medium shrink-0 ${
          supported ? 'text-emerald-500' : 'text-amber-400'
        }`}
      >
        {supported ? 'Supported' : 'Fallback'}
      </span>
    </div>
  );
}
