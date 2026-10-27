import { PracticeAudio } from './audio.js';
import type { MonitoringRelationship } from './audio.js';
import { CONTROLS, playableBars } from '../../lib/performance/chart.js';
import type { ChannelId, Chart, PracticeState, PracticeEvent, SongScript, LiveEffectDefinition } from '../../lib/performance/model.js';
import { SONGS, loadSong } from '../../songs/index.js';
import { parseControlCue } from '../../lib/performance/chart-controls.js';
import { createChartFollower, openCurrentChart } from './open-chart.js';
import { recordingToMp3 } from './recording-export.js';
import { installChartPanel } from './chart-panel.js';
import { decodeCompiledSong } from '../../lib/performance/compiled-song.js';
import type { CompiledSong } from '../../lib/performance/compiled-song.js';
import { createPeripheralInput, peripheralCommandId } from './peripheral-input.js';
import type { PeripheralInput } from './peripheral-input.js';

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
  'mushroom': requiredElement('#mushroom', HTMLButtonElement),
  'record-demo': requiredElement('#record-demo', HTMLButtonElement),
  'download-demo': requiredElement('#download-demo', HTMLAnchorElement),
  'recording-hint': requiredElement('#recording-hint', HTMLSpanElement),
  'effects-enabled': requiredElement('#effects-enabled', HTMLInputElement),
  'effects-delay': requiredElement('#effects-delay', HTMLInputElement),
  'effects-feedback': requiredElement('#effects-feedback', HTMLInputElement),
  'effects-wet': requiredElement('#effects-wet', HTMLInputElement),
  'effects-status': requiredElement('#effects-status', HTMLSpanElement),
  'input-device': requiredElement('#input-device', HTMLSelectElement),
  'output-device': requiredElement('#output-device', HTMLSelectElement),
  'refresh-devices': requiredElement('#refresh-devices', HTMLButtonElement),
  'device-hint': requiredElement('#device-hint', HTMLParagraphElement),
  'effects-capture-hint': requiredElement('#effects-capture-hint', HTMLParagraphElement),
  'monitor-relationship': requiredElement('#monitor-relationship', HTMLSelectElement),
  'monitor-hint': requiredElement('#monitor-hint', HTMLParagraphElement),
  'offline-status': requiredElement('#offline-status', HTMLSpanElement),
};
const startLabel = requiredElement('#start span:last-child', HTMLSpanElement);
const recordLabel = requiredElement('#record-demo span:last-child', HTMLSpanElement);
const sectionProgress = requiredElement('#section-progress > span', HTMLSpanElement);
const chartSource = requiredElement('#chart-source', HTMLElement);
interface PadElements {
  shell: HTMLElement; button: HTMLButtonElement; mute: HTMLButtonElement; status: HTMLSpanElement;
  cue: HTMLElement; sampleStatus: HTMLSpanElement; volume: HTMLInputElement;
  volumeOutput: HTMLOutputElement; load: HTMLButtonElement;
}
const pads = new Map<ChannelId, PadElements>();
const heldKeys = new Set<string>();
let keyboardInput: PeripheralInput | undefined;
let keyboardSession = 0;
let keyboardConnected = false;
function keyboardEdge(event: KeyboardEvent, edge: 'press' | 'release') {
  const mapping = new Map([...CONTROLS.map(control => [control.key, control.id] as const), ['Escape', 'mushroom'] as const]);
  keyboardInput ??= createPeripheralInput({ producerId: 'practice-keyboard', mapping });
  if (!keyboardConnected) {
    keyboardInput.connect({ sessionId: String(keyboardSession++), releasedCodes: keyboardSession === 1 ? [...mapping.keys()] : [] });
    keyboardConnected = true;
  }
  return keyboardInput.inject({ sessionId: String(keyboardSession - 1), sourceTimeMs: event.timeStamp, kind: 'key', code: event.code,
    edge, repeat: edge === 'press' && event.repeat });
}
const sources = new Map<ChannelId, string>();
let chart: Chart | undefined;
let song: SongScript | undefined;
let songGeneration = 0;
let switching = false;
let outputCapture: 'idle' | 'starting' | 'waiting' | 'recording' | 'stopping' = 'idle';
let audio: PracticeAudio | undefined;
let preparing: Promise<PracticeAudio> | null = null;
let starting = false;
let transportGeneration = 0;
type DisplayState = Pick<PracticeState, 'phase' | 'bar' | 'beat' | 'selectedChannel' | 'channels'> & Partial<PracticeState>;
let state: DisplayState = { phase: 'idle', bar: null, beat: 1, selectedChannel: 'R1', channels: CONTROLS.map(({ id }) => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })) };
let recorder: MediaRecorder | undefined;
let recordingURL: string | undefined;
let chartFollower: ReturnType<typeof createChartFollower> | undefined;
let chartFollowOptIn = false;

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
  const compiled = song?.compiled?.cues.find(action => action.source.text.trim() === cue.trim());
  if (compiled) {
    const names = { arm: 'Arm capture', commit: 'Commit + loop', 'commit-arm': 'Commit + arm', stop: 'Stop loop', play: 'Play' };
    const target = compiled.execution.kind === 'next-bar' ? 'next bar' : compiled.execution.kind === 'beat' ? beatName(compiled.execution.beat) : 'now';
    return `${names[compiled.kind]} · ${target}${compiled.cueBeat === null ? '' : ` · cue ${beatName(compiled.cueBeat)}`}`;
  }
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
  preparing = PracticeAudio.create({ chart: song.chart, program: song.program, compiled: song.compiled }).then(async instance => {
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

function controlName(id: ChannelId): string { return chart?.controlNames[id] || id; }

function flash(id: ChannelId | 'mushroom', held = false) {
  const element = id === 'mushroom' ? elements[id] : pads.get(id)?.button;
  if (!element) return;
  element.classList.add('pressed');
  if (!held) setTimeout(() => element.classList.remove('pressed'), 130);
}

function releasePresses() {
  heldKeys.clear();
  keyboardInput?.disconnect();
  if (keyboardConnected) keyboardConnected = false;
  document.querySelectorAll('.pressed').forEach(element => element.classList.remove('pressed'));
}

async function triggerPad(id: ChannelId, commandId?: string) {
  const generation = transportGeneration;
  const instance = await ensureAudio();
  if (generation !== transportGeneration) return;
  await instance.selectChannel(id);
  if (generation !== transportGeneration) return;
  await instance.control({ id }, { commandId });
}

function liveEffectDefinitions(): readonly LiveEffectDefinition[] {
  if (!elements['effects-enabled'].checked) return [];
  const delayMs = Number(elements['effects-delay'].value);
  const feedback = Number(elements['effects-feedback'].value);
  const wet = Number(elements['effects-wet'].value);
  if (!Number.isFinite(delayMs) || delayMs < 40 || delayMs > 250) throw new Error('Choose a slapback delay from 40 to 250 ms.');
  if (!Number.isFinite(feedback) || feedback < 0 || feedback > 0.7) throw new Error('Choose feedback from 0 to 0.7.');
  if (!Number.isFinite(wet) || wet < 0 || wet > 1) throw new Error('Choose a wet amount from 0 to 1.');
  return [{ kind: 'slapback', delayMs, feedback, wet }];
}

function monitoringRelationship(value: string): MonitoringRelationship {
  switch (value) {
    case 'unknown': case 'different-devices': case 'same-usb-interface': case 'same-non-usb': return value;
    default: throw new Error('Choose the physical input/output relationship.');
  }
}

async function refreshAudioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) throw new Error('Audio device enumeration needs localhost or HTTPS in a supported browser.');
  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const { kind, select } of [{ kind: 'audioinput', select: elements['input-device'] }, { kind: 'audiooutput', select: elements['output-device'] }]) {
    const previous = select.value;
    const defaultOption = document.createElement('option');
    defaultOption.value = ''; defaultOption.textContent = kind === 'audioinput' ? 'System default input' : 'System default output';
    select.replaceChildren(defaultOption);
    devices.filter(device => device.kind === kind && device.deviceId && device.deviceId !== 'default').forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `${kind === 'audioinput' ? 'Input' : 'Output'} ${index + 1} · name needs permission`;
      select.append(option);
    });
    if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
  }
  elements['device-hint'].textContent = 'Selected devices apply at Start. Confirm physical input/output identity and USB-interface status separately; device names alone do not establish monitoring eligibility.';
}

