import {
  AspectRatio,
  ClipTransform,
  ColorAdjustments,
  CutFlowProject,
  OverlayLayer,
  PROJECT_SCHEMA_VERSION,
  TEMPLATE_SCHEMA_VERSION,
  TemplateDefinition,
  TextLayer,
  TimelineClip,
  TimelineTrack,
} from '../types/project';

export function createId(prefix = 'cf'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function getDimensionsForAspectRatio(
  aspectRatio: AspectRatio,
  resolution: '1080p' | '720p' = '1080p'
): { width: number; height: number } {
  const shortSide = resolution === '1080p' ? 1080 : 720;
  const longSide = resolution === '1080p' ? 1920 : 1280;
  if (aspectRatio === '9:16') return { width: shortSide, height: longSide };
  if (aspectRatio === '1:1') return { width: shortSide, height: shortSide };
  return { width: longSide, height: shortSide };
}

export function defaultTransform(): ClipTransform {
  return {
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 1,
    fitMode: 'fit',
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
  };
}

export function defaultColorAdjustments(): ColorAdjustments {
  return {
    brightness: 0,
    contrast: 0,
    saturation: 0,
    blur: 0,
    exposure: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    vibrance: 0,
    gamma: 1,
    vignette: 0,
    sharpen: 0,
    grain: 0,
    lift: 0,
    gain: 1,
  };
}

export function createDefaultTracks(): TimelineTrack[] {
  return [
    { id: 'track_overlay_1', name: 'Text & Overlays', kind: 'overlay', order: 0, muted: false, locked: false, visible: true },
    { id: 'track_video_2', name: 'PiP / Video 2', kind: 'video', order: 1, muted: false, locked: false, visible: true },
    { id: 'track_video_1', name: 'Main Video', kind: 'video', order: 2, muted: false, locked: false, visible: true },
    { id: 'track_audio_1', name: 'Audio', kind: 'audio', order: 3, muted: false, locked: false, visible: true },
  ];
}

export function createEmptyProject(params: {
  name: string;
  type: 'edit' | 'template-prep' | 'output';
  aspectRatio?: AspectRatio;
  resolution?: '1080p' | '720p';
  fps?: 30 | 60;
}): CutFlowProject {
  const aspectRatio = params.aspectRatio ?? (params.type === 'template-prep' ? '9:16' : '16:9');
  const resolution = params.resolution ?? '1080p';
  const { width, height } = getDimensionsForAspectRatio(aspectRatio, resolution);
  const now = Date.now();
  return {
    id: createId('proj'),
    name: params.name,
    createdAt: now,
    updatedAt: now,
    type: params.type,
    aspectRatio,
    width,
    height,
    fps: params.fps ?? 30,
    maxDurationSec: params.type === 'template-prep' ? 300 : 1200,
    media: [],
    tracks: createDefaultTracks(),
    clips: [],
    textLayers: [],
    overlayLayers: [],
    exportSettings: {
      resolution,
      fps: params.fps ?? 30,
      format: 'mp4',
      quality: 'high',
    },
    version: PROJECT_SCHEMA_VERSION,
  };
}

export function formatTimecode(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * 30);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, exp);
  return `${val.toFixed(exp === 0 ? 0 : 1)} ${units[exp]}`;
}

export function computeProjectDuration(project: CutFlowProject): number {
  let maxEnd = 0;
  for (const clip of project.clips) {
    maxEnd = Math.max(maxEnd, clip.startTime + clip.duration);
  }
  for (const text of project.textLayers) {
    maxEnd = Math.max(maxEnd, text.startTime + text.duration);
  }
  for (const overlay of project.overlayLayers) {
    maxEnd = Math.max(maxEnd, overlay.startTime + overlay.duration);
  }
  return Math.min(project.maxDurationSec, maxEnd);
}

export function snapTime(timeSec: number, candidates: number[], thresholdSec = 0.18): number {
  let best = timeSec;
  let minDiff = thresholdSec;
  for (const c of candidates) {
    const diff = Math.abs(timeSec - c);
    if (diff < minDiff) {
      minDiff = diff;
      best = c;
    }
  }
  return Math.max(0, Number(best.toFixed(4)));
}

