import {
  CachedModelRecord,
  deleteCachedModelRecord,
  listCachedModelRecords,
  saveCachedModelRecord,
} from '../storage';
import { detectBrowserCapabilities } from '../capabilities';
import { AI_MODEL_CATALOG, AIModelDefinition, getModelDefinition } from './modelRegistry';

export type ModelInstallState = 'built-in' | 'not-downloaded' | 'downloading' | 'ready' | 'error';

export interface ModelStatusEntry {
  definition: AIModelDefinition;
  state: ModelInstallState;
  progress: number; // 0..1
  downloadedBytes?: number;
  totalBytes?: number;
  downloadedAt?: number;
  sizeBytes?: number;
  backendUsed?: string;
  error?: string;
}

const CUTFLOW_MODEL_CACHE = 'cutflow-ai-models-v1';
const activeDownloads = new Map<
  string,
  { progress: number; message: string; downloadedBytes?: number; totalBytes?: number }
>();
const downloadErrors = new Map<string, string>();
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const fn of listeners) fn();
}

export function subscribeModelManager(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function getAllModelStatuses(): Promise<ModelStatusEntry[]> {
  const records = await listCachedModelRecords();
  const byId = new Map<string, CachedModelRecord>(records.map((r) => [r.modelId, r]));

  return AI_MODEL_CATALOG.map((def) => {
    if (def.builtIn) {
      return {
        definition: def,
        state: 'built-in',
        progress: 1,
        sizeBytes: 0,
        backendUsed: 'WebAudio DSP',
      };
    }

    const active = activeDownloads.get(def.id);
    if (active) {
      return {
        definition: def,
        state: 'downloading',
        progress: active.progress,
        downloadedBytes: active.downloadedBytes,
        totalBytes: active.totalBytes,
      };
    }

    const err = downloadErrors.get(def.id);
    const rec = byId.get(def.id);
    if (rec?.verified) {
      return {
        definition: def,
        state: 'ready',
        progress: 1,
        downloadedAt: rec.downloadedAt,
        sizeBytes: rec.sizeBytes,
        backendUsed: rec.backendUsed,
      };
    }

    if (err) {
      return {
        definition: def,
        state: 'error',
        progress: 0,
        error: err,
      };
    }

    return {
      definition: def,
      state: 'not-downloaded',
      progress: 0,
    };
  });
}

export async function isModelReady(modelId: string): Promise<boolean> {
  const def = getModelDefinition(modelId);
  if (!def) return false;
  if (def.builtIn) return true;
  const records = await listCachedModelRecords();
  return Boolean(records.find((r) => r.modelId === modelId && r.verified));
}

async function checkQuotaBeforeDownload(requiredBytes: number): Promise<void> {
  if (navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const est = await navigator.storage.estimate();
      const remaining = (est.quota ?? Infinity) - (est.usage ?? 0);
      if (Number.isFinite(remaining) && remaining < requiredBytes * 1.15) {
        throw new Error(
          `Insufficient local storage quota (~${Math.round(remaining / (1024 * 1024))} MB free, need ~${Math.round(requiredBytes / (1024 * 1024))} MB).`
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Insufficient')) throw err;
    }
  }
}

async function streamFetchAndCacheBinary(params: {
  url: string;
  modelId: string;
  label: string;
  expectedBytes: number;
  minBytes: number;
  signal?: AbortSignal;
  onProgress?: (progress: number, stage: string, loadedBytes?: number, totalBytes?: number) => void;
}): Promise<number> {
  const { url, modelId, label, expectedBytes, minBytes, signal, onProgress } = params;

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`${label} download failed (HTTP ${res.status}). Check network connectivity.`);
  }

  const headerLen = Number(res.headers.get('content-length') || 0);
  const total = headerLen > 0 ? headerLen : expectedBytes;
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  if (reader) {
    while (true) {
      if (signal?.aborted) throw new Error('Download cancelled.');
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        const p = Math.min(0.96, received / Math.max(1, total));
        activeDownloads.set(modelId, {
          progress: p,
          message: `Downloading ${label}`,
          downloadedBytes: received,
          totalBytes: total,
        });
        onProgress?.(p, `Downloading ${label}`, received, total);
        notifyListeners();
      }
    }
  } else {
    const buf = new Uint8Array(await res.arrayBuffer());
    chunks.push(buf);
    received = buf.byteLength;
  }

  if (received < minBytes) {
    throw new Error(`Downloaded ${label} binary (${received} B) failed integrity size check.`);
  }

  const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
  if (typeof caches !== 'undefined') {
    const cache = await caches.open(CUTFLOW_MODEL_CACHE);
    await cache.put(url, new Response(blob, { status: 200 }));
  }
  return received;
}

