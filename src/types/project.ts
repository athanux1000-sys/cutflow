export const PROJECT_SCHEMA_VERSION = 2;
export const TEMPLATE_SCHEMA_VERSION = 2;
export const CUTFLOW_TEMPLATE_FORMAT = 'cutflow.template' as const;
export const CUTFLOW_TEMPLATE_MANIFEST_VERSION = '1.0.0' as const;

export type AppRoute = 'home' | 'video-edit' | 'templates' | 'outputs' | 'output-edit' | 'settings';

export type ProjectType = 'edit' | 'template-prep' | 'output';

export type AspectRatio = '16:9' | '9:16' | '1:1';

export type FitMode = 'fit' | 'fill' | 'stretch';

export type MediaKind = 'video' | 'audio' | 'image';

export type StorageBackend = 'opfs' | 'idb';

export type TimelineTool = 'select' | 'razor' | 'trim' | 'hand';

export type RomanizationStyle = 'natural-hinglish' | 'phonetic-roman' | 'preserve-english';

export interface InputPreferences {
  scrollMode: 'zoom' | 'pan';
  touchBarScrubSensitivity: number; // 0.5 .. 2.5
  invertScroll: boolean;
  defaultTimelineTool: TimelineTool;
}

export interface CustomVocabEntry {
  id: string;
  spokenForm: string;
  preferredSpelling: string;
  caseSensitive: boolean;
}

export interface MediaAssetRef {
  id: string;
  name: string;
  type: MediaKind;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  width: number;
  height: number;
  storageBackend: StorageBackend;
  storageKey: string;
  thumbnailDataUrl?: string;
  waveformPeaks?: number[];
  createdAt: number;
}

export interface TimelineTrack {
  id: string;
  name: string;
  kind: 'video' | 'audio' | 'overlay';
  order: number;
  muted: boolean;
  locked: boolean;
  visible: boolean;
}

export interface CropInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ClipTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  fitMode: FitMode;
  crop: CropInsets;
}

export interface ColorAdjustments {
  brightness: number; // -1..1
  contrast: number; // -1..1
  saturation: number; // -1..1
  blur: number; // 0..20 px
  exposure: number; // -2..2 stops
  temperature: number; // -1..1
  tint: number; // -1..1
  highlights: number; // -1..1
  shadows: number; // -1..1
  whites: number; // -1..1
  blacks: number; // -1..1
  vibrance: number; // -1..1
  gamma: number; // 0.5..2.0 (1 = neutral)
  vignette: number; // 0..1
  sharpen: number; // 0..1
  grain: number; // 0..1
  lift?: number; // -0.5..0.5 shadow lift
  gain?: number; // 0.5..1.5 highlight gain
}

export interface TransitionSpec {
  type: 'none' | 'fade' | 'slide-up';
  durationSec: number;
}

export interface ChromaKeyConfig {
  enabled: boolean;
  keyColor: string;
  tolerance: number;
  status: 'next-stage';
}

export interface KeyframeTrack {
  property: 'x' | 'y' | 'scale' | 'opacity';
  keyframes: Array<{ timeSec: number; value: number }>;
  status: 'next-stage';
}

export interface TimelineClip {
  id: string;
  trackId: string;
  mediaId: string;
  name: string;
  kind: MediaKind;
  startTime: number;
  duration: number;
  sourceIn: number;
  sourceOut: number;
  speed: number;
  volume: number;
  muted: boolean;
  fadeInSec: number;
  fadeOutSec: number;
  transform: ClipTransform;
  color: ColorAdjustments;
  transitionIn?: TransitionSpec;
  chromaKey?: ChromaKeyConfig;
  keyframes?: KeyframeTrack[];
}

export type TypographyRole = 'hero' | 'supporting' | 'standard' | 'annotation' | 'stat';

export type AnimationPreset =
  | 'none'
  | 'fade'
  | 'slide-up'
  | 'spring-pop'
  | 'impact'
  | 'word-reveal'
  | 'kinetic-cascade'
  | 'type-on'
  | 'mask-reveal'
  | 'tracking-reveal'
  | 'stagger'
  | 'bounce'
  | 'shake'
  | 'emphasis-pulse'
  | 'motion-trail';

export interface KineticAnimationSpec {
  preset: AnimationPreset;
  durationSec: number;
  anticipationMs: number; // e.g. 40ms
  springStiffness: number; // k
  springDamping: number; // c
  springMass: number; // m
  overshoot: number; // 0..0.5
  motionBlurStrength: number; // 0..1
  staggerMs: number; // per-word stagger
}

