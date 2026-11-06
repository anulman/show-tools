import { audioMode, canChangeAudioMode, changeAudioMode } from './audio-mode.js';
import type { CatalogDocument } from '../../lib/voice-catalog/model.js';
import { exportMusicXmlWithVoices } from '../../lib/performance/musicxml-authoring.js';
import { musicXmlSourceView } from '../../lib/performance/musicxml-source-view.js';
import { renderVoiceAvatar } from './voice-avatar.js';
import { installVoiceCatalog } from './voice-catalog.js';
import type { SongSource } from '../../lib/performance/song-source.js';
import type { PracticeAudio } from './audio.js';
import { RemoteDesk, RemoteSession } from './remote-session.js';
import type { RemoteConnection } from './remote-session.js';
import type { DeskView } from '../../lib/remote-performance/session-schema.js';
import type { MonitoringRelationship } from './audio.js';
import { CONTROLS, playableBars } from '../../lib/performance/chart.js';
import type { ChannelId, Chart, PracticeState, PracticeEvent, SongScript, VoiceEffectConfiguration } from '../../lib/performance/model.js';
import { SONGS, loadSong } from '../../songs/index.js';
import { parseControlCue } from '../../lib/performance/chart-controls.js';
import { createChartFollower, openCurrentChart } from './open-chart.js';
import { recordingToMp3 } from './recording-export.js';
import { installChartPanel } from './chart-panel.js';
import { decodeCompiledSong } from '../../lib/performance/compiled-song.js';
import type { CompiledSong } from '../../lib/performance/compiled-song.js';
import { createVoiceEffectsEditor, initialVoiceEffects } from './voice-effects.js';
import { keyboardFocusBlocksShortcut } from './keyboard-focus.js';
import { takePresentation } from './take-presentation.js';
import { createPeripheralInput, peripheralCommandId } from './peripheral-input.js';
import type { PeripheralInput } from './peripheral-input.js';

