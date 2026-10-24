import { PracticeAudio } from './audio.js';
import { CONTROLS, playableBars } from '../../lib/performance/chart.js';
import { CONTROL_IDS, type ChannelId, type Chart, type PracticeState, type PracticeEvent, type SongScript } from '../../lib/performance/model.js';
import { SONGS, loadSong } from '../../songs/index.js';
import { parseControlCue } from '../../lib/performance/chart-controls.js';
import { openCurrentChart } from './open-chart.js';

function requiredElement<T extends Element>(selector: string, constructor: { new(): T }, root: ParentNode = document): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Missing UI element ${selector}`);
  return element;
}

const elements = {
  'practice-desk': requiredElement('#practice-desk', HTMLElement),
  'song-title': requiredElement('#song-title', HTMLHeadingElement),
  'song-select': requiredElement('#song-select', HTMLSelectElement),
  'song-description': requiredElement('#song-description', HTMLParagraphElement),
  'sheet-link': requiredElement('#sheet-link', HTMLButtonElement),
  'sheet-status': requiredElement('#sheet-status', HTMLSpanElement),
  'error': requiredElement('#error', HTMLDivElement),
  'phase-label': requiredElement('#phase-label', HTMLSpanElement),
  'range-label': requiredElement('#range-label', HTMLSpanElement),
  'bar-number': requiredElement('#bar-number', HTMLSpanElement),
  'beat-number': requiredElement('#beat-number', HTMLSpanElement),
  'beat-dots': requiredElement('#beat-dots', HTMLDivElement),
  'start': requiredElement('#start', HTMLButtonElement),
  'stop': requiredElement('#stop', HTMLButtonElement),
  'transport-hint': requiredElement('#transport-hint', HTMLParagraphElement),
  'bpm': requiredElement('#bpm', HTMLInputElement),
  'count-in': requiredElement('#count-in', HTMLSelectElement),
  'start-section': requiredElement('#start-section', HTMLSelectElement),
  'end-bar': requiredElement('#end-bar', HTMLInputElement),
  'loop': requiredElement('#loop', HTMLInputElement),
  'current-section': requiredElement('#current-section', HTMLElement),
  'next-section': requiredElement('#next-section', HTMLElement),
  'section-progress': requiredElement('#section-progress', HTMLDivElement),
  'pads': requiredElement('#pads', HTMLDivElement),
  'click': requiredElement('#click', HTMLInputElement),
  'channel-controls': requiredElement('#channel-controls', HTMLElement),
  'selected-id': requiredElement('#selected-id', HTMLSpanElement),
  'selected-channel': requiredElement('#selected-channel', HTMLSelectElement),
  'knob': requiredElement('#knob', HTMLDivElement),
  'volume-output': requiredElement('#volume-output', HTMLOutputElement),
  'volume': requiredElement('#volume', HTMLInputElement),
  'mute-selected': requiredElement('#mute-selected', HTMLButtonElement),
  'sample-status': requiredElement('#sample-status', HTMLParagraphElement),
  'load-sound': requiredElement('#load-sound', HTMLButtonElement),
  'sample-file': requiredElement('#sample-file', HTMLInputElement),
  'mushroom': requiredElement('#mushroom', HTMLButtonElement),
  'record-demo': requiredElement('#record-demo', HTMLButtonElement),
  'download-demo': requiredElement('#download-demo', HTMLAnchorElement),
  'recording-hint': requiredElement('#recording-hint', HTMLSpanElement),
  'offline-status': requiredElement('#offline-status', HTMLSpanElement),
};
const startLabel = requiredElement('#start span:last-child', HTMLSpanElement);
const recordLabel = requiredElement('#record-demo span:last-child', HTMLSpanElement);
const sectionProgress = requiredElement('#section-progress > span', HTMLSpanElement);
const knobNeedle = requiredElement('#knob > span', HTMLSpanElement);
interface PadElements { shell: HTMLElement; button: HTMLButtonElement; mute: HTMLButtonElement; status: HTMLSpanElement; cue: HTMLElement; sampleStatus: HTMLSpanElement }
const pads = new Map<ChannelId, PadElements>();
const heldKeys = new Set<string>();
const sources = new Map<ChannelId, string>();
let chart: Chart | undefined;
let song: SongScript | undefined;
let songGeneration = 0;
let switching = false;
let outputCapture: 'idle' | 'starting' | 'recording' | 'stopping' = 'idle';
let audio: PracticeAudio | undefined;
let preparing: Promise<PracticeAudio> | null = null;
let starting = false;
let transportGeneration = 0;
type DisplayState = Pick<PracticeState, 'phase' | 'bar' | 'beat' | 'selectedChannel' | 'channels'> & Partial<PracticeState>;
let state: DisplayState = { phase: 'idle', bar: null, beat: 1, selectedChannel: 'R1', channels: CONTROLS.map(({ id }) => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })) };
let recorder: MediaRecorder | undefined;
let recordingURL: string | undefined;

function showError(error: unknown) {
  elements.error.textContent = error instanceof Error ? error.message : String(error);
  elements.error.hidden = false;
}

async function act(action: () => unknown | Promise<unknown>): Promise<void> {
  elements.error.hidden = true;
  try { await action(); }
  catch (error) { showError(error); }
}

function isRunning() { return state.phase === 'playing' || state.phase === 'count-in'; }

function beatName(position: number): string {
  const whole = Math.floor(position) + 1;
  const fraction = position % 1;
  return `${whole}${fraction === 0.25 ? 'e' : fraction === 0.5 ? '&' : fraction === 0.75 ? 'a' : ''}`;
}

function cueLabel(cue: string): string {
  const action = parseControlCue(cue);
  if (action.kind === 'tap') {
    const beats = action.beats.map(beatName);
    return `Tap ${beats.join(' · ')}`;
  }
  const labels: Readonly<Record<string, string>> = {
    r: 'Arm capture', rb: 'Arm · next bar',
    c: 'Commit + loop', cb: 'Commit + loop · next bar',
    cr: 'Commit + arm', crb: 'Commit + arm · next bar',
    x: 'Stop loop', xb: 'Stop · next bar',
    p: 'Play', pb: 'Play · next bar',
  };
  return cue ? labels[cue] || `Chart cue ${cue}` : 'No action in this column';
}

async function ensureAudio() {
  if (audio) return audio;
  if (!song || switching) throw new Error('The song script is still loading. Try again in a moment.');
  if (!window.isSecureContext) throw new Error('Audio needs HTTPS on your phone, or localhost on this computer. See Setup & notes.');
  if (preparing) return preparing;
  elements.start.disabled = true;
  startLabel.textContent = 'Preparing audio…';
  const generation = songGeneration;
  preparing = PracticeAudio.create({ chart: song.chart, program: song.program }).then(async instance => {
    if (generation !== songGeneration) {
      await instance.dispose();
      throw new Error('The song changed while audio was preparing.');
    }
    audio = instance;
    audio.subscribe(render);
    audio.onEvent(event => {
      if (generation === songGeneration && audio === instance) postPerformanceEvent(event);
    });
    return instance;
  }).finally(() => { preparing = null; render(state); });
  return preparing;
}

function selectedId(): ChannelId { return state.selectedChannel || 'R1'; }
function controlName(id: ChannelId): string { return chart?.controlNames[id] || id; }

function flash(id: ChannelId | 'mushroom', held = false) {
  const element = id === 'mushroom' ? elements[id] : pads.get(id)?.button;
  if (!element) return;
  element.classList.add('pressed');
  if (!held) setTimeout(() => element.classList.remove('pressed'), 130);
}

function releasePresses() {
  heldKeys.clear();
  document.querySelectorAll('.pressed').forEach(element => element.classList.remove('pressed'));
}

async function triggerPad(id: ChannelId) {
  const generation = transportGeneration;
  const instance = await ensureAudio();
  if (generation !== transportGeneration) return;
  await instance.selectChannel(id);
  if (generation !== transportGeneration) return;
  await instance.control({ id });
}

async function startPractice() {
  if (starting || isRunning() || outputCapture === 'starting' || outputCapture === 'stopping') return;
  if (!chart) throw new Error('The song chart is still loading. Try again in a moment.');
  const bpm = Number(elements.bpm.value);
  const startBar = Number(elements['start-section'].value);
  const endBar = Number(elements['end-bar'].value);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('Choose a tempo between 40 and 240 BPM.');
  if (!Number.isInteger(endBar) || endBar < startBar || endBar > playableBars(chart)) throw new Error(`Choose an end bar from ${startBar} to ${playableBars(chart)}. Partial bars are not sequenced yet.`);
  const generation = ++transportGeneration;
  starting = true;
  render(state);
  let instance: PracticeAudio | undefined;
  let startedRecording = false;
  try {
    instance = await ensureAudio();
    if (generation !== transportGeneration) return;
    await instance.enableMicrophone();
    if (generation !== transportGeneration) { await instance.disableMicrophone(); return; }
    if (outputCapture === 'idle') { await toggleOutputRecording(); startedRecording = true; }
    if (generation !== transportGeneration) { finishOutputRecording(); await instance.disableMicrophone(); return; }
    await instance.setClick(elements.click.checked);
    if (generation !== transportGeneration) return;
    await instance.start({ bpm, countInBars: Number(elements['count-in'].value), startBar, endBar,
      loop: elements.loop.checked, automatic: false });
  } catch (error) {
    if (startedRecording) finishOutputRecording();
    if (instance) await instance.disableMicrophone().catch(() => {});
    throw error;
  } finally { starting = false; render(state); }
}

async function stopPerformance(command: 'stop' | 'panic') {
  transportGeneration++;
  finishOutputRecording();
  releasePresses();
  const instance = audio;
  if (!instance) return;
  const results = await Promise.allSettled([
    command === 'stop' ? instance.stop() : instance.control({ id: 'mushroom' }),
    instance.disableMicrophone(),
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    if (audio === instance) audio = undefined;
    await instance.dispose().catch(() => {});
    sources.clear();
    render({ phase: 'idle', looping: [], recording: null, microphone: false,
      channels: state.channels.map(channel => ({ ...channel, looping: false,
        ready: false, status: 'empty', light: { kind: 'off' } })) });
    throw failure.reason;
  }
}

function stopPractice() { return stopPerformance('stop'); }

function panic() { return stopPerformance('panic'); }

function makePads() {
  for (const control of CONTROLS) {
    const shell = document.createElement('article');
    shell.className = 'pad-shell';
    shell.dataset.channel = control.id;
    shell.style.setProperty('--pad-color', control.color);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pad';
    button.dataset.control = control.id;
    button.setAttribute('aria-label', `${control.id} ${controlName(control.id)}`);
    button.innerHTML = `<span class="pad-top"><span class="pad-id">${control.id}</span><kbd>${control.shortcut}</kbd></span><span class="pad-name-row"><strong class="pad-name"></strong><span class="pad-cue" aria-label="Chart cue"><code></code><i class="pad-led" aria-hidden="true"></i></span></span><span class="pad-sample-state">Empty slot</span>`;
    const footer = document.createElement('div');
    footer.className = 'pad-footer';
    const status = document.createElement('span');
    status.textContent = 'No action in this column';
    const mute = document.createElement('button');
    mute.type = 'button';
    mute.className = 'channel-mute';
    mute.textContent = 'MUTE';
    mute.setAttribute('aria-label', `Mute ${control.id} ${controlName(control.id)}`);
    mute.setAttribute('aria-pressed', 'false');
    mute.addEventListener('click', () => act(async () => {
      const instance = await ensureAudio();
      const channel = state.channels?.find(channel => channel.id === control.id);
      await instance.setChannel(control.id, { muted: !channel?.muted });
    }));
    footer.append(status, mute);
    shell.append(button, footer);
    elements.pads.append(shell);
    pads.set(control.id, { shell, button, mute, status, cue: requiredElement('code', HTMLElement, button), sampleStatus: requiredElement('.pad-sample-state', HTMLSpanElement, button) });
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      flash(control.id, true);
      act(() => triggerPad(control.id));
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, () => button.classList.remove('pressed'));
    }
    button.addEventListener('click', event => {
      if (event.detail !== 0) return;
      flash(control.id);
      act(() => triggerPad(control.id));
    });
    const option = document.createElement('option');
    option.value = control.id;
    option.textContent = `${control.id} · ${controlName(control.id)}`;
    elements['selected-channel'].append(option);
  }
}

function render(next: Partial<PracticeState>) {
  const ended = next.phase === 'ended' && state.phase !== 'ended';
  state = { ...state, ...next };
  if (ended) {
    finishOutputRecording();
    if (audio) void audio.disableMicrophone().catch(showError);
  }
  if (!chart) return;
  const running = isRunning();
  const displayBar = state.bar || Number(elements['start-section'].value) || 1;
  const currentBar = chart.bars[displayBar - 1];
  const currentSection = chart.sections.find(section => section.id === currentBar?.sectionId);
  const nextSection = chart.sections.find(section => section.startBar > displayBar);
  const inCountIn = state.phase === 'count-in';
  const selected = CONTROLS.find(control => control.id === selectedId()) || { id: 'R1', color: '#dfbe78' };
  const selectedChannel = state.channels?.find(channel => channel.id === selected.id) || { gain: 1, muted: false };
  const gain = Number.isFinite(selectedChannel.gain) ? selectedChannel.gain : 1;
  const recording = state.channels.some(channel => ['armed', 'recording', 'stopping'].includes(channel.status));
  elements['practice-desk'].dataset.phase = state.phase;
  elements['practice-desk'].dataset.bar = state.bar === null ? '' : String(state.bar);
  elements['practice-desk'].dataset.beat = state.beat === null ? '' : String(state.beat);
  elements['phase-label'].textContent = inCountIn ? `COUNT-IN · ${state.countInRemaining ?? '…'} TO GO` : state.phase === 'playing' ? 'PLAYING' : state.phase === 'ended' ? 'RANGE COMPLETE' : 'READY TO PLAY';
  elements['range-label'].textContent = `BARS ${running ? state.startBar : elements['start-section'].value}–${running ? state.endBar : elements['end-bar'].value}`;
  elements['bar-number'].textContent = inCountIn ? 'IN' : String(displayBar).padStart(2, '0');
  elements['beat-number'].textContent = String(state.beat || 1);
  elements['beat-dots'].querySelectorAll('i').forEach((dot, index) => dot.classList.toggle('active', running && index === (state.beat || 1) - 1));
  elements.start.disabled = running || starting || switching || Boolean(preparing) || outputCapture === 'starting' || outputCapture === 'stopping';
  elements['song-select'].disabled = switching || outputCapture !== 'idle';
  elements['record-demo'].disabled = outputCapture === 'starting' || outputCapture === 'stopping';
  startLabel.textContent = preparing ? 'Preparing audio…' : state.phase === 'ended' ? 'Play again' : 'Start practice';
  elements.stop.disabled = !starting && !running && !recording;
  elements['transport-hint'].textContent = inCountIn ? 'Listen for the downbeat.' : state.phase === 'playing' ? 'Space to stop. Esc stops everything.' : Number(elements['count-in'].value) === 0 ? 'Start on the next beat.' : `${elements['count-in'].value === '1' ? 'One bar' : 'Two bars'} of clicks, then you're in.`;
  for (const element of [elements.bpm, elements['count-in'], elements['start-section'], elements['end-bar'], elements.loop]) element.disabled = running || starting;
  elements['current-section'].textContent = inCountIn ? 'Lead-in' : currentBar?.section || 'Ready';
  elements['next-section'].replaceChildren();
  if (inCountIn) elements['next-section'].textContent = currentBar?.section || 'Song start';
  else if (nextSection) {
    elements['next-section'].textContent = nextSection.label;
    const barLabel = document.createElement('span');
    barLabel.textContent = `· bar ${nextSection.startBar}`;
    elements['next-section'].append(barLabel);
  } else elements['next-section'].textContent = 'End of chart';
  const sectionLength = currentSection ? currentSection.endBar - currentSection.startBar + 1 : 1;
  const progress = currentSection && !inCountIn ? ((displayBar - currentSection.startBar) * 4 + (state.beat || 1) - 1) / (sectionLength * 4) : 0;
  sectionProgress.style.width = `${Math.min(100, progress * 100)}%`;
  elements['sheet-link'].setAttribute('aria-label', `Open ${inCountIn ? 'lead-in' : `bar ${displayBar}`} in Google Sheets`);
  for (const control of CONTROLS) {
    const pad = pads.get(control.id);
    if (!pad) continue;
    const channel = state.channels?.find(channel => channel.id === control.id);
    const looping = channel?.looping || state.looping?.includes(control.id);
    const cue = (inCountIn ? chart.leadInCues : currentBar?.cues)?.[control.id] || '';
    const compiledCue = (inCountIn ? song?.program.controls?.leadIn : song?.program.controls?.bars[displayBar - 1])?.[control.id];
    const capture = compiledCue && (compiledCue.kind === 'arm' || compiledCue.kind === 'commit-arm') ? compiledCue.capture : undefined;
    const action = cueLabel(cue) + (capture ? ` · Extract ${capture.beats.map(beatName).join(' + ')}` : '');
    const sampleStatus = channel?.status || 'empty';
    pad.shell.classList.toggle('selected', control.id === selected.id);
    pad.shell.classList.toggle('muted', Boolean(channel?.muted));
    pad.shell.dataset.sampleStatus = sampleStatus;
    const light = channel?.light || { kind: 'off' };
    if (pad.shell.dataset.light !== light.kind) {
      if (light.kind === 'releasing') pad.shell.style.setProperty('--pad-release-ms', `${light.remainingMs}ms`);
      pad.shell.dataset.light = light.kind;
    }
    const name = chart.controlNames[control.id];
    const padName = pad.button.querySelector('.pad-name');
    if (padName) padName.textContent = name;
    pad.button.setAttribute('aria-label', `${control.id} ${name}, ${action}`);
    pad.mute.setAttribute('aria-label', `Mute ${control.id} ${name}`);
    const option = Array.from(elements['selected-channel'].options).find(option => option.value === control.id);
    if (option) option.textContent = `${control.id} · ${name}`;
    pad.button.setAttribute('aria-pressed', looping ? 'true' : 'false');
    pad.mute.setAttribute('aria-pressed', String(Boolean(channel?.muted)));
    pad.mute.textContent = channel?.muted ? 'UNMUTE' : 'MUTE';
    pad.status.textContent = action;
    pad.sampleStatus.textContent = sampleStatus === 'empty' ? 'Empty slot' : sampleStatus === 'ready' ? 'Sample ready' :
      sampleStatus === 'armed' ? 'Capture armed' : sampleStatus === 'stopping' ? 'Commit queued' :
      sampleStatus === 'recording' ? 'Recording microphone' : 'Loop playing';
    pad.cue.textContent = cue || '·';
    pad.cue.title = 'Original chart notation';
  }
  elements['selected-channel'].value = selected.id;
  elements['selected-id'].textContent = selected.id;
  elements['channel-controls']?.style.setProperty('--selected', selected.color);
  elements.volume.style.setProperty('--selected', selected.color);
  elements.knob.style.setProperty('--selected', selected.color);
  knobNeedle.style.transform = `rotate(${-135 + gain * 270}deg)`;
  if (document.activeElement !== elements.volume) elements.volume.value = String(gain);
  elements['volume-output'].innerHTML = `${Math.round(gain * 100)}<span>%</span>`;
  elements['mute-selected'].setAttribute('aria-pressed', String(Boolean(selectedChannel.muted)));
  elements['mute-selected'].textContent = selectedChannel.muted ? 'Unmute channel' : 'Mute channel';
  const channel = state.channels.find(channel => channel.id === selected.id);
  if (channel?.status === 'recording' || channel?.status === 'armed') sources.delete(selected.id);
  elements['sample-status'].textContent = channel?.ready ? sources.get(selected.id) || 'Captured microphone sample' : 'Empty slot · capture from the chart';
  elements['load-sound'].disabled = running || Boolean(recording);
  if (state.error) showError(new Error(state.error));
}

