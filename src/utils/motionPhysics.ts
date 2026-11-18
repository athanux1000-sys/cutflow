import { KineticAnimationSpec, TextLayer } from '../types/project';

export interface EvaluatedMotionState {
  xOffset: number; // normalized canvas units
  yOffset: number;
  scaleMul: number;
  opacityMul: number;
  rotationDeg: number;
  blurPx: number;
  visibleWordCount: number | null;
  clipRatio: number; // 0..1 horizontal mask reveal
  letterSpacingDelta: number; // px offset for tracking-reveal
  trailGhosts: number; // 0..3 trailing echo copies during high motion
}

export function defaultKineticAnimation(): KineticAnimationSpec {
  return {
    preset: 'none',
    durationSec: 0.42,
    anticipationMs: 40,
    springStiffness: 260,
    springDamping: 18,
    springMass: 1,
    overshoot: 0.14,
    motionBlurStrength: 0.35,
    staggerMs: 65,
  };
}

/**
 * Analytical / deterministic damped harmonic oscillator solver for
 *   m * x'' + c * x' + k * (x - 1) = 0, x(0) = 0, x'(0) = initialVelocity.
 * Produces identical displacement and velocity at any timestamp `t` across all FPS values.
 */
export function evaluateDampedSpring(params: {
  tSec: number;
  mass: number;
  stiffness: number;
  damping: number;
  initialVelocity?: number;
}): { value: number; velocity: number } {
  const t = Math.max(0, params.tSec);
  const m = Math.max(0.2, params.mass);
  const k = Math.max(10, params.stiffness);
  const c = Math.max(1, params.damping);
  const v0 = params.initialVelocity ?? 0;

  const omega0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const y0 = -1;

  if (zeta < 1) {
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const A = y0;
    const B = (v0 + zeta * omega0 * y0) / omegaD;
    const decay = Math.exp(-zeta * omega0 * t);
    const cos = Math.cos(omegaD * t);
    const sin = Math.sin(omegaD * t);

    const y = decay * (A * cos + B * sin);
    const dy =
      decay *
      ((-zeta * omega0 * A + omegaD * B) * cos + (-zeta * omega0 * B - omegaD * A) * sin);

    return { value: 1 + y, velocity: dy };
  }

  if (Math.abs(zeta - 1) < 0.001) {
    const A = y0;
    const B = v0 + omega0 * y0;
    const decay = Math.exp(-omega0 * t);
    const y = decay * (A + B * t);
    const dy = decay * (B - omega0 * (A + B * t));
    return { value: 1 + y, velocity: dy };
  }

  const sq = omega0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -omega0 * zeta + sq;
  const r2 = -omega0 * zeta - sq;
  const C2 = (v0 - r1 * y0) / (r2 - r1);
  const C1 = y0 - C2;
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  const y = C1 * e1 + C2 * e2;
  const dy = C1 * r1 * e1 + C2 * r2 * e2;
  return { value: 1 + y, velocity: dy };
}

function neutralState(visibleWordCount: number | null): EvaluatedMotionState {
  return {
    xOffset: 0,
    yOffset: 0,
    scaleMul: 1,
    opacityMul: 1,
    rotationDeg: 0,
    blurPx: 0,
    visibleWordCount,
    clipRatio: 1,
    letterSpacingDelta: 0,
    trailGhosts: 0,
  };
}

function computeVisibleWords(layer: TextLayer, timelineTimeSec: number, elapsed: number, staggerMs: number): number {
  if (layer.words && layer.words.length > 0) {
    return Math.max(1, layer.words.filter((w) => timelineTimeSec >= w.startSec).length);
  }
  const words = layer.text.trim().split(/\s+/).filter(Boolean);
  const staggerSec = Math.max(0.03, staggerMs / 1000);
  return Math.max(1, Math.min(words.length, Math.floor(elapsed / staggerSec) + 1));
}