function requiredElement<T extends Element>(selector: string, constructor: { new(): T }, root: ParentNode = document): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Missing UI element ${selector}`);
  return element;
}

const elements = {
  'audio-mode-select': requiredElement('#audio-mode-select', HTMLSelectElement),
  'practice-desk': requiredElement('#practice-desk', HTMLElement),
  'song-select': requiredElement('#song-select', HTMLSelectElement),
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
  'bpm': requiredElement('#bpm', HTMLInputElement),
  'count-in': requiredElement('#count-in', HTMLSelectElement),
  'start-section': requiredElement('#start-section', HTMLSelectElement),
  'end-bar': requiredElement('#end-bar', HTMLInputElement),
  'loop': requiredElement('#loop', HTMLInputElement),
  'pads': requiredElement('#pads', HTMLElement),
  'live-voices': requiredElement('#live-voices', HTMLElement),
  'click': requiredElement('#click', HTMLInputElement),
  'mushroom': requiredElement('#mushroom', HTMLButtonElement),
  'record-demo': requiredElement('#record-demo', HTMLButtonElement),
  'download-demo': requiredElement('#download-demo', HTMLAnchorElement),
  'recording-hint': requiredElement('#recording-hint', HTMLSpanElement),
  'monitor-relationship': requiredElement('#monitor-relationship', HTMLSelectElement),
  'monitor-hint': requiredElement('#monitor-hint', HTMLParagraphElement),
  'offline-status': requiredElement('#offline-status', HTMLSpanElement),
};
const startLabel = requiredElement('#start span:last-child', HTMLSpanElement);
const recordLabel = requiredElement('#record-demo span:last-child', HTMLSpanElement);
const chartSource = requiredElement('#chart-source', HTMLElement);
interface PadElements {
  shell: HTMLElement; button: HTMLButtonElement; status: HTMLSpanElement;
  cue: HTMLElement; sampleStatus: HTMLSpanElement; takePlan: HTMLSpanElement; volume: HTMLInputElement;
  volumeOutput: HTMLOutputElement;
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
    keyboardInput.connect({ sessionId: String(keyboardSession++), releasedCodes: [...mapping.keys()] });
    keyboardConnected = true;
  }
  return keyboardInput.inject({ sessionId: String(keyboardSession - 1), sourceTimeMs: event.timeStamp, kind: 'key', code: event.code,
    edge, repeat: edge === 'press' && event.repeat });
}
const voiceAvatars = new Map<number, { root: HTMLElement; name: string }>();
const liveVoiceStates = new Map<number, HTMLSpanElement>();
const rotationControls: HTMLButtonElement[] = [];
let rotationSequence = 0;
const rotationSession = crypto.randomUUID();
let effectsApplying = false;
const voiceEffects = createVoiceEffectsEditor(profile => { void act(() => applyVoiceEffects(profile)); });
let chart: Chart | undefined;
let song: SongScript | undefined;
let songGeneration = 0;
let switching = false;
let outputCapture: 'idle' | 'starting' | 'waiting' | 'recording' | 'stopping' = 'idle';
const mode = audioMode(new URL(location.href));
const remote = mode === 'hardware';
type PerformanceSession = PracticeAudio | RemoteSession;
let audio: PerformanceSession | undefined;
let remoteDesk: RemoteDesk | undefined;
let preparing: Promise<PerformanceSession> | null = null;
let starting = false;
let offlineUpdate: { kind: 'current' } | { kind: 'waiting'; worker: ServiceWorker } | { kind: 'pending' } | { kind: 'reloading' } = { kind: 'current' };
let transportGeneration = 0;
type DisplayState = Pick<PracticeState, 'phase' | 'bar' | 'beat' | 'selectedChannel' | 'channels'> & Partial<PracticeState>;
let state: DisplayState = { phase: 'idle', bar: null, beat: 1, selectedChannel: 'R1', channels: CONTROLS.map(({ id }) => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })) };
let recorder: MediaRecorder | undefined;
let recordingURL: string | undefined;
let chartFollower: ReturnType<typeof createChartFollower> | undefined;
let chartFollowOptIn = false;
const voiceCatalog = installVoiceCatalog(requiredElement('#voice-library-root', HTMLElement), {
  drafts: voiceEffects,
  remote,
  isBusy: () => isRunning() || starting || switching || effectsApplying || Boolean(preparing) || outputCapture !== 'idle',
  onError: showError,
  onBusyChange: () => render(state),
  apply: async configurations => {
    effectsApplying = true; render(state);
    try { const instance = await ensureAudio(configurations); await instance.configureVoiceEffects(configurations); }
    finally { effectsApplying = false; render(state); }
  },
});

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
    const action = compiled.tempoBeatHint ? 'Play + tempo hit' : compiled.captureTail === 'silence-to-bar-end' ? 'Commit + join · rest to bar end' : names[compiled.kind];
    return `${action} · ${target}${compiled.cueBeat === null ? '' : ` · cue ${beatName(compiled.cueBeat)}`}`;
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

async function ensureAudio(initialEffects?: readonly VoiceEffectConfiguration[]) {
  if (audio) return audio;
  if (remote) throw new Error('Hardware audio is unavailable. Enable audio and wait for ready.');
  if (!song || switching) throw new Error('The song script is still loading. Try again in a moment.');
  if (!window.isSecureContext) throw new Error('Audio needs HTTPS on your phone, or localhost on this computer. See Setup & notes.');
  if (preparing) return preparing;
  elements.start.disabled = true;
  startLabel.textContent = 'Preparing audio…';
  const generation = songGeneration;
  const currentSong = song;
  preparing = import('./audio.js').then(({ PracticeAudio }) => PracticeAudio.create({ chart: currentSong.chart, program: currentSong.program, compiled: currentSong.compiled, initialVoiceEffects: initialEffects ?? voiceCatalog.savedConfigurations() })).then(async instance => {
    if (generation !== songGeneration) {
      await instance.dispose();
      throw new Error('The song changed while audio was preparing.');
    }
    audio = instance;
    audio.subscribe(render);
    audio.onEvent(event => {
      if (generation === songGeneration && audio === instance) {
        postPerformanceEvent(event);
        if (event.type === 'control' && event.applied === false && event.error) showError(new Error(event.error));
      }
    });
    return instance;
  }).finally(() => { preparing = null; render(state); });
  return preparing;
}

function controlName(id: ChannelId): string {
  return song?.compiled?.parts.find(part => part.role.kind === 'pad' && part.role.buttonId === id)?.name || chart?.controlNames[id] || id;
}

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
  if (voiceCatalog.busy) return;
  const generation = transportGeneration;
  const instance = await ensureAudio();
  if (generation !== transportGeneration) return;
  await instance.selectChannel(id);
  if (generation !== transportGeneration) return;
  await instance.control({ id }, { commandId });
}

async function applyVoiceEffects(profile: number) {
  if (isRunning() || starting || switching || effectsApplying || outputCapture !== 'idle') return;
  effectsApplying = true; render(state);
  try {
    const configurations = voiceEffects.configurations(profile);
    if (remote) {
      const instance = await ensureAudio(configurations);
      if (!(instance instanceof RemoteSession)) throw new Error('Remote session is unavailable.');
      const selected = configurations.find(configuration => configuration.profile === profile);
      if (!selected) throw new Error('Voice profile is unavailable.');
      await instance.configureVoiceProfile(profile, selected.effects);
    } else {
      await voiceCatalog.saveDrafts();
      const instance = await ensureAudio(configurations);
      await instance.configureVoiceEffects(configurations);
    }
  } finally { effectsApplying = false; render(state); }
}

async function rotate(value: number) {
  if (!audio || !isRunning()) return;
  await audio.control({ id: 'knob', value }, { commandId: `practice-rotation/${rotationSession}/${rotationSequence++}` });
}

function monitoringRelationship(value: string): MonitoringRelationship {
  switch (value) {
    case 'unknown': case 'different-devices': case 'same-usb-interface': case 'same-non-usb': return value;
    default: throw new Error('Choose the physical input/output relationship.');
  }
}

async function startPractice() {
  if (voiceCatalog.busy || starting || isRunning() || outputCapture === 'starting' || outputCapture === 'stopping') return;
  if (!chart) throw new Error('The song chart is still loading. Try again in a moment.');
  const bpm = Number(elements.bpm.value);
  const startBar = Number(elements['start-section'].value);
  const endBar = Number(elements['end-bar'].value);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('Choose a tempo between 40 and 240 BPM.');
  if (!Number.isInteger(endBar) || endBar < startBar || endBar > playableBars(chart)) throw new Error(`Choose an end bar from ${startBar} to ${playableBars(chart)}. Partial bars are not sequenced yet.`);
  if (remote) {
    const instance = await ensureAudio();
    await instance.start({ bpm, countInBars: Number(elements['count-in'].value), startBar, endBar, loop: elements.loop.checked, automatic: false });
    return;
  }
  const effects = song?.compiled ? voiceEffects.configurations() : initialVoiceEffects('dry');
  const generation = ++transportGeneration;
  starting = true;
  render(state);
  let instance: PerformanceSession | undefined;
  let startedRecording = false;
  let microphoneGeneration: number | undefined;
  try {
    await voiceCatalog.saveDrafts();
    if (generation !== transportGeneration) return;
    instance = await ensureAudio(effects);
    if (generation !== transportGeneration) return;
    await instance.configureVoiceEffects(effects);
    if (generation !== transportGeneration) return;
    microphoneGeneration = await instance.enableMicrophone();
    if (generation !== transportGeneration) { await instance.disableMicrophone(microphoneGeneration); return; }
    if (outputCapture === 'idle') { await toggleOutputRecording(); startedRecording = true; }
    if (generation !== transportGeneration) { finishOutputRecording(); await instance.disableMicrophone(microphoneGeneration); return; }
    await instance.setClick(elements.click.checked);
    if (generation !== transportGeneration) return;
    await instance.start({ bpm, countInBars: Number(elements['count-in'].value), startBar, endBar,
      loop: elements.loop.checked, automatic: false });
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
  if (remote) {
    await (command === 'stop' ? instance.stop() : instance.control({ id: 'mushroom' }, { commandId }));
    return;
  }
  const results = await Promise.allSettled([
    command === 'stop' ? instance.stop() : instance.control({ id: 'mushroom' }, { commandId }),
    ...(remote ? [] : [instance.disableMicrophone()]),
  ]);
  const failure = results.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') {
    if (audio === instance) audio = undefined;
    await instance.dispose().catch(() => {});
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
    button.innerHTML = `<span class="pad-top"><span class="pad-id">${control.id}</span><kbd>${control.shortcut}</kbd></span><span class="pad-name-row"><span class="pad-identity"><span class="performance-avatar" hidden></span><strong class="pad-name"></strong></span><span class="pad-cue" aria-label="Chart cue"><code></code><i class="pad-led" aria-hidden="true"></i></span></span><span class="pad-sample-state">Empty slot</span><span class="pad-take-plan" hidden></span>`;
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
    const status = document.createElement('span'); status.className = 'pad-action';
    status.textContent = 'No action in this column';
    shell.append(button, status, volumeRow);
    elements.pads.append(shell);
    pads.set(control.id, { shell, button, status, cue: requiredElement('code', HTMLElement, button),
      sampleStatus: requiredElement('.pad-sample-state', HTMLSpanElement, button), takePlan: requiredElement('.pad-take-plan', HTMLSpanElement, button), volume, volumeOutput });
    const pad = pads.get(control.id);
    if (pad) {
      pad.sampleStatus.id = `pad-sample-state-${control.id}`;
      pad.takePlan.id = `pad-take-plan-${control.id}`;
      button.setAttribute('aria-describedby', `${pad.sampleStatus.id} ${pad.takePlan.id}`);
    }
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

function mountVoiceRows() {
  voiceEffects.reset(song?.compiled ? 'compiled' : 'dry'); liveVoiceStates.clear(); voiceAvatars.clear(); rotationControls.length = 0;
  for (const pad of pads.values()) {
    const avatar = requiredElement('.performance-avatar', HTMLElement, pad.button);
    avatar.hidden = true; delete avatar.dataset.avatar;
  }
  elements['live-voices'].replaceChildren();
  for (const pad of pads.values()) pad.shell.querySelector('.voice-effects')?.remove();
  const parts = song?.compiled?.parts;
  for (const part of parts ?? []) {
    if (part.role.kind === 'pad') {
      const pad = pads.get(part.role.buttonId);
      if (pad) {
        voiceEffects.mount(part, pad.shell, remote ? undefined : () => voiceCatalog.openProfile(part.profile));
        voiceAvatars.set(part.profile, { root: requiredElement('.performance-avatar', HTMLElement, pad.button), name: part.name });
      }
      continue;
    }
    const shell = document.createElement('article'); shell.className = 'voice-row'; shell.dataset.voice = part.id;
    const main = document.createElement('div'); main.className = 'voice-main';
    const identity = document.createElement('div'); identity.className = 'voice-identity';
    const avatar = document.createElement('span'); avatar.className = 'performance-avatar'; avatar.hidden = true;
    voiceAvatars.set(part.profile, { root: avatar, name: part.name });
    const name = document.createElement('h2'); name.textContent = part.name;
    main.title = part.role.kind === 'default-live' ? 'Default live voice' : 'Use vertical scroll while playing to turn the knob';
    identity.append(avatar, name);
    const tools = document.createElement('div'); tools.className = 'voice-tools';
    const status = document.createElement('span'); status.className = 'voice-state'; status.textContent = 'STANDBY';
    liveVoiceStates.set(part.profile, status); tools.append(status);
    if (part.role.kind === 'rotation-live') {
      const rotations = document.createElement('div'); rotations.className = 'rotation-controls';
      for (const [value, text] of [[-1, '↶'], [1, '↷']] satisfies readonly [number, string][]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'rotation'; button.textContent = text;
        button.setAttribute('aria-label', `Rotate ${value > 0 ? 'clockwise' : 'counterclockwise'}`);
        button.title = 'Knob rotation'; button.disabled = true;
        button.addEventListener('click', () => { void act(() => rotate(value)); }); rotations.append(button); rotationControls.push(button);
      }
      tools.append(rotations);
    }
    main.append(identity, tools); shell.append(main); voiceEffects.mount(part, shell, remote ? undefined : () => voiceCatalog.openProfile(part.profile)); elements['live-voices'].append(shell);
  }
  elements['live-voices'].hidden = !liveVoiceStates.size;
}

function browserModeBusy(): boolean {
  return voiceCatalog.busy || isRunning() || starting || switching || effectsApplying || Boolean(preparing) || outputCapture !== 'idle' || state.channels.some(channel => ['armed', 'recording', 'stopping'].includes(channel.status));
}

let changingAudioMode = false;
elements['audio-mode-select'].value = mode;
elements['audio-mode-select'].addEventListener('change', () => {
  const select = elements['audio-mode-select'];
  const next = select.value;
  if (next !== 'browser' && next !== 'hardware') { select.value = mode; return; }
  changingAudioMode = true;
  select.disabled = true;
  void changeAudioMode({ current: mode, next, browserBusy: browserModeBusy(), url: new URL(location.href),
    dispose: async () => { if (remote) await remoteDesk?.dispose(); else await audio?.dispose(); }, navigate: url => location.assign(url.href) })
    .then(changed => { if (!changed) { changingAudioMode = false; select.value = mode; select.disabled = false; } })
    .catch(error => { changingAudioMode = false; select.value = mode; select.disabled = false; showError(error); });
});

function render(next: Partial<PracticeState>) {
  const ended = next.phase === 'ended' && state.phase !== 'ended';
  state = { ...state, ...next };
  beginOutputRecording(state.phase);
  if (ended) {
    finishOutputRecording();
    if (audio && !remote) void audio.disableMicrophone().catch(showError);
  }
  applyPendingPracticeUpdate();
  elements['audio-mode-select'].disabled = changingAudioMode || !canChangeAudioMode(mode, browserModeBusy());
  if (remote && !audio) { renderHardwareUnavailable(); return; }
  if (!chart) return;
  if (remote && state.click !== undefined && document.activeElement !== elements.click) elements.click.checked = state.click;
  const running = isRunning();
  const displayBar = state.bar || Number(elements['start-section'].value) || 1;
  const currentBar = chart.bars[displayBar - 1];
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
  elements.start.disabled = voiceCatalog.busy || song?.compiled?.executable === false || running || starting || switching || effectsApplying || Boolean(preparing) || outputCapture === 'starting' || outputCapture === 'stopping';
  elements['song-select'].disabled = remote || voiceCatalog.busy || switching || starting || effectsApplying || Boolean(preparing) || outputCapture !== 'idle';
  elements['record-demo'].disabled = remote || voiceCatalog.busy || outputCapture === 'starting' || outputCapture === 'stopping';
  const effectsLocked = running || starting || switching || Boolean(preparing) || effectsApplying || outputCapture !== 'idle';
  voiceEffects.render(state.voiceEffects, effectsLocked);
  voiceCatalog.update({ bar: state.bar, voiceEffects: state.voiceEffects });
  for (const [profile, avatar] of voiceAvatars) renderVoiceAvatar(avatar.root, voiceCatalog.voiceForProfile(profile), avatar.name);
  for (const [profile, label] of liveVoiceStates) {
    const applied = state.voiceEffects?.find(voice => voice.profile === profile);
    label.textContent = applied?.activity === 'live' ? 'LIVE' : applied?.activity === 'tail' ? 'RELEASING' : applied?.activity === 'capture' ? 'RECORDING' : 'STANDBY';
    label.dataset.activity = applied?.activity || 'standby';
    if (applied?.rotationEligible) label.textContent += applied.rotationRemainingBeats > 0 ? ` · ${applied.rotationRemainingBeats.toFixed(2)} BEAT` : ' · KNOB CUE';
  }
  for (const button of rotationControls) button.disabled = !running || !audio || !state.voiceEffects?.some(voice => voice.rotationEligible);
  elements['monitor-relationship'].disabled = remote || !audio?.microphone || starting;
  elements['monitor-relationship'].value = audio?.monitoringRelationship || 'unknown';
  elements['monitor-hint'].textContent = remote ? 'Audio and monitoring run on the host. Remote recording is unavailable.' : audio?.monitoringRelationship === 'different-devices' || audio?.monitoringRelationship === 'same-usb-interface'
    ? 'Confirmed setup. Live monitoring follows the active voice. Downloads include processed voice.'
    : audio?.monitoringRelationship === 'same-non-usb'
      ? 'Same non-USB device confirmed. Live monitoring stays off. Downloads include processed voice.'
      : 'Live monitoring is off. Confirm your physical setup after Start. Downloads still include processed voice.';
  startLabel.textContent = preparing ? 'Preparing audio…' : state.phase === 'ended' ? 'Play again' : 'Start practice';
  elements.stop.disabled = !starting && !running && !recording;
  for (const element of [elements.bpm, elements['count-in'], elements['start-section'], elements['end-bar'], elements.loop]) element.disabled = running || starting;
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
    const name = controlName(control.id);
    const padName = pad.button.querySelector('.pad-name');
    if (padName) padName.textContent = name;
    pad.button.setAttribute('aria-label', `${control.id} ${name}, ${action}`);
    pad.volume.setAttribute('aria-label', `${control.id} ${name} volume`);
    if (document.activeElement !== pad.volume) pad.volume.value = String(channel?.gain ?? 1);
    const gain = Number(pad.volume.value);
    const percentage = `${Math.round(gain * 100)}%`;
    pad.volume.setAttribute('aria-valuetext', percentage);
    pad.volume.style.setProperty('--volume', percentage);
    pad.volumeOutput.textContent = percentage;
    pad.button.setAttribute('aria-pressed', looping ? 'true' : 'false');
    pad.status.textContent = action;
    const stoppingLabel = light.kind === 'releasing' ? (looping ? 'Stop queued' : 'Releasing') : 'Commit queued';
    pad.sampleStatus.textContent = sampleStatus === 'empty' ? 'Empty slot' : sampleStatus === 'ready' ? 'Sample ready' :
      sampleStatus === 'armed' ? 'Capture armed' : sampleStatus === 'stopping' ? stoppingLabel :
      sampleStatus === 'recording' ? 'Recording microphone' : 'Loop playing';
    const take = takePresentation(song?.compiled, control.id, state);
    if (take.summary) pad.sampleStatus.textContent = take.summary;
    pad.takePlan.textContent = take.plan;
    pad.takePlan.hidden = !take.plan;
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
  elements['recording-hint'].textContent = 'Recording.';
  elements['download-demo'].hidden = true;
}

function finishOutputRecording() {
  if (outputCapture === 'waiting') {
    recorder = undefined;
    outputCapture = 'idle';
    elements['record-demo'].setAttribute('aria-pressed', 'false');
    recordLabel.textContent = 'Record demo';
    elements['recording-hint'].textContent = 'Recording cancelled.';
    return;
  }
  if (recorder?.state !== 'recording') return;
  outputCapture = 'stopping';
  recorder.stop();
}

async function toggleOutputRecording() {
  if (remote) throw new Error('Remote recording is unavailable.');
  if (voiceCatalog.busy) return;
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
        elements['recording-hint'].textContent = 'MP3 ready.';
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
    elements['recording-hint'].textContent = 'Armed · recording starts after count-in.';
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
elements['monitor-relationship'].addEventListener('change', () => act(() => {
  if (!audio) throw new Error('Start the microphone before confirming the monitoring setup.');
  if (audio instanceof RemoteSession) throw new Error('Monitoring belongs to the remote host');
  audio.setMonitoringRelationship(monitoringRelationship(elements['monitor-relationship'].value));
}));
elements.click.addEventListener('change', () => act(async () => {
  if (audio) await audio.setClick(elements.click.checked);
}));
elements['start-section'].addEventListener('change', () => {
  if (remote && !audio) { renderHardwareUnavailable(); return; }
  if (!chart) return;
  const start = Number(elements['start-section'].value);
  elements['end-bar'].min = String(start);
  if (Number(elements['end-bar'].value) < start) elements['end-bar'].value = String(Math.min(playableBars(chart), chart.sections.find(section => section.startBar === start)?.endBar || playableBars(chart)));
  render(state);
});
for (const element of [elements['count-in'], elements['end-bar']]) element.addEventListener('change', () => render(state));

window.addEventListener('wheel', event => {
  if (!audio || !isRunning() || !song?.compiled?.rotation || !Number.isFinite(event.deltaY) || event.deltaY === 0
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input,select,textarea,[contenteditable=true],details[open]')
    || document.querySelector('dialog[open]')
    || document.activeElement?.closest('input,select,textarea,[contenteditable=true]')) return;
  event.preventDefault(); void act(() => rotate(event.deltaY));
}, { passive: false });

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
  if (document.querySelector('dialog[open]')) return;
  const target = event.target instanceof Element ? event.target : null;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || keyboardFocusBlocksShortcut(event.code, Boolean(target?.closest('input,select,textarea,[contenteditable=true]')), Boolean(target?.closest('button,summary,a,[role=button]')))) return;
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
async function switchSong(id: string, imported?: CompiledSong, source?: SongSource, options: { remoteSong?: SongScript; voiceMetadata?: CatalogDocument } = {}): Promise<void> {
  const { remoteSong, voiceMetadata } = options;
  if (remote && !remoteSong) throw new Error('Songs are loaded on the remote host.');
  if (voiceCatalog.busy) throw new Error('Wait for the voice library save before switching songs.');
  if (outputCapture !== 'idle') throw new Error('Finish the output recording before switching songs.');
  chartFollower?.stop();
  const generation = ++songGeneration;
  transportGeneration++;
  switching = true;
  render(state);
  releasePresses();
  const previousAudio = audio;
  if (!remoteSong) audio = undefined;
  try {
    if (previousAudio && !remoteSong) await previousAudio.stop();
    if (previousAudio && !remoteSong) await previousAudio.dispose();
    if (preparing) await preparing.catch(() => {});
    const loaded: SongScript = remoteSong ?? (imported ? {
      id: imported.id, chart: imported.chart, program: { lengthBeats: imported.chart.beatsPerBar, events: [] }, compiled: imported, source, voiceMetadata,
      practice: { startBar: imported.chart.bars[0]?.bar || 1, endBar: imported.chart.annotatedThroughBar },
      description: 'Chart-compiled performance. Source cells and native instructions are available below.',
    } : await loadSong(id));
    if (generation !== songGeneration) return;
    song = loaded;
    chart = loaded.chart;
    if (!remoteSong) state = { phase: 'idle', bar: null, beat: 1, selectedChannel: 'R1', recording: null, microphone: false,
      looping: [], error: null, channels: CONTROLS.map(({ id }) => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })) };
    mountVoiceRows();
    await voiceCatalog.load(loaded).catch(showError);
    if (remoteSong && ![...elements['song-select'].options].some(option => option.value === loaded.id)) {
      const option = document.createElement('option'); option.value = loaded.id; option.textContent = loaded.chart.title;
      elements['song-select'].append(option);
    }
    elements['song-select'].value = loaded.id;
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
  resolveMapping: (source, mapping) => voiceCatalog.cueMapping(source, mapping),
  isBusy: () => voiceCatalog.busy || isRunning() || starting || switching || effectsApplying || preparing !== null || outputCapture !== 'idle',
  exportMusicXml: xml => exportMusicXmlWithVoices(xml, song?.compiled?.source.digest,
    document => voiceCatalog.exportSongVoices(document.song, musicXmlSourceView(document))),
  onLoad: async (input, source, voices) => {
    if (remote) throw new Error('Songs are loaded on the remote host.');
    const compiled = decodeCompiledSong(input);
    if (!compiled.executable) throw new Error('Resolve the chart inspection errors before loading.');
    if (voiceCatalog.busy || isRunning() || starting || switching || preparing || effectsApplying || outputCapture !== 'idle') throw new Error('Stop practice and finish the recording before loading a chart.');
    await switchSong(compiled.id, compiled, source, { voiceMetadata: voices ?? undefined });
  },
});
function syncRemoteTransport(current: PracticeState) {
  elements.bpm.value = String(current.bpm);
  const start = String(current.startBar);
  if (![...elements['start-section'].options].some(option => option.value === start)) {
    const option = document.createElement('option'); option.value = start; option.textContent = `Bar ${start}`;
    elements['start-section'].append(option);
  }
  elements['start-section'].value = start;
  elements['end-bar'].min = start;
  elements['end-bar'].value = String(current.endBar);
  elements.loop.checked = current.loop;
  elements.click.checked = current.click;
}

const hardwareCard = requiredElement('#hardware-audio', HTMLElement);
const hardwareStatus = requiredElement('#hardware-audio-status', HTMLSpanElement);
const enableAudio = requiredElement('#enable-audio', HTMLButtonElement);
const terminateAudio = requiredElement('#terminate-audio', HTMLButtonElement);

function renderHardwareUnavailable() {
  for (const control of [elements.start, elements.stop, elements.bpm, elements['count-in'], elements['start-section'], elements['end-bar'], elements.loop, elements.click, elements.mushroom, elements['record-demo'], elements['song-select'], elements['monitor-relationship']]) control.disabled = true;
  elements['phase-label'].textContent = 'AUDIO UNAVAILABLE';
  elements['bar-number'].textContent = '··';
  elements['beat-number'].textContent = '·';
  elements['beat-dots'].querySelectorAll('i').forEach(dot => dot.classList.remove('active'));
  elements['pads'].hidden = true;
  elements['live-voices'].hidden = true;
  elements['practice-desk'].dataset.phase = '';
  elements['practice-desk'].dataset.bar = '';
  elements['practice-desk'].dataset.beat = '';
  voiceEffects.render(undefined, true);
}

if (remote) {
  hardwareCard.hidden = false;
  elements['offline-status'].textContent = 'Audio runs on the remote host.';
  chartSource.hidden = true;
  renderHardwareUnavailable();
  enableAudio.addEventListener('click', () => { void act(async () => { await remoteDesk?.enableAudio(); }); });
  terminateAudio.addEventListener('click', () => { void act(async () => { await remoteDesk?.terminateAudio(); }); });
  await act(async () => {
    const token = window.prompt('Enter the remote performance token');
    if (!token) throw new Error('A token is required to connect. Refresh to try again.');
    const desk = await RemoteDesk.connect(token);
    remoteDesk = desk;
    await switchSong(desk.snapshot().song.id, undefined, undefined, { remoteSong: desk.snapshot().song });
    desk.subscribe(view => {
      const status = view.audio;
      const connection = desk.connection;
      const connected = connection.kind === 'connected';
      hardwareCard.dataset.connection = connection.kind;
      hardwareCard.dataset.audio = connected ? status.kind : '';
      hardwareStatus.textContent = connection.kind === 'disconnected' ? 'Connection lost; audio may still be running. Reconnect to the desk.'
        : connection.kind === 'connecting' ? 'Connecting to desk…'
        : status.kind === 'fault' ? `Audio fault · ${status.error}`
        : status.kind === 'ready' ? 'Audio on' : `Audio ${status.kind}`;
      enableAudio.disabled = !connected || (status.kind !== 'off' && status.kind !== 'fault');
      terminateAudio.disabled = !connected || status.kind === 'off' || status.kind === 'fault' || status.kind === 'stopping';
      if (!connected || status.kind !== 'ready') {
        audio = undefined;
        transportGeneration++;
        starting = false;
        releasePresses();
        chartFollower?.stop();
        renderHardwareUnavailable();
        return;
      }
      let session: RemoteSession;
      try { session = desk.performance(); } catch { return; }
      elements['pads'].hidden = false;
      elements['live-voices'].hidden = !liveVoiceStates.size;
      elements.click.disabled = false;
      elements.mushroom.disabled = false;
      if (audio !== session) {
        audio = session;
        syncRemoteTransport(session.snapshot());
        for (const voice of session.snapshot().voiceEffects ?? []) voiceEffects.setEffects(voice.profile, voice.effects);
        session.subscribe(render);
        session.onEvent(event => { postPerformanceEvent(event); if (event.type === 'control' && event.applied === false && event.error) showError(new Error(event.error)); });
      }
      render(session.snapshot());
    });
    void desk.listen();
    elements['recording-hint'].textContent = 'Remote recording is unavailable.';
  });
} else await act(() => switchSong('dance-yrself-clean'));

if (new URLSearchParams(location.search).has('test')) {
  window.practiceDesk = { get audio() { return remote ? undefined : audio; }, get state() { return remote && !audio ? undefined : state; }, get chart() { return chart; }, get hardware() { return remoteDesk?.snapshot(); }, get connection() { return remoteDesk?.connection; } };
}

function applyPendingPracticeUpdate() {
  if (offlineUpdate.kind === 'current' || offlineUpdate.kind === 'reloading') return;
  elements['offline-status'].textContent = 'Update ready. It will apply when practice, recording, and voice editing finish.';
  if (voiceCatalog.busy || document.querySelector('dialog[open]') || isRunning() || starting || switching || preparing || effectsApplying || outputCapture !== 'idle') return;
  if (offlineUpdate.kind === 'waiting') {
    offlineUpdate.worker.postMessage({ type: 'activate-when-idle' });
    return;
  }
  offlineUpdate = { kind: 'reloading' };
  location.reload();
}

document.addEventListener('close', () => applyPendingPracticeUpdate(), true);

if (!remote && 'serviceWorker' in navigator && window.isSecureContext && !new URLSearchParams(location.search).has('test')) {
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!navigator.serviceWorker.controller) return;
    if (hadController) {
      offlineUpdate = { kind: 'pending' };
      applyPendingPracticeUpdate();
    }
    hadController = true;
  });
  navigator.serviceWorker.register('./sw.js', { type: 'module' }).then(async registration => {
    const noticeWaiting = () => {
      if (registration.waiting) {
        offlineUpdate = { kind: 'waiting', worker: registration.waiting };
        applyPendingPracticeUpdate();
      }
    };
    registration.addEventListener('updatefound', () => {
      registration.installing?.addEventListener('statechange', noticeWaiting);
    });
    window.addEventListener('focus', noticeWaiting);
    noticeWaiting();
    await navigator.serviceWorker.ready;
    if (registration.active && offlineUpdate.kind === 'current') elements['offline-status'].textContent = 'Practice files cached for offline use.';
  }).catch(() => { elements['offline-status'].textContent = 'Offline cache unavailable.'; });
}

declare global {
  interface Window {
    practiceDesk?: { readonly audio: PerformanceSession | undefined; readonly state: DisplayState | undefined; readonly chart: Chart | undefined; readonly hardware: DeskView | undefined; readonly connection: RemoteConnection | undefined };
  }
}
