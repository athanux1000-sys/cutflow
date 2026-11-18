import { BrowserCapabilities } from '../capabilities';
import { PerformanceMode } from '../../types/project';

export type AIModelKind =
  | 'vad'
  | 'asr'
  | 'vision-face'
  | 'vision-pose'
  | 'vision-segmenter'
  | 'vision-object'
  | 'ocr';

export interface AIModelDefinition {
  id: string;
  name: string;
  kind: AIModelKind;
  version: string;
  sizeMb: number;
  sizeBytes: number;
  license: string;
  builtIn: boolean;
  hfRepo?: string;
  preferredDtype?: string | Record<string, string>;
  assetUrl?: string;
  wasmBaseUrl?: string;
  languages: string;
  description: string;
  recommendedForLowMemory: boolean;
  requiresWebGpuOptional: boolean;
  profileTier: 'lightweight' | 'balanced' | 'quality' | 'optional';
}

export const MEDIAPIPE_LOCAL_WASM_BASE = '/wasm/mediapipe';

export const AI_MODEL_CATALOG: AIModelDefinition[] = [
  {
    id: 'vad-acoustic-local',
    name: 'Acoustic Energy VAD & Chunker',
    kind: 'vad',
    version: '1.0.0',
    sizeMb: 0,
    sizeBytes: 0,
    license: 'CutFlow Built-in (Apache-2.0)',
    builtIn: true,
    languages: 'All spoken audio',
    description: 'Zero-download deterministic RMS energy voice-activity detector used as fallback when Silero VAD is not downloaded.',
    recommendedForLowMemory: true,
    requiresWebGpuOptional: false,
    profileTier: 'lightweight',
  },
  {
    id: 'silero-vad-onnx',
    name: 'Silero VAD v5 (ONNX)',
    kind: 'vad',
    version: '5.0',
    sizeMb: 2,
    sizeBytes: 2 * 1024 * 1024,
    license: 'MIT (onnx-community/silero-vad)',
    builtIn: false,
    hfRepo: 'onnx-community/silero-vad',
    assetUrl: 'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx',
    languages: 'Multilingual speech/non-speech detection',
    description: 'Local neural voice-activity detector (onnx-community/silero-vad) for tight speech-boundary chunking.',
    recommendedForLowMemory: true,
    requiresWebGpuOptional: false,
    profileTier: 'balanced',
  },
  {
    id: 'whisper-base-multi',
    name: 'Whisper Base Multilingual (ONNX q8)',
    kind: 'asr',
    version: 'onnx-q8',
    sizeMb: 73,
    sizeBytes: 73 * 1024 * 1024,
    license: 'MIT (onnx-community/whisper-base)',
    builtIn: false,
    hfRepo: 'onnx-community/whisper-base',
    preferredDtype: 'q8',
    languages: 'Hindi, English, Hinglish + 90 languages',
    description: 'Lightweight multilingual Whisper speech model (~73 MB). Best for 4 GB VRAM & 8 GB RAM laptops.',
    recommendedForLowMemory: true,
    requiresWebGpuOptional: true,
    profileTier: 'lightweight',
  },
  {
    id: 'whisper-small-multi',
    name: 'Whisper Small Multilingual (ONNX q8)',
    kind: 'asr',
    version: 'onnx-q8',
    sizeMb: 237,
    sizeBytes: 237 * 1024 * 1024,
    license: 'MIT (onnx-community/whisper-small)',
    builtIn: false,
    hfRepo: 'onnx-community/whisper-small',
    preferredDtype: 'q8',
    languages: 'Hindi, English, Hinglish + 90 languages',
    description: 'Balanced multilingual speech model (~237 MB) with stronger Hindi/English code-switching accuracy.',
    recommendedForLowMemory: false,
    requiresWebGpuOptional: true,
    profileTier: 'balanced',
  },
  {
    id: 'whisper-large-v3-turbo-multi',
    name: 'Whisper Large v3 Turbo (ONNX q4/q4f16)',
    kind: 'asr',
    version: 'onnx-q4',
    sizeMb: 590,
    sizeBytes: 590 * 1024 * 1024,
    license: 'MIT (onnx-community/whisper-large-v3-turbo)',
    builtIn: false,
    hfRepo: 'onnx-community/whisper-large-v3-turbo',
    preferredDtype: { encoder_model: 'q4', decoder_model_merged: 'q4f16' },
    languages: 'Hindi, English, Hinglish + 99 languages',
    description: 'Quality-focused multilingual Whisper Large v3 Turbo (~590 MB quantized). Recommended on WebGPU with 12+ GB RAM.',
    recommendedForLowMemory: false,
    requiresWebGpuOptional: true,
    profileTier: 'quality',
  },
  {
    id: 'mediapipe-face-landmarker',
    name: 'MediaPipe Face Landmarker (Float16)',
    kind: 'vision-face',
    version: '0.10',
    sizeMb: 4,
    sizeBytes: 4 * 1024 * 1024,
    license: 'Apache-2.0 (Google MediaPipe)',
    builtIn: false,
    assetUrl: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    wasmBaseUrl: MEDIAPIPE_LOCAL_WASM_BASE,
    languages: 'Visual (468 face/eye/mouth landmarks)',
    description: 'Detects face, eye, and mouth landmarks locally so kinetic typography avoids covering the speaker mouth.',
    recommendedForLowMemory: true,
    requiresWebGpuOptional: false,
    profileTier: 'lightweight',
  },
  {
    id: 'mediapipe-pose-landmarker',
    name: 'MediaPipe Pose Landmarker Lite (Float16)',
    kind: 'vision-pose',
    version: '0.10',
    sizeMb: 6,
    sizeBytes: 6 * 1024 * 1024,
    license: 'Apache-2.0 (Google MediaPipe)',
    builtIn: false,
    assetUrl: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    wasmBaseUrl: MEDIAPIPE_LOCAL_WASM_BASE,
    languages: 'Visual (33 body/shoulder/hand landmarks)',
    description: 'Detects upper-body and gesture zones to keep captions and split-screen layouts balanced around speaker framing.',
    recommendedForLowMemory: true,
    requiresWebGpuOptional: false,
    profileTier: 'balanced',
  },
  {
    id: 'mediapipe-image-segmenter',
    name: 'MediaPipe Selfie Segmenter (Float16)',
    kind: 'vision-segmenter',
    version: '0.10',
    sizeMb: 1,
    sizeBytes: 1 * 1024 * 1024,
    license: 'Apache-2.0 (Google MediaPipe)',
    builtIn: false,
    assetUrl: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
    wasmBaseUrl: MEDIAPIPE_LOCAL_WASM_BASE,
    languages: 'Visual (Foreground person mask)',
    description: 'Generates foreground subject silhouette masks to score true negative space regions in every scene.',
    recommendedForLowMemory: true,
    requiresWebGpuOptional: false,
    profileTier: 'balanced',
  },
  {
    id: 'mediapipe-object-detector',
    name: 'MediaPipe Object Detector (EfficientDet-Lite0)',
    kind: 'vision-object',
    version: '0.10',
    sizeMb: 5,
    sizeBytes: 5 * 1024 * 1024,
    license: 'Apache-2.0 (Google MediaPipe)',
    builtIn: false,
    assetUrl: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite',
    wasmBaseUrl: MEDIAPIPE_LOCAL_WASM_BASE,
    languages: 'Visual (80 COCO classes)',
    description: 'Identifies props and foreground objects so overlays and kinetic labels do not cover focal objects.',
    recommendedForLowMemory: false,
    requiresWebGpuOptional: false,
    profileTier: 'quality',
  },
  {
    id: 'tesseract-ocr-eng',
    name: 'Tesseract OCR Engine (English)',
    kind: 'ocr',
    version: '7.0',
    sizeMb: 15,
    sizeBytes: 15 * 1024 * 1024,
    license: 'Apache-2.0 (Tesseract.js)',
    builtIn: false,
    languages: 'Latin / English burned-in text',
    description: 'Detects existing burned-in subtitles or graphics in source video so new CutFlow captions avoid collisions.',
    recommendedForLowMemory: true,
    requiresWebGpuOptional: false,
    profileTier: 'optional',
  },
];

