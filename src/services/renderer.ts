import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import {
  CutFlowProject,
  ExportSettings,
  FinalOutputItem,
  RenderJob,
} from '../types/project';
import {
  computeClipAudioGain,
  computeProjectDuration,
  createId,
  getDimensionsForAspectRatio,
} from '../utils/timelineMath';
import { detectBrowserCapabilities } from './capabilities';
import { scheduleSoundCuesInOfflineContext } from './soundDesign';
import { ProjectMediaPool, renderProjectFrame } from './compositor';
import { loadMediaBlob, saveMediaBlob, saveOutputItem, saveRenderJob } from './storage';

export interface RenderProgressEvent {
  progress: number;
  stage: string;
  currentFrame: number;
  totalFrames: number;
}

export interface RenderedVideoResult {
  blob: Blob;
  mimeType: string;
  extension: 'mp4' | 'webm';
  posterDataUrl: string;
  durationSec: number;
  width: number;
  height: number;
  fps: 30 | 60;
  encoderPath: 'webcodecs-mp4' | 'mediarecorder-fallback';
}

async function mixProjectAudio(
  project: CutFlowProject,
  durationSec: number,
  sampleRate = 48000
): Promise<AudioBuffer | null> {
  if (typeof OfflineAudioContext === 'undefined' || durationSec <= 0) return null;

  const audioClips = project.clips.filter((c) => {
    if (c.muted || c.volume <= 0) return false;
    const track = project.tracks.find((t) => t.id === c.trackId);
    if (track?.muted) return false;
    return c.kind === 'audio' || c.kind === 'video';
  });

  const soundCues = project.soundCues ?? [];
  if (audioClips.length === 0 && soundCues.length === 0) return null;

  const totalSamples = Math.max(1, Math.ceil(durationSec * sampleRate));
  const offline = new OfflineAudioContext(2, totalSamples, sampleRate);
  let scheduledAny = false;

  for (const clip of audioClips) {
    const asset = project.media.find((m) => m.id === clip.mediaId);
    if (!asset) continue;
    const blob = await loadMediaBlob(asset.storageKey, asset.storageBackend);
    if (!blob) continue;

    try {
      const arrayBuf = await blob.arrayBuffer();
      const decoded = await offline.decodeAudioData(arrayBuf.slice(0));
      const src = offline.createBufferSource();
      src.buffer = decoded;
      src.playbackRate.value = Math.max(0.25, Math.min(4, clip.speed || 1));

      const gainNode = offline.createGain();
      const baseVol = Math.max(0, Math.min(2, clip.volume));
      const start = Math.max(0, clip.startTime);
      const end = Math.min(durationSec, clip.startTime + clip.duration);
      const fadeIn = Math.min(clip.fadeInSec, clip.duration * 0.5);
      const fadeOut = Math.min(clip.fadeOutSec, clip.duration * 0.5);

      if (fadeIn > 0.01) {
        gainNode.gain.setValueAtTime(0, start);
        gainNode.gain.linearRampToValueAtTime(baseVol, start + fadeIn);
      } else {
        gainNode.gain.setValueAtTime(baseVol, start);
      }

      if (fadeOut > 0.01 && end - fadeOut > start + fadeIn) {
        gainNode.gain.setValueAtTime(baseVol, end - fadeOut);
        gainNode.gain.linearRampToValueAtTime(0, end);
      }

      src.connect(gainNode);
      gainNode.connect(offline.destination);
      const sourceDuration = Math.max(0.05, clip.sourceOut - clip.sourceIn);
      src.start(start, clip.sourceIn, sourceDuration);
      scheduledAny = true;
    } catch {
      // Video file may have no audio track or unsupported audio codec; skip safely
    }
  }

  if (soundCues.length > 0 && scheduleSoundCuesInOfflineContext(offline, soundCues, durationSec)) {
    scheduledAny = true;
  }

  if (!scheduledAny) return null;
  return await offline.startRendering();
}

function capturePosterFromCanvas(canvas: HTMLCanvasElement): string {
  const thumbCanvas = document.createElement('canvas');
  const maxW = 360;
  const scale = maxW / Math.max(1, canvas.width);
  thumbCanvas.width = Math.max(1, Math.round(canvas.width * scale));
  thumbCanvas.height = Math.max(1, Math.round(canvas.height * scale));
  const tctx = thumbCanvas.getContext('2d');
  if (tctx) {
    tctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    return thumbCanvas.toDataURL('image/jpeg', 0.78);
  }
  return '';
}

