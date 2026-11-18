import {
  EditorialPlan,
  EditorialPlanItem,
  LayoutAnchorId,
  NormalizedBox,
  SceneCompositionMap,
  SceneCompositionRecord,
  SoundCueEvent,
  TemplateDefinition,
  TextLayer,
  TranscriptSegment,
  TypographyRole,
  TypographyRoleRule,
} from '../types/project';
import { createId } from './timelineMath';
import { defaultKineticAnimation } from './motionPhysics';

const INTENSIFIER_WORDS = new Set([
  'asli', 'jannat', 'best', 'worst', 'crazy', 'insane', 'literally', 'actually',
  'bahut', 'sabse', 'super', 'ultra', 'pro', 'secret', 'never', 'always', 'free',
  'real', 'fake', 'only', 'first', 'final', 'massive', 'huge', 'zero', 'perfect',
  'amazing', 'dhamaka', 'gazab', 'mast', 'bhai', 'important', 'must', 'stop',
]);

const FILLER_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on', 'for', 'and',
  'ye', 'wo', 'hai', 'hain', 'ka', 'ki', 'ke', 'ko', 'se', 'mein', 'toh', 'bhi', 'hi',
]);

export interface LinguisticHierarchy {
  setupPhrase?: string;
  heroWord?: string;
  supportingPhrase?: string;
  dominantRole: TypographyRole;
}

export function analyzeLinguisticHierarchy(text: string): LinguisticHierarchy {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { dominantRole: 'standard' };
  if (words.length === 1) {
    return { heroWord: words[0], dominantRole: 'hero' };
  }

  let bestIdx = -1;
  let bestScore = -1;

  for (let i = 0; i < words.length; i++) {
    const clean = words[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!clean) continue;
    let score = 0;

    if (INTENSIFIER_WORDS.has(clean)) score += 4;
    if (/\d/.test(clean)) score += 3.5;
    if (words[i].includes('!') || words[i].includes('?')) score += 2.5;
    if (!FILLER_WORDS.has(clean) && clean.length >= 5) score += 2;
    if (words[i] === words[i].toUpperCase() && clean.length >= 2) score += 2;
    if (i > 0 && i < words.length - 1) score += 0.6;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx === -1 || bestScore < 2) {
    return { dominantRole: 'standard' };
  }

  const setup = words.slice(0, bestIdx).join(' ').trim();
  const hero = words[bestIdx].replace(/[,.!?]+$/, '');
  const support = words.slice(bestIdx + 1).join(' ').trim();

  return {
    setupPhrase: setup || undefined,
    heroWord: hero,
    supportingPhrase: support || undefined,
    dominantRole: /\d/.test(hero) ? 'stat' : 'hero',
  };
}

/**
 * Wraps caption text cleanly to aspect-safe line lengths while avoiding single-word orphans.
 */
export function wrapCaptionTextBalanced(params: {
  text: string;
  maxCharsPerLine?: number;
  orphanAvoidance?: boolean;
}): string {
  const { text, maxCharsPerLine = 26, orphanAvoidance = true } = params;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length <= maxCharsPerLine) return clean;

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);

  // Pull a word down from previous line if the last line ended up with a single orphan word
  if (orphanAvoidance && lines.length >= 2) {
    const lastLineWords = lines[lines.length - 1].split(' ');
    const prevLineWords = lines[lines.length - 2].split(' ');
    if (lastLineWords.length === 1 && prevLineWords.length >= 3) {
      const moved = prevLineWords.pop()!;
      lines[lines.length - 2] = prevLineWords.join(' ');
      lines[lines.length - 1] = `${moved} ${lastLineWords[0]}`;
    }
  }

  return lines.join('\n');
}