export function getModelDefinition(modelId: string): AIModelDefinition | undefined {
  return AI_MODEL_CATALOG.find((m) => m.id === modelId);
}

export function getRecommendedBundleForProfile(profile: PerformanceMode): {
  asrModelId: string;
  visionModelIds: string[];
  estimatedTotalMb: number;
} {
  if (profile === 'low-memory') {
    return {
      asrModelId: 'whisper-base-multi',
      visionModelIds: ['silero-vad-onnx', 'mediapipe-face-landmarker'],
      estimatedTotalMb: 79,
    };
  }
  if (profile === 'quality') {
    return {
      asrModelId: 'whisper-large-v3-turbo-multi',
      visionModelIds: [
        'silero-vad-onnx',
        'mediapipe-face-landmarker',
        'mediapipe-pose-landmarker',
        'mediapipe-image-segmenter',
        'mediapipe-object-detector',
        'tesseract-ocr-eng',
      ],
      estimatedTotalMb: 623,
    };
  }
  return {
    asrModelId: 'whisper-small-multi',
    visionModelIds: [
      'silero-vad-onnx',
      'mediapipe-face-landmarker',
      'mediapipe-pose-landmarker',
      'mediapipe-image-segmenter',
    ],
    estimatedTotalMb: 250,
  };
}