async function renderWithWebCodecs(params: {
  project: CutFlowProject;
  width: number;
  height: number;
  fps: 30 | 60;
  durationSec: number;
  quality: 'high' | 'standard';
  signal?: AbortSignal;
  onProgress?: (ev: RenderProgressEvent) => void;
}): Promise<RenderedVideoResult> {
  const { project, width, height, fps, durationSec, quality, signal, onProgress } = params;
  const caps = await detectBrowserCapabilities();
  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));

  const pool = new ProjectMediaPool();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to acquire 2D rendering context.');

  onProgress?.({ progress: 0.02, stage: 'Preloading project media', currentFrame: 0, totalFrames });
  await pool.preloadProject(project);

  const mixedAudio = caps.webCodecsAudioEncoder
    ? await mixProjectAudio(project, durationSec, 48000).catch(() => null)
    : null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width,
      height,
    },
    audio: mixedAudio
      ? {
          codec: 'aac',
          numberOfChannels: 2,
          sampleRate: 48000,
        }
      : undefined,
    fastStart: 'in-memory',
  });

  let encoderError: Error | null = null;
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  const bitrate = quality === 'high' ? (width >= 1920 || height >= 1920 ? 8_000_000 : 5_000_000) : 3_000_000;
  const avcCodec = width * height > 1280 * 720 ? 'avc1.420028' : 'avc1.42001f';

  videoEncoder.configure({
    codec: avcCodec,
    width,
    height,
    bitrate,
    framerate: fps,
  });

  let audioEncoder: AudioEncoder | null = null;
  if (mixedAudio && caps.webCodecsAudioEncoder) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        muxer.addAudioChunk(chunk, meta);
      },
      error: (err) => {
        encoderError = err instanceof Error ? err : new Error(String(err));
      },
    });
    audioEncoder.configure({
      codec: 'mp4a.40.2',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 128_000,
    });
  }

  let posterDataUrl = '';

  try {
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      if (signal?.aborted) {
        throw new Error('Render cancelled by user.');
      }
      if (encoderError) throw encoderError;

      const timeSec = frameIdx / fps;
      await renderProjectFrame({
        ctx,
        project,
        timeSec,
        pool,
        canvasWidth: width,
        canvasHeight: height,
        seekVideos: true,
      });

      if (frameIdx === Math.floor(totalFrames * 0.15) || frameIdx === 0) {
        posterDataUrl = capturePosterFromCanvas(canvas);
      }

      const timestampUs = Math.round((frameIdx * 1_000_000) / fps);
      const durationUs = Math.round(1_000_000 / fps);
      const frame = new VideoFrame(canvas, { timestamp: timestampUs, duration: durationUs });
      const keyFrame = frameIdx % (fps * 2) === 0;
      videoEncoder.encode(frame, { keyFrame });
      frame.close();

      if (videoEncoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 12));
      }

      if (frameIdx % 3 === 0 || frameIdx === totalFrames - 1) {
        onProgress?.({
          progress: 0.05 + (0.85 * (frameIdx + 1)) / totalFrames,
          stage: `Encoding frame ${frameIdx + 1} / ${totalFrames}`,
          currentFrame: frameIdx + 1,
          totalFrames,
        });
      }
    }

    if (audioEncoder && mixedAudio) {
      onProgress?.({
        progress: 0.92,
        stage: 'Encoding mixed audio track',
        currentFrame: totalFrames,
        totalFrames,
      });
      const ch0 = mixedAudio.getChannelData(0);
      const ch1 = mixedAudio.numberOfChannels > 1 ? mixedAudio.getChannelData(1) : ch0;
      const chunkFrames = 4800; // 100ms chunks
      for (let offset = 0; offset < mixedAudio.length; offset += chunkFrames) {
        if (signal?.aborted) throw new Error('Render cancelled by user.');
        const count = Math.min(chunkFrames, mixedAudio.length - offset);
        const planar = new Float32Array(count * 2);
        planar.set(ch0.subarray(offset, offset + count), 0);
        planar.set(ch1.subarray(offset, offset + count), count);

        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate: 48000,
          numberOfFrames: count,
          numberOfChannels: 2,
          timestamp: Math.round((offset * 1_000_000) / 48000),
          data: planar,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      }
      await audioEncoder.flush();
      audioEncoder.close();
    }

    onProgress?.({ progress: 0.97, stage: 'Muxing MP4 container', currentFrame: totalFrames, totalFrames });
    await videoEncoder.flush();
    videoEncoder.close();
    muxer.finalize();

    const buffer = target.buffer;
    const blob = new Blob([buffer], { type: 'video/mp4' });
    if (blob.size < 64) {
      throw new Error('Produced MP4 buffer was empty.');
    }

    onProgress?.({ progress: 1, stage: 'Completed', currentFrame: totalFrames, totalFrames });
    return {
      blob,
      mimeType: 'video/mp4',
      extension: 'mp4',
      posterDataUrl,
      durationSec,
      width,
      height,
      fps,
      encoderPath: 'webcodecs-mp4',
    };
  } catch (err) {
    try {
      if (videoEncoder.state !== 'closed') videoEncoder.close();
      if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
    } catch {
      // ignore cleanup errors
    }
    throw err;
  } finally {
    pool.dispose();
  }
}