export function splitClipAtTime(
  clip: TimelineClip,
  playheadTime: number,
  minClipDuration = 0.2
): [TimelineClip, TimelineClip] | null {
  const rel = playheadTime - clip.startTime;
  if (rel <= minClipDuration || clip.duration - rel <= minClipDuration) {
    return null;
  }

  const speed = Math.max(0.25, clip.speed || 1);
  const splitSourceOffset = rel * speed;
  const splitSourceTime = clip.sourceIn + splitSourceOffset;

  const left: TimelineClip = {
    ...clip,
    duration: Number(rel.toFixed(4)),
    sourceOut: Number(splitSourceTime.toFixed(4)),
    fadeOutSec: Math.min(clip.fadeOutSec, rel * 0.5),
  };

  const rightDuration = clip.duration - rel;
  const right: TimelineClip = {
    ...clip,
    id: createId('clip'),
    startTime: Number(playheadTime.toFixed(4)),
    duration: Number(rightDuration.toFixed(4)),
    sourceIn: Number(splitSourceTime.toFixed(4)),
    fadeInSec: Math.min(clip.fadeInSec, rightDuration * 0.5),
    transform: { ...clip.transform, crop: { ...clip.transform.crop } },
    color: { ...clip.color },
  };

  return [left, right];
}

export function clampTrimStart(
  clip: TimelineClip,
  newStartTime: number,
  minDuration = 0.2
): TimelineClip {
  const maxStart = clip.startTime + clip.duration - minDuration;
  const clampedStart = Math.min(Math.max(0, newStartTime), maxStart);
  const deltaTimeline = clampedStart - clip.startTime;
  const speed = Math.max(0.25, clip.speed || 1);
  const nextSourceIn = Math.max(0, clip.sourceIn + deltaTimeline * speed);
  const actualDeltaTimeline = (nextSourceIn - clip.sourceIn) / speed;
  const finalStart = clip.startTime + actualDeltaTimeline;
  const finalDuration = Math.max(minDuration, clip.duration - actualDeltaTimeline);

  return {
    ...clip,
    startTime: Number(finalStart.toFixed(4)),
    duration: Number(finalDuration.toFixed(4)),
    sourceIn: Number(nextSourceIn.toFixed(4)),
  };
}

export function clampTrimEnd(
  clip: TimelineClip,
  newDuration: number,
  maxSourceDuration: number,
  minDuration = 0.2
): TimelineClip {
  const speed = Math.max(0.25, clip.speed || 1);
  const maxPossibleDuration =
    maxSourceDuration > 0
      ? Math.max(minDuration, (maxSourceDuration - clip.sourceIn) / speed)
      : newDuration;
  const clampedDuration = Math.min(Math.max(minDuration, newDuration), maxPossibleDuration);
  const nextSourceOut = clip.sourceIn + clampedDuration * speed;

  return {
    ...clip,
    duration: Number(clampedDuration.toFixed(4)),
    sourceOut: Number(nextSourceOut.toFixed(4)),
  };
}

export function mapTimelineTimeToSourceTime(clip: TimelineClip, timelineTime: number): number {
  const offset = Math.max(0, timelineTime - clip.startTime);
  const speed = Math.max(0.25, clip.speed || 1);
  const raw = clip.sourceIn + offset * speed;
  return Math.min(clip.sourceOut, Math.max(clip.sourceIn, raw));
}

export function computeClipAudioGain(clip: TimelineClip, timelineTime: number): number {
  if (clip.muted || clip.volume <= 0) return 0;
  const rel = timelineTime - clip.startTime;
  if (rel < 0 || rel > clip.duration) return 0;

  let fadeGain = 1;
  if (clip.fadeInSec > 0 && rel < clip.fadeInSec) {
    fadeGain *= Math.max(0, rel / clip.fadeInSec);
  }
  const timeToEnd = clip.duration - rel;
  if (clip.fadeOutSec > 0 && timeToEnd < clip.fadeOutSec) {
    fadeGain *= Math.max(0, timeToEnd / clip.fadeOutSec);
  }
  return Math.max(0, Math.min(2, clip.volume * fadeGain));
}

