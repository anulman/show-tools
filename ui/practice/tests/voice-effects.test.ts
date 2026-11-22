import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardFocusBlocksShortcut } from '../keyboard-focus.js';
import { effectSummary } from '../voice-effects.js';
import { initialVoiceEffects } from '../../../lib/performance/vocal-effects.js';
import song from '../../../songs/dance-yrself-clean.js';
import { DEFAULT_LIVE_PROFILE, ROTATION_LIVE_PROFILE, VOICE_PROFILE_COUNT } from '../../../lib/performance/model.js';

test('Space leaves focused disclosures, actions and links to their native keyboard behavior', () => {
  assert.equal(keyboardFocusBlocksShortcut('Space', false, true), true);
  assert.equal(keyboardFocusBlocksShortcut('Space', false, false), false);
  assert.equal(keyboardFocusBlocksShortcut('KeyQ', false, true), false);
  assert.equal(keyboardFocusBlocksShortcut('KeyQ', true, false), true);
  assert.equal(keyboardFocusBlocksShortcut('Space', true, true), true);
});

test('capture voices start dry while live vocals retain their approved independent stacks', () => {
  const configurations = initialVoiceEffects(song.compiled);
  assert.equal(configurations.length, VOICE_PROFILE_COUNT);
  assert.equal(new Set(configurations.map(configuration => configuration.profile)).size, VOICE_PROFILE_COUNT);
  const backup = configurations.find(configuration => configuration.profile === ROTATION_LIVE_PROFILE);
  assert.deepEqual(backup?.effects.map(effect => effect.kind), ['slapback', 'chorus']);
  for (const configuration of configurations.filter(item => item.profile < DEFAULT_LIVE_PROFILE)) assert.deepEqual(configuration.effects, []);
  assert.notEqual(configurations[0].effects, configurations[1].effects, 'dry arrays are independent');
  const main = configurations.find(configuration => configuration.profile === DEFAULT_LIVE_PROFILE);
  assert.deepEqual(main?.effects, [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
  assert.notEqual(main?.effects[0], backup?.effects[0], 'live profiles do not share mutable stage objects');
});

test('effect summaries retain the supplied processing order and parameter units', () => {
  const slapback = { kind: 'slapback', delayMs: 112, feedback: .2, wet: .3 } satisfies Parameters<typeof effectSummary>[0][number];
  const chorus = { kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 } satisfies Parameters<typeof effectSummary>[0][number];
  assert.equal(effectSummary([slapback, chorus]), 'Slapback · 112 ms · 30% → Chorus · 0.8 Hz · 35%');
  assert.equal(effectSummary([chorus, slapback]), 'Chorus · 0.8 Hz · 35% → Slapback · 112 ms · 30%');
  assert.equal(effectSummary([]), 'Dry');
});

test('legacy dry preparation includes no hidden default or backup effect stages', () => {
  const configurations = initialVoiceEffects();
  assert.equal(configurations.length, VOICE_PROFILE_COUNT);
  assert(configurations.every(configuration => configuration.effects.length === 0));
});

test('knob stepping preserves effect bounds and decimal precision', async () => {
  const { steppedKnobValue } = await import('../effect-knob.js');
  assert.equal(steppedKnobValue(1000, 40, 250, 1), 250);
  assert.equal(steppedKnobValue(-10, 0, .7, .01), 0);
  assert.equal(steppedKnobValue(.804, .05, 5, .05), .8);
  assert.equal(steppedKnobValue(4.76, 0, 9, .1), 4.8);
  assert.equal(steppedKnobValue(.29 + .01, 0, 1, .01), .3);
  assert.equal(steppedKnobValue(40, 10, 40, .1), 40);
});