export function evaluateTextLayerMotion(
  layer: TextLayer,
  timelineTimeSec: number
): EvaluatedMotionState {
  const anim = layer.animation;
  const totalWords = layer.words?.length ?? null;

  if (!anim || anim.preset === 'none') {
    return neutralState(totalWords);
  }

  const elapsed = Math.max(0, timelineTimeSec - layer.startTime);
  const remaining = Math.max(0, layer.startTime + layer.duration - timelineTimeSec);
  const dur = Math.max(0.12, anim.durationSec);
  const anticipationSec = Math.max(0, Math.min(0.15, anim.anticipationMs / 1000));
  const exitOpacity = remaining < 0.15 ? Math.max(0, remaining / 0.15) : 1;

  if (anim.preset === 'fade') {
    const p = Math.min(1, elapsed / dur);
    return {
      ...neutralState(totalWords),
      opacityMul: p * exitOpacity,
    };
  }

  if (anim.preset === 'word-reveal' || anim.preset === 'type-on') {
    const visibleCount = computeVisibleWords(layer, timelineTimeSec, elapsed, anim.staggerMs);
    return {
      ...neutralState(visibleCount),
      opacityMul: exitOpacity,
    };
  }

  if (anim.preset === 'stagger') {
    const visibleCount = computeVisibleWords(layer, timelineTimeSec, elapsed, anim.staggerMs);
    const spring = evaluateDampedSpring({
      tSec: elapsed,
      mass: anim.springMass,
      stiffness: anim.springStiffness,
      damping: anim.springDamping,
      initialVelocity: 1.8,
    });
    return {
      ...neutralState(visibleCount),
      yOffset: (1 - spring.value) * 0.045,
      scaleMul: 0.92 + 0.08 * spring.value,
      opacityMul: Math.min(1, elapsed / 0.1) * exitOpacity,
      blurPx: elapsed > 0.5 ? 0 : Number(Math.min(4, Math.abs(spring.velocity) * 0.3 * anim.motionBlurStrength).toFixed(2)),
    };
  }

  if (anim.preset === 'mask-reveal') {
    const spring = evaluateDampedSpring({
      tSec: elapsed,
      mass: anim.springMass,
      stiffness: Math.max(120, anim.springStiffness * 0.85),
      damping: Math.max(16, anim.springDamping * 1.15),
      initialVelocity: 1.2,
    });
    const clipRatio = Math.max(0.06, Math.min(1, spring.value));
    return {
      ...neutralState(totalWords),
      xOffset: (1 - clipRatio) * -0.02,
      opacityMul: Math.min(1, elapsed / 0.08) * exitOpacity,
      clipRatio,
    };
  }

  if (anim.preset === 'tracking-reveal') {
    const spring = evaluateDampedSpring({
      tSec: elapsed,
      mass: anim.springMass,
      stiffness: anim.springStiffness,
      damping: Math.max(18, anim.springDamping),
      initialVelocity: 1.4,
    });
    return {
      ...neutralState(totalWords),
      letterSpacingDelta: Number(((1 - spring.value) * 14).toFixed(2)),
      opacityMul: Math.min(1, elapsed / 0.16) * exitOpacity,
    };
  }

  // Anticipation phase before spring/impact entrance
  const usesAnticipation =
    anim.preset === 'impact' ||
    anim.preset === 'spring-pop' ||
    anim.preset === 'bounce' ||
    anim.preset === 'motion-trail';

  if (anticipationSec > 0 && elapsed < anticipationSec && usesAnticipation) {
    const ap = elapsed / anticipationSec;
    const dip = Math.sin(ap * Math.PI) * 0.08;
    return {
      ...neutralState(totalWords),
      yOffset: dip * 0.02,
      scaleMul: 1 - dip,
      opacityMul: Math.min(1, ap * 1.6) * exitOpacity,
    };
  }

  const springTime = Math.max(0, elapsed - (usesAnticipation ? anticipationSec : 0));
  const spring = evaluateDampedSpring({
    tSec: springTime,
    mass: anim.springMass,
    stiffness: anim.springStiffness,
    damping: anim.preset === 'bounce' ? Math.max(6, anim.springDamping * 0.55) : anim.springDamping,
    initialVelocity: anim.preset === 'impact' || anim.preset === 'bounce' ? 4.5 : 1.5,
  });

  const rawBlur = Math.min(6, Math.abs(spring.velocity) * 0.45 * anim.motionBlurStrength);
  const blurPx = springTime > 0.65 ? 0 : Number(rawBlur.toFixed(2));

  if (anim.preset === 'slide-up') {
    return {
      ...neutralState(totalWords),
      yOffset: (1 - spring.value) * 0.08,
      opacityMul: Math.min(1, springTime / 0.14) * exitOpacity,
      blurPx,
    };
  }

  if (anim.preset === 'kinetic-cascade') {
    return {
      ...neutralState(totalWords),
      xOffset: (1 - spring.value) * -0.06,
      yOffset: (1 - spring.value) * 0.03,
      scaleMul: 0.9 + 0.1 * spring.value,
      opacityMul: Math.min(1, springTime / 0.14) * exitOpacity,
      rotationDeg: (1 - spring.value) * -2.5,
      blurPx,
    };
  }

  if (anim.preset === 'bounce') {
    return {
      ...neutralState(totalWords),
      yOffset: (1 - spring.value) * -0.09,
      scaleMul: Math.max(0.75, 0.85 + 0.15 * spring.value),
      opacityMul: Math.min(1, springTime / 0.1) * exitOpacity,
      blurPx,
    };
  }

  if (anim.preset === 'shake') {
    const windowSec = 0.45;
    const decay = springTime < windowSec ? Math.exp(-springTime * 7) : 0;
    const osc = Math.sin(springTime * 42);
    return {
      ...neutralState(totalWords),
      xOffset: decay * osc * 0.025,
      rotationDeg: decay * osc * 2.2,
      scaleMul: 1 + decay * 0.06,
      opacityMul: Math.min(1, springTime / 0.06) * exitOpacity,
      blurPx: decay > 0.2 ? Number((decay * 2.5 * anim.motionBlurStrength).toFixed(2)) : 0,
    };
  }

  if (anim.preset === 'emphasis-pulse') {
    const baseScale = 0.84 + 0.16 * spring.value;
    const pulse =
      springTime > 0.25 && springTime < 1.25
        ? Math.sin((springTime - 0.25) * Math.PI * 2) * 0.06 * Math.exp(-(springTime - 0.25))
        : 0;
    return {
      ...neutralState(totalWords),
      scaleMul: Math.max(0.6, baseScale + pulse),
      opacityMul: Math.min(1, springTime / 0.1) * exitOpacity,
      blurPx,
    };
  }

  if (anim.preset === 'motion-trail') {
    const xOffset = (1 - spring.value) * -0.14;
    const speedMag = Math.abs(spring.velocity);
    const trailGhosts = springTime < 0.45 && speedMag > 0.8 ? (speedMag > 2.2 ? 3 : 2) : 0;
    return {
      ...neutralState(totalWords),
      xOffset,
      scaleMul: 0.94 + 0.06 * spring.value,
      opacityMul: Math.min(1, springTime / 0.1) * exitOpacity,
      blurPx,
      trailGhosts,
    };
  }

  // spring-pop & impact
  const startScale = anim.preset === 'impact' ? 1.38 : 0.72;
  const scaleMul = Math.max(0.5, startScale + (1 - startScale) * spring.value);

  return {
    ...neutralState(totalWords),
    scaleMul,
    opacityMul: Math.min(1, springTime / 0.08) * exitOpacity,
    blurPx,
  };
}
