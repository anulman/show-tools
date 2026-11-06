import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioMode, audioModeURL, canChangeAudioMode, changeAudioMode } from '../audio-mode.js';

test('browser is the default and mode URLs preserve other state', () => {
  const url = new URL('https://example.test/practice/?song=one&test#cue');
  assert.equal(audioMode(url), 'browser');
  const hardware = audioModeURL(url, 'hardware');
  assert.equal(audioMode(hardware), 'hardware');
  assert.equal(hardware.searchParams.get('song'), 'one');
  assert.equal(hardware.hash, '#cue');
  const browser = audioModeURL(hardware, 'browser');
  assert.equal(browser.searchParams.get('song'), 'one');
  assert.equal(browser.searchParams.has('test'), true);
  assert.equal(browser.hash, '#cue');
});

test('busy browser blocks a mode change', async () => {
  let disposed = false;
  assert.equal(canChangeAudioMode('browser', true), false);
  assert.equal(await changeAudioMode({ current: 'browser', next: 'hardware', browserBusy: true,
    url: new URL('https://example.test/'), dispose: async () => { disposed = true; }, navigate: () => assert.fail('navigated') }), false);
  assert.equal(disposed, false);
});

test('leaving active hardware only disposes the client and navigates', async () => {
  const actions: string[] = [];
  const session = { start: () => actions.push('start'), stop: () => actions.push('stop'), dispose: async () => { actions.push('detach'); } };
  assert.equal(await changeAudioMode({ current: 'hardware', next: 'browser', browserBusy: true,
    url: new URL('https://example.test/?remote&test#cue'), dispose: () => session.dispose(), navigate: url => actions.push(url.href) }), true);
  assert.deepEqual(actions, ['detach', 'https://example.test/?test=#cue']);
});
