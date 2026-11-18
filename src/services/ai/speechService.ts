import {
  CustomVocabEntry,
  MediaAssetRef,
  PerformanceMode,
  RomanizationStyle,
  TranscriptSegment,
} from '../../types/project';
import { buildWordTokensForSegment, processTextToRomanHinglish } from '../../utils/hinglish';
import { createId } from '../../utils/timelineMath';
import { detectBrowserCapabilities } from '../capabilities';
import { loadMediaBlob } from '../storage';
import { getCachedBinaryAssetBuffer, isModelReady } from './modelManager';
import { getModelDefinition } from './modelRegistry';
import { resourceGovernor } from './resourceGovernor';
import type { WhisperWorkerMessage } from './whisperWorker';

export class ModelNotDownloadedError extends Error {
  modelId: string;
  constructor(modelId: string, modelName: string) {
    super(
      `${modelName} is not downloaded yet. Please download it in Settings or Setup before transcribing.`
    );
    this.name = 'ModelNotDownloadedError';
    this.modelId = modelId;
  }
}

export interface SpeechChunkWindow {
  index: number;
  startSec: number;
  endSec: number;
  audio: Float32Array;
  vadSource: 'silero-vad-onnx' | 'acoustic-energy-rms';
}

export async function extractMono16kAudio(blob: Blob): Promise<{
  pcm: Float32Array;
  sampleRate: number;
  durationSec: number;
}> {
  if (typeof AudioContext === 'undefined' || typeof OfflineAudioContext === 'undefined') {
    throw new Error('Web Audio API is unavailable in this browser for local speech extraction.');
  }
  const buffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(buffer.slice(0));
  } catch {
    await decodeCtx.close().catch(() => {});
    throw new Error('Selected media contains no decodable audio track for speech recognition.');
  }
  await decodeCtx.close().catch(() => {});

  const targetRate = 16000;
  const totalSamples = Math.max(1, Math.ceil(decoded.duration * targetRate));
  const offline = new OfflineAudioContext(1, totalSamples, targetRate);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const rendered = await offline.startRendering();

  return {
    pcm: rendered.getChannelData(0),
    sampleRate: targetRate,
    durationSec: decoded.duration,
  };
}

/**
 * Deterministic RMS Voice Activity Detection + speech-aware 15-25s chunking with 0.6s overlap.
 */
export function buildSpeechAwareChunks(
  pcm: Float32Array,
  sampleRate = 16000,
  targetChunkSec = 20
): SpeechChunkWindow[] {
  const totalDuration = pcm.length / sampleRate;
  if (totalDuration <= 0.15) return [];

  const frameSamples = Math.floor(sampleRate * 0.05);
  const energies: number[] = [];
  for (let i = 0; i < pcm.length; i += frameSamples) {
    let sumSq = 0;
    const end = Math.min(pcm.length, i + frameSamples);
    for (let j = i; j < end; j++) {
      sumSq += pcm[j] * pcm[j];
    }
    energies.push(Math.sqrt(sumSq / Math.max(1, end - i)));
  }

  const sorted = [...energies].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.25)] ?? 0.002;
  const threshold = Math.max(0.004, noiseFloor * 2.4);

  const rawRegions: Array<{ startSec: number; endSec: number }> = [];
  let inSpeech = false;
  let regionStart = 0;
  for (let i = 0; i < energies.length; i++) {
    const t = i * 0.05;
    if (energies[i] >= threshold) {
      if (!inSpeech) {
        inSpeech = true;
        regionStart = Math.max(0, t - 0.15);
      }
    } else if (inSpeech) {
      rawRegions.push({ startSec: regionStart, endSec: Math.min(totalDuration, t + 0.15) });
      inSpeech = false;
    }
  }
  if (inSpeech) {
    rawRegions.push({ startSec: regionStart, endSec: totalDuration });
  }

  return splitRegionsIntoOverlappingChunks(
    rawRegions.length > 0 ? rawRegions : [{ startSec: 0, endSec: totalDuration }],
    pcm,
    sampleRate,
    targetChunkSec,
    'acoustic-energy-rms'
  );
}

/**
 * Neural Silero VAD v5 inference using onnxruntime-web on cached `onnx-community/silero-vad`.
 * Falls back cleanly and transparently to acoustic RMS VAD if Silero is not downloaded or fails.
 */
