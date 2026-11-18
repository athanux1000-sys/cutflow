/**
 * Next-Stage Local AI Integration Contracts for CutFlow.
 *
 * Notice: No AI models are executed or simulated in this stage.
 * All service implementations explicitly report `not-configured` until
 * local models (WebGPU / ONNX / WASM / Whisper / MediaPipe) are connected
 * in the next development stage.
 */

export type AIStageStatus = 'not-configured' | 'ready' | 'error';

export interface AIStageResult<T> {
  status: AIStageStatus;
  stage: 'next-development-stage';
  capability: string;
  reason: string;
  data?: T;
}

export interface SpeechSegment {
  startSec: number;
  endSec: number;
  text: string;
  confidence: number;
}

export interface WordAlignmentToken {
  word: string;
  startSec: number;
  endSec: number;
  confidence: number;
}

export interface BoundingBox {
  x: number; // normalized 0..1
  y: number;
  width: number;
  height: number;
}

export interface FaceDetectionResult {
  frameTimeSec: number;
  faces: Array<{ id: string; box: BoundingBox; confidence: number }>;
}

export interface FaceTrackSpan {
  trackId: string;
  startSec: number;
  endSec: number;
  samples: Array<{ timeSec: number; centerX: number; centerY: number; box: BoundingBox }>;
}

export interface SceneCutBoundary {
  timeSec: number;
  score: number;
}

export interface DetectedObjectItem {
  label: string;
  confidence: number;
  box: BoundingBox;
  timeSec: number;
}

export interface OCRRegion {
  text: string;
  box: BoundingBox;
  timeSec: number;
  confidence: number;
}

export interface SaliencyMapFrame {
  timeSec: number;
  focusPoint: { x: number; y: number };
  safeZone: BoundingBox;
}

export interface SceneCompositionAdvice {
  recommendedCropCenter: { x: number; y: number };
  recommendedScale: number;
  subjectFraming: 'portrait' | 'wide' | 'split' | 'detail';
}

export interface CaptionLayoutPlan {
  placementY: number;
  maxCharsPerLine: number;
  safeMarginBottom: number;
}

export interface TypographyAnimationPlan {
  preset: 'word-pop' | 'slide-reveal' | 'static-editorial';
  emphasisWords: string[];
}

export interface TemplateAdaptationPlan {
  templateId: string;
  cropOverrides: { x: number; y: number; scale: number };
  suggestedHeadline?: string;
}

export interface SpeechRecognitionService {
  transcribe(audioBuffer: AudioBuffer): Promise<AIStageResult<SpeechSegment[]>>;
}

export interface VoiceActivityDetectionService {
  detectSpeechRegions(audioBuffer: AudioBuffer): Promise<AIStageResult<Array<{ startSec: number; endSec: number }>>>;
}

export interface WordAlignmentService {
  alignWords(audioBuffer: AudioBuffer, transcript: string): Promise<AIStageResult<WordAlignmentToken[]>>;
}

export interface LanguageIdentificationService {
  detectLanguage(audioBuffer: AudioBuffer): Promise<AIStageResult<{ languageCode: string; confidence: number }>>;
}

export interface RomanHinglishTranscriptionService {
  transcribeHinglish(audioBuffer: AudioBuffer): Promise<AIStageResult<SpeechSegment[]>>;
}

export interface FaceDetectionService {
  detectFaces(frame: ImageBitmap | HTMLCanvasElement, timeSec: number): Promise<AIStageResult<FaceDetectionResult>>;
}

export interface FaceTrackingService {
  trackFaces(videoBlob: Blob): Promise<AIStageResult<FaceTrackSpan[]>>;
}

export interface SceneDetectionService {
  detectSceneCuts(videoBlob: Blob): Promise<AIStageResult<SceneCutBoundary[]>>;
}

export interface ObjectDetectionService {
  detectObjects(frame: ImageBitmap | HTMLCanvasElement, timeSec: number): Promise<AIStageResult<DetectedObjectItem[]>>;
}

