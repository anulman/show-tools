import { strFromU8, unzipSync } from 'fflate';
import { createSampleDownloads } from '../sample-downloads.js';
import { compiledCaptureFixture } from '../../../lib/performance/tests/fixtures/compiled-capture.js';
import type { PracticeState } from '../../../lib/performance/model.js';

const results: string[] = [];
function check(value: unknown, text: string): asserts value {
  if (!value) throw new Error(text);
  results.push(text);
}

async function run() {
  const fixture = await compiledCaptureFixture();
  const drum = fixture.takes[0];
  if (!drum) throw new Error('Missing drum fixture');
  const extraTake = (voiceId: string) => ({ ...drum, id: `fixture/${voiceId}/take-1`, voiceId, sourceVoiceId: voiceId, sourceName: voiceId });
  const song = { ...fixture, takes: [...fixture.takes, extraTake('cowbell'), extraTake('whistle')] };
  const anchor = document.createElement('div');
  document.body.append(anchor);
  let phase: PracticeState['phase'] = 'idle', runId = 'original-run', fail = false;
  const state = () => ({ phase, runId, compiledTakes: [0, 1, 2].map(index => ({
    index, ready: true, frames: 4, period: 4, playback: 'idle' as const, sourceEndFrames: null, selectionIndex: null,
  })) });
  const source = { takeAudioToken: () => runId, takeAudio: async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    if (fail) throw new Error('Practice changed; retry.');
    const bytes = new Uint8Array(44), view = new DataView(bytes.buffer);
    view.setUint32(0, 48000, true); view.setUint32(4, 4, true); view.setUint32(8, 4, true);
    return bytes;
  } };
  const panel = createSampleDownloads(anchor, () => ({ song, state: state(), source }));
  panel.render();
  const section = document.querySelector('.sample-downloads');
  const button = section?.querySelector('button');
  check(section && button && section.querySelectorAll('button').length === 1, 'one shared download button');
  const actionLabel = () => button.textContent;
  const [drums, cowbell, whistle] = section.querySelectorAll<HTMLInputElement>('input[type=checkbox]');
  check(drums?.checked && cowbell?.checked && !button.disabled && actionLabel() === 'Download all samples',
    'available voices start checked and can be downloaded in one action');
  check(!whistle || whistle.disabled, 'uncaptured voices cannot be selected');

  cowbell.focus();
  panel.render();
  check(document.activeElement === cowbell, 'ordinary readback preserves keyboard focus');
  phase = 'playing'; panel.render();
  check(button.disabled, 'running performance disables downloads');
  phase = 'idle'; panel.render();

  const downloads: Array<{ name: string; bytes: Promise<ArrayBuffer> }> = [];
  document.addEventListener('click', event => {
    if (!(event.target instanceof HTMLAnchorElement)) return;
    event.preventDefault();
    downloads.push({ name: event.target.download, bytes: fetch(event.target.href).then(response => response.arrayBuffer()) });
  });
  const status = () => section.querySelector('[role=status]')?.textContent;
  const finish = async () => {
    for (let attempts = 0; panel.busy && attempts < 200; attempts++) await new Promise(resolve => setTimeout(resolve, 10));
    check(!panel.busy, 'download completed within the fixture deadline');
  };
  const samples = async (index: number) => {
    const entry = downloads[index];
    if (!entry) throw new Error('Expected a download');
    return JSON.parse(strFromU8(unzipSync(new Uint8Array(await entry.bytes))['samples.json'])).samples;
  };
  button.click();
  check(button.disabled, 'download disables duplicate requests');
  await finish();
  check(downloads[0]?.name === 'fixture-all-samples.zip' && (await samples(0)).length === 3, 'default ZIP contains all three captured takes');

  cowbell.click();
  check(actionLabel() === 'Download selected samples', 'unchecking a voice changes the action to a subset');
  drums.click();
  check(button.disabled, 'empty selection cannot download');
  drums.click();
  button.click();
  await finish();
  check(downloads[1]?.name === 'fixture-drums-samples.zip' && (await samples(1)).length === 2, 'subset ZIP contains only the selected voice');
  check(status() === 'Samples downloaded.' && !cowbell.checked, 'completion is announced and preserves the selection');
  fail = true; button.click();
  await finish();
  check(status() === 'Practice changed; retry.' && !button.disabled && !cowbell.checked, 'failure preserves the selection for retry');
  runId = 'next-run'; panel.render();
  check(cowbell.checked && actionLabel() === 'Download all samples', 'new capture run defaults to all voices');
  check(document.documentElement.scrollWidth <= innerWidth, 'download controls fit the viewport');
  document.title = `PASS: ${results.length} sample download checks`;
}
run().catch(error => { document.title = 'FAIL: sample download checks'; results.push(String(error)); }).finally(() => {
  const result = document.createElement('pre'); result.id = 'sample-download-result'; result.textContent = JSON.stringify(results); document.body.append(result);
});