export async function buildSileroVadChunksIfReady(
  pcm: Float32Array,
  sampleRate = 16000,
  targetChunkSec = 20
): Promise<{ chunks: SpeechChunkWindow[]; vadEngineUsed: 'silero-vad-onnx' | 'acoustic-energy-rms' }> {
  const sileroDef = getModelDefinition('silero-vad-onnx');
  const sileroReady = await isModelReady('silero-vad-onnx');
  if (!sileroReady || !sileroDef?.assetUrl) {
    return {
      chunks: buildSpeechAwareChunks(pcm, sampleRate, targetChunkSec),
      vadEngineUsed: 'acoustic-energy-rms',
    };
  }

  const modelBytes = await getCachedBinaryAssetBuffer(sileroDef.assetUrl);
  if (!modelBytes) {
    return {
      chunks: buildSpeechAwareChunks(pcm, sampleRate, targetChunkSec),
      vadEngineUsed: 'acoustic-energy-rms',
    };
  }

  type SileroVadSession = {
    run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Float32Array }>>;
    release?: () => Promise<void>;
  };
  let session: SileroVadSession | null = null;

  try {
    const ort = await import('onnxruntime-web');
    const createdSession = (await ort.InferenceSession.create(modelBytes, {
      executionProviders: ['wasm'],
    })) as unknown as SileroVadSession;
    session = createdSession;

    const frameSize = 512; // 32 ms at 16 kHz
    let stateData = new Float32Array(2 * 1 * 128);
    const srTensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(sampleRate)]), [1]);

    const probs: number[] = [];
    for (let offset = 0; offset + frameSize <= pcm.length; offset += frameSize) {
      const slice = pcm.subarray(offset, offset + frameSize);
      const inputTensor = new ort.Tensor('float32', slice, [1, frameSize]);
      const stateTensor = new ort.Tensor('float32', stateData, [2, 1, 128]);
      const out = await createdSession.run({
        input: inputTensor,
        state: stateTensor,
        sr: srTensor,
      });
      const prob = out.output?.data?.[0] ?? 0;
      probs.push(prob);
      if (out.stateN?.data) {
        stateData = new Float32Array(out.stateN.data);
      }
    }

    const totalDuration = pcm.length / sampleRate;
    const frameDur = frameSize / sampleRate;
    const rawRegions: Array<{ startSec: number; endSec: number }> = [];
    let active = false;
    let start = 0;

    for (let i = 0; i < probs.length; i++) {
      const t = i * frameDur;
      if (probs[i] >= 0.45) {
        if (!active) {
          active = true;
          start = Math.max(0, t - 0.15);
        }
      } else if (active) {
        rawRegions.push({ startSec: start, endSec: Math.min(totalDuration, t + 0.15) });
        active = false;
      }
    }
    if (active) {
      rawRegions.push({ startSec: start, endSec: totalDuration });
    }

    const chunks = splitRegionsIntoOverlappingChunks(
      rawRegions.length > 0 ? rawRegions : [{ startSec: 0, endSec: totalDuration }],
      pcm,
      sampleRate,
      targetChunkSec,
      'silero-vad-onnx'
    );
    return { chunks, vadEngineUsed: 'silero-vad-onnx' };
  } catch {
    return {
      chunks: buildSpeechAwareChunks(pcm, sampleRate, targetChunkSec),
      vadEngineUsed: 'acoustic-energy-rms',
    };
  } finally {
    const activeSession = session as SileroVadSession | null;
    await activeSession?.release?.().catch(() => {});
  }
}

function splitRegionsIntoOverlappingChunks(
  regions: Array<{ startSec: number; endSec: number }>,
  pcm: Float32Array,
  sampleRate: number,
  targetChunkSec: number,
  vadSource: 'silero-vad-onnx' | 'acoustic-energy-rms'
): SpeechChunkWindow[] {
  const merged: Array<{ startSec: number; endSec: number }> = [];
  for (const r of regions) {
    const prev = merged[merged.length - 1];
    if (prev && r.startSec - prev.endSec < 0.7 && r.endSec - prev.startSec <= targetChunkSec) {
      prev.endSec = r.endSec;
    } else {
      merged.push({ ...r });
    }
  }

  const windows: SpeechChunkWindow[] = [];
  let index = 0;
  const overlap = 0.6;
  for (const reg of merged) {
    let cursor = reg.startSec;
    while (cursor < reg.endSec - 0.1) {
      const end = Math.min(reg.endSec, cursor + targetChunkSec);
      const s0 = Math.max(0, Math.floor(cursor * sampleRate));
      const s1 = Math.min(pcm.length, Math.ceil(end * sampleRate));
      if (s1 - s0 > sampleRate * 0.2) {
        windows.push({
          index: index++,
          startSec: Number(cursor.toFixed(3)),
          endSec: Number(end.toFixed(3)),
          audio: pcm.slice(s0, s1),
          vadSource,
        });
      }
      if (end >= reg.endSec) break;
      cursor = Math.max(cursor + 1, end - overlap);
    }
  }

  return windows;
}