function finishOutputRecording() {
  if (recorder?.state !== 'recording') return;
  outputCapture = 'stopping';
  recorder.stop();
}

async function toggleOutputRecording() {
  if (outputCapture === 'starting' || outputCapture === 'stopping') return;
  if (recorder?.state === 'recording') { finishOutputRecording(); render(state); return; }
  const generation = transportGeneration;
  outputCapture = 'starting';
  render(state);
  try {
    const instance = await ensureAudio();
    if (generation !== transportGeneration) return;
    if (!window.MediaRecorder || !instance.outputStream) throw new Error('This browser cannot record the desk output. Use your device screen recorder.');
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(instance.outputStream, mimeType ? { mimeType } : {});
    const chunks: Blob[] = [];
    const activeRecorder = recorder;
    recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener('stop', () => {
      if (recordingURL) URL.revokeObjectURL(recordingURL);
      const type = activeRecorder.mimeType || mimeType || 'audio/webm';
      recordingURL = URL.createObjectURL(new Blob(chunks, { type }));
      elements['download-demo'].href = recordingURL;
      elements['download-demo'].download = `practice-${new Date().toISOString().replace(/[:.]/g, '-')}.${type.includes('mp4') ? 'm4a' : 'webm'}`;
      elements['download-demo'].hidden = false;
      elements['record-demo'].setAttribute('aria-pressed', 'false');
      recordLabel.textContent = 'Record demo';
      elements['recording-hint'].textContent = 'Take ready. Download it before leaving.';
      outputCapture = 'idle';
      render(state);
    });
    recorder.addEventListener('error', event => showError('error' in event ? event.error : new Error('Output recording failed.')));
    recorder.start();
    outputCapture = 'recording';
    render(state);
    elements['record-demo'].setAttribute('aria-pressed', 'true');
    recordLabel.textContent = 'Finish take';
    elements['recording-hint'].textContent = 'Recording the desk output.';
    elements['download-demo'].hidden = true;
  } finally {
    if (outputCapture === 'starting') outputCapture = 'idle';
    render(state);
  }
}