export type LayoutAnchorId =
  | 'upper-left'
  | 'top-center'
  | 'upper-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'lower-left'
  | 'lower-center'
  | 'lower-right';

export interface TranscriptWordToken {
  id: string;
  word: string;
  rawWord?: string;
  startSec: number;
  endSec: number;
  confidence?: number;
  timingSource: 'model-aligned' | 'estimated';
  role?: TypographyRole;
  uncertain?: boolean;
}

export interface TranscriptSegment {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
  rawText: string;
  language: 'en' | 'hi' | 'hi-en' | 'other';
  script: 'latin' | 'devanagari' | 'mixed' | 'other';
  confidence?: number;
  userEdited: boolean;
  uncertain: boolean;
  words: TranscriptWordToken[];
}

export interface TextLayer {
  id: string;
  trackId: string;
  text: string;
  startTime: number;
  duration: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  color: string;
  backgroundColor: string;
  align: 'left' | 'center' | 'right';
  x: number; // -0.5..0.5
  y: number; // -0.5..0.5
  scale: number;
  opacity: number;
  rotation: number;
  role?: TypographyRole;
  letterSpacing?: number;
  lineHeight?: number;
  textCase?: 'none' | 'upper' | 'title';
  strokeColor?: string;
  strokeWidth?: number;
  shadowBlur?: number;
  cornerRadius?: number;
  animation?: KineticAnimationSpec;
  words?: TranscriptWordToken[];
  anchorZone?: LayoutAnchorId;
  userLockedPosition?: boolean;
  transcriptSegmentId?: string;
}

export type OverlayShapeType = 'rectangle' | 'circle' | 'frame' | 'lower-third' | 'line';

export interface OverlayLayer {
  id: string;
  trackId: string;
  kind: 'shape' | 'image';
  name: string;
  shapeType?: OverlayShapeType;
  mediaId?: string;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  startTime: number;
  duration: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  opacity: number;
  rotation: number;
}

export type SoundEffectType = 'none' | 'soft-pop' | 'impact-hit' | 'whoosh-in' | 'subtle-tick';

export interface SoundCueEvent {
  id: string;
  timeSec: number;
  effect: SoundEffectType;
  volume: number;
  linkedLayerId?: string;
}

export interface NormalizedBox {
  x: number; // top-left 0..1
  y: number;
  width: number;
  height: number;
  confidence?: number;
  label?: string;
}

export interface SceneCompositionRecord {
  sceneId: string;
  startSec: number;
  endSec: number;
  cutConfidence: number;
  faceBoxes: NormalizedBox[];
  mouthBoxes: NormalizedBox[];
  eyeBoxes: NormalizedBox[];
  poseBoxes?: NormalizedBox[];
  personSilhouetteBoxes?: NormalizedBox[];
  objectBoxes?: NormalizedBox[];
  ocrRegions: Array<NormalizedBox & { text: string }>;
  negativeSpaceBoxes: NormalizedBox[];
  motionScore: number; // 0..1
  brightnessAvg: number; // 0..1
  dominantPalette: string[];
  suggestedAnchor: LayoutAnchorId;
  limitations: string[];
}

export interface SceneCompositionMap {
  mediaId: string;
  durationSec: number;
  analyzedAt: number;
  faceDetectorUsed: string;
  poseDetectorUsed?: string;
  segmenterUsed?: string;
  objectDetectorUsed?: string;
  ocrUsed: string;
  scenes: SceneCompositionRecord[];
}

export interface SourceAnalysisBundle {
  cacheKey: string;
  mediaId: string;
  modelId: string;
  romanizationStyle: RomanizationStyle;
  createdAt: number;
  segments: TranscriptSegment[];
  sceneMap?: SceneCompositionMap;
}

export interface EditorialPlanItem {
  id: string;
  segmentId: string;
  startSec: number;
  endSec: number;
  setupPhrase?: string;
  heroWord?: string;
  supportingPhrase?: string;
  fullText: string;
  role: TypographyRole;
  anchorZone: LayoutAnchorId;
  anchorX: number;
  anchorY: number;
  animation: KineticAnimationSpec;
  sfx: SoundEffectType;
  faceSafeScore: number;
  reason: string;
}

export interface EditorialPlan {
  id: string;
  projectId: string;
  templateId?: string;
  createdAt: number;
  items: EditorialPlanItem[];
}

