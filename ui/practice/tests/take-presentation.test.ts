import test from 'node:test';
import assert from 'node:assert/strict';
import song from '../../../songs/dance-yrself-clean.js';
import drunkGirls from '../../../songs/drunk-girls.js';
import { CONTROL_IDS } from '../../../lib/performance/model.js';
import type { ChannelId, ChannelState, CompiledTakeState } from '../../../lib/performance/model.js';
import { takePresentation } from '../take-presentation.js';
import { frozenCutoverMusicXml } from '../../../scripts/verify-musicxml-cutover.js';
import { readMusicXmlSong } from '../../../lib/performance/musicxml-song.js';
import { compiledCaptureFixture } from '../../../lib/performance/tests/fixtures/compiled-capture.js';

const compiled = (await readMusicXmlSong(await frozenCutoverMusicXml())).song;
const channels: ChannelState[] = CONTROL_IDS.map(id => ({ id, ready: false, muted: false, gain: 1, looping: false, status: 'empty', light: { kind: 'off' } }));

test('DG capture plans and playback name the authored pickup and numbered bars', () => {
  const current = drunkGirls.compiled;
  assert(current);
  assert.match(takePresentation(current, 'L2', { channels }).plan, /bar Pickup–0\.7/);
  const girls = takePresentation(current, 'R2', { channels }).plan;
  assert.match(girls, /bar 4 /);
  assert.match(girls, /bar 5 /);
  assert.match(takePresentation(current, 'R1', { channels }).plan, /bar 89–92 /);
  const readings: CompiledTakeState[] = current.takes.map((take, index) => ({ index, ready: true, frames: 32000, period: 32000,
    playback: take.voiceId === 'guitar' ? 'playing' : 'idle', sourceEndFrames: null, selectionIndex: null }));
  assert.match(takePresentation(current, 'L2', { channels, compiledTakes: readings }).summary ?? '', /bar Pickup–0\.7/);
});
function readback(channelId: ChannelId, playback: CompiledTakeState['playback'], readyCount: number) {
  const voice = compiled.voices.find(voice => voice.buttonId === channelId);
  let ready = 0;
  return compiled.takes.map((take, index): CompiledTakeState => {
    const present = take.voiceId === voice?.id && ready++ < readyCount;
    return { index, ready: present, frames: present ? 123 : 0, period: present ? 456 : 0, playback: present ? playback : 'idle', sourceEndFrames: null, selectionIndex: null };
  });
}

test('DYC plans expose the written pairwise doubling and Bing Bong source cutoff before capture', () => {
  const drums = takePresentation(compiled, 'R1', { channels });
  assert.equal(drums.plan, 'Layer bars 1–2 + 3–4 · 2-bar loop · 1+3, 2+4');
  assert.equal(drums.summary, null, 'metadata cannot claim that a layer exists');
  const bing = takePresentation(compiled, 'L2', { channels });
  assert.equal(bing.plan, 'Layer bars 5–6 + 7–8 · 2-bar loop · 5+7, 6+8 · Layer 2 ends at 8:3; 2 counts rest');
});

test('DYC layer readiness and playback follow take readback rather than bar progression', () => {
  const one = readback('R1', 'playing', 1);
  assert.equal(takePresentation(compiled, 'R1', { channels, compiledTakes: one }).summary, '1 layer playing · 2-bar loop');
  const both = readback('R1', 'playing', 2);
  assert.equal(takePresentation(compiled, 'R1', { channels, compiledTakes: both }).summary, '2 layers playing · 2-bar loop');
  const stopped = readback('R1', 'idle', 2);
  assert.equal(takePresentation(compiled, 'R1', { channels, compiledTakes: stopped }).summary, '2 of 2 layers saved');
  const releasing = readback('R1', 'releasing', 2);
  assert.equal(takePresentation(compiled, 'R1', { channels, compiledTakes: releasing }).summary, 'Releasing · 2 of 2 layers saved');
});

test('recording distinguishes saved layers without claiming the active bank reports every older playback', () => {
  const compiledTakes = readback('L2', 'playing', 1);
  const recording = channels.map(channel => channel.id === 'L2' ? { ...channel, status: 'recording', ready: true } satisfies ChannelState : channel);
  assert.equal(takePresentation(compiled, 'L2', { channels: recording, compiledTakes }).summary, 'Recording · 1 of 2 layers saved');
});