export const ANCHOR_COORDS: Record<LayoutAnchorId, { x: number; y: number; box: NormalizedBox }> = {
  'upper-left': { x: -0.22, y: -0.34, box: { x: 0.06, y: 0.08, width: 0.44, height: 0.14 } },
  'top-center': { x: 0, y: -0.34, box: { x: 0.14, y: 0.08, width: 0.72, height: 0.14 } },
  'upper-right': { x: 0.22, y: -0.34, box: { x: 0.5, y: 0.08, width: 0.44, height: 0.14 } },
  'center-left': { x: -0.22, y: 0, box: { x: 0.06, y: 0.43, width: 0.44, height: 0.14 } },
  'center': { x: 0, y: 0, box: { x: 0.14, y: 0.43, width: 0.72, height: 0.14 } },
  'center-right': { x: 0.22, y: 0, box: { x: 0.5, y: 0.43, width: 0.44, height: 0.14 } },
  'lower-left': { x: -0.22, y: 0.3, box: { x: 0.06, y: 0.73, width: 0.44, height: 0.14 } },
  'lower-center': { x: 0, y: 0.3, box: { x: 0.14, y: 0.73, width: 0.72, height: 0.14 } },
  'lower-right': { x: 0.22, y: 0.3, box: { x: 0.5, y: 0.73, width: 0.44, height: 0.14 } },
};

export function boxIntersectionArea(a: NormalizedBox, b: NormalizedBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  return (x2 - x1) * (y2 - y1);
}

export function selectBestAnchorForScene(params: {
  scene?: SceneCompositionRecord;
  preferredAnchors?: LayoutAnchorId[];
  previousAnchor?: LayoutAnchorId;
  isSceneCut: boolean;
}): { anchor: LayoutAnchorId; faceSafeScore: number; reason: string } {
  const { scene, preferredAnchors, previousAnchor, isSceneCut } = params;
  const candidates: LayoutAnchorId[] = preferredAnchors?.length
    ? preferredAnchors
    : [
        'lower-center',
        'top-center',
        'upper-left',
        'upper-right',
        'lower-left',
        'lower-right',
        'center-left',
        'center-right',
      ];

  let bestAnchor: LayoutAnchorId = candidates[0];
  let bestScore = -Infinity;
  let bestFacePenalty = 0;

  for (let idx = 0; idx < candidates.length; idx++) {
    const id = candidates[idx];
    const candidateBox = ANCHOR_COORDS[id].box;
    const area = Math.max(0.001, candidateBox.width * candidateBox.height);

    let score = 1.0 - idx * 0.04;
    let facePenalty = 0;

    if (scene) {
      for (const mouth of scene.mouthBoxes) {
        facePenalty += (boxIntersectionArea(candidateBox, mouth) / area) * 5.0;
      }
      for (const eye of scene.eyeBoxes) {
        facePenalty += (boxIntersectionArea(candidateBox, eye) / area) * 3.5;
      }
      for (const face of scene.faceBoxes) {
        facePenalty += (boxIntersectionArea(candidateBox, face) / area) * 2.2;
      }
      for (const silhouette of scene.personSilhouetteBoxes ?? []) {
        score -= (boxIntersectionArea(candidateBox, silhouette) / area) * 1.4;
      }
      for (const pose of scene.poseBoxes ?? []) {
        score -= (boxIntersectionArea(candidateBox, pose) / area) * 1.1;
      }
      for (const obj of scene.objectBoxes ?? []) {
        score -= (boxIntersectionArea(candidateBox, obj) / area) * 0.9;
      }
      for (const ocr of scene.ocrRegions) {
        score -= (boxIntersectionArea(candidateBox, ocr) / area) * 2.2;
      }
      for (const neg of scene.negativeSpaceBoxes) {
        score += (boxIntersectionArea(candidateBox, neg) / area) * 0.9;
      }
    }

    score -= facePenalty;

    if (!isSceneCut && previousAnchor && id === previousAnchor) {
      score += 0.35;
    }

    if (score > bestScore) {
      bestScore = score;
      bestAnchor = id;
      bestFacePenalty = facePenalty;
    }
  }

  const faceSafeScore = Math.max(0, Math.min(1, 1 - bestFacePenalty));
  const reason =
    bestFacePenalty > 0.1
      ? 'Fallback placement: limited clear negative space in frame'
      : scene?.mouthBoxes.length
        ? 'Mouth-safe negative-space anchor selected'
        : scene?.personSilhouetteBoxes?.length || scene?.objectBoxes?.length
          ? 'Silhouette- & object-aware negative-space anchor selected'
          : 'Balanced composition anchor selected';

  return { anchor: bestAnchor, faceSafeScore, reason };
}

