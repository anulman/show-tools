import type { PracticeAudio } from '../audio.js';
import { mountTuner } from '../../tuner/panel.js';
import type { TunerPort, TunerState } from '../../../lib/tuner/model.js';

let contexts = 0, acquisitions = 0;
let sharedContext: AudioContext | undefined;
let source: OscillatorNode | undefined;
const OriginalContext = window.AudioContext;
window.AudioContext = class extends OriginalContext {
  constructor(options?: AudioContextOptions) { super(options); contexts++; sharedContext = this; }
};
const syntheticDevices = Object.assign(new EventTarget(), { getUserMedia: async () => {
  acquisitions++;
  if (!sharedContext) throw new Error('Microphone requested before shared audio exists');
  const destination = sharedContext.createMediaStreamDestination();
  source = sharedContext.createOscillator();
  const gain = sharedContext.createGain();
  gain.gain.value = .2;
  source.frequency.value = 130.81278265;
  source.connect(gain).connect(destination);
  source.start();
  return destination.stream;
} });
Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: syntheticDevices });
const toolbar = document.createElement('div');
toolbar.style.cssText = 'position:relative;z-index:9;background:#fff;padding:12px;color:#111;font:14px system-ui';
const run = document.createElement('button');
run.textContent = 'Run shared tuner checks';
const output = document.createElement('pre');
output.style.whiteSpace = 'pre-wrap';
toolbar.append(run, output);
document.body.prepend(toolbar);
let passed = 0;
function check(value: unknown, message: string): void {
  if (!value) throw new Error(message);
  passed++;
  output.textContent += `PASS ${message}\n`;
}
async function until(predicate: () => unknown, message: string, timeoutMs = 6000) {
  const deadline = performance.now() + timeoutMs;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
function click(text: string) {
  const button = [...document.querySelectorAll('button')].find(node => node.textContent === text);
  if (!button || button.disabled) throw new Error(`Button unavailable: ${text}`);
  button.click();
}
function select(label: string, value: string) {
  const field = [...document.querySelectorAll<HTMLLabelElement>('.tuner-field')].find(node => node.querySelector('span')?.textContent === label)?.querySelector('select');
  if (!field) throw new Error(`Select unavailable: ${label}`);
  field.value = value;
  field.dispatchEvent(new Event('change', { bubbles: true }));
}
function sharedAudio(): PracticeAudio {
  const audio = window.practiceDesk?.audio;
  if (!audio || !('tracker' in audio)) throw new Error('Shared browser session unavailable');
  return audio;
}
run.addEventListener('click', () => {
  run.disabled = true;
  void (async () => {
    await until(() => window.practiceDesk?.chart, 'Practice chart did not load');
    click('Tuner');
    check(contexts === 0 && acquisitions === 0, 'Opening tuner creates no audio context or microphone');
    check(navigator.mediaDevices === syntheticDevices, 'The fixture replaces microphone acquisition with a synthetic provider');
    click('Use shared audio');
    await until(() => document.querySelector('.tuner-connection')?.textContent?.includes('connected'), 'Shared audio connection failed');
    const audio = sharedAudio();
    check(contexts === 1 && acquisitions === 0, 'Reference controls reuse one practice AudioContext');
    check(audio.tuner.snapshot().root === 48 && audio.tuner.snapshot().targets.length === 8, 'Native defaults are C3 major through C4');
    select('Scale', 'natural-minor');
    await until(() => audio.tuner.snapshot().scale === 'natural-minor', 'Scale selection did not apply automatically');
    check(audio.tuner.snapshot().targets[2].midi === 51, 'Changing scale immediately applies native C minor');
    select('Root note', '2');
    select('Octave', '2');
    select('Scale', 'major');
    await until(() => audio.tuner.snapshot().root === 38 && audio.tuner.snapshot().scale === 'major', 'Latest rapid selection was not applied');
    check(![...document.querySelectorAll('button')].some(node => node.textContent === 'Set scale'), 'Selections apply without a Set scale button');
    select('Root note', '0');
    select('Octave', '3');
    await until(() => audio.tuner.snapshot().root === 48 && !document.querySelector('.tuner-panel[aria-busy=true]'), 'C3 selection did not acknowledge');
    click('Hear note');
    await until(() => audio.tuner.snapshot().preview.kind === 'note', 'Native reference did not start');
    check(audio.snapshot().phase === 'idle', 'Reference plays without starting the song');
    click('Confirm');
    await until(() => audio.tuner.snapshot().step === 1, 'Confirmation did not advance');
    check(document.querySelector('.tuner-target')?.textContent === 'D3', 'Native confirmation advances to D3');
    const notePreview = audio.tuner.snapshot().preview;
    check(notePreview.kind === 'note' && notePreview.step === 0, 'Confirm leaves the independently playing C3 reference unchanged');
    click('Stop sound');
    await until(() => audio.tuner.snapshot().preview.kind === 'silent', 'Reference did not stop');
    click('Confirm');
    await until(() => audio.tuner.snapshot().step === 2, 'Silent confirmation did not advance');
    check(audio.tuner.snapshot().preview.kind === 'silent', 'Confirm advances silently without triggering Hear');
    const previewed = new Set<number>();
    const detachPreview = audio.tuner.subscribe(value => { if (value.preview.kind === 'scale') previewed.add(value.preview.step); });
    click('Play scale');
    await until(() => audio.tuner.snapshot().preview.kind === 'scale', 'Whole scale did not begin');
    await until(() => audio.tuner.snapshot().preview.kind === 'silent', 'Whole scale did not finish natively', 20000);
    detachPreview();
    check(previewed.size === 8 && audio.tuner.snapshot().step === 2, 'Whole scale plays every ascending degree without confirming any note');
    const revision = audio.tuner.snapshot().revision;
    await audio.tuner.command({ kind: 'configure', root: 48, scale: 'major', expectedRevision: revision });
    let staleRejected = false;
    try { await audio.tuner.command({ kind: 'confirm', expectedRevision: revision }); } catch { staleRejected = true; }
    check(staleRejected && audio.tuner.snapshot().step === 0, 'Stale confirmation cannot skip a scale note');
    click('Listen');
    await until(() => audio.tuner.snapshot().pitch.kind === 'pitched', 'Native pitch detector did not recognize synthetic C3');
    const pitch = audio.tuner.snapshot().pitch;
    check(pitch.kind === 'pitched' && pitch.note.midi === 48 && Math.abs(pitch.cents) < 3, 'Real worklet and WASM report synthetic C3 in tune');
    check(contexts === 1 && acquisitions === 1, 'Listening acquires the microphone through the existing session once');
    click('Close tuner');
    click('Close tuner');
    await until(() => !document.querySelector('dialog[open]'), 'Tuner did not close');
    check(!audio.tuner.snapshot().listening && audio.microphone, 'Closing tuner stops analysis and preserves the shared microphone');
    click('Tuner');
    check(sharedAudio() === audio && contexts === 1 && acquisitions === 1, 'Reopening tuner keeps the same session, context, and microphone');
    check(document.querySelectorAll('.tuner-panel').length === 1, 'Reopening mounts one tuner view');
    click('Listen');
    await until(() => audio.tuner.snapshot().listening, 'Shared microphone was not reused');
    await audio.start({ bpm: 120, countInBars: 0, startBar: 1, endBar: 2, loop: false });
    check(!audio.tuner.snapshot().listening && audio.tuner.snapshot().preview.kind === 'silent', 'Starting practice closes native tuning in the same engine');
    let runningRejected = false;
    try { await audio.tuner.command({ kind: 'cue', expectedRevision: audio.tuner.snapshot().revision }); } catch { runningRejected = true; }
    check(runningRejected && audio.snapshot().phase === 'playing', 'Tuner cue cannot interrupt an active performance');
    await audio.stop();
    click('Close tuner');
    await until(() => !document.querySelector('dialog[open]'), 'Final tuner close failed');
    check(contexts === 1 && acquisitions === 1, 'Both sibling views used one audio context and one microphone acquisition');
    const snapshot = audio.tuner.snapshot();
    const detachedRoot = document.createElement('div');
    document.body.append(detachedRoot);
    const never = new Promise<TunerPort>(() => {});
    const connectingPanel = mountTuner(detachedRoot, { connect: () => never });
    detachedRoot.querySelector('button')?.click();
    await connectingPanel.close();
    check(detachedRoot.children.length === 0, 'Closing while shared audio connects disposes the panel immediately');
    let subscribers = 0, closes = 0;
    const port = (revision: number): TunerPort => {
      const state: TunerState = { ...snapshot, revision };
      return { snapshot: () => state, subscribe: () => { subscribers++; return () => subscribers--; },
        command: async command => { if (command.kind === 'close') closes++; return state; } };
    };
    connectingPanel.setSession(port(7));
    check(subscribers === 0, 'A late audio connection cannot resubscribe a closed panel');
    const changingPanel = mountTuner(detachedRoot, { connect: () => never });
    const blockedPort: TunerPort = { ...port(8), command: () => new Promise<TunerState>(() => {}) };
    changingPanel.setSession(blockedPort);
    detachedRoot.querySelectorAll('button').forEach(button => { if (button.textContent === 'Hear note') button.click(); });
    const closed = changingPanel.close();
    changingPanel.setSession(port(9));
    await closed;
    check(detachedRoot.children.length === 0 && subscribers === 0 && closes === 1, 'Closing follows a replacement session and removes its listeners');
    detachedRoot.remove();
    source?.stop();
    await audio.disableMicrophone();
    await audio.dispose();
    document.title = `PASS: ${passed} shared tuner checks`;
    output.textContent += `PASS ${passed} checks. Synthetic input only. Audio disposed.\n`;
  })().catch(error => {
    document.title = 'FAIL: shared tuner checks';
    output.textContent += `FAIL ${error instanceof Error ? error.stack : String(error)}\n`;
    source?.stop();
    void window.practiceDesk?.audio?.dispose();
  });
});
