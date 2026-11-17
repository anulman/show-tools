import { createSampleDownloads } from '../sample-downloads.js';
import { compiledCaptureFixture } from '../../../lib/performance/tests/fixtures/compiled-capture.js';
import type { PracticeState } from '../../../lib/performance/model.js';

const results: string[] = [];
const check = (value: boolean, text: string) => { if (!value) throw new Error(text); results.push(text); };
async function run() {
  const song = await compiledCaptureFixture();
  const anchor = document.createElement('div'); document.body.append(anchor);
  let phase: PracticeState['phase'] = 'idle', fail = false;
  const state = () => ({ phase, runId: 'fixture', compiledTakes: [{ index: 0, ready: true, frames: 4, period: 4, playback: 'idle' as const, sourceEndFrames: null, selectionIndex: null }] });
  const source = { takeAudioToken: () => 'fixture', takeAudio: async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    if (fail) throw new Error('Practice changed; retry.');
    const bytes = new Uint8Array(44), view = new DataView(bytes.buffer);
    view.setUint32(0, 48000, true); view.setUint32(4, 4, true); view.setUint32(8, 4, true);
    return bytes;
  } };
  const panel = createSampleDownloads(anchor, () => ({ song, state: state(), source })); panel.render();
  const button = document.querySelector<HTMLButtonElement>('.sample-download-actions button'); check(Boolean(button && !button.disabled), 'committed voice has an enabled sample button');
  if (!button) throw new Error('Button missing');
  button.focus(); panel.render(); check(document.activeElement === button, 'unchanged readback preserves keyboard focus');
  phase = 'playing'; panel.render(); check(Boolean(document.querySelector<HTMLButtonElement>('.sample-download-actions button')?.disabled), 'running performance disables downloads');
  phase = 'idle'; panel.render();
  let name = '';
  document.addEventListener('click', event => { if (event.target instanceof HTMLAnchorElement) { event.preventDefault(); name = event.target.download; } });
  document.querySelector<HTMLButtonElement>('.sample-download-actions button')?.click();
  check(Boolean(document.querySelector<HTMLButtonElement>('.sample-download-actions button')?.disabled), 'download disables duplicate requests');
  while (document.querySelector('[role=status]')?.textContent === 'Preparing samples…') await new Promise(resolve => setTimeout(resolve, 10));
  check(name === 'fixture-drums-samples.zip', 'download has song and voice filename');
  check(document.querySelector('[role=status]')?.textContent === 'Samples downloaded.', 'successful archive is announced');
  fail = true; document.querySelector<HTMLButtonElement>('.sample-download-actions button')?.click();
  while (document.querySelector('[role=status]')?.textContent === 'Preparing samples…') await new Promise(resolve => setTimeout(resolve, 10));
  check(document.querySelector('[role=status]')?.textContent === 'Practice changed; retry.', 'read failure is visible and retryable');
  check(!document.querySelector<HTMLButtonElement>('.sample-download-actions button')?.disabled, 'failed read releases busy state');
  check(document.documentElement.scrollWidth <= innerWidth, 'download controls fit the viewport');
  document.title = `PASS: ${results.length} sample download checks`;
}
run().catch(error => { document.title = 'FAIL: sample download checks'; results.push(String(error)); }).finally(() => {
  const result = document.createElement('pre'); result.id = 'sample-download-result'; result.textContent = JSON.stringify(results); document.body.append(result);
});