export function buildEditorialPlan(params: {
  projectId: string;
  segments: TranscriptSegment[];
  sceneMap?: SceneCompositionMap;
  template?: TemplateDefinition;
}): EditorialPlan {
  const { projectId, segments, sceneMap, template } = params;
  const items: EditorialPlanItem[] = [];
  let prevAnchor: LayoutAnchorId | undefined;
  let prevSceneId: string | undefined;

  for (const seg of segments) {
    const mid = (seg.startSec + seg.endSec) / 2;
    const scene =
      sceneMap?.scenes.find((s) => mid >= s.startSec && mid <= s.endSec) ?? sceneMap?.scenes[0];
    const isSceneCut = Boolean(scene && prevSceneId && scene.sceneId !== prevSceneId);

    const { anchor, faceSafeScore, reason } = selectBestAnchorForScene({
      scene,
      preferredAnchors: template?.manifest?.layout.preferredAnchors ?? template?.config.preferredAnchors,
      previousAnchor: prevAnchor,
      isSceneCut,
    });

    const hierarchy = analyzeLinguisticHierarchy(seg.text);
    const coords = ANCHOR_COORDS[anchor];
    const tplAnim = template?.manifest?.animation;
    const tplTypo = template?.config.typography;
    const baseAnim = defaultKineticAnimation();

    const preset = hierarchy.heroWord
      ? tplAnim?.heroPreset ?? tplTypo?.preferredAnimation ?? 'spring-pop'
      : tplAnim?.supportingPreset ?? tplTypo?.preferredAnimation ?? 'fade';

    items.push({
      id: createId('plan'),
      segmentId: seg.id,
      startSec: seg.startSec,
      endSec: seg.endSec,
      setupPhrase: hierarchy.setupPhrase,
      heroWord: hierarchy.heroWord,
      supportingPhrase: hierarchy.supportingPhrase,
      fullText: seg.text,
      role: hierarchy.dominantRole,
      anchorZone: anchor,
      anchorX: coords.x,
      anchorY: coords.y,
      animation: {
        ...baseAnim,
        preset,
        springStiffness: tplAnim?.springStiffness ?? tplTypo?.springStiffness ?? baseAnim.springStiffness,
        springDamping: tplAnim?.springDamping ?? tplTypo?.springDamping ?? baseAnim.springDamping,
        springMass: tplAnim?.springMass ?? baseAnim.springMass,
        anticipationMs: tplAnim?.anticipationMs ?? tplTypo?.anticipationMs ?? baseAnim.anticipationMs,
        motionBlurStrength: tplAnim?.motionBlurStrength ?? baseAnim.motionBlurStrength,
        staggerMs: tplAnim?.staggerMs ?? baseAnim.staggerMs,
      },
      sfx:
        hierarchy.heroWord && (template?.manifest?.audio.enabled ?? template?.config.soundProfile?.enabled ?? true)
          ? template?.manifest?.audio.heroSfx ?? template?.config.soundProfile?.heroSfx ?? 'soft-pop'
          : 'none',
      faceSafeScore,
      reason,
    });

    prevAnchor = anchor;
    prevSceneId = scene?.sceneId;
  }

  return {
    id: createId('eplan'),
    projectId,
    templateId: template?.id,
    createdAt: Date.now(),
    items,
  };
}

