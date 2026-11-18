import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplateToProject, BUILT_IN_TEMPLATES } from './templates';
import { createEmptyProject, defaultColorAdjustments, defaultTransform } from '../utils/timelineMath';

test('BUILT_IN_TEMPLATES contains 8 live-rendered curated templates with zero stock image URLs', () => {
  assert.equal(BUILT_IN_TEMPLATES.length, 8);
  const expectedNames = [
    'Editorial Punch',
    'Clean Podcast',
    'Cinematic Editorial',
    'Kinetic Stack',
    'Minimal Caption',
    'Split Composition',
    'Bold Explainer',
    'Storytelling',
  ];
  const ids = new Set(BUILT_IN_TEMPLATES.map((t) => t.id));
  assert.equal(ids.size, 8);

  for (const name of expectedNames) {
    assert.ok(
      BUILT_IN_TEMPLATES.some((t) => t.name === name),
      `Expected built-in template "${name}" to exist`
    );
  }

  for (const tpl of BUILT_IN_TEMPLATES) {
    assert.ok(tpl.name.length > 0);
    assert.equal(tpl.version, '1.0.0');
    assert.equal(tpl.previewImage, '');
    assert.ok(!tpl.previewImage.includes('/src/assets/images/'));
    assert.ok(tpl.manifest, `Expected manifest on ${tpl.name}`);
    assert.equal(tpl.manifest?.format, 'cutflow.template');
    assert.equal(tpl.manifest?.schemaVersion, '1.0.0');
  }
});

test('applyTemplateToProject creates non-destructive output project across aspects with grain/lift/gain', () => {
  const source = createEmptyProject({ name: 'Source Reel', type: 'template-prep', aspectRatio: '9:16' });
  source.clips.push({
    id: 'c1',
    trackId: 'track_video_1',
    mediaId: 'm1',
    name: 'Clip 1',
    kind: 'video',
    startTime: 0,
    duration: 6,
    sourceIn: 0,
    sourceOut: 6,
    speed: 1,
    volume: 1,
    muted: false,
    fadeInSec: 0,
    fadeOutSec: 0,
    transform: defaultTransform(),
    color: defaultColorAdjustments(),
  });

  const editorialPunch = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl_editorial_punch')!;
  assert.ok(editorialPunch);

  const out1080 = applyTemplateToProject(source, editorialPunch, '1080p');
  assert.notEqual(out1080.id, source.id);
  assert.equal(out1080.type, 'output');
  assert.equal(out1080.sourceProjectId, source.id);
  assert.equal(out1080.templateId, editorialPunch.id);
  assert.equal(out1080.width, 1080);
  assert.equal(out1080.height, 1920);
  assert.equal(source.overlayLayers.length, 0);
  assert.equal(source.textLayers.length, 0);
  assert.ok(out1080.overlayLayers.length >= 1);
  assert.ok(out1080.textLayers.length >= 1);
  assert.equal(out1080.exportSettings.resolution, '1080p');

  const storytelling = BUILT_IN_TEMPLATES.find((t) => t.id === 'tpl_storytelling')!;
  const outSquare = applyTemplateToProject(source, storytelling, '720p', { aspectRatioOverride: '1:1' });
  assert.equal(outSquare.aspectRatio, '1:1');
  assert.equal(outSquare.width, 720);
  assert.equal(outSquare.height, 720);
  assert.ok((outSquare.clips[0].color.grain ?? 0) > 0);
  assert.equal(outSquare.exportSettings.resolution, '720p');
});