test('take readout preserves native queued-stop and release status', () => {
  const compiledTakes = readback('R1', 'playing', 2);
  const queued = channels.map(channel => channel.id === 'R1' ? { ...channel, status: 'stopping', looping: true, light: { kind: 'releasing', remainingMs: 100 } } satisfies ChannelState : channel);
  assert.equal(takePresentation(compiled, 'R1', { channels: queued, compiledTakes }).summary, 'Stop queued · 2 of 2 layers saved');
  const released = queued.map(channel => ({ ...channel, looping: false }));
  assert.equal(takePresentation(compiled, 'R1', { channels: released, compiledTakes }).summary, 'Releasing · 2 of 2 layers saved');
});

test('Cowbell names the playing bar identity and keeps its six recordings separate', () => {
  const readings = readback('R2', 'idle', 3);
  const take = compiled.takes.findIndex(take => take.voiceId === 'cowbell' && take.begin.bar === 11);
  const compiledTakes = readings.map(reading => reading.index === take ? { ...reading, playback: 'playing' } satisfies CompiledTakeState : reading);
  const result = takePresentation(compiled, 'R2', { channels, compiledTakes });
  assert.equal(result.plan, '6 separate versions · bar 10 (4)&a · bar 11 (4)& · bar 12 4 · bar 82 &e3a& · bar 83 &e3a&a · bar 84 &e3e');
  assert.equal(result.summary, 'Playing version 2/6 · bar 11 · (4)&');
});

test('legacy songs and incomplete readback do not fabricate take state', async () => {
  assert.deepEqual(takePresentation(undefined, 'R1', { channels }), { plan: '', summary: null });
  assert.equal(takePresentation(compiled, 'R1', { channels, compiledTakes: [] }).summary, null);
  assert.deepEqual(takePresentation(await compiledCaptureFixture(), 'R2', { channels }), { plan: '', summary: null });
});

test('trimmed playback is reported from native source admission without adding a version', () => {
  const readings = readback('R2', 'idle', 6);
  const take = compiled.takes.findIndex(take => take.voiceId === 'cowbell' && take.begin.bar === 82);
  const compiledTakes = readings.map(reading => reading.index === take ? { ...reading, playback: 'playing', sourceEndFrames: 102857 } satisfies CompiledTakeState : reading);
  assert.equal(takePresentation(compiled, 'R2', { channels, compiledTakes }).summary, 'Playing version 4/6 · bar 82 · &e3a& · Trimmed');
  assert.equal(takePresentation(compiled, 'R2', { channels, compiledTakes: compiledTakes.map(reading => ({ ...reading, sourceEndFrames: null, selectionIndex: null })) }).summary, 'Playing version 4/6 · bar 82 · &e3a&');
});

test('current DYC describes five capture parents and eleven distinct reusable Cowbell bar views', () => {
  const current = song.compiled;
  assert.equal(current.takes.length, 5);
  assert.equal(takePresentation(current, 'R1', { channels }).plan, 'Record bars 1–3 with pickup · play section 1 once · repeat sections 2–3');
  assert.equal(takePresentation(current, 'L2', { channels }).plan, 'Record bars 5–6 · 2-bar loop');
  assert.equal(takePresentation(current, 'R2', { channels }).plan, '2 captures · bars 8–12 + 79–84 · 11 reusable bar views');
});

test('Cowbell playback names the native-selected source bar and trim rather than a parent capture or chart position', () => {
  const current = song.compiled;
  const parent = current.takes.findIndex(take => take.voiceId === 'cowbell' && take.begin.bar === 79);
  const read = (selectionIndex: number | null) => current.takes.map((_, index): CompiledTakeState => ({ index, ready: true, frames: 96000,
    period: 96000, playback: index === parent ? 'playing' : 'idle', selectionIndex: index === parent ? selectionIndex : null,
    sourceEndFrames: index === parent ? 62000 : null }));
  const fullBar = current.selections.findIndex(selection => selection.id.endsWith('/bar-82'));
  assert(fullBar >= 0);
  assert.equal(takePresentation(current, 'R2', { channels, compiledTakes: read(fullBar) }).summary,
    'Playing bar 82 · &e3a& · 1-bar loop · capture 2/2');
  const trimmed = current.selections.findIndex(selection => selection.window.kind === 'slice' && selection.window.loopCounts > selection.window.endCount - selection.window.beginCount);
  assert(trimmed >= 0);
  assert.equal(takePresentation(current, 'R2', { channels, compiledTakes: read(trimmed) }).summary,
    'Playing bar 82 · &e3a& · 1-bar loop · capture 2/2 · Trimmed');
  assert.equal(takePresentation(current, 'R2', { channels, compiledTakes: read(null) }).summary, '1 capture playing · view unavailable');
  const idle = read(trimmed).map(reading => ({ ...reading, playback: 'idle' as const, selectionIndex: null }));
  assert.equal(takePresentation(current, 'R2', { channels, compiledTakes: idle }).summary, '2 of 2 captures saved');
});