elements.start.addEventListener('click', () => act(startPractice));
elements['sheet-link'].addEventListener('click', () => act(async () => {
  if (!chart) throw new Error('Choose a song first');
  const currentChart = chart;
  const currentBar = state.bar || Number(elements['start-section'].value) || 1;
  const phase = state.phase === 'count-in' ? 'count-in' : 'playing';
  elements['sheet-link'].disabled = true;
  elements['sheet-status'].textContent = 'Selecting column…';
  try {
    const result = await openCurrentChart(currentChart, currentBar, phase);
    elements['sheet-status'].textContent = `Selected ${result.selectedRange}`;
  } catch (error) {
    elements['sheet-status'].textContent = '';
    throw error;
  }
  finally { elements['sheet-link'].disabled = false; }
}));
elements['song-select'].addEventListener('change', () => act(() => switchSong(elements['song-select'].value)));
elements.stop.addEventListener('click', () => act(stopPractice));
elements.mushroom.addEventListener('click', () => { flash('mushroom'); act(panic); });
elements['record-demo'].addEventListener('click', () => act(toggleOutputRecording));
elements['selected-channel'].addEventListener('change', () => act(async () => {
  const instance = await ensureAudio();
  const id = CONTROL_IDS.find(id => id === elements['selected-channel'].value);
  if (!id) throw new Error('Choose a known channel');
  await instance.selectChannel(id);
}));
elements.volume.addEventListener('input', () => act(async () => {
  const value = Number(elements.volume.value);
  knobNeedle.style.transform = `rotate(${-135 + value * 270}deg)`;
  elements['volume-output'].innerHTML = `${Math.round(value * 100)}<span>%</span>`;
  const instance = await ensureAudio();
  await instance.control({ id: 'knob', value });
}));
elements['mute-selected'].addEventListener('click', () => act(async () => {
  const instance = await ensureAudio();
  const channel = state.channels?.find(channel => channel.id === selectedId());
  await instance.setChannel(selectedId(), { muted: !channel?.muted });
}));
elements.click.addEventListener('change', () => act(async () => {
  if (audio) await audio.setClick(elements.click.checked);
}));
elements['load-sound'].addEventListener('click', () => elements['sample-file'].click());
elements['sample-file'].addEventListener('change', () => act(async () => {
  const file = elements['sample-file'].files?.[0];
  if (!file) return;
  const id = selectedId();
  const instance = await ensureAudio();
  await instance.loadFile(id, file);
  sources.set(id, file.name);
  elements['sample-file'].value = '';
  render(state);
}));
elements['start-section'].addEventListener('change', () => {
  if (!chart) return;
  const start = Number(elements['start-section'].value);
  elements['end-bar'].min = String(start);
  if (Number(elements['end-bar'].value) < start) elements['end-bar'].value = String(Math.min(playableBars(chart), chart.sections.find(section => section.startBar === start)?.endBar || playableBars(chart)));
  render(state);
});
for (const element of [elements['count-in'], elements['end-bar']]) element.addEventListener('change', () => render(state));