export function getActiveElementsAtTime(project: CutFlowProject, timeSec: number): {
  clips: TimelineClip[];
  texts: TextLayer[];
  overlays: OverlayLayer[];
} {
  const trackMap = new Map(project.tracks.map((t) => [t.id, t]));
  const isTrackVisible = (trackId: string): boolean => {
    const t = trackMap.get(trackId);
    return t ? t.visible : true;
  };

  const clips = project.clips
    .filter((c) => isTrackVisible(c.trackId) && timeSec >= c.startTime && timeSec < c.startTime + c.duration)
    .sort((a, b) => {
      const ta = trackMap.get(a.trackId)?.order ?? 0;
      const tb = trackMap.get(b.trackId)?.order ?? 0;
      return tb - ta; // draw lower order (background) first, higher priority tracks on top
    });

  const texts = project.textLayers.filter(
    (l) => isTrackVisible(l.trackId) && timeSec >= l.startTime && timeSec < l.startTime + l.duration
  );

  const overlays = project.overlayLayers.filter(
    (o) => isTrackVisible(o.trackId) && timeSec >= o.startTime && timeSec < o.startTime + o.duration
  );

  return { clips, texts, overlays };
}

export interface DrawGeometry {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

export function computeDrawRect(
  srcWidth: number,
  srcHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  transform: ClipTransform
): DrawGeometry {
  const safeSrcW = Math.max(1, srcWidth);
  const safeSrcH = Math.max(1, srcHeight);
  const crop = transform.crop;

  const sx = Math.max(0, Math.min(0.45, crop.left)) * safeSrcW;
  const sy = Math.max(0, Math.min(0.45, crop.top)) * safeSrcH;
  const rightCut = Math.max(0, Math.min(0.45, crop.right)) * safeSrcW;
  const bottomCut = Math.max(0, Math.min(0.45, crop.bottom)) * safeSrcH;
  const sw = Math.max(1, safeSrcW - sx - rightCut);
  const sh = Math.max(1, safeSrcH - sy - bottomCut);

  let baseW = canvasWidth;
  let baseH = canvasHeight;

  if (transform.fitMode === 'fit') {
    const scaleFactor = Math.min(canvasWidth / sw, canvasHeight / sh);
    baseW = sw * scaleFactor;
    baseH = sh * scaleFactor;
  } else if (transform.fitMode === 'fill') {
    const scaleFactor = Math.max(canvasWidth / sw, canvasHeight / sh);
    baseW = sw * scaleFactor;
    baseH = sh * scaleFactor;
  }

  const dw = baseW * transform.scale;
  const dh = baseH * transform.scale;
  const dx = -dw / 2;
  const dy = -dh / 2;

  return { sx, sy, sw, sh, dx, dy, dw, dh };
}

export function migrateProjectSchema(raw: CutFlowProject): CutFlowProject {
  return {
    ...raw,
    version: PROJECT_SCHEMA_VERSION,
    tracks: raw.tracks?.length ? raw.tracks : createDefaultTracks(),
    clips: (raw.clips ?? []).map((c) => ({
      ...c,
      transform: { ...defaultTransform(), ...(c.transform ?? {}), crop: { ...defaultTransform().crop, ...(c.transform?.crop ?? {}) } },
      color: { ...defaultColorAdjustments(), ...(c.color ?? {}) },
      fadeInSec: c.fadeInSec ?? 0,
      fadeOutSec: c.fadeOutSec ?? 0,
      speed: c.speed ?? 1,
      volume: c.volume ?? 1,
      muted: Boolean(c.muted),
    })),
    textLayers: raw.textLayers ?? [],
    overlayLayers: raw.overlayLayers ?? [],
  };
}

export function cloneProject(project: CutFlowProject, overrides?: Partial<CutFlowProject>): CutFlowProject {
  const cloned = JSON.parse(JSON.stringify(project)) as CutFlowProject;
  return {
    ...cloned,
    ...overrides,
    updatedAt: Date.now(),
  };
}

export function projectsEqual(a: CutFlowProject, b: CutFlowProject): boolean {
  const stripMeta = (p: CutFlowProject) => ({
    ...p,
    updatedAt: 0,
  });
  return JSON.stringify(stripMeta(a)) === JSON.stringify(stripMeta(b));
}

export interface TemplateValidationResult {
  valid: boolean;
  error?: string;
  template?: TemplateDefinition;
}

function containsUnsafeScript(value: unknown): boolean {
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    return (
      lower.includes('<script') ||
      lower.includes('javascript:') ||
      lower.includes('eval(') ||
      lower.includes('new function')
    );
  }
  if (Array.isArray(value)) {
    return value.some(containsUnsafeScript);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsUnsafeScript);
  }
  return false;
}