async function renderWithMediaRecorderFallback(params: {
  project: CutFlowProject;
  width: number;
  height: number;
  fps: 30 | 60;
  durationSec: number;
  quality: 'high' | 'standard';
  signal?: AbortSignal;
  onProgress?: (ev: RenderProgressEvent) => void;
}): Promise<RenderedVideoResult> {
  const { project, width, height, fps, durationSec, quality, signal, onProgress } = params;
  const caps = await detectBrowserCapabilities();
  if (!caps.mediaRecorder || !caps.mediaRecorderMimeType) {
    throw new Error('Neither WebCodecs H.264 nor MediaRecorder video export is supported in this browser.');
  }

  const totalFrames = Math.max(1, Math.ceil(durationSec * fps));
  const pool = new ProjectMediaPool();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to acquire 2D canvas context.');

  onProgress?.({ progress: 0.02, stage: 'Preloading media for fallback encoder', currentFrame: 0, totalFrames });
  await pool.preloadProject(project);

  const canvasStream = canvas.captureStream(fps);
  const mimeType = caps.mediaRecorderMimeType;
  const recorder = new MediaRecorder(canvasStream, {
    mimeType,
    videoBitsPerSecond: quality === 'high' ? 6_000_000 : 3_000_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error('MediaRecorder encoding failed.'));
  });

  recorder.start(200);
  let posterDataUrl = '';

  try {
    const frameIntervalMs = Math.round(1000 / fps);
    for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
      const frameStart = performance.now();
      if (signal?.aborted) {
        recorder.stop();
        throw new Error('Render cancelled by user.');
      }

      const timeSec = frameIdx / fps;
      await renderProjectFrame({
        ctx,
        project,
        timeSec,
        pool,
        canvasWidth: width,
        canvasHeight: height,
        seekVideos: true,
      });

      if (frameIdx === Math.floor(totalFrames * 0.15) || frameIdx === 0) {
        posterDataUrl = capturePosterFromCanvas(canvas);
      }

      if (frameIdx % 4 === 0 || frameIdx === totalFrames - 1) {
        onProgress?.({
          progress: 0.05 + (0.9 * (frameIdx + 1)) / totalFrames,
          stage: `Recording frame ${frameIdx + 1} / ${totalFrames}`,
          currentFrame: frameIdx + 1,
          totalFrames,
        });
      }

      const elapsed = performance.now() - frameStart;
      const waitMs = Math.max(4, Math.min(34, frameIntervalMs - elapsed));
      await new Promise((r) => setTimeout(r, waitMs));
    }

    recorder.stop();
    const blob = await stopPromise;
    if (blob.size < 64) {
      throw new Error('Fallback recorder produced an empty video file.');
    }

    const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
    onProgress?.({ progress: 1, stage: 'Completed', currentFrame: totalFrames, totalFrames });
    return {
      blob,
      mimeType,
      extension,
      posterDataUrl,
      durationSec,
      width,
      height,
      fps,
      encoderPath: 'mediarecorder-fallback',
    };
  } finally {
    canvasStream.getTracks().forEach((t) => t.stop());
    pool.dispose();
  }
}

