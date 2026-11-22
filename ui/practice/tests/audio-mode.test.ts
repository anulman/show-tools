import { test } from 'node:test';
import assert from 'node:assert/strict';
import { practiceAssetBase } from '../../../lib/remote-performance/desk-paths.js';
import { audioMode, audioModeURL, canChangeAudioMode, changeAudioMode, defaultAudioMode } from '../audio-mode.js';

test('browser is the default and mode URLs preserve other state', () => {
  const url = new URL('https://example.test/practice/?song=one&test#cue');
  assert.equal(audioMode(url), 'browser');
  assert.equal(audioMode(url, 'hardware'), 'hardware');
  assert.equal(audioMode(audioModeURL(url, 'browser', 'hardware'), 'hardware'), 'browser');
  const hardware = audioModeURL(url, 'hardware');
  assert.equal(audioMode(hardware), 'hardware');
  assert.equal(hardware.searchParams.get('song'), 'one');
  assert.equal(hardware.hash, '#cue');
  const browser = audioModeURL(hardware, 'browser');
  assert.equal(browser.searchParams.get('song'), 'one');
  assert.equal(browser.searchParams.has('test'), true);
  assert.equal(browser.hash, '#cue');
});

test('gateway mode changes use different paths so the Browser worker cannot control Hardware', async () => {
  const browser = new URL('https://desk.test/ui/practice/?browser&song=tribulations#pads');
  const live = audioModeURL(browser, 'hardware', 'hardware');
  assert.equal(live.href, 'https://desk.test/ui/live/?song=tribulations#pads');
  assert.equal(await defaultAudioMode(live), 'hardware');
  const nextBrowser = audioModeURL(live, 'browser', 'hardware');
  assert.equal(nextBrowser.href, 'https://desk.test/ui/browser/?song=tribulations#pads');
  assert.equal(audioMode(nextBrowser, await defaultAudioMode(nextBrowser)), 'browser');
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

test('nested preview song routes share the existing asset directory', () => {
  for (const path of ['/preview/tanstack', '/preview/tanstack/01-dance-yrself-clean', '/preview/tanstack/browser/04-tribulations']) {
    const base = practiceAssetBase(`https://desk.test${path}`);
    assert.equal(new URL('./songs/drunk-girls.musicxml', base).href, 'https://desk.test/ui/practice/songs/drunk-girls.musicxml');
  }
  for (const path of ['/ui/browser/', '/releases/archived/ui/practice/', '/preview/tanstack-lab/']) {
    const base = practiceAssetBase(`https://desk.test${path}`);
    assert.equal(new URL('./songs/drunk-girls.musicxml', base).pathname, `${path}songs/drunk-girls.musicxml`);
  }
});