export interface OCRService {
  extractText(frame: ImageBitmap | HTMLCanvasElement, timeSec: number): Promise<AIStageResult<OCRRegion[]>>;
}

export interface SaliencyAnalysisService {
  analyzeSaliency(frame: ImageBitmap | HTMLCanvasElement, timeSec: number): Promise<AIStageResult<SaliencyMapFrame>>;
}

export interface SceneCompositionService {
  analyzeComposition(videoBlob: Blob): Promise<AIStageResult<SceneCompositionAdvice>>;
}

export interface CaptionLayoutPlanner {
  planLayout(saliency: SaliencyMapFrame[], aspectRatio: '9:16' | '1:1' | '16:9'): Promise<AIStageResult<CaptionLayoutPlan>>;
}

export interface TypographyAnimationPlanner {
  planTypography(tokens: WordAlignmentToken[]): Promise<AIStageResult<TypographyAnimationPlan>>;
}

export interface TemplateAdaptationService {
  adaptTemplate(templateId: string, composition: SceneCompositionAdvice): Promise<AIStageResult<TemplateAdaptationPlan>>;
}

export interface CutFlowAIStageRegistry {
  speechRecognition: SpeechRecognitionService;
  voiceActivityDetection: VoiceActivityDetectionService;
  wordAlignment: WordAlignmentService;
  languageIdentification: LanguageIdentificationService;
  romanHinglishTranscription: RomanHinglishTranscriptionService;
  faceDetection: FaceDetectionService;
  faceTracking: FaceTrackingService;
  sceneDetection: SceneDetectionService;
  objectDetection: ObjectDetectionService;
  ocr: OCRService;
  saliencyAnalysis: SaliencyAnalysisService;
  sceneComposition: SceneCompositionService;
  captionLayoutPlanner: CaptionLayoutPlanner;
  typographyAnimationPlanner: TypographyAnimationPlanner;
  templateAdaptation: TemplateAdaptationService;
}

function unconfigured<T>(capability: string): Promise<AIStageResult<T>> {
  return Promise.resolve({
    status: 'not-configured',
    stage: 'next-development-stage',
    capability,
    reason: `${capability} is reserved for the next local AI development stage. No local model weights are loaded.`,
  });
}

export const aiStageRegistry: CutFlowAIStageRegistry = {
  speechRecognition: { transcribe: () => unconfigured('Speech Recognition') },
  voiceActivityDetection: { detectSpeechRegions: () => unconfigured('Voice Activity Detection') },
  wordAlignment: { alignWords: () => unconfigured('Word-Level Alignment') },
  languageIdentification: { detectLanguage: () => unconfigured('Language Identification') },
  romanHinglishTranscription: { transcribeHinglish: () => unconfigured('Roman Hinglish Transcription') },
  faceDetection: { detectFaces: () => unconfigured('Face Detection') },
  faceTracking: { trackFaces: () => unconfigured('Face Tracking') },
  sceneDetection: { detectSceneCuts: () => unconfigured('Scene Detection') },
  objectDetection: { detectObjects: () => unconfigured('Object Detection') },
  ocr: { extractText: () => unconfigured('OCR') },
  saliencyAnalysis: { analyzeSaliency: () => unconfigured('Saliency Analysis') },
  sceneComposition: { analyzeComposition: () => unconfigured('Scene Composition Analysis') },
  captionLayoutPlanner: { planLayout: () => unconfigured('Caption Layout Planning') },
  typographyAnimationPlanner: { planTypography: () => unconfigured('Typography Animation Planning') },
  templateAdaptation: { adaptTemplate: () => unconfigured('Template Adaptation') },
};

export const AI_STAGE_CAPABILITIES_LIST = [
  'Speech Recognition',
  'Voice Activity Detection',
  'Word-Level Alignment',
  'Language Identification',
  'Roman Hinglish Transcription',
  'Face Detection',
  'Face Tracking',
  'Scene Detection',
  'Object Detection',
  'OCR',
  'Saliency Analysis',
  'Scene Composition Analysis',
  'Caption Layout Planning',
  'Typography Animation Planning',
  'Template Adaptation',
] as const;