function pickRuleForRole(template: TemplateDefinition | undefined, role: TypographyRole): TypographyRoleRule | null {
  const typo = template?.manifest?.typography;
  if (!typo) return null;
  if (role === 'hero' || role === 'stat') return typo.hero;
  if (role === 'supporting') return typo.supporting;
  if (role === 'annotation') return typo.annotation;
  return typo.standard;
}

export function editorialPlanToTimelineLayers(params: {
  plan: EditorialPlan;
  segments: TranscriptSegment[];
  overlayTrackId: string;
  template?: TemplateDefinition;
  enableSoundDesign: boolean;
}): { textLayers: TextLayer[]; soundCues: SoundCueEvent[] } {
  const { plan, segments, overlayTrackId, template, enableSoundDesign } = params;
  const textLayers: TextLayer[] = [];
  const soundCues: SoundCueEvent[] = [];

  const typo = template?.config.typography;
  const orphanAvoidance = template?.manifest?.adaptation.orphanAvoidance ?? true;
  const targetRatio = template?.aspectRatio ?? '9:16';
  const ratioScale =
    template?.manifest?.adaptation.aspectOverrides[targetRatio]?.fontSizeScale ??
    (targetRatio === '16:9' ? 0.88 : 1);

  for (const item of plan.items) {
    const seg = segments.find((s) => s.id === item.segmentId);
    const isHero = item.role === 'hero' || item.role === 'stat';
    const roleRule = pickRuleForRole(template, item.role);

    const fontFamily =
      roleRule?.fontFamily ?? (isHero ? typo?.heroFont ?? 'Space Grotesk' : typo?.bodyFont ?? 'Inter');
    const fontWeight = roleRule?.fontWeight ?? (isHero ? 700 : 600);
    const baseSize = isHero ? 56 : 46;
    const fontSize = Math.round(baseSize * (roleRule?.sizeRatio ?? (isHero ? 1.2 : 1)) * ratioScale);
    const color = roleRule?.color ?? (isHero ? typo?.heroColor ?? '#F4F5F7' : typo?.bodyColor ?? '#F4F5F7');
    const backgroundColor =
      roleRule?.backgroundColor ?? typo?.panelColor ?? 'rgba(11,12,14,0.68)';

    const maxChars = targetRatio === '9:16' ? 22 : targetRatio === '1:1' ? 28 : 38;
    const wrappedText = wrapCaptionTextBalanced({
      text: item.fullText,
      maxCharsPerLine: maxChars,
      orphanAvoidance,
    });

    const layerId = createId('txt');
    textLayers.push({
      id: layerId,
      trackId: overlayTrackId,
      text: wrappedText,
      startTime: item.startSec,
      duration: Math.max(0.4, Number((item.endSec - item.startSec).toFixed(3))),
      fontFamily,
      fontSize,
      fontWeight,
      color,
      backgroundColor,
      align: item.anchorZone.includes('left')
        ? 'left'
        : item.anchorZone.includes('right')
          ? 'right'
          : 'center',
      x: item.anchorX,
      y: item.anchorY,
      scale: 1,
      opacity: 1,
      rotation: 0,
      role: item.role,
      letterSpacing: roleRule?.letterSpacing,
      lineHeight: roleRule?.lineHeight,
      textCase: roleRule?.textCase,
      cornerRadius: 10,
      animation: item.animation,
      words: seg?.words,
      anchorZone: item.anchorZone,
      transcriptSegmentId: item.segmentId,
    });

    if (enableSoundDesign && item.sfx !== 'none') {
      soundCues.push({
        id: createId('sfx'),
        timeSec: item.startSec,
        effect: item.sfx,
        volume: template?.manifest?.audio.cueVolume ?? 0.25,
        linkedLayerId: layerId,
      });
    }
  }

  return { textLayers, soundCues };
}
