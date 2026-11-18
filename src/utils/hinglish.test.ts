import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCustomVocabulary,
  buildWordTokensForSegment,
  processTextToRomanHinglish,
} from './hinglish';

test('processTextToRomanHinglish converts natural Hindi phrases into readable Roman Hinglish', () => {
  const r1 = processTextToRomanHinglish('मुझे ये वीडियो एडिट करना है', 'natural-hinglish');
  assert.equal(r1.text.toLowerCase(), 'mujhe ye video edit karna hai');
  assert.equal(r1.language, 'hi');

  const r2 = processTextToRomanHinglish('ये बहुत अच्छा है!', 'natural-hinglish');
  assert.equal(r2.text.toLowerCase(), 'ye bahut achha hai!');
});

test('processTextToRomanHinglish preserves mixed English words in code-switched speech', () => {
  const mixed = processTextToRomanHinglish(
    'Basically मुझे ये camera movement थोड़ा smooth करना है',
    'natural-hinglish'
  );
  assert.equal(mixed.language, 'hi-en');
  assert.equal(mixed.script, 'mixed');
  assert.ok(mixed.text.includes('Basically'));
  assert.ok(mixed.text.includes('camera movement'));
  assert.ok(mixed.text.toLowerCase().includes('mujhe ye'));
});

test('processTextToRomanHinglish does not blindly delete non-Latin scripts and flags uncertain', () => {
  const regional = processTextToRomanHinglish('Hello தமிழ் world', 'natural-hinglish');
  assert.ok(regional.text.includes('தமிழ்'));
  assert.equal(regional.uncertain, true);
});

test('applyCustomVocabulary replaces preferred spellings accurately', () => {
  const out = applyCustomVocabulary('Use cutflow with aryan sharma today', [
    { id: 'v1', spokenForm: 'cutflow', preferredSpelling: 'CutFlow', caseSensitive: false },
    { id: 'v2', spokenForm: 'aryan sharma', preferredSpelling: 'Aryan Sharma', caseSensitive: false },
  ]);
  assert.equal(out, 'Use CutFlow with Aryan Sharma today');
});

test('buildWordTokensForSegment marks model-aligned vs estimated timings accurately', () => {
  const estimated = buildWordTokensForSegment({
    segmentId: 'seg1',
    text: 'Ye asli jannat hai bhai',
    startSec: 1.0,
    endSec: 3.0,
    style: 'natural-hinglish',
    customVocabulary: [],
  });
  assert.equal(estimated.length, 5);
  assert.equal(estimated[0].timingSource, 'estimated');
  assert.equal(estimated[0].startSec, 1.0);
  assert.equal(estimated[4].endSec, 3.0);

  const aligned = buildWordTokensForSegment({
    segmentId: 'seg2',
    text: 'Hello world',
    startSec: 0,
    endSec: 1.5,
    modelWordChunks: [
      { text: 'Hello', timestamp: [0.1, 0.5] },
      { text: 'world', timestamp: [0.6, 1.2] },
    ],
    style: 'natural-hinglish',
    customVocabulary: [],
  });
  assert.equal(aligned.length, 2);
  assert.equal(aligned[0].timingSource, 'model-aligned');
  assert.equal(aligned[1].startSec, 0.6);
});
