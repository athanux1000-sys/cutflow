import { MediaAssetRef, MediaKind } from '../types/project';
import { createId } from '../utils/timelineMath';
import { loadMediaBlob, saveMediaBlob } from './storage';

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'm4v', 'mkv', 'ogg']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'opus']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']);

export function detectMediaKind(file: File): MediaKind | null {
  const mime = file.type.toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  if (IMAGE_EXTS.has(ext)) return 'image';
  return null;
}

class MediaUrlRegistry {
  private urls = new Map<string, string>();
  private loading = new Map<string, Promise<string | null>>();

  async getUrl(asset: MediaAssetRef): Promise<string | null> {
    const existing = this.urls.get(asset.storageKey);
    if (existing) return existing;

    const inflight = this.loading.get(asset.storageKey);
    if (inflight) return inflight;

    const task = (async () => {
      try {
        const blob = await loadMediaBlob(asset.storageKey, asset.storageBackend);
        if (!blob) return null;
        const url = URL.createObjectURL(blob);
        this.urls.set(asset.storageKey, url);
        return url;
      } finally {
        this.loading.delete(asset.storageKey);
      }
    })();

    this.loading.set(asset.storageKey, task);
    return task;
  }

  async getBlobUrlForKey(key: string, backend: 'opfs' | 'idb'): Promise<string | null> {
    const existing = this.urls.get(key);
    if (existing) return existing;
    const blob = await loadMediaBlob(key, backend);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    this.urls.set(key, url);
    return url;
  }

  revokeKey(key: string): void {
    const url = this.urls.get(key);
    if (url) {
      URL.revokeObjectURL(url);
      this.urls.delete(key);
    }
  }

  revokeAll(): void {
    for (const url of this.urls.values()) {
      URL.revokeObjectURL(url);
    }
    this.urls.clear();
  }
}

export const mediaUrlRegistry = new MediaUrlRegistry();

async function extractWaveformPeaks(file: Blob, targetBars = 48): Promise<number[] | undefined> {
  if (typeof AudioContext === 'undefined') return undefined;
  let ctx: AudioContext | null = null;
  try {
    if (file.size > 40 * 1024 * 1024) {
      // Avoid decoding huge files synchronously on low-memory machines
      return undefined;
    }
    ctx = new AudioContext();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const channel = audioBuffer.getChannelData(0);
    const blockSize = Math.max(1, Math.floor(channel.length / targetBars));
    const peaks: number[] = [];
    for (let i = 0; i < targetBars; i++) {
      const start = i * blockSize;
      let max = 0;
      const step = Math.max(1, Math.floor(blockSize / 64));
      for (let j = 0; j < blockSize && start + j < channel.length; j += step) {
        const val = Math.abs(channel[start + j]);
        if (val > max) max = val;
      }
      peaks.push(Number(Math.min(1, max).toFixed(3)));
    }
    return peaks;
  } catch {
    return undefined;
  } finally {
    if (ctx) {
      await ctx.close().catch(() => undefined);
    }
  }
}