export async function downloadModelExplicitly(
  modelId: string,
  onProgress?: (progress: number, stage: string, loadedBytes?: number, totalBytes?: number) => void,
  signal?: AbortSignal
): Promise<{ provider: string; verifiedBytes: number }> {
  const def = getModelDefinition(modelId);
  if (!def) throw new Error(`Unknown model id: ${modelId}`);
  if (def.builtIn) return { provider: 'WebAudio DSP', verifiedBytes: 0 };
  if (activeDownloads.has(modelId)) {
    throw new Error(`${def.name} is already downloading.`);
  }

  downloadErrors.delete(modelId);
  activeDownloads.set(modelId, { progress: 0.02, message: 'Checking local storage quota' });
  notifyListeners();

  try {
    await checkQuotaBeforeDownload(def.sizeBytes);

    if (def.kind === 'asr' && def.hfRepo) {
      onProgress?.(0.04, `Preparing ${def.hfRepo}`, 0, def.sizeBytes);
      const { env, pipeline } = await import('@huggingface/transformers');
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      const caps = await detectBrowserCapabilities();
      const useWebGpu = caps.webGPU && def.id !== 'whisper-base-multi';
      let chosenProvider = useWebGpu ? 'webgpu' : 'wasm';
      const fileProgress = new Map<string, { loaded: number; total: number }>();

      const buildPipeline = async (device: 'webgpu' | 'wasm') => {
        return await pipeline('automatic-speech-recognition', def.hfRepo!, {
          dtype: (def.preferredDtype ?? 'q8') as never,
          device,
          progress_callback: (info: {
            status?: string;
            progress?: number;
            loaded?: number;
            total?: number;
            file?: string;
          }) => {
            if (info.file && typeof info.loaded === 'number' && typeof info.total === 'number') {
              fileProgress.set(info.file, { loaded: info.loaded, total: info.total });
            }
            let sumLoaded = 0;
            let sumTotal = 0;
            for (const fp of fileProgress.values()) {
              sumLoaded += fp.loaded;
              sumTotal += fp.total;
            }
            const ratio =
              sumTotal > 0
                ? Math.min(0.95, sumLoaded / sumTotal)
                : typeof info.progress === 'number'
                  ? Math.min(0.95, info.progress / 100)
                  : 0.1;

            activeDownloads.set(modelId, {
              progress: ratio,
              message: info.file ? `Downloading ${info.file}` : 'Caching Whisper ONNX weights',
              downloadedBytes: sumLoaded || undefined,
              totalBytes: sumTotal || def.sizeBytes,
            });
            onProgress?.(
              ratio,
              info.file ? `Downloading ${info.file}` : 'Caching Whisper ONNX weights',
              sumLoaded || undefined,
              sumTotal || def.sizeBytes
            );
            notifyListeners();
          },
        });
      };

      let asrPipe: unknown;
      try {
        asrPipe = await buildPipeline(chosenProvider as 'webgpu' | 'wasm');
      } catch (err) {
        if (chosenProvider === 'webgpu') {
          chosenProvider = 'wasm';
          onProgress?.(0.08, 'WebGPU init fallback -> WASM SIMD', 0, def.sizeBytes);
          asrPipe = await buildPipeline('wasm');
        } else {
          throw err;
        }
      }

      // Immediately release pipeline runtime memory after caching & verifying load
      if (typeof (asrPipe as { dispose?: () => Promise<void> }).dispose === 'function') {
        await (asrPipe as { dispose: () => Promise<void> }).dispose();
      }

      let measuredBytes = 0;
      for (const fp of fileProgress.values()) measuredBytes = Math.max(measuredBytes, fp.loaded);
      const finalSize = measuredBytes > 0 ? measuredBytes : def.sizeBytes;
      const providerLabel =
        chosenProvider === 'webgpu' ? 'ONNX Runtime (WebGPU)' : 'ONNX Runtime (WASM SIMD)';

      await saveCachedModelRecord({
        modelId,
        downloadedAt: Date.now(),
        sizeBytes: finalSize,
        backendUsed: providerLabel,
        verified: true,
      });

      onProgress?.(1, 'Verified & cached offline', finalSize, finalSize);
      return { provider: providerLabel, verifiedBytes: finalSize };
    }

    if (
      (def.kind === 'vad' || def.kind.startsWith('vision-')) &&
      def.assetUrl
    ) {
      onProgress?.(0.06, `Fetching ${def.name}`, 0, def.sizeBytes);
      const received = await streamFetchAndCacheBinary({
        url: def.assetUrl,
        modelId,
        label: def.name,
        expectedBytes: def.sizeBytes,
        minBytes: def.kind === 'vision-segmenter' ? 50_000 : 100_000,
        signal,
        onProgress,
      });

      const backendUsed =
        def.kind === 'vad' ? 'ONNX Runtime Web (Silero VAD)' : 'MediaPipe Local WASM';
      await saveCachedModelRecord({
        modelId,
        downloadedAt: Date.now(),
        sizeBytes: received,
        backendUsed,
        verified: true,
      });

      onProgress?.(1, 'Verified & cached offline', received, received);
      return { provider: backendUsed, verifiedBytes: received };
    }

    if (def.kind === 'ocr') {
      onProgress?.(0.12, 'Downloading Tesseract English OCR traineddata', 0, def.sizeBytes);
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('eng', 1, {
        logger: (m: { progress?: number; status?: string }) => {
          if (typeof m.progress === 'number') {
            const p = Math.min(0.95, 0.12 + m.progress * 0.82);
            activeDownloads.set(modelId, {
              progress: p,
              message: m.status ?? 'Caching OCR traineddata',
              downloadedBytes: Math.round(p * def.sizeBytes),
              totalBytes: def.sizeBytes,
            });
            onProgress?.(p, m.status ?? 'Caching OCR traineddata', Math.round(p * def.sizeBytes), def.sizeBytes);
            notifyListeners();
          }
        },
      });
      await worker.terminate();

      await saveCachedModelRecord({
        modelId,
        downloadedAt: Date.now(),
        sizeBytes: def.sizeBytes,
        backendUsed: 'Tesseract.js WASM Worker',
        verified: true,
      });

      onProgress?.(1, 'Verified & cached offline', def.sizeBytes, def.sizeBytes);
      return { provider: 'Tesseract.js WASM Worker', verifiedBytes: def.sizeBytes };
    }

    throw new Error(`No download handler implemented for ${def.name}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Model download failed.';
    downloadErrors.set(modelId, msg);
    throw err;
  } finally {
    activeDownloads.delete(modelId);
    notifyListeners();
  }
}

/**
 * Runs a real 0.4s silent audio test inference against an already-downloaded Whisper ONNX model
 * to confirm runtime initialization works before marking setup verification complete.
 */
export async function verifyAsrRuntimeTestInference(modelId: string): Promise<{
  ok: boolean;
  provider: string;
  durationMs: number;
  error?: string;
}> {
  const def = getModelDefinition(modelId);
  if (!def || !def.hfRepo) {
    return { ok: false, provider: 'none', durationMs: 0, error: 'Unknown ASR model' };
  }
  const t0 = performance.now();
  const caps = await detectBrowserCapabilities();
  const preferGpu = caps.webGPU && def.id !== 'whisper-base-multi';
  let provider = preferGpu ? 'webgpu' : 'wasm';

  try {
    const { env, pipeline } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    env.useBrowserCache = true;

    let pipe: unknown;
    try {
      pipe = await pipeline('automatic-speech-recognition', def.hfRepo, {
        dtype: (def.preferredDtype ?? 'q8') as never,
        device: provider as 'webgpu' | 'wasm',
      });
    } catch (gpuErr) {
      if (provider === 'webgpu') {
        provider = 'wasm';
        pipe = await pipeline('automatic-speech-recognition', def.hfRepo, {
          dtype: (def.preferredDtype ?? 'q8') as never,
          device: 'wasm',
        });
      } else {
        throw gpuErr;
      }
    }

    const silentPcm = new Float32Array(16000 * 0.5);
    await (pipe as (a: Float32Array) => Promise<unknown>)(silentPcm);
    if (typeof (pipe as { dispose?: () => Promise<void> }).dispose === 'function') {
      await (pipe as { dispose: () => Promise<void> }).dispose();
    }

    return {
      ok: true,
      provider: provider === 'webgpu' ? 'ONNX WebGPU' : 'ONNX WASM SIMD',
      durationMs: Math.round(performance.now() - t0),
    };
  } catch (err) {
    return {
      ok: false,
      provider,
      durationMs: Math.round(performance.now() - t0),
      error: err instanceof Error ? err.message : 'Whisper test inference failed.',
    };
  }
}

export async function getCachedBinaryAssetBuffer(assetUrl: string): Promise<Uint8Array | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await caches.open(CUTFLOW_MODEL_CACHE);
    const match = await cache.match(assetUrl);
    if (!match) return null;
    const buf = await match.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

export const getCachedMediaPipeModelBuffer = getCachedBinaryAssetBuffer;

export async function deleteDownloadedModel(modelId: string): Promise<void> {
  const def = getModelDefinition(modelId);
  await deleteCachedModelRecord(modelId);
  downloadErrors.delete(modelId);

  if (typeof caches !== 'undefined') {
    if (def?.assetUrl) {
      const cache = await caches.open(CUTFLOW_MODEL_CACHE);
      await cache.delete(def.assetUrl);
    }
    if (def?.kind === 'asr' && def.hfRepo) {
      try {
        const cache = await caches.open('transformers-cache');
        const keys = await cache.keys();
        for (const req of keys) {
          if (req.url.includes(def.hfRepo)) {
            await cache.delete(req);
          }
        }
      } catch {
        // ignore if transformers-cache not present
      }
    }
  }
  notifyListeners();
}
