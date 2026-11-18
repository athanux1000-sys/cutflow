import { PerformanceMode } from '../types/project';

export interface BrowserCapabilities {
  webCodecsVideoEncoder: boolean;
  webCodecsH264Supported: boolean;
  webCodecsAudioEncoder: boolean;
  webGL2: boolean;
  webGL2Renderer: string;
  webGPU: boolean;
  opfs: boolean;
  indexedDB: boolean;
  fileSystemAccess: boolean;
  webWorkers: boolean;
  mediaRecorder: boolean;
  mediaRecorderMimeType: string;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
  recommendedProfile: PerformanceMode;
  recommendedWorkerConcurrency: number;
}

let cachedCapabilities: BrowserCapabilities | null = null;

export async function detectBrowserCapabilities(): Promise<BrowserCapabilities> {
  if (cachedCapabilities) return cachedCapabilities;

  const hasVideoEncoder = typeof VideoEncoder !== 'undefined';
  const hasAudioEncoder = typeof AudioEncoder !== 'undefined';

  let h264Supported = false;
  if (hasVideoEncoder && typeof VideoEncoder.isConfigSupported === 'function') {
    try {
      const res = await VideoEncoder.isConfigSupported({
        codec: 'avc1.420028',
        width: 1280,
        height: 720,
        bitrate: 4_000_000,
        framerate: 30,
      });
      h264Supported = Boolean(res.supported);
      if (!h264Supported) {
        const baseline = await VideoEncoder.isConfigSupported({
          codec: 'avc1.42001f',
          width: 1280,
          height: 720,
          bitrate: 4_000_000,
          framerate: 30,
        });
        h264Supported = Boolean(baseline.supported);
      }
    } catch {
      h264Supported = false;
    }
  }

  let aacSupported = false;
  if (hasAudioEncoder && typeof AudioEncoder.isConfigSupported === 'function') {
    try {
      const res = await AudioEncoder.isConfigSupported({
        codec: 'mp4a.40.2',
        sampleRate: 48000,
        numberOfChannels: 2,
        bitrate: 128_000,
      });
      aacSupported = Boolean(res.supported);
    } catch {
      aacSupported = false;
    }
  }

  let webGL2 = false;
  let webGL2Renderer = 'Unavailable';
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (gl) {
      webGL2 = true;
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      webGL2Renderer = debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER));
    }
  } catch {
    webGL2 = false;
  }

  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  const webGPU = Boolean(nav.gpu);

  let opfs = false;
  try {
    if (navigator.storage && typeof navigator.storage.getDirectory === 'function') {
      await navigator.storage.getDirectory();
      opfs = true;
    }
  } catch {
    opfs = false;
  }

  const indexedDBAvailable = typeof indexedDB !== 'undefined';
  const fileSystemAccess =
    typeof (window as Window & { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
  const webWorkers = typeof Worker !== 'undefined';

  let mediaRecorder = false;
  let mediaRecorderMimeType = '';
  if (typeof MediaRecorder !== 'undefined') {
    mediaRecorder = true;
    const candidates = [
      'video/mp4;codecs=avc1',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) {
        mediaRecorderMimeType = mime;
        break;
      }
    }
  }

  const hardwareConcurrency = Math.max(1, navigator.hardwareConcurrency || 2);
  const deviceMemoryGb = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;

  let recommendedProfile: PerformanceMode = 'balanced';
  if ((deviceMemoryGb !== null && deviceMemoryGb <= 4) || hardwareConcurrency <= 2) {
    recommendedProfile = 'low-memory';
  } else if (webGL2 && hardwareConcurrency >= 8 && (deviceMemoryGb === null || deviceMemoryGb >= 8)) {
    recommendedProfile = 'quality';
  }

  const recommendedWorkerConcurrency = hardwareConcurrency >= 8 ? 2 : 1;

  cachedCapabilities = {
    webCodecsVideoEncoder: hasVideoEncoder,
    webCodecsH264Supported: h264Supported,
    webCodecsAudioEncoder: aacSupported,
    webGL2,
    webGL2Renderer,
    webGPU,
    opfs,
    indexedDB: indexedDBAvailable,
    fileSystemAccess,
    webWorkers,
    mediaRecorder,
    mediaRecorderMimeType,
    hardwareConcurrency,
    deviceMemoryGb,
    recommendedProfile,
    recommendedWorkerConcurrency,
  };

  return cachedCapabilities;
}

export function clearCachedCapabilities(): void {
  cachedCapabilities = null;
}
