import {
  AppSettings,
  CutFlowProject,
  FinalOutputItem,
  RenderJob,
  SetupConfig,
  SourceAnalysisBundle,
  StorageBackend,
  TemplateDefinition,
  UserFontRecord,
} from '../types/project';
import { migrateProjectSchema } from '../utils/timelineMath';

const DB_NAME = 'cutflow_studio_db';
const DB_VERSION = 3;

const STORE_PROJECTS = 'projects';
const STORE_TEMPLATES = 'templates';
const STORE_OUTPUTS = 'outputs';
const STORE_JOBS = 'jobs';
const STORE_BLOBS = 'blobs';
const STORE_SETTINGS = 'settings';
const STORE_ANALYSES = 'analyses';
const STORE_MODELS = 'models';
const STORE_SETUP = 'setup';
const STORE_FONTS = 'fonts';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  defaultResolution: '1080p',
  defaultFps: 30,
  defaultAspectRatio: '9:16',
  performanceMode: 'balanced',
  autoSaveEnabled: true,
  autoSaveIntervalMs: 3000,
  romanizationStyle: 'natural-hinglish',
  customVocabulary: [],
  preferredWhisperModelId: 'whisper-small-multi',
  autoSoundDesign: true,
  inputPreferences: {
    scrollMode: 'pan',
    touchBarScrubSensitivity: 1.0,
    invertScroll: false,
    defaultTimelineTool: 'select',
  },
};

export const DEFAULT_SETUP_CONFIG: SetupConfig = {
  setupComplete: false,
  preferredWorkflow: 'both',
  defaultAspectRatio: '9:16',
  preferredLanguages: ['en', 'hi', 'hi-en'],
  romanizationStyle: 'natural-hinglish',
  performanceProfile: 'balanced',
  exportResolution: '1080p',
  exportFps: 30,
  selectedAsrModelId: 'whisper-small-multi',
  selectedVisionModelIds: ['silero-vad-onnx', 'mediapipe-face-landmarker'],
  installLocalFonts: true,
  offlineReady: false,
  installedManifest: [],
};

// Legacy built-in placeholder IDs that must never remain cached as custom templates
const LEGACY_PLACEHOLDER_TEMPLATE_IDS = new Set([
  'tpl_clean_split_grid',
  'tpl_editorial_frame',
  'tpl_bold_kinetic_reel',
  'tpl_studio_spotlight',
  'tpl_framed_pip_matte',
  'tpl_square_cinema',
  'tpl_widescreen_letterbox',
]);

// Known synthetic sample IDs from earlier prototypes — only exact confirmed IDs are auto-cleaned
const CONFIRMED_SAMPLE_PROJECT_IDS = new Set([
  'sample_project_1',
  'demo_project_1',
  'cutflow_demo_project',
  'cutflow_sample_edit',
]);

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser context.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_TEMPLATES)) {
        db.createObjectStore(STORE_TEMPLATES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_OUTPUTS)) {
        db.createObjectStore(STORE_OUTPUTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_JOBS)) {
        db.createObjectStore(STORE_JOBS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_ANALYSES)) {
        db.createObjectStore(STORE_ANALYSES, { keyPath: 'cacheKey' });
      }
      if (!db.objectStoreNames.contains(STORE_MODELS)) {
        db.createObjectStore(STORE_MODELS, { keyPath: 'modelId' });
      }
      if (!db.objectStoreNames.contains(STORE_SETUP)) {
        db.createObjectStore(STORE_SETUP, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_FONTS)) {
        db.createObjectStore(STORE_FONTS, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB.'));
  });

  return dbPromise;
}

function txRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed.'));
  });
}

async function getOpfsRootDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
      return null;
    }
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('cutflow-assets', { create: true });
  } catch {
    return null;
  }
}