async function startPractice() {
  if (starting || isRunning() || outputCapture === 'starting' || outputCapture === 'stopping') return;
  if (!chart) throw new Error('The song chart is still loading. Try again in a moment.');
  const bpm = Number(elements.bpm.value);
  const startBar = Number(elements['start-section'].value);
  const endBar = Number(elements['end-bar'].value);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('Choose a tempo between 40 and 240 BPM.');
  if (!Number.isInteger(endBar) || endBar < startBar || endBar > playableBars(chart)) throw new Error(`Choose an end bar from ${startBar} to ${playableBars(chart)}. Partial bars are not sequenced yet.`);
  const effects = liveEffectDefinitions();
  const generation = ++transportGeneration;
  starting = true;
  render(state);
  let instance: PracticeAudio | undefined;
  let startedRecording = false;
  let microphoneGeneration: number | undefined;
  try {
    instance = await ensureAudio();
    if (generation !== transportGeneration) return;
    await instance.configureLiveEffects(effects);
    if (generation !== transportGeneration) return;
    await instance.setOutputDevice(elements['output-device'].value);
    if (generation !== transportGeneration) return;
    microphoneGeneration = await instance.enableMicrophone({ deviceId: elements['input-device'].value || undefined });
    if (generation !== transportGeneration) { await instance.disableMicrophone(microphoneGeneration); return; }
    if (outputCapture === 'idle') { await toggleOutputRecording(); startedRecording = true; }
    if (generation !== transportGeneration) { finishOutputRecording(); await instance.disableMicrophone(microphoneGeneration); return; }
    await instance.setClick(elements.click.checked);
    if (generation !== transportGeneration) return;
    await instance.start({ bpm, countInBars: Number(elements['count-in'].value), startBar, endBar,
      loop: elements.loop.checked, automatic: false });
    void refreshAudioDevices().catch(showError);
  } catch (error) {
    if (startedRecording) finishOutputRecording();
    if (instance && microphoneGeneration !== undefined) await instance.disableMicrophone(microphoneGeneration).catch(() => {});
    throw error;
  } finally { starting = false; render(state); }
}

