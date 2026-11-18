/// <reference lib="webworker" />
import { env, pipeline } from '@huggingface/transformers';

export interface WhisperWorkerRequest {
  type: 'transcribe';
  hfRepo: string;
  dtype?: string | Record<string, string>;
  preferWebGpu: boolean;
  chunks: Array<{
    index: number;
    startSec: number;
    endSec: number;
    audio: Float32Array;
  }>;
}

export type WhisperWorkerMessage =
  | { type: 'progress'; progress: number; stage: string; backend: string }
  | {
      type: 'chunk-result';
      chunkIndex: number;
      startSec: number;
      endSec: number;
      text: string;
      wordChunks: Array<{ text: string; timestamp: [number, number | null] }>;
    }
  | { type: 'complete'; backend: string }
  | { type: 'error'; message: string };

self.onmessage = async (event: MessageEvent<WhisperWorkerRequest>) => {
  const req = event.data;
  if (req.type !== 'transcribe') return;

  env.allowLocalModels = false;
  env.useBrowserCache = true;

  let backend = req.preferWebGpu ? 'webgpu' : 'wasm';
  let asrPipe: unknown = null;
  const dtypeOption = (req.dtype ?? 'q8') as never;

  const post = (msg: WhisperWorkerMessage) => self.postMessage(msg);

  try {
    post({ type: 'progress', progress: 0.05, stage: `Loading ${req.hfRepo} (${backend})`, backend });

    try {
      asrPipe = await pipeline('automatic-speech-recognition', req.hfRepo, {
        dtype: dtypeOption,
        device: backend === 'webgpu' ? 'webgpu' : 'wasm',
      });
    } catch (gpuErr) {
      if (backend === 'webgpu') {
        backend = 'wasm';
        post({
          type: 'progress',
          progress: 0.08,
          stage: 'WebGPU unavailable, switching to WASM SIMD',
          backend,
        });
        asrPipe = await pipeline('automatic-speech-recognition', req.hfRepo, {
          dtype: dtypeOption,
          device: 'wasm',
        });
      } else {
        throw gpuErr;
      }
    }

    const total = Math.max(1, req.chunks.length);
    const runPipe = asrPipe as (
      audio: Float32Array,
      opts: Record<string, unknown>
    ) => Promise<{
      text?: string;
      chunks?: Array<{ text: string; timestamp: [number, number | null] }>;
    }>;

    for (let i = 0; i < req.chunks.length; i++) {
      const ch = req.chunks[i];
      post({
        type: 'progress',
        progress: 0.1 + (0.85 * i) / total,
        stage: `Transcribing speech window ${i + 1} / ${total}`,
        backend,
      });

      const out = await runPipe(ch.audio, {
        return_timestamps: 'word',
        chunk_length_s: 25,
        stride_length_s: 3,
      });

      const wordChunks = (out.chunks ?? []).map((wc) => ({
        text: wc.text,
        timestamp: [
          ch.startSec + (wc.timestamp[0] ?? 0),
          wc.timestamp[1] != null ? ch.startSec + wc.timestamp[1] : null,
        ] as [number, number | null],
      }));

      post({
        type: 'chunk-result',
        chunkIndex: ch.index,
        startSec: ch.startSec,
        endSec: ch.endSec,
        text: (out.text ?? '').trim(),
        wordChunks,
      });
    }

    post({ type: 'complete', backend });
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : 'Whisper transcription worker failed.',
    });
  } finally {
    try {
      const disposable = asrPipe as { dispose?: () => Promise<void> } | null;
      if (disposable && typeof disposable.dispose === 'function') {
        await disposable.dispose();
      }
    } catch {
      // ignore dispose errors
    }
  }
};