export async function saveMediaBlob(
  key: string,
  blob: Blob
): Promise<{ backend: StorageBackend; key: string }> {
  const opfsDir = await getOpfsRootDir();
  if (opfsDir) {
    try {
      const fileHandle = await opfsDir.getFileHandle(key, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { backend: 'opfs', key };
    } catch {
      // Fall through to IndexedDB if OPFS write fails
    }
  }

  const db = await openDatabase();
  const tx = db.transaction(STORE_BLOBS, 'readwrite');
  await txRequest(tx.objectStore(STORE_BLOBS).put({ key, blob, savedAt: Date.now() }));
  return { backend: 'idb', key };
}

export async function loadMediaBlob(key: string, backend: StorageBackend): Promise<Blob | null> {
  if (backend === 'opfs') {
    const opfsDir = await getOpfsRootDir();
    if (opfsDir) {
      try {
        const fileHandle = await opfsDir.getFileHandle(key);
        return await fileHandle.getFile();
      } catch {
        // Fallback check in IDB
      }
    }
  }

  const db = await openDatabase();
  const tx = db.transaction(STORE_BLOBS, 'readonly');
  const record = (await txRequest(tx.objectStore(STORE_BLOBS).get(key))) as
    | { key: string; blob: Blob }
    | undefined;
  return record?.blob ?? null;
}

export async function deleteMediaBlob(key: string, backend: StorageBackend): Promise<void> {
  if (backend === 'opfs') {
    const opfsDir = await getOpfsRootDir();
    if (opfsDir) {
      try {
        await opfsDir.removeEntry(key);
      } catch {
        // ignore if already removed
      }
    }
  }

  const db = await openDatabase();
  const tx = db.transaction(STORE_BLOBS, 'readwrite');
  await txRequest(tx.objectStore(STORE_BLOBS).delete(key));
}

export async function saveProject(project: CutFlowProject): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_PROJECTS, 'readwrite');
  const toSave: CutFlowProject = {
    ...project,
    updatedAt: Date.now(),
  };
  await txRequest(tx.objectStore(STORE_PROJECTS).put(toSave));
}

export async function getProject(id: string): Promise<CutFlowProject | null> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_PROJECTS, 'readonly');
  const raw = (await txRequest(tx.objectStore(STORE_PROJECTS).get(id))) as CutFlowProject | undefined;
  return raw ? migrateProjectSchema(raw) : null;
}

export async function listProjects(): Promise<CutFlowProject[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_PROJECTS, 'readonly');
  const all = (await txRequest(tx.objectStore(STORE_PROJECTS).getAll())) as CutFlowProject[];
  return all.map(migrateProjectSchema).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_PROJECTS, 'readwrite');
  await txRequest(tx.objectStore(STORE_PROJECTS).delete(id));
}

export async function saveCustomTemplate(template: TemplateDefinition): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
  await txRequest(tx.objectStore(STORE_TEMPLATES).put(template));
}

export async function listCustomTemplates(): Promise<TemplateDefinition[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_TEMPLATES, 'readonly');
  const all = (await txRequest(tx.objectStore(STORE_TEMPLATES).getAll())) as TemplateDefinition[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteCustomTemplate(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_TEMPLATES, 'readwrite');
  await txRequest(tx.objectStore(STORE_TEMPLATES).delete(id));
}

export async function saveOutputItem(output: FinalOutputItem): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_OUTPUTS, 'readwrite');
  await txRequest(tx.objectStore(STORE_OUTPUTS).put(output));
}

export async function listOutputs(): Promise<FinalOutputItem[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_OUTPUTS, 'readonly');
  const all = (await txRequest(tx.objectStore(STORE_OUTPUTS).getAll())) as FinalOutputItem[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getOutputItem(id: string): Promise<FinalOutputItem | null> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_OUTPUTS, 'readonly');
  const raw = (await txRequest(tx.objectStore(STORE_OUTPUTS).get(id))) as FinalOutputItem | undefined;
  return raw ?? null;
}

export async function deleteOutputItem(id: string): Promise<void> {
  const existing = await getOutputItem(id);
  if (existing) {
    await deleteMediaBlob(existing.storageKey, existing.storageBackend);
  }
  const db = await openDatabase();
  const tx = db.transaction(STORE_OUTPUTS, 'readwrite');
  await txRequest(tx.objectStore(STORE_OUTPUTS).delete(id));
}

export async function saveRenderJob(job: RenderJob): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_JOBS, 'readwrite');
  await txRequest(tx.objectStore(STORE_JOBS).put(job));
}