export interface ModelCompatibilityReport {
  compatible: boolean;
  provider: string;
  warning?: string;
}

export function evaluateModelCompatibility(
  model: AIModelDefinition,
  caps: BrowserCapabilities | null,
  performanceMode: PerformanceMode
): ModelCompatibilityReport {
  if (model.builtIn) {
    return { compatible: true, provider: 'WebAudio Deterministic DSP' };
  }

  const memGb = caps?.deviceMemoryGb ?? null;
  if (
    model.id === 'whisper-large-v3-turbo-multi' &&
    (!caps?.webGPU || performanceMode === 'low-memory' || (memGb !== null && memGb <= 8))
  ) {
    return {
      compatible: true,
      provider: caps?.webGPU ? 'ONNX Runtime (WebGPU)' : 'ONNX Runtime (WASM SIMD CPU — Slow)',
      warning: !caps?.webGPU
        ? 'WebGPU unavailable: Whisper Large v3 Turbo on CPU WASM can be slow and memory-heavy; Whisper Small or Base is recommended.'
        : 'Large quantized model (~590 MB): recommended for devices with >8 GB RAM.',
    };
  }

  if (
    !model.recommendedForLowMemory &&
    (performanceMode === 'low-memory' || (memGb !== null && memGb <= 4))
  ) {
    return {
      compatible: true,
      provider: caps?.webGPU ? 'ONNX Runtime (WebGPU w/ WASM fallback)' : 'ONNX Runtime (WASM SIMD)',
      warning: 'Heavy model for low-memory devices; Whisper Base (73 MB) is safer for 4 GB VRAM / 8 GB RAM.',
    };
  }

  if (model.kind === 'asr') {
    return {
      compatible: Boolean(caps?.webWorkers ?? true),
      provider: caps?.webGPU ? 'ONNX Runtime (WebGPU w/ WASM fallback)' : 'ONNX Runtime (WASM SIMD)',
    };
  }

  if (model.kind === 'vad') {
    return {
      compatible: true,
      provider: 'ONNX Runtime Web (Silero VAD v5)',
    };
  }

  if (model.kind.startsWith('vision-')) {
    return {
      compatible: true,
      provider: caps?.webGL2 ? 'MediaPipe Local WASM + WebGL2 Delegate' : 'MediaPipe Local WASM CPU',
    };
  }

  return {
    compatible: Boolean(caps?.webWorkers ?? true),
    provider: 'Tesseract Web Worker WASM',
  };
}
