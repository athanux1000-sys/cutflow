import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultKineticAnimation, evaluateDampedSpring, evaluateTextLayerMotion } from './motionPhysics';
import { TextLayer } from '../types/project';

function makeLayer(overrides: Partial<TextLayer> = {}): TextLayer {
  return {
    id: 'txt_1',
    trackId: 'track_overlay_1',
    text: 'Ye asli jannat hai bhai',
    startTime: 2,
    duration: 4,
    fontFamily: 'Inter',
    fontSize: 56,
    fontWeight: 700,
    color: '#FFFFFF',
    backgroundColor: 'transparent',
    align: 'center',
    x: 0,
    y: 0.3,
    scale: 1,
    opacity: 1,
    rotation: 0,
    animation: { ...defaultKineticAnimation(), preset: 'spring-pop' },
    ...overrides,
  };
}

test('evaluateDampedSpring converges to 1 and produces identical results regardless of evaluation order', () => {
  const sEarly = evaluateDampedSpring({ tSec: 0.05, mass: 1, stiffness: 260, damping: 18 });
  const sMid = evaluateDampedSpring({ tSec: 0.18, mass: 1, stiffness: 260, damping: 18 });
  const sLate = evaluateDampedSpring({ tSec: 2.0, mass: 1, stiffness: 260, damping: 18 });

  assert.ok(sEarly.value < sMid.value);
  assert.ok(Math.abs(sLate.value - 1) < 0.001);
  assert.ok(Math.abs(sLate.velocity) < 0.001);

  // Frame-rate independence check: evaluating 0.25s directly vs after other frames matches identically
  const a = evaluateDampedSpring({ tSec: 0.25, mass: 1, stiffness: 260, damping: 18 });
  const b = evaluateDampedSpring({ tSec: 15 / 60, mass: 1, stiffness: 260, damping: 18 });
  assert.equal(a.value, b.value);
});

test('evaluateTextLayerMotion applies anticipation dip and bounded velocity motion blur', () => {
  const layer = makeLayer({
    animation: {
      ...defaultKineticAnimation(),
      preset: 'impact',
      anticipationMs: 40,
      motionBlurStrength: 0.8,
    },
  });

  // During 40ms anticipation window (t = 2.02s -> elapsed 20ms)
  const anticipationState = evaluateTextLayerMotion(layer, 2.02);
  assert.ok(anticipationState.scaleMul < 1);

  // Right after impact launch (t = 2.06s -> strong velocity -> bounded motion blur)
  const impactState = evaluateTextLayerMotion(layer, 2.06);
  assert.ok(impactState.blurPx > 0 && impactState.blurPx <= 6);

  // Settled state (t = 4.0s)
  const settledState = evaluateTextLayerMotion(layer, 4.0);
  assert.equal(settledState.blurPx, 0);
  assert.ok(Math.abs(settledState.scaleMul - 1) < 0.01);
});

test('evaluateTextLayerMotion word-reveal honors word timestamps', () => {
  const layer = makeLayer({
    animation: { ...defaultKineticAnimation(), preset: 'word-reveal' },
    words: [
      { id: 'w0', word: 'Ye', startSec: 2.0, endSec: 2.3, timingSource: 'aligned' as 'model-aligned' },
      { id: 'w1', word: 'asli', startSec: 2.4, endSec: 2.8, timingSource: 'model-aligned' },
      { id: 'w2', word: 'jannat', startSec: 3.0, endSec: 3.6, timingSource: 'model-aligned' },
    ],
  });

  assert.equal(evaluateTextLayerMotion(layer, 2.1).visibleWordCount, 1);
  assert.equal(evaluateTextLayerMotion(layer, 2.5).visibleWordCount, 2);
  assert.equal(evaluateTextLayerMotion(layer, 3.2).visibleWordCount, 3);
});

test('evaluateTextLayerMotion evaluates mask-reveal, tracking-reveal, motion-trail, shake, bounce, emphasis-pulse, and stagger', () => {
  const maskEarly = evaluateTextLayerMotion(
    makeLayer({ animation: { ...defaultKineticAnimation(), preset: 'mask-reveal' } }),
    2.03
  );
  const maskLate = evaluateTextLayerMotion(
    makeLayer({ animation: { ...defaultKineticAnimation(), preset: 'mask-reveal' } }),
    3.5
  );
  assert.ok(maskEarly.clipRatio < maskLate.clipRatio);
  assert.ok(Math.abs(maskLate.clipRatio - 1) < 0.02);

  const trackEarly = evaluateTextLayerMotion(
    makeLayer({ animation: { ...defaultKineticAnimation(), preset: 'tracking-reveal' } }),
    2.02
  );
  const trackLate = evaluateTextLayerMotion(
    makeLayer({ animation: { ...defaultKineticAnimation(), preset: 'tracking-reveal' } }),
    3.5
  );
  assert.ok(trackEarly.letterSpacingDelta > trackLate.letterSpacingDelta);

  const trailActive = evaluateTextLayerMotion(
    makeLayer({ animation: { ...defaultKineticAnimation(), preset: 'motion-trail', anticipationMs: 0 } }),
    2.05
  );
  assert.ok(trailActive.trailGhosts >= 2);
  assert.ok(trailActive.xOffset < 0);

  const shakeMid = evaluateTextLayerMotion(
    makeLayer({ animation: { ...defaultKineticAnimation(), preset: 'shake' } }),
    2.08
  );
  assert.ok(Math.abs(shakeMid.xOffset) > 0 || Math.abs(shakeMid.rotationDeg) > 0);

  const bounce = evaluateTextLayerMotion(
    makeLayer({ animation: { ...defaultKineticAnimation(), preset: 'bounce' } }),
    2.1
  );
  assert.ok(bounce.opacityMul > 0 && bounce.scaleMul > 0.7);

  const pulse = evaluateTextLayerMotion(
    makeLayer({ animation: { ...defaultKineticAnimation(), preset: 'emphasis-pulse' } }),
    2.35
  );
  assert.ok(pulse.scaleMul > 0.8);

  const stagger = evaluateTextLayerMotion(
    makeLayer({ animation: { ...defaultKineticAnimation(), preset: 'stagger' } }),
    2.12
  );
  assert.ok((stagger.visibleWordCount ?? 0) >= 1);
});