async function stopPerformance(command: 'stop' | 'panic', commandId?: string) {
  transportGeneration++;
  chartFollower?.stop();
  finishOutputRecording();
  releasePresses();
  const instance = audio;
  if (!instance) return;
  const results = await Promise.allSettled([
    command === 'stop' ? instance.stop() : instance.control({ id: 'mushroom' }, { commandId }),
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

function panic(commandId?: string) { return stopPerformance('panic', commandId); }

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
    const volumeRow = document.createElement('label');
    volumeRow.className = 'pad-volume';
    const volumeLabel = document.createElement('span');
    volumeLabel.textContent = 'VOLUME';
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.min = '0'; volume.max = '1'; volume.step = '0.01'; volume.value = '1';
    const volumeOutput = document.createElement('output');
    volumeOutput.textContent = '100%';
    volumeRow.append(volumeLabel, volume, volumeOutput);
    volume.addEventListener('input', () => act(async () => {
      const gain = Number(volume.value);
      volumeOutput.textContent = `${Math.round(gain * 100)}%`;
      volume.style.setProperty('--volume', `${gain * 100}%`);
      const instance = await ensureAudio();
      await instance.setChannel(control.id, { gain });
    }));
    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'audio/*'; file.hidden = true;
    const load = document.createElement('button');
    load.type = 'button'; load.className = 'channel-load'; load.textContent = 'LOAD';
    load.addEventListener('click', () => file.click());
    file.addEventListener('change', () => act(async () => {
      const sound = file.files?.[0];
      if (!sound) return;
      const instance = await ensureAudio();
      await instance.loadFile(control.id, sound);
      sources.set(control.id, sound.name);
      file.value = '';
      render(state);
    }));
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
    footer.append(status, load, mute);
    shell.append(button, volumeRow, footer, file);
    elements.pads.append(shell);
    pads.set(control.id, { shell, button, mute, status, cue: requiredElement('code', HTMLElement, button),
      sampleStatus: requiredElement('.pad-sample-state', HTMLSpanElement, button), volume, volumeOutput, load });
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
  }
}

function render(next: Partial<PracticeState>) {
  const ended = next.phase === 'ended' && state.phase !== 'ended';
  state = { ...state, ...next };
  beginOutputRecording(state.phase);
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
  const recording = state.channels.some(channel => ['armed', 'recording', 'stopping'].includes(channel.status));
  elements['practice-desk'].dataset.phase = state.phase;
  elements['practice-desk'].dataset.bar = state.bar === null ? '' : String(state.bar);
  elements['practice-desk'].dataset.beat = state.beat === null ? '' : String(state.beat);
  elements['phase-label'].textContent = inCountIn ? `COUNT-IN · ${state.countInRemaining ?? '…'} TO GO` : state.phase === 'playing' ? 'PLAYING' : state.phase === 'ended' ? 'RANGE COMPLETE' : 'READY TO PLAY';
  elements['range-label'].textContent = `BARS ${running ? state.startBar : elements['start-section'].value}–${running ? state.endBar : elements['end-bar'].value}`;
  elements['bar-number'].textContent = inCountIn ? 'IN' : String(displayBar).padStart(2, '0');
  elements['beat-number'].textContent = String(state.beat || 1);
  elements['beat-dots'].querySelectorAll('i').forEach((dot, index) => dot.classList.toggle('active', running && index === (state.beat || 1) - 1));
  elements.start.disabled = song?.compiled?.executable === false || running || starting || switching || Boolean(preparing) || outputCapture === 'starting' || outputCapture === 'stopping';
  elements['song-select'].disabled = switching || outputCapture !== 'idle';
  elements['record-demo'].disabled = outputCapture === 'starting' || outputCapture === 'stopping';
  const effectsLocked = running || starting || switching || Boolean(preparing) || outputCapture !== 'idle';
  elements['input-device'].disabled = effectsLocked;
  elements['output-device'].disabled = effectsLocked;
  for (const element of [elements['effects-enabled'], elements['effects-delay'], elements['effects-feedback'], elements['effects-wet']]) element.disabled = effectsLocked;
  const effects = state.liveEffects;
  elements['effects-status'].textContent = effects?.active
    ? `Live voice active · revision ${effects.revision}`
    : effects?.prepared ? `Prepared · revision ${effects.revision}. Set effects before Start.` : 'Set effects before Start.';
  const compiledCapture = effects?.captureSupported === true || song?.compiled?.executable === true;
  elements['effects-capture-hint'].hidden = !elements['effects-enabled'].checked;
  elements['effects-capture-hint'].textContent = compiledCapture
    ? 'Capture stores processed voice. Arm selects the voice stack immediately; recording starts at its chart boundary. Effects continue evolving during playback.'
    : 'This chart is not ready for effect-enabled sample capture. Resolve and load the compiled chart inspection before performing it.';
  elements['monitor-relationship'].disabled = !audio?.microphone || starting;
  elements['monitor-relationship'].value = audio?.monitoringRelationship || 'unknown';
  elements['monitor-hint'].textContent = audio?.monitoringRelationship === 'different-devices' || audio?.monitoringRelationship === 'same-usb-interface'
    ? 'Confirmed setup. Live monitoring follows the active voice. Downloads include processed voice.'
    : audio?.monitoringRelationship === 'same-non-usb'
      ? 'Same non-USB device confirmed. Live monitoring stays off. Downloads include processed voice.'
      : 'Live monitoring is off. Confirm your physical setup after Start. Downloads still include processed voice.';
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
    const replay = song?.program.barPlayback?.some(entry => entry.bar === displayBar && entry.channelId === control.id);
    const action = (replay && compiledCue?.kind === 'none' ? 'Auto · recorded bar' : cueLabel(cue))
      + (capture?.kind === 'sparse' ? ` · Extract ${capture.beats.map(beatName).join(' + ')}` : capture?.kind === 'bar' ? ' · Full-bar take' : '');
    const sampleStatus = channel?.status || 'empty';
    pad.shell.classList.toggle('selected', control.id === state.selectedChannel);
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
    pad.volume.setAttribute('aria-label', `${control.id} ${name} volume`);
    pad.load.setAttribute('aria-label', `Load sound for ${control.id} ${name}`);
    pad.load.disabled = running || Boolean(recording);
    if (document.activeElement !== pad.volume) pad.volume.value = String(channel?.gain ?? 1);
    const gain = Number(pad.volume.value);
    const percentage = `${Math.round(gain * 100)}%`;
    pad.volume.setAttribute('aria-valuetext', percentage);
    pad.volume.style.setProperty('--volume', percentage);
    pad.volumeOutput.textContent = percentage;
    if (sampleStatus === 'recording' || sampleStatus === 'armed') sources.delete(control.id);
    pad.sampleStatus.title = sources.get(control.id) || '';
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
  if (state.error) showError(new Error(state.error));
}

function beginOutputRecording(phase: PracticeState['phase']) {
  if (outputCapture !== 'waiting' || phase !== 'playing' || !recorder) return;
  recorder.start();
  outputCapture = 'recording';
  recordLabel.textContent = 'Finish take';
  elements['recording-hint'].textContent = 'Recording the desk output.';
  elements['download-demo'].hidden = true;
}

function finishOutputRecording() {
  if (outputCapture === 'waiting') {
    recorder = undefined;
    outputCapture = 'idle';
    elements['record-demo'].setAttribute('aria-pressed', 'false');
    recordLabel.textContent = 'Record demo';
    elements['recording-hint'].textContent = 'Recording cancelled before the song started.';
    return;
  }
  if (recorder?.state !== 'recording') return;
  outputCapture = 'stopping';
  recorder.stop();
}

async function toggleOutputRecording() {
  if (outputCapture === 'starting' || outputCapture === 'stopping') return;
  if (outputCapture === 'waiting' || recorder?.state === 'recording') { finishOutputRecording(); render(state); return; }
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
    recorder.addEventListener('stop', () => { void finalizeTake(); });
    async function finalizeTake() {
      outputCapture = 'stopping';
      elements['recording-hint'].textContent = 'Preparing MP3…';
      render(state);
      try {
        const type = activeRecorder.mimeType || mimeType || 'audio/webm';
        const mp3 = await recordingToMp3(new Blob(chunks, { type }));
        if (recordingURL) URL.revokeObjectURL(recordingURL);
        recordingURL = URL.createObjectURL(mp3);
        elements['download-demo'].href = recordingURL;
        elements['download-demo'].download = `practice-${new Date().toISOString().replace(/[:.]/g, '-')}.mp3`;
        elements['download-demo'].hidden = false;
        elements['recording-hint'].textContent = 'MP3 ready. Download it before leaving.';
      } catch (error) {
        elements['download-demo'].hidden = !recordingURL;
        elements['recording-hint'].textContent = 'MP3 export failed. Please try another take.';
        showError(error);
      } finally {
        elements['record-demo'].setAttribute('aria-pressed', 'false');
        recordLabel.textContent = 'Record demo';
        outputCapture = 'idle';
        render(state);
      }
    }
    recorder.addEventListener('error', event => showError('error' in event ? event.error : new Error('Output recording failed.')));
    outputCapture = 'waiting';
    elements['record-demo'].setAttribute('aria-pressed', 'true');
    recordLabel.textContent = 'Cancel take';
    elements['recording-hint'].textContent = 'Recording starts with the song. Lead-in is excluded.';
    beginOutputRecording(state.phase);
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
    chartFollowOptIn = true;
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
elements['effects-enabled'].addEventListener('change', () => render(state));
elements['refresh-devices'].addEventListener('click', () => act(refreshAudioDevices));
elements['monitor-relationship'].addEventListener('change', () => act(() => {
  if (!audio) throw new Error('Start the microphone before confirming the monitoring setup.');
  audio.setMonitoringRelationship(monitoringRelationship(elements['monitor-relationship'].value));
}));
elements.click.addEventListener('change', () => act(async () => {
  if (audio) await audio.setClick(elements.click.checked);
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
    const input = keyboardEdge(event, 'press');
    if (!input) return;
    heldKeys.add(event.code);
    flash('mushroom', true);
    act(() => panic(peripheralCommandId(input)));
    return;
  }
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable=true]'))) return;
  const control = CONTROLS.find(control => control.key === event.code);
  if (!control && event.code !== 'Space') return;
  event.preventDefault();
  if (control) {
    const input = keyboardEdge(event, 'press');
    if (!input) return;
    heldKeys.add(event.code);
    flash(control.id, true); act(() => triggerPad(control.id, peripheralCommandId(input)));
  } else { heldKeys.add(event.code); act(() => isRunning() ? stopPractice() : startPractice()); }
});
window.addEventListener('keyup', event => {
  if (event.code === 'Escape' || CONTROLS.some(control => control.key === event.code)) keyboardEdge(event, 'release');
  heldKeys.delete(event.code);
  const control = CONTROLS.find(control => control.key === event.code);
  if (control) pads.get(control.id)?.button.classList.remove('pressed');
  if (event.code === 'Escape') elements.mushroom.classList.remove('pressed');
});
function postPerformanceEvent(event: PracticeEvent): void {
  window.postMessage({ kind: 'show-tools-performance', event }, location.origin);
  if (!chartFollowOptIn && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
  if (event.state.phase !== 'playing' && event.state.phase !== 'count-in') { chartFollower?.stop(); return; }
  chartFollower ??= createChartFollower({ onStatus: status => { elements['sheet-status'].textContent = status; } });
  chartFollower.receive(event);
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
async function switchSong(id: string, imported?: CompiledSong): Promise<void> {
  if (outputCapture !== 'idle') throw new Error('Finish the output recording before switching songs.');
  chartFollower?.stop();
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
    const loaded: SongScript = imported ? {
      id: imported.id, chart: imported.chart, program: { lengthBeats: imported.chart.beatsPerBar, events: [] }, compiled: imported,
      practice: { startBar: imported.chart.bars[0]?.bar || 1, endBar: imported.chart.annotatedThroughBar },
      description: 'Chart-compiled performance. Source cells and native instructions are available below.',
    } : await loadSong(id);
    if (generation !== songGeneration) return;
    song = loaded;
    chart = loaded.chart;
    sources.clear();
    state = { phase: 'idle', bar: null, beat: 1, selectedChannel: 'R1', recording: null, microphone: false,
      looping: [], error: null, channels: CONTROLS.map(({ id }) => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })) };
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
const chartPanel = installChartPanel(chartSource, {
  isBusy: () => isRunning() || starting || switching || preparing !== null || outputCapture !== 'idle',
  onLoad: async input => {
    const compiled = decodeCompiledSong(input);
    if (!compiled.executable) throw new Error('Resolve the chart inspection errors before loading.');
    if (isRunning() || starting || switching || preparing || outputCapture !== 'idle') throw new Error('Stop practice and finish the recording before loading a chart.');
    await switchSong(compiled.id, compiled);
  },
});
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