export async function listRenderJobs(): Promise<RenderJob[]> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_JOBS, 'readonly');
  const all = (await txRequest(tx.objectStore(STORE_JOBS).getAll())) as RenderJob[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_SETTINGS, 'readwrite');
  await txRequest(tx.objectStore(STORE_SETTINGS).put({ key: 'app_settings', value: settings }));
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_SETTINGS, 'readonly');
    const record = (await txRequest(tx.objectStore(STORE_SETTINGS).get('app_settings'))) as
      | { key: string; value: Partial<AppSettings> }
      | undefined;
    const saved = record?.value ?? {};
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      inputPreferences: {
        ...DEFAULT_SETTINGS.inputPreferences,
        ...(saved.inputPreferences ?? {}),
      },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSetupConfig(config: SetupConfig): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_SETUP, 'readwrite');
  await txRequest(tx.objectStore(STORE_SETUP).put({ key: 'setup_config', value: config }));
}

export async function loadSetupConfig(): Promise<SetupConfig> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_SETUP, 'readonly');
    const record = (await txRequest(tx.objectStore(STORE_SETUP).get('setup_config'))) as
      | { key: string; value: Partial<SetupConfig> }
      | undefined;
    const saved = record?.value ?? {};
    return {
      ...DEFAULT_SETUP_CONFIG,
      ...saved,
      installedManifest: Array.isArray(saved.installedManifest) ? saved.installedManifest : [],
    };
  } catch {
    return DEFAULT_SETUP_CONFIG;
  }
}

export async function saveUserFontRecord(font: UserFontRecord): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_FONTS, 'readwrite');
  await txRequest(tx.objectStore(STORE_FONTS).put(font));
}

export async function listUserFontRecords(): Promise<UserFontRecord[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_FONTS, 'readonly');
    const all = (await txRequest(tx.objectStore(STORE_FONTS).getAll())) as UserFontRecord[];
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

export async function deleteUserFontRecord(id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_FONTS, 'readwrite');
  await txRequest(tx.objectStore(STORE_FONTS).delete(id));
}

export async function saveAnalysisBundle(bundle: SourceAnalysisBundle): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_ANALYSES, 'readwrite');
  await txRequest(tx.objectStore(STORE_ANALYSES).put(bundle));
}

export async function getAnalysisBundle(cacheKey: string): Promise<SourceAnalysisBundle | null> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_ANALYSES, 'readonly');
  const raw = (await txRequest(tx.objectStore(STORE_ANALYSES).get(cacheKey))) as
    | SourceAnalysisBundle
    | undefined;
  return raw ?? null;
}

export async function findAnalysisByMediaId(mediaId: string): Promise<SourceAnalysisBundle | null> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_ANALYSES, 'readonly');
  const all = (await txRequest(tx.objectStore(STORE_ANALYSES).getAll())) as SourceAnalysisBundle[];
  return all.find((a) => a.mediaId === mediaId) ?? null;
}

export interface CachedModelRecord {
  modelId: string;
  downloadedAt: number;
  sizeBytes: number;
  backendUsed: string;
  verified: boolean;
}

export async function saveCachedModelRecord(rec: CachedModelRecord): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_MODELS, 'readwrite');
  await txRequest(tx.objectStore(STORE_MODELS).put(rec));
}

export async function listCachedModelRecords(): Promise<CachedModelRecord[]> {
  try {
    const db = await openDatabase();
    const tx = db.transaction(STORE_MODELS, 'readonly');
    return (await txRequest(tx.objectStore(STORE_MODELS).getAll())) as CachedModelRecord[];
  } catch {
    return [];
  }
}

export async function deleteCachedModelRecord(modelId: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction(STORE_MODELS, 'readwrite');
  await txRequest(tx.objectStore(STORE_MODELS).delete(modelId));
}

export interface StorageAuditReport {
  removedLegacyTemplates: number;
  removedConfirmedSamples: number;
  ambiguousEmptyProjects: CutFlowProject[];
}