function splitRawIntoPhraseSegments(params: {
  chunkStartSec: number;
  chunkEndSec: number;
  rawText: string;
  wordChunks: Array<{ text: string; timestamp: [number, number | null] }>;
  style: RomanizationStyle;
  vocab: CustomVocabEntry[];
}): TranscriptSegment[] {
  const { chunkStartSec, chunkEndSec, rawText, wordChunks, style, vocab } = params;
  const cleanRaw = rawText.trim();
  if (!cleanRaw) return [];

  if (wordChunks.length > 0) {
    const segments: TranscriptSegment[] = [];
    let buffer: typeof wordChunks = [];

    const flush = () => {
      if (buffer.length === 0) return;
      const rawJoined = buffer.map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
      const s0 = buffer[0].timestamp[0] ?? chunkStartSec;
      const last = buffer[buffer.length - 1];
      const s1 = last.timestamp[1] ?? Math.min(chunkEndSec, (last.timestamp[0] ?? s0) + 0.4);
      const segId = createId('seg');
      const conv = processTextToRomanHinglish(rawJoined, style, vocab);
      segments.push({
        id: segId,
        startSec: Number(Math.max(0, s0).toFixed(3)),
        endSec: Number(Math.max(s0 + 0.3, s1).toFixed(3)),
        text: conv.text,
        rawText: rawJoined,
        language: conv.language,
        script: conv.script,
        userEdited: false,
        uncertain: conv.uncertain,
        words: buildWordTokensForSegment({
          segmentId: segId,
          text: conv.text,
          startSec: s0,
          endSec: Math.max(s0 + 0.3, s1),
          modelWordChunks: buffer,
          style,
          customVocabulary: vocab,
        }),
      });
      buffer = [];
    };

    for (const wc of wordChunks) {
      buffer.push(wc);
      const endsPunct = /[.!?।]$/.test(wc.text.trim());
      if (buffer.length >= 6 || (buffer.length >= 3 && endsPunct)) {
        flush();
      }
    }
    flush();
    if (segments.length > 0) return segments;
  }

  const rawPhrases = cleanRaw
    .split(/(?<=[.!?।])\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const parts = rawPhrases.length > 0 ? rawPhrases : [cleanRaw];
  const span = Math.max(0.4, chunkEndSec - chunkStartSec);
  const totalLen = parts.reduce((acc, p) => acc + p.length, 0) || 1;
  let cursor = chunkStartSec;

  return parts.map((raw) => {
    const dur = Math.max(0.4, (raw.length / totalLen) * span);
    const s0 = cursor;
    const s1 = Math.min(chunkEndSec, s0 + dur);
    cursor = s1;
    const segId = createId('seg');
    const conv = processTextToRomanHinglish(raw, style, vocab);
    return {
      id: segId,
      startSec: Number(s0.toFixed(3)),
      endSec: Number(s1.toFixed(3)),
      text: conv.text,
      rawText: raw,
      language: conv.language,
      script: conv.script,
      userEdited: false,
      uncertain: conv.uncertain,
      words: buildWordTokensForSegment({
        segmentId: segId,
        text: conv.text,
        startSec: s0,
        endSec: s1,
        style,
        customVocabulary: vocab,
      }),
    };
  });
}

export async function transcribeMediaAssetLocally(params: {
  asset: MediaAssetRef;
  modelId: string;
  romanizationStyle: RomanizationStyle;
  customVocabulary: CustomVocabEntry[];
  performanceMode: PerformanceMode;
  signal?: AbortSignal;
  onProgress?: (progress: number, stage: string) => void;
}): Promise<{
  segments: TranscriptSegment[];
  backendUsed: string;
  vadEngineUsed: 'silero-vad-onnx' | 'acoustic-energy-rms';
  vadWindowsCount: number;
}> {
  const {
    asset,
    modelId,
    romanizationStyle,
    customVocabulary,
    performanceMode,
    signal,
    onProgress,
  } = params;

  const modelDef = getModelDefinition(modelId);
  if (!modelDef || !modelDef.hfRepo) {
    throw new Error(`Invalid ASR model id: ${modelId}`);
  }

  const ready = await isModelReady(modelId);
  if (!ready) {
    throw new ModelNotDownloadedError(modelId, modelDef.name);
  }

  return resourceGovernor.runExclusiveTask({
    name: `Speech Recognition (${modelDef.name})`,
    kind: 'asr',
    backend: modelDef.id,
    signal,
    fn: async (abortSignal) => {
      onProgress?.(0.04, 'Loading local media blob');
      const blob = await loadMediaBlob(asset.storageKey, asset.storageBackend);
      if (!blob) {
        throw new Error('Source media file could not be loaded from local storage.');
      }

      onProgress?.(0.09, 'Extracting 16kHz mono audio & running local VAD');
      const { pcm } = await extractMono16kAudio(blob);
      const budget = resourceGovernor.getProfileBudget(performanceMode);
      const { chunks, vadEngineUsed } = await buildSileroVadChunksIfReady(
        pcm,
        16000,
        budget.whisperChunkSec
      );
      if (chunks.length === 0) {
        return {
          segments: [],
          backendUsed: 'VAD (no speech)',
          vadEngineUsed,
          vadWindowsCount: 0,
        };
      }

      const caps = await detectBrowserCapabilities();
      const preferWebGpu = caps.webGPU && performanceMode !== 'low-memory';

      onProgress?.(0.16, `Starting ${modelDef.name} worker (${vadEngineUsed})`);

      const worker = new Worker(new URL('./whisperWorker.ts', import.meta.url), {
        type: 'module',
      });

      const allSegments: TranscriptSegment[] = [];
      let usedBackend = preferWebGpu ? 'webgpu' : 'wasm';

      try {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            worker.terminate();
            reject(new Error('Transcription cancelled by user.'));
          };
          abortSignal.addEventListener('abort', onAbort, { once: true });

          worker.onmessage = (ev: MessageEvent<WhisperWorkerMessage>) => {
            const msg = ev.data;
            if (msg.type === 'progress') {
              usedBackend = msg.backend;
              onProgress?.(0.16 + msg.progress * 0.8, msg.stage);
            } else if (msg.type === 'chunk-result') {
              const segs = splitRawIntoPhraseSegments({
                chunkStartSec: msg.startSec,
                chunkEndSec: msg.endSec,
                rawText: msg.text,
                wordChunks: msg.wordChunks,
                style: romanizationStyle,
                vocab: customVocabulary,
              });
              allSegments.push(...segs);
            } else if (msg.type === 'complete') {
              usedBackend = msg.backend;
              abortSignal.removeEventListener('abort', onAbort);
              resolve();
            } else if (msg.type === 'error') {
              abortSignal.removeEventListener('abort', onAbort);
              reject(new Error(msg.message));
            }
          };

          worker.onerror = (err) => {
            abortSignal.removeEventListener('abort', onAbort);
            reject(new Error(err.message || 'Whisper worker crashed.'));
          };

          worker.postMessage({
            type: 'transcribe',
            hfRepo: modelDef.hfRepo,
            dtype: modelDef.preferredDtype ?? 'q8',
            preferWebGpu,
            chunks,
          });
        });
      } finally {
        worker.terminate();
      }

      allSegments.sort((a, b) => a.startSec - b.startSec);
      const deduped: TranscriptSegment[] = [];
      for (const seg of allSegments) {
        const prev = deduped[deduped.length - 1];
        if (
          prev &&
          seg.startSec < prev.endSec - 0.15 &&
          seg.text.toLowerCase() === prev.text.toLowerCase()
        ) {
          continue;
        }
        if (prev && seg.startSec < prev.endSec) {
          seg.startSec = Number(prev.endSec.toFixed(3));
          seg.endSec = Number(Math.max(seg.startSec + 0.25, seg.endSec).toFixed(3));
        }
        deduped.push(seg);
      }

      onProgress?.(1, `Transcribed ${deduped.length} segments`);
      return {
        segments: deduped,
        backendUsed: usedBackend,
        vadEngineUsed,
        vadWindowsCount: chunks.length,
      };
    },
  });
}

export function reRomanizeTranscriptSegments(
  segments: TranscriptSegment[],
  style: RomanizationStyle,
  customVocabulary: CustomVocabEntry[]
): TranscriptSegment[] {
  return segments.map((seg) => {
    const sourceRaw = seg.userEdited ? seg.text : seg.rawText || seg.text;
    const conv = processTextToRomanHinglish(sourceRaw, style, customVocabulary);
    return {
      ...seg,
      text: conv.text,
      language: conv.language,
      script: conv.script,
      uncertain: conv.uncertain,
      words: buildWordTokensForSegment({
        segmentId: seg.id,
        text: conv.text,
        startSec: seg.startSec,
        endSec: seg.endSec,
        style,
        customVocabulary,
      }),
    };
  });
}