async function extractVideoMetadata(
  blob: Blob
): Promise<{ durationSec: number; width: number; height: number; thumbnailDataUrl?: string }> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'metadata';

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out reading video metadata.')), 12000);
      video.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve();
      };
      video.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Unsupported or corrupted video file.'));
      };
      video.src = url;
    });

    let durationSec = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    if (durationSec === 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 1500);
        const onTimeUpdate = () => {
          video.removeEventListener('timeupdate', onTimeUpdate);
          clearTimeout(timer);
          resolve();
        };
        video.addEventListener('timeupdate', onTimeUpdate);
        try {
          video.currentTime = 1e7;
        } catch {
          clearTimeout(timer);
          resolve();
        }
      });
      durationSec =
        Number.isFinite(video.duration) && video.duration > 0
          ? video.duration
          : video.seekable.length > 0
            ? video.seekable.end(video.seekable.length - 1)
            : 4;
      video.currentTime = 0;
    }
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    // Seek briefly for thumbnail frame
    let thumbnailDataUrl: string | undefined;
    try {
      const seekTime = Math.min(0.5, durationSec * 0.25);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), 2500);
        video.onseeked = () => {
          clearTimeout(timer);
          resolve();
        };
        video.currentTime = seekTime;
      });
      const canvas = document.createElement('canvas');
      const thumbW = 240;
      const thumbH = Math.max(1, Math.round((thumbW * height) / width));
      canvas.width = thumbW;
      canvas.height = thumbH;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, thumbW, thumbH);
        thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.72);
      }
    } catch {
      thumbnailDataUrl = undefined;
    }

    return { durationSec, width, height, thumbnailDataUrl };
  } finally {
    video.src = '';
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function extractAudioMetadata(blob: Blob): Promise<{ durationSec: number }> {
  const url = URL.createObjectURL(blob);
  const audio = document.createElement('audio');
  audio.preload = 'metadata';
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out reading audio metadata.')), 10000);
      audio.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve();
      };
      audio.onerror = () => {
        clearTimeout(timeout);
        reject(new Error('Unsupported or corrupted audio file.'));
      };
      audio.src = url;
    });
    const durationSec = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 5;
    return { durationSec };
  } finally {
    audio.src = '';
    URL.revokeObjectURL(url);
  }
}