window.addEventListener('keydown', event => {
  if (event.repeat || heldKeys.has(event.code)) return;
  if (event.code === 'Escape') {
    event.preventDefault();
    heldKeys.add(event.code);
    flash('mushroom', true);
    act(panic);
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable=true]'))) return;
  const control = CONTROLS.find(control => control.key === event.code);
  if (!control && event.code !== 'Space') return;
  event.preventDefault();
  heldKeys.add(event.code);
  if (control) { flash(control.id, true); act(() => triggerPad(control.id)); }
  else act(() => isRunning() ? stopPractice() : startPractice());
});
window.addEventListener('keyup', event => {
  heldKeys.delete(event.code);
  const control = CONTROLS.find(control => control.key === event.code);
  if (control) pads.get(control.id)?.button.classList.remove('pressed');
  if (event.code === 'Escape') elements.mushroom.classList.remove('pressed');
});
function postPerformanceEvent(event: PracticeEvent): void {
  window.postMessage({ kind: 'show-tools-performance', event }, location.origin);
}

window.addEventListener('message', event => {
  const message: unknown = event.data;
  if (event.source !== window || event.origin !== location.origin || typeof message !== 'object' || message === null
    || !('kind' in message) || message.kind !== 'show-tools-state-request' || !audio) return;
  const current = audio.snapshot();
  postPerformanceEvent({ v: 1, runId: current.runId, seq: current.seq, type: 'state', state: current });
});

