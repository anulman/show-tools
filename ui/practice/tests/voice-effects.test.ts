import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardFocusBlocksShortcut } from '../keyboard-focus.js';
import { effectSummary, initialVoiceEffects } from '../voice-effects.js';
import { ROTATION_LIVE_PROFILE, VOICE_PROFILE_COUNT } from '../../../lib/performance/model.js';

test('Space leaves focused disclosures, actions and links to their native keyboard behavior', () => {
  assert.equal(keyboardFocusBlocksShortcut('Space', false, true), true);
  assert.equal(keyboardFocusBlocksShortcut('Space', false, false), false);
  assert.equal(keyboardFocusBlocksShortcut('KeyQ', false, true), false);
  assert.equal(keyboardFocusBlocksShortcut('KeyQ', true, false), true);
  assert.equal(keyboardFocusBlocksShortcut('Space', true, true), true);
});

test('each voice starts with its own stack and backup has serial slapback then chorus', () => {
  const configurations = initialVoiceEffects();
  assert.equal(configurations.length, VOICE_PROFILE_COUNT);
  assert.equal(new Set(configurations.map(configuration => configuration.profile)).size, VOICE_PROFILE_COUNT);
  const backup = configurations.find(configuration => configuration.profile === ROTATION_LIVE_PROFILE);
  assert.deepEqual(backup?.effects.map(effect => effect.kind), ['slapback', 'chorus']);
  assert.notEqual(configurations[0].effects[0], configurations[1].effects[0]);
  assert.deepEqual(configurations[0].effects, [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
});

test('effect summaries retain the supplied processing order and parameter units', () => {
  const slapback = { kind: 'slapback', delayMs: 112, feedback: .2, wet: .3 } satisfies Parameters<typeof effectSummary>[0][number];
  const chorus = { kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 } satisfies Parameters<typeof effectSummary>[0][number];
  assert.equal(effectSummary([slapback, chorus]), 'Slapback · 112 ms · 30% → Chorus · 0.8 Hz · 35%');
  assert.equal(effectSummary([chorus, slapback]), 'Chorus · 0.8 Hz · 35% → Slapback · 112 ms · 30%');
  assert.equal(effectSummary([]), 'Dry');
});

test('legacy dry preparation includes no hidden default or backup effect stages', () => {
  const configurations = initialVoiceEffects('dry');
  assert.equal(configurations.length, VOICE_PROFILE_COUNT);
  assert(configurations.every(configuration => configuration.effects.length === 0));
});