async function extractImageMetadata(
  blob: Blob
): Promise<{ width: number; height: number; thumbnailDataUrl?: string }> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    const thumbW = 240;
    const thumbH = Math.max(1, Math.round((thumbW * img.naturalHeight) / Math.max(1, img.naturalWidth)));
    canvas.width = thumbW;
    canvas.height = thumbH;
    const ctx = canvas.getContext('2d');
    let thumbnailDataUrl: string | undefined;
    if (ctx) {
      ctx.drawImage(img, 0, 0, thumbW, thumbH);
      thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.75);
    }
    return { width: img.naturalWidth || 1080, height: img.naturalHeight || 1080, thumbnailDataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function importMediaFile(
  file: File,
  maxDurationSec: number
): Promise<MediaAssetRef> {
  const kind = detectMediaKind(file);
  if (!kind) {
    throw new Error(`Unsupported media file "${file.name}". Please import video, audio, or image files.`);
  }

  let durationSec = 5;
  let width = 1080;
  let height = 1080;
  let thumbnailDataUrl: string | undefined;
  let waveformPeaks: number[] | undefined;

  if (kind === 'video') {
    const meta = await extractVideoMetadata(file);
    durationSec = meta.durationSec;
    width = meta.width;
    height = meta.height;
    thumbnailDataUrl = meta.thumbnailDataUrl;
    if (durationSec > maxDurationSec) {
      throw new Error(
        `"${file.name}" is ${Math.round(durationSec)}s long, exceeding this workspace limit of ${Math.round(
          maxDurationSec / 60
        )} minutes.`
      );
    }
    waveformPeaks = await extractWaveformPeaks(file);
  } else if (kind === 'audio') {
    const meta = await extractAudioMetadata(file);
    durationSec = meta.durationSec;
    width = 0;
    height = 0;
    if (durationSec > maxDurationSec) {
      throw new Error(
        `"${file.name}" exceeds the ${Math.round(maxDurationSec / 60)}-minute workspace limit.`
      );
    }
    waveformPeaks = await extractWaveformPeaks(file);
  } else {
    const meta = await extractImageMetadata(file);
    durationSec = 5; // default image clip duration on timeline
    width = meta.width;
    height = meta.height;
    thumbnailDataUrl = meta.thumbnailDataUrl;
  }

  const assetId = createId('media');
  const storageKey = `${assetId}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const stored = await saveMediaBlob(storageKey, file);

  return {
    id: assetId,
    name: file.name,
    type: kind,
    mimeType: file.type || (kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/png'),
    sizeBytes: file.size,
    durationSec: Number(durationSec.toFixed(3)),
    width,
    height,
    storageBackend: stored.backend,
    storageKey: stored.key,
    thumbnailDataUrl,
    waveformPeaks,
    createdAt: Date.now(),
  };
}

/**
 * Generates a real, locally encoded 4-second studio calibration video file (.webm)
 * using Canvas + MediaRecorder so users can test editing, splitting, templates, and export
 * immediately without needing external footage.
 */
export async function generateCalibrationClipFile(
  durationSec = 4,
  width = 1280,
  height = 720
): Promise<File> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder is unavailable to create a calibration video clip.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not initialize 2D canvas.');

  const stream = canvas.captureStream(30);
  let audioCtx: AudioContext | null = null;
  let hasAudioTrack = false;
  try {
    if (typeof AudioContext !== 'undefined') {
      audioCtx = new AudioContext();
      if (audioCtx.state === 'suspended') {
        await audioCtx.resume().catch(() => {});
      }
      const dest = audioCtx.createMediaStreamDestination();
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      // Two clear spoken-cadence tone bursts for real waveform + acoustic VAD verification
      const t0 = audioCtx.currentTime;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.14, t0 + 0.25);
      gain.gain.setValueAtTime(0.14, t0 + 1.25);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + 1.45);
      gain.gain.setValueAtTime(0.0001, t0 + 2.0);
      gain.gain.linearRampToValueAtTime(0.16, t0 + 2.15);
      gain.gain.setValueAtTime(0.16, t0 + 3.2);
      gain.gain.linearRampToValueAtTime(0.0001, t0 + 3.4);

      const osc = audioCtx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(220, t0);
      osc.frequency.setValueAtTime(330, t0 + 2.0);
      osc.connect(gain);
      gain.connect(dest);
      osc.start(t0);
      osc.stop(t0 + durationSec);
      const audioTrack = dest.stream.getAudioTracks()[0];
      if (audioTrack) {
        stream.addTrack(audioTrack);
        hasAudioTrack = true;
      }
    }
  } catch {
    hasAudioTrack = false;
  }

  const mime =
    hasAudioTrack && MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
      ? 'video/webm;codecs=vp8,opus'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));
  });

  recorder.start(100);
  const totalFrames = durationSec * 30;
  const bars = ['#E2E8F0', '#FACC15', '#2DD4BF', '#22C55E', '#A855F7', '#EF4444', '#3B82F6'];

  for (let f = 0; f < totalFrames; f++) {
    const t = f / 30;
    ctx.fillStyle = '#0F1115';
    ctx.fillRect(0, 0, width, height);

    const barW = width / bars.length;
    for (let i = 0; i < bars.length; i++) {
      ctx.fillStyle = bars[i];
      ctx.globalAlpha = 0.85;
      ctx.fillRect(i * barW, 0, barW + 1, height * 0.65);
    }
    ctx.globalAlpha = 1;

    ctx.fillStyle = '#121418';
    ctx.fillRect(0, height * 0.65, width, height * 0.35);

    // Moving playhead indicator bar
    const progressX = ((t / durationSec) * (width - 160)) + 80;
    ctx.fillStyle = '#14B8A6';
    ctx.fillRect(80, height * 0.72, width - 160, 4);
    ctx.beginPath();
    ctx.arc(progressX, height * 0.72 + 2, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#F4F5F7';
    ctx.font = '600 42px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`CUTFLOW CALIBRATION  ${t.toFixed(2)}s`, width / 2, height * 0.88);

    await new Promise((r) => setTimeout(r, 33));
  }

  recorder.stop();
  stream.getTracks().forEach((tr) => tr.stop());
  const blob = await done;
  if (audioCtx) {
    await audioCtx.close().catch(() => {});
  }
  return new File([blob], `calibration_clip_${Date.now().toString().slice(-4)}.webm`, { type: mime });
}
