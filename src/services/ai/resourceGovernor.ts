import { PerformanceMode } from '../../types/project';

export type ResourceTaskKind = 'vad' | 'asr' | 'vision' | 'ocr' | 'template-clone' | 'render';

export interface TaskTimingRecord {
  id: string;
  name: string;
  kind: ResourceTaskKind;
  durationMs: number;
  status: 'completed' | 'failed' | 'cancelled';
  backend: string;
  timestamp: number;
  note?: string;
}

export interface GovernorSnapshot {
  busy: boolean;
  activeTaskName: string | null;
  activeTaskKind: ResourceTaskKind | null;
  queueLength: number;
  recentTimings: TaskTimingRecord[];
}

type Listener = (snapshot: GovernorSnapshot) => void;

class LocalResourceGovernor {
  private queue: Array<() => Promise<void>> = [];
  private running = false;
  private activeTaskName: string | null = null;
  private activeTaskKind: ResourceTaskKind | null = null;
  private activeAbortController: AbortController | null = null;
  private recentTimings: TaskTimingRecord[] = [];
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.getSnapshot());
    return () => {
      this.listeners.delete(fn);
    };
  }

  getSnapshot(): GovernorSnapshot {
    return {
      busy: this.running,
      activeTaskName: this.activeTaskName,
      activeTaskKind: this.activeTaskKind,
      queueLength: this.queue.length,
      recentTimings: [...this.recentTimings],
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const l of this.listeners) l(snap);
  }

  cancelActive(): void {
    if (this.activeAbortController) {
      this.activeAbortController.abort();
    }
  }

  getProfileBudget(mode: PerformanceMode): {
    maxSampleFrames: number;
    analysisWidth: number;
    analysisHeight: number;
    whisperChunkSec: number;
  } {
    if (mode === 'low-memory') {
      return {
        maxSampleFrames: 14,
        analysisWidth: 256,
        analysisHeight: 144,
        whisperChunkSec: 15,
      };
    }
    if (mode === 'quality') {
      return {
        maxSampleFrames: 32,
        analysisWidth: 384,
        analysisHeight: 216,
        whisperChunkSec: 25,
      };
    }
    return {
      maxSampleFrames: 22,
      analysisWidth: 320,
      analysisHeight: 180,
      whisperChunkSec: 20,
    };
  }

  async runExclusiveTask<T>(params: {
    name: string;
    kind: ResourceTaskKind;
    backend?: string;
    signal?: AbortSignal;
    fn: (abortSignal: AbortSignal) => Promise<T>;
  }): Promise<T> {
    const { name, kind, backend = 'local', signal, fn } = params;

    return new Promise<T>((resolve, reject) => {
      const execute = async () => {
        const controller = new AbortController();
        this.activeAbortController = controller;
        this.activeTaskName = name;
        this.activeTaskKind = kind;
        this.emit();

        const onExternalAbort = () => controller.abort();
        signal?.addEventListener('abort', onExternalAbort, { once: true });

        const startedAt = performance.now();
        try {
          if (signal?.aborted) {
            throw new Error('Task cancelled before start.');
          }
          const result = await fn(controller.signal);
          this.recordTiming({
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name,
            kind,
            durationMs: Math.round(performance.now() - startedAt),
            status: 'completed',
            backend,
            timestamp: Date.now(),
          });
          resolve(result);
        } catch (err) {
          const cancelled =
            controller.signal.aborted ||
            (err instanceof Error && err.message.toLowerCase().includes('cancel'));
          this.recordTiming({
            id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name,
            kind,
            durationMs: Math.round(performance.now() - startedAt),
            status: cancelled ? 'cancelled' : 'failed',
            backend,
            timestamp: Date.now(),
            note: err instanceof Error ? err.message : String(err),
          });
          reject(err);
        } finally {
          signal?.removeEventListener('abort', onExternalAbort);
          this.activeAbortController = null;
          this.activeTaskName = null;
          this.activeTaskKind = null;
          this.emit();
        }
      };

      this.queue.push(execute);
      this.emit();
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.emit();

    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        await next();
      }
      // Allow GC breathing room between heavy ML/render tasks
      await new Promise((r) => setTimeout(r, 30));
    }

    this.running = false;
    this.emit();
  }

  private recordTiming(entry: TaskTimingRecord): void {
    this.recentTimings = [entry, ...this.recentTimings].slice(0, 16);
  }
}

export const resourceGovernor = new LocalResourceGovernor();
