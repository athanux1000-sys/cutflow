import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeLinguisticHierarchy,
  buildEditorialPlan,
  selectBestAnchorForScene,
  wrapCaptionTextBalanced,
} from './editorialPlanner';
import { SceneCompositionRecord, TranscriptSegment } from '../types/project';

test('analyzeLinguisticHierarchy identifies expressive hero word and setup/support phrases', () => {
  const res = analyzeLinguisticHierarchy('Ye asli jannat hai bhai!');
  assert.ok(res.heroWord === 'asli' || res.heroWord === 'jannat' || res.heroWord === 'bhai');
  assert.equal(res.dominantRole, 'hero');

  const statRes = analyzeLinguisticHierarchy('We grew 300% in 10 days');
  assert.equal(statRes.dominantRole, 'stat');
  assert.equal(statRes.heroWord, '300%');
});

test('selectBestAnchorForScene avoids speaker mouth and OCR boxes', () => {
  // Speaker mouth positioned in lower-center region (y: 0.72..0.85, x: 0.35..0.65)
  const scene: SceneCompositionRecord = {
    sceneId: 'sc_1',
    startSec: 0,
    endSec: 10,
    cutConfidence: 1,
    faceBoxes: [{ x: 0.3, y: 0.55, width: 0.4, height: 0.35 }],
    mouthBoxes: [{ x: 0.4, y: 0.74, width: 0.2, height: 0.1 }],
    eyeBoxes: [{ x: 0.38, y: 0.62, width: 0.24, height: 0.06 }],
    ocrRegions: [{ x: 0.1, y: 0.08, width: 0.8, height: 0.12, text: 'TOP TITLE' }],
    negativeSpaceBoxes: [{ x: 0.06, y: 0.42, width: 0.3, height: 0.2 }],
    motionScore: 0.2,
    brightnessAvg: 0.5,
    dominantPalette: ['#111111'],
    suggestedAnchor: 'center-left',
    limitations: [],
  };

  const chosen = selectBestAnchorForScene({
    scene,
    preferredAnchors: ['lower-center', 'top-center', 'center-left'],
    isSceneCut: false,
  });

  // Should avoid both lower-center (mouth collision) and top-center (OCR collision)
  assert.equal(chosen.anchor, 'center-left');
  assert.ok(chosen.faceSafeScore > 0.85);
});

test('selectBestAnchorForScene avoids personSilhouetteBoxes, poseBoxes, and objectBoxes', () => {
  const scene: SceneCompositionRecord = {
    sceneId: 'sc_2',
    startSec: 0,
    endSec: 5,
    cutConfidence: 1,
    faceBoxes: [],
    mouthBoxes: [],
    eyeBoxes: [],
    ocrRegions: [],
    personSilhouetteBoxes: [{ x: 0.1, y: 0.7, width: 0.8, height: 0.2 }],
    poseBoxes: [{ x: 0.1, y: 0.05, width: 0.45, height: 0.22 }],
    objectBoxes: [{ x: 0.05, y: 0.4, width: 0.45, height: 0.2 }],
    negativeSpaceBoxes: [{ x: 0.52, y: 0.06, width: 0.44, height: 0.18 }],
    motionScore: 0.3,
    brightnessAvg: 0.6,
    dominantPalette: ['#222222'],
    suggestedAnchor: 'upper-right',
    limitations: [],
  };

  const chosen = selectBestAnchorForScene({
    scene,
    preferredAnchors: ['lower-center', 'upper-left', 'center-left', 'upper-right'],
    isSceneCut: true,
  });
  assert.equal(chosen.anchor, 'upper-right');
});

test('wrapCaptionTextBalanced prevents single-word orphan lines when orphanAvoidance is enabled', () => {
  const wrapped = wrapCaptionTextBalanced({
    text: 'This clean offline workflow edits fast!',
    maxCharsPerLine: 24,
    orphanAvoidance: true,
  });
  const lines = wrapped.split('\n');
  assert.ok(lines.length >= 2);
  assert.ok(lines[lines.length - 1].split(' ').length >= 2, `Last line had an orphan: "${wrapped}"`);
});

test('buildEditorialPlan preserves layout continuity within same scene and adapts on scene cut', () => {
  const segments: TranscriptSegment[] = [
    {
      id: 's1',
      startSec: 0,
      endSec: 2.5,
      text: 'Ye asli jannat hai bhai!',
      rawText: 'Ye asli jannat hai bhai!',
      language: 'hi-en',
      script: 'latin',
      userEdited: false,
      uncertain: false,
      words: [],
    },
    {
      id: 's2',
      startSec: 2.6,
      endSec: 5.0,
      text: 'Look at that view',
      rawText: 'Look at that view',
      language: 'en',
      script: 'latin',
      userEdited: false,
      uncertain: false,
      words: [],
    },
  ];

  const plan = buildEditorialPlan({ projectId: 'proj_1', segments });
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].anchorZone, plan.items[1].anchorZone);
  assert.equal(plan.items[0].sfx, 'soft-pop');
});