/**
 * Conservative startup data hygiene:
 * - Removes only confirmed legacy placeholder templates or explicitly marked sample IDs.
 * - Preserves all real user projects, imported media, and custom templates.
 * - Flags unpopulated auto-created empty projects separately for user inspection without deleting them.
 */
export async function auditAndCleanSampleRecords(): Promise<StorageAuditReport> {
  const report: StorageAuditReport = {
    removedLegacyTemplates: 0,
    removedConfirmedSamples: 0,
    ambiguousEmptyProjects: [],
  };

  try {
    const customTemplates = await listCustomTemplates();
    for (const tpl of customTemplates) {
      if (LEGACY_PLACEHOLDER_TEMPLATE_IDS.has(tpl.id) || tpl.previewImage?.includes('/src/assets/images/tpl_')) {
        await deleteCustomTemplate(tpl.id);
        report.removedLegacyTemplates += 1;
      }
    }

    const projects = await listProjects();
    for (const proj of projects) {
      if (CONFIRMED_SAMPLE_PROJECT_IDS.has(proj.id)) {
        await deleteProject(proj.id);
        report.removedConfirmedSamples += 1;
      } else if (
        proj.media.length === 0 &&
        proj.clips.length === 0 &&
        proj.textLayers.length === 0 &&
        proj.overlayLayers.length === 0
      ) {
        report.ambiguousEmptyProjects.push(proj);
      }
    }
  } catch {
    // Never break app startup on hygiene check
  }

  return report;
}

export interface StorageUsageReport {
  usageBytes: number;
  quotaBytes: number;
  projectCount: number;
  outputCount: number;
  opfsAvailable: boolean;
}

export async function getStorageUsageReport(): Promise<StorageUsageReport> {
  let usageBytes = 0;
  let quotaBytes = 0;
  if (navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const est = await navigator.storage.estimate();
      usageBytes = est.usage ?? 0;
      quotaBytes = est.quota ?? 0;
    } catch {
      // ignore
    }
  }
  const [projects, outputs, opfsDir] = await Promise.all([
    listProjects().catch(() => []),
    listOutputs().catch(() => []),
    getOpfsRootDir(),
  ]);

  return {
    usageBytes,
    quotaBytes,
    projectCount: projects.length,
    outputCount: outputs.length,
    opfsAvailable: Boolean(opfsDir),
  };
}

export async function clearTemporaryCache(): Promise<{ removedBlobs: number }> {
  const [projects, outputs] = await Promise.all([listProjects(), listOutputs()]);
  const activeKeys = new Set<string>();

  for (const p of projects) {
    for (const m of p.media) {
      activeKeys.add(m.storageKey);
    }
  }
  for (const o of outputs) {
    activeKeys.add(o.storageKey);
    for (const m of o.editableProjectSnapshot?.media ?? []) {
      activeKeys.add(m.storageKey);
    }
  }

  let removedBlobs = 0;

  const opfsDir = await getOpfsRootDir();
  if (opfsDir) {
    try {
      const entries = (opfsDir as unknown as { keys?: () => AsyncIterable<string> }).keys?.();
      if (entries) {
        for await (const key of entries) {
          if (!activeKeys.has(key)) {
            await opfsDir.removeEntry(key);
            removedBlobs += 1;
          }
        }
      }
    } catch {
      // ignore iteration unsupported
    }
  }

  const db = await openDatabase();
  const blobTx = db.transaction(STORE_BLOBS, 'readwrite');
  const blobKeys = (await txRequest(blobTx.objectStore(STORE_BLOBS).getAllKeys())) as string[];
  for (const key of blobKeys) {
    if (!activeKeys.has(key)) {
      await txRequest(blobTx.objectStore(STORE_BLOBS).delete(key));
      removedBlobs += 1;
    }
  }

  const jobsTx = db.transaction(STORE_JOBS, 'readwrite');
  const jobs = (await txRequest(jobsTx.objectStore(STORE_JOBS).getAll())) as RenderJob[];
  for (const j of jobs) {
    if (j.status === 'completed' || j.status === 'cancelled' || j.status === 'failed') {
      await txRequest(jobsTx.objectStore(STORE_JOBS).delete(j.id));
    }
  }

  return { removedBlobs };
}