export async function renderProjectToVideo(params: {
  project: CutFlowProject;
  settings?: Partial<ExportSettings>;
  signal?: AbortSignal;
  onProgress?: (ev: RenderProgressEvent) => void;
}): Promise<RenderedVideoResult> {
  const { project, settings, signal, onProgress } = params;
  const resolution = settings?.resolution ?? project.exportSettings.resolution ?? '1080p';
  const fps = settings?.fps ?? project.exportSettings.fps ?? project.fps ?? 30;
  const quality = settings?.quality ?? project.exportSettings.quality ?? 'high';
  const { width, height } = getDimensionsForAspectRatio(project.aspectRatio, resolution);
  const rawDuration = computeProjectDuration(project);
  const durationSec = Math.max(1, Math.min(project.maxDurationSec, rawDuration));

  const caps = await detectBrowserCapabilities();

  if (caps.webCodecsVideoEncoder && caps.webCodecsH264Supported) {
    try {
      return await renderWithWebCodecs({
        project,
        width,
        height,
        fps,
        durationSec,
        quality,
        signal,
        onProgress,
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      // If WebCodecs fails at runtime (e.g. hardware encoder unavailable), fall back to MediaRecorder
      onProgress?.({
        progress: 0.02,
        stage: 'Switching to browser MediaRecorder fallback',
        currentFrame: 0,
        totalFrames: Math.ceil(durationSec * fps),
      });
    }
  }

  return await renderWithMediaRecorderFallback({
    project,
    width,
    height,
    fps,
    durationSec,
    quality,
    signal,
    onProgress,
  });
}

export async function saveRenderedVideoToFinalOutputs(params: {
  project: CutFlowProject;
  rendered: RenderedVideoResult;
  outputName?: string;
  templateName?: string;
}): Promise<FinalOutputItem> {
  const { project, rendered, outputName, templateName } = params;
  const outputId = createId('out');
  const storageKey = `${outputId}.${rendered.extension}`;
  const stored = await saveMediaBlob(storageKey, rendered.blob);

  const item: FinalOutputItem = {
    id: outputId,
    name: outputName ?? project.name,
    projectId: project.id,
    sourceProjectId: project.sourceProjectId,
    templateId: project.templateId,
    templateName,
    durationSec: rendered.durationSec,
    width: rendered.width,
    height: rendered.height,
    fps: rendered.fps,
    mimeType: rendered.mimeType,
    sizeBytes: rendered.blob.size,
    storageBackend: stored.backend,
    storageKey: stored.key,
    posterDataUrl: rendered.posterDataUrl,
    renderStatus: 'ready',
    approvalStatus: 'pending',
    editableProjectSnapshot: JSON.parse(JSON.stringify(project)),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await saveOutputItem(item);
  return item;
}

export async function exportBlobToDisk(
  blob: Blob,
  suggestedName: string,
  extension: 'mp4' | 'webm' = 'mp4'
): Promise<'file-system-access' | 'download'> {
  const safeName = `${suggestedName.replace(/[^a-zA-Z0-9._-]+/g, '_')}.${extension}`;
  const win = window as Window & {
    showSaveFilePicker?: (opts: unknown) => Promise<{
      createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
    }>;
  };

  if (typeof win.showSaveFilePicker === 'function') {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName: safeName,
        types: [
          {
            description: 'Video file',
            accept: { [blob.type || 'video/mp4']: [`.${extension}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'file-system-access';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw new Error('Save cancelled.');
      }
      // Fall through to standard anchor download if FS Access fails in iframe
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  return 'download';
}

export async function executeRenderJobQueue(params: {
  jobs: Array<{ job: RenderJob; project: CutFlowProject }>;
  signal?: AbortSignal;
  onJobUpdate: (job: RenderJob) => void;
}): Promise<RenderJob[]> {
  const { jobs, signal, onJobUpdate } = params;
  const results: RenderJob[] = [];

  for (const item of jobs) {
    if (signal?.aborted) {
      const cancelled: RenderJob = {
        ...item.job,
        status: 'cancelled',
        stage: 'Cancelled',
      };
      await saveRenderJob(cancelled);
      onJobUpdate(cancelled);
      results.push(cancelled);
      continue;
    }

    let currentJob: RenderJob = {
      ...item.job,
      status: 'rendering',
      progress: 0.01,
      stage: 'Initializing render',
    };
    await saveRenderJob(currentJob);
    onJobUpdate(currentJob);

    try {
      const rendered = await renderProjectToVideo({
        project: item.project,
        signal,
        onProgress: (ev) => {
          currentJob = {
            ...currentJob,
            progress: ev.progress,
            stage: ev.stage,
          };
          onJobUpdate(currentJob);
        },
      });

      const savedOutput = await saveRenderedVideoToFinalOutputs({
        project: item.project,
        rendered,
        outputName: item.job.outputName,
        templateName: item.job.templateName,
      });

      currentJob = {
        ...currentJob,
        status: 'completed',
        progress: 1,
        stage: `Ready (${rendered.encoderPath === 'webcodecs-mp4' ? 'MP4' : 'WebM fallback'})`,
        completedAt: Date.now(),
        outputId: savedOutput.id,
      };
      await saveRenderJob(currentJob);
      onJobUpdate(currentJob);
      results.push(currentJob);
    } catch (err) {
      const isCancelled = signal?.aborted || (err instanceof Error && err.message.includes('cancelled'));
      currentJob = {
        ...currentJob,
        status: isCancelled ? 'cancelled' : 'failed',
        stage: isCancelled ? 'Cancelled' : 'Failed',
        error: err instanceof Error ? err.message : 'Render failed',
      };
      await saveRenderJob(currentJob);
      onJobUpdate(currentJob);
      results.push(currentJob);
    }
  }

  return results;
}

export { computeClipAudioGain };