export interface ExportSettings {
  resolution: '1080p' | '720p';
  fps: 30 | 60;
  format: 'mp4';
  quality: 'high' | 'standard';
}

export interface CutFlowProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  type: ProjectType;
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fps: 30 | 60;
  maxDurationSec: number;
  media: MediaAssetRef[];
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  textLayers: TextLayer[];
  overlayLayers: OverlayLayer[];
  soundCues?: SoundCueEvent[];
  transcriptSegments?: TranscriptSegment[];
  sceneMap?: SceneCompositionMap;
  editorialPlan?: EditorialPlan;
  autoSoundDesign?: boolean;
  exportSettings: ExportSettings;
  templateId?: string;
  sourceProjectId?: string;
  version: number;
}

export interface TypographyRoleRule {
  fontFamily: string;
  fontWeight: 400 | 500 | 600 | 700;
  sizeRatio: number;
  color: string;
  backgroundColor?: string;
  textCase?: 'none' | 'upper' | 'title';
  letterSpacing?: number;
  lineHeight?: number;
}

export interface CutFlowTemplateManifest {
  format: typeof CUTFLOW_TEMPLATE_FORMAT;
  schemaVersion: typeof CUTFLOW_TEMPLATE_MANIFEST_VERSION;
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  aspectRatios: AspectRatio[];
  defaultAspectRatio: AspectRatio;
  version: string;
  designSystem: {
    mood: string;
    backgroundColor: string;
    accentColor: string;
    secondaryColor: string;
    frameInset: number;
    frameRadius: number;
    borderColor?: string;
    borderWidth?: number;
    fitMode: FitMode;
    vignetteStrength: number;
  };
  typography: {
    pairingName: string;
    hero: TypographyRoleRule;
    supporting: TypographyRoleRule;
    standard: TypographyRoleRule;
    annotation: TypographyRoleRule;
    kicker: TypographyRoleRule;
  };
  layout: {
    preferredAnchors: LayoutAnchorId[];
    faceSafeMargin: number;
    avoidMouth: boolean;
    avoidOcr: boolean;
    maxLinesPerBlock: number;
    splitPacingStyle: 'balanced' | 'punchy' | 'split-screen' | 'editorial';
    accentShape?: {
      enabled: boolean;
      shapeType: OverlayShapeType;
      fillColor: string;
      strokeColor: string;
      strokeWidth: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };
    titleOverlay?: {
      enabled: boolean;
      defaultText: string;
      fontFamily: string;
      fontSize: number;
      fontWeight: 500 | 600 | 700;
      color: string;
      y: number;
    };
  };
  adaptation: {
    aspectOverrides: Partial<
      Record<AspectRatio, { frameInset?: number; scaleMul?: number; fontSizeScale?: number }>
    >;
    autoWrapMaxWidthRatio: number;
    orphanAvoidance: boolean;
    longSentenceStrategy: 'split-phrases' | 'scale-down' | 'stack-vertical';
  };
  animation: {
    preferredPreset: AnimationPreset;
    heroPreset: AnimationPreset;
    supportingPreset: AnimationPreset;
    springStiffness: number;
    springDamping: number;
    springMass: number;
    anticipationMs: number;
    motionBlurStrength: number;
    staggerMs: number;
  };
  colour: ColorAdjustments;
  audio: {
    enabled: boolean;
    heroSfx: SoundEffectType;
    transitionSfx: SoundEffectType;
    cueVolume: number;
  };
  assets: Array<{
    path: string;
    role: 'font' | 'overlay' | 'lut' | 'preview';
    mimeType: string;
    optional?: boolean;
  }>;
  preview: {
    sampleTitle: string;
    sampleHeroWord: string;
    sampleCaption: string;
    sampleKicker: string;
  };
  metadata: {
    author: string;
    source: 'built-in' | 'creator' | 'imported' | 'gemini-assisted' | 'video-cloned';
    license: string;
    createdAt: number;
    notes?: string;
  };
}

