import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampTrimEnd,
  clampTrimStart,
  computeClipAudioGain,
  computeDrawRect,
  computeProjectDuration,
  createEmptyProject,
  defaultColorAdjustments,
  defaultTransform,
  mapTimelineTimeToSourceTime,
  projectsEqual,
  splitClipAtTime,
  validateTemplateJson,
} from './timelineMath';
import { TimelineClip } from '../types/project';

function makeSampleClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip_1',
    trackId: 'track_video_1',
    mediaId: 'media_1',
    name: 'Sample Video',
    kind: 'video',
    startTime: 2,
    duration: 10,
    sourceIn: 0,
    sourceOut: 10,
    speed: 1,
    volume: 1,
    muted: false,
    fadeInSec: 0,
    fadeOutSec: 0,
    transform: defaultTransform(),
    color: defaultColorAdjustments(),
    ...overrides,
  };
}

test('splitClipAtTime splits clip cleanly at playhead and preserves continuity', () => {
  const clip = makeSampleClip({ startTime: 2, duration: 10, sourceIn: 1, sourceOut: 11 });
  const result = splitClipAtTime(clip, 6);
  assert.ok(result);
  const [left, right] = result;
  assert.equal(left.startTime, 2);
  assert.equal(left.duration, 4);
  assert.equal(left.sourceIn, 1);
  assert.equal(left.sourceOut, 5);

  assert.equal(right.startTime, 6);
  assert.equal(right.duration, 6);
  assert.equal(right.sourceIn, 5);
  assert.equal(right.sourceOut, 11);
  assert.notEqual(right.id, left.id);
});

test('splitClipAtTime refuses split too close to clip edges', () => {
  const clip = makeSampleClip({ startTime: 0, duration: 5 });
  assert.equal(splitClipAtTime(clip, 0.05), null);
  assert.equal(splitClipAtTime(clip, 4.95), null);
});

test('clampTrimStart updates startTime, duration, and sourceIn consistently', () => {
  const clip = makeSampleClip({ startTime: 0, duration: 8, sourceIn: 0, sourceOut: 8 });
  const trimmed = clampTrimStart(clip, 2.5);
  assert.equal(trimmed.startTime, 2.5);
  assert.equal(trimmed.duration, 5.5);
  assert.equal(trimmed.sourceIn, 2.5);
});

test('clampTrimEnd respects max source duration and min duration', () => {
  const clip = makeSampleClip({ startTime: 0, duration: 5, sourceIn: 2, sourceOut: 7 });
  const extended = clampTrimEnd(clip, 15, 10);
  assert.equal(extended.duration, 8);
  assert.equal(extended.sourceOut, 10);

  const shrunk = clampTrimEnd(clip, 0.01, 10, 0.2);
  assert.equal(shrunk.duration, 0.2);
});

test('mapTimelineTimeToSourceTime accounts for playback speed and sourceIn', () => {
  const clip = makeSampleClip({ startTime: 1, duration: 4, sourceIn: 2, sourceOut: 10, speed: 2 });
  assert.equal(mapTimelineTimeToSourceTime(clip, 1), 2);
  assert.equal(mapTimelineTimeToSourceTime(clip, 3), 6);
  assert.equal(mapTimelineTimeToSourceTime(clip, 10), 10);
});

test('computeClipAudioGain applies fade in, fade out, and mute', () => {
  const clip = makeSampleClip({ startTime: 0, duration: 10, volume: 1, fadeInSec: 2, fadeOutSec: 2 });
  assert.equal(computeClipAudioGain(clip, 0), 0);
  assert.equal(computeClipAudioGain(clip, 1), 0.5);
  assert.equal(computeClipAudioGain(clip, 5), 1);
  assert.equal(computeClipAudioGain(clip, 9), 0.5);
  assert.equal(computeClipAudioGain({ ...clip, muted: true }, 5), 0);
});

test('computeDrawRect handles fit and fill scaling for 16:9 source in 9:16 canvas', () => {
  const fitT = { ...defaultTransform(), fitMode: 'fit' as const };
  const fitRect = computeDrawRect(1920, 1080, 1080, 1920, fitT);
  assert.equal(Math.round(fitRect.dw), 1080);
  assert.equal(Math.round(fitRect.dh), 608);

  const fillT = { ...defaultTransform(), fitMode: 'fill' as const };
  const fillRect = computeDrawRect(1920, 1080, 1080, 1920, fillT);
  assert.equal(Math.round(fillRect.dh), 1920);
  assert.equal(Math.round(fillRect.dw), 3413);
});

test('computeProjectDuration returns end of latest element capped at maxDurationSec', () => {
  const project = createEmptyProject({ name: 'Test', type: 'template-prep' });
  project.clips.push(makeSampleClip({ startTime: 5, duration: 12 }));
  assert.equal(computeProjectDuration(project), 17);

  project.clips.push(makeSampleClip({ id: 'c2', startTime: 290, duration: 40 }));
  assert.equal(computeProjectDuration(project), 300);
});

test('validateTemplateJson rejects script payloads and validates safe data-driven templates', () => {
  const unsafe = validateTemplateJson({
    name: 'Bad',
    config: { backgroundColor: '<script>alert(1)</script>' },
  });
  assert.equal(unsafe.valid, false);

  const valid = validateTemplateJson({
    name: 'Editorial Frame',
    category: 'Creator',
    aspectRatio: '9:16',
    config: {
      aspectRatio: '9:16',
      backgroundColor: '#111111',
      frameInset: 0.08,
      frameRadius: 16,
      fitMode: 'fill',
      vignetteStrength: 0.2,
    },
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.template?.name, 'Editorial Frame');
});

test('projectsEqual ignores updatedAt timestamp for dirty state checks', () => {
  const a = createEmptyProject({ name: 'P1', type: 'output' });
  const b = { ...a, updatedAt: a.updatedAt + 5000 };
  assert.equal(projectsEqual(a, b), true);
  const c = { ...a, name: 'P1 Edited' };
  assert.equal(projectsEqual(a, c), false);
});