window.addEventListener('blur', releasePresses);
document.addEventListener('visibilitychange', () => { if (document.hidden) releasePresses(); });
window.addEventListener('pagehide', () => { if (recorder?.state === 'recording') recorder.stop(); });

makePads();
for (const entry of SONGS) {
  const option = document.createElement('option');
  option.value = entry.id;
  option.textContent = entry.title;
  elements['song-select'].append(option);
}
elements.start.disabled = true;
async function switchSong(id: string): Promise<void> {
  if (outputCapture !== 'idle') throw new Error('Finish the output recording before switching songs.');
  const generation = ++songGeneration;
  transportGeneration++;
  switching = true;
  render(state);
  releasePresses();
  const previousAudio = audio;
  audio = undefined;
  try {
    if (previousAudio) await previousAudio.stop();
    if (previousAudio) await previousAudio.dispose();
    if (preparing) await preparing.catch(() => {});
    const loaded = await loadSong(id);
    if (generation !== songGeneration) return;
    song = loaded;
    chart = loaded.chart;
    sources.clear();
    state = { phase: 'idle', bar: null, beat: 1, selectedChannel: 'R1', recording: null, microphone: false,
      looping: [], error: null, channels: CONTROLS.map(({ id }) => ({ id, gain: 0.8, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })) };
    elements['song-select'].value = loaded.id;
    elements['song-title'].textContent = loaded.chart.title;
    elements['song-description'].textContent = loaded.description;
    document.title = `${loaded.chart.title} · Practice desk`;
    elements.bpm.value = String(loaded.chart.bpm);
    elements['start-section'].replaceChildren();
    for (const section of loaded.chart.sections.filter(section => section.startBar <= playableBars(loaded.chart))) {
      const option = document.createElement('option');
      option.value = String(section.startBar);
      option.textContent = `${section.label}${section.startBar > loaded.chart.annotatedThroughBar ? ' · uncharted' : ''}`;
      elements['start-section'].append(option);
    }
    elements['start-section'].value = String(loaded.practice.startBar);
    elements['end-bar'].min = String(loaded.practice.startBar);
    elements['end-bar'].max = String(playableBars(loaded.chart));
    elements['end-bar'].value = String(loaded.practice.endBar);
  } catch (error) {
    if (song) elements['song-select'].value = song.id;
    throw error;
  } finally {
    if (generation === songGeneration) {
      switching = false;
      starting = false;
      render(state);
    }
  }
}
await act(() => switchSong('dance-yrself-clean'));

if (new URLSearchParams(location.search).has('test')) {
  window.practiceDesk = { get audio() { return audio; }, get state() { return state; }, get chart() { return chart; } };
}

if ('serviceWorker' in navigator && window.isSecureContext && !new URLSearchParams(location.search).has('test')) {
  navigator.serviceWorker.register('./sw.js', { type: 'module' }).then(async registration => {
    await navigator.serviceWorker.ready;
    if (registration.active) elements['offline-status'].textContent = 'Practice files cached for offline use.';
  }).catch(() => { elements['offline-status'].textContent = 'Offline cache unavailable.'; });
}

declare global {
  interface Window {
    practiceDesk?: { readonly audio: PracticeAudio | undefined; readonly state: DisplayState; readonly chart: Chart | undefined };
  }
}