export interface TemplateConfig {
  aspectRatio: AspectRatio;
  backgroundColor: string;
  frameInset: number;
  frameRadius: number;
  borderColor?: string;
  borderWidth?: number;
  fitMode: FitMode;
  vignetteStrength: number;
  colorGrade: ColorAdjustments;
  typography?: {
    heroFont: string;
    bodyFont: string;
    annotationFont?: string;
    kickerFont?: string;
    heroColor: string;
    bodyColor: string;
    panelColor: string;
    preferredAnimation: AnimationPreset;
    springStiffness: number;
    springDamping: number;
    anticipationMs: number;
  };
  soundProfile?: {
    enabled: boolean;
    heroSfx: SoundEffectType;
    transitionSfx: SoundEffectType;
  };
  preferredAnchors?: LayoutAnchorId[];
  titleOverlay?: {
    enabled: boolean;
    defaultText: string;
    fontFamily: string;
    fontSize: number;
    fontWeight: 500 | 600 | 700;
    color: string;
    y: number;
  };
  accentShape?: {
    enabled: boolean;
    shapeType: OverlayShapeType;
    fillColor: string;
    strokeColor: string;
    strokeWidth: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface TemplateDefinition {
  id: string;
  schemaVersion: number;
  name: string;
  description: string;
  category: string;
  tags: string[];
  aspectRatio: AspectRatio;
  version: string;
  previewImage: string;
  isFavorite: boolean;
  isBuiltIn: boolean;
  createdAt: number;
  assetReferences: string[];
  license?: string;
  config: TemplateConfig;
  manifest?: CutFlowTemplateManifest;
}

export interface CFTemplatePackageManifest {
  packageFormat: 'cftemplate';
  manifestVersion: number;
  template: TemplateDefinition | CutFlowTemplateManifest;
  assets: Array<{ path: string; mimeType: string; role: 'preview' | 'overlay' | 'font' }>;
}

export type RenderJobStatus =
  | 'queued'
  | 'preparing'
  | 'analyzing'
  | 'transcribing'
  | 'planning'
  | 'rendering'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RenderJob {
  id: string;
  projectId: string;
  sourceProjectId?: string;
  templateId?: string;
  templateName?: string;
  outputName: string;
  status: RenderJobStatus;
  progress: number;
  stage: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
  outputId?: string;
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface FinalOutputItem {
  id: string;
  name: string;
  projectId: string;
  sourceProjectId?: string;
  templateId?: string;
  templateName?: string;
  durationSec: number;
  width: number;
  height: number;
  fps: 30 | 60;
  mimeType: string;
  sizeBytes: number;
  storageBackend: StorageBackend;
  storageKey: string;
  posterDataUrl: string;
  renderStatus: 'ready' | 'error';
  approvalStatus: ApprovalStatus;
  editableProjectSnapshot: CutFlowProject;
  createdAt: number;
  updatedAt: number;
}

export type PerformanceMode = 'balanced' | 'quality' | 'low-memory';

export interface InstalledAssetEntry {
  id: string;
  name: string;
  kind: 'asr' | 'vad' | 'vision' | 'ocr' | 'wasm' | 'fonts' | 'templates';
  status: 'ready' | 'failed' | 'skipped';
  sizeBytes: number;
  provider?: string;
  verifiedAt?: number;
  error?: string;
}

export interface SetupConfig {
  setupComplete: boolean;
  completedAt?: number;
  preferredWorkflow: 'video-edit' | 'templates' | 'both';
  defaultAspectRatio: AspectRatio;
  preferredLanguages: string[];
  romanizationStyle: RomanizationStyle;
  performanceProfile: PerformanceMode;
  exportResolution: '1080p' | '720p';
  exportFps: 30 | 60;
  selectedAsrModelId: string;
  selectedVisionModelIds: string[];
  installLocalFonts: boolean;
  offlineReady: boolean;
  installedManifest: InstalledAssetEntry[];
  verifiedProviderReport?: {
    asrProvider: string;
    asrVerified: boolean;
    visionProvider: string;
    offlineReady: boolean;
    checkedAt: number;
  };
}

export interface UserFontRecord {
  id: string;
  familyName: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  licenseNote?: string;
  data: ArrayBuffer;
  createdAt: number;
}

export interface AppSettings {
  theme: 'dark' | 'light';
  defaultResolution: '1080p' | '720p';
  defaultFps: 30 | 60;
  defaultAspectRatio?: AspectRatio;
  performanceMode: PerformanceMode;
  autoSaveEnabled: boolean;
  autoSaveIntervalMs: number;
  romanizationStyle: RomanizationStyle;
  customVocabulary: CustomVocabEntry[];
  preferredWhisperModelId: string;
  autoSoundDesign: boolean;
  inputPreferences: InputPreferences;
}

export type SelectionTarget =
  | { kind: 'clip'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'overlay'; id: string }
  | null;