export function validateTemplateJson(raw: unknown): TemplateValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Template JSON must be an object.' };
  }

  if (containsUnsafeScript(raw)) {
    return { valid: false, error: 'Rejected template: executable script patterns are not permitted.' };
  }

  const candidate = raw as Partial<TemplateDefinition>;
  if (!candidate.name || typeof candidate.name !== 'string') {
    return { valid: false, error: 'Template missing required string field "name".' };
  }
  if (!candidate.config || typeof candidate.config !== 'object') {
    return { valid: false, error: 'Template missing required "config" object.' };
  }
  const aspectRatio = candidate.aspectRatio ?? candidate.config.aspectRatio ?? '9:16';
  if (aspectRatio !== '9:16' && aspectRatio !== '1:1' && aspectRatio !== '16:9') {
    return { valid: false, error: 'Unsupported template aspect ratio.' };
  }

  const normalized: TemplateDefinition = {
    id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : createId('tpl'),
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    name: candidate.name.trim().slice(0, 80),
    description: typeof candidate.description === 'string' ? candidate.description.slice(0, 240) : '',
    category: typeof candidate.category === 'string' && candidate.category.trim() ? candidate.category : 'Custom',
    tags: Array.isArray(candidate.tags) ? candidate.tags.filter((t): t is string => typeof t === 'string').slice(0, 8) : [],
    aspectRatio,
    version: typeof candidate.version === 'string' ? candidate.version : '1.0.0',
    previewImage: typeof candidate.previewImage === 'string' ? candidate.previewImage : '',
    isFavorite: Boolean(candidate.isFavorite),
    isBuiltIn: false,
    createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
    assetReferences: Array.isArray(candidate.assetReferences)
      ? candidate.assetReferences.filter((a): a is string => typeof a === 'string')
      : [],
    config: {
      aspectRatio,
      backgroundColor: typeof candidate.config.backgroundColor === 'string' ? candidate.config.backgroundColor : '#0B0C0E',
      frameInset: typeof candidate.config.frameInset === 'number' ? Math.max(0, Math.min(0.25, candidate.config.frameInset)) : 0.05,
      frameRadius: typeof candidate.config.frameRadius === 'number' ? Math.max(0, Math.min(64, candidate.config.frameRadius)) : 12,
      borderColor: typeof candidate.config.borderColor === 'string' ? candidate.config.borderColor : undefined,
      borderWidth: typeof candidate.config.borderWidth === 'number' ? Math.max(0, Math.min(16, candidate.config.borderWidth)) : 0,
      fitMode:
        candidate.config.fitMode === 'fill' || candidate.config.fitMode === 'stretch' || candidate.config.fitMode === 'fit'
          ? candidate.config.fitMode
          : 'fill',
      vignetteStrength:
        typeof candidate.config.vignetteStrength === 'number'
          ? Math.max(0, Math.min(1, candidate.config.vignetteStrength))
          : 0,
      colorGrade: {
        ...defaultColorAdjustments(),
        ...(candidate.config.colorGrade ?? {}),
      },
      typography: candidate.config.typography,
      soundProfile: candidate.config.soundProfile,
      preferredAnchors: candidate.config.preferredAnchors,
      titleOverlay: candidate.config.titleOverlay,
      accentShape: candidate.config.accentShape,
    },
  };

  return { valid: true, template: normalized };
}
