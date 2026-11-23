import { initialVoiceEffects } from '../../lib/performance/vocal-effects.js';
import { dismissOnBackdrop } from './dialog.js';
import { chartBarLabel, chartBarOrdinal } from '../../lib/performance/chart-position.js';
import { enablePhoneMotion } from './phone-motion.js';
import { createTambourineTuning } from './tambourine-tuning.js';
import { createTambourineTrace } from './tambourine-trace.js';
import { audioMode, audioModeURL, defaultAudioMode, changeAudioMode, type AudioMode } from './audio-mode.js';
import type { CatalogDocument } from '../../lib/voice-catalog/model.js';
import { exportMusicXmlWithVoices } from '../../lib/performance/musicxml-authoring.js';
import { musicXmlSourceView } from '../../lib/performance/musicxml-source-view.js';
import { renderVoiceAvatar } from './voice-avatar.js';
import { installVoiceCatalog } from './voice-catalog.js';
import type { SongSource } from '../../lib/performance/song-source.js';
import type { PracticeAudio } from './audio.js';
import { RemoteDesk, RemoteSession } from './remote-session.js';
import { arcadeButton, arcadeColorForRow, createInputBindingPanel } from './input-binding-panel.js';
import { createHardwareAuth } from './hardware-auth.js';
import type { RemoteConnection } from './remote-session.js';
import type { DeskView, SongPreview } from '../../lib/remote-performance/session-schema.js';
import type { MonitoringRelationship } from './audio.js';
import { CONTROLS, playableBars } from '../../lib/performance/chart.js';
import { CONTROL_IDS } from '../../lib/performance/model.js';
import type { ChannelId, Chart, PracticeState, PracticeEvent, SongScript, VoiceEffectConfiguration } from '../../lib/performance/model.js';
import { SONGS, loadSong } from '../../songs/index.js';
import { parseControlCue } from '../../lib/performance/chart-controls.js';
import { createChartFollower } from './open-chart.js';
import { createSampleDownloads } from './sample-downloads.js';
import { recordingToMp3 } from './recording-export.js';
import { installChartPanel } from './chart-panel.js';
import { decodeCompiledSong } from '../../lib/performance/compiled-song.js';
import type { CompiledSong } from '../../lib/performance/compiled-song.js';
import { createVoiceEffectsEditor } from './voice-effects.js';
import { keyboardFocusBlocksShortcut } from './keyboard-focus.js';
import { takePresentation } from './take-presentation.js';
import { createMusicalInputProducer } from './peripheral-input.js';
import { createMusicalInputPolicy } from './musical-input-policy.js';
import { mountTuner, type TunerPanel } from '../tuner/panel.js';
import type { TunerPort } from '../../lib/tuner/model.js';

function requiredElement<T extends Element>(selector: string, constructor: { new(): T }, root: ParentNode = document): T {
  const element = root.querySelector(selector);
  if (!(element instanceof constructor)) throw new Error(`Missing UI element ${selector}`);
  return element;
}

type PerformanceSession = PracticeAudio | RemoteSession;
type DisplayState = Pick<PracticeState, 'phase' | 'bar' | 'beat' | 'selectedChannel' | 'channels'> & Partial<PracticeState>;

export interface DeskSongObservation {
  readonly id: string;
  readonly digest: string | undefined;
  readonly installedIds: readonly string[];
  readonly reason: 'selected' | 'observed';
}

export interface DeskMountOptions {
  readonly assetBase?: URL;
  readonly workerURL?: URL;
  readonly onSong?: (song: DeskSongObservation) => void;
  readonly onModeChange?: (mode: AudioMode) => void;
  readonly initialSongId?: string;
  readonly mode?: AudioMode;
  readonly signal?: AbortSignal;
  readonly allowSongInput?: (songId: string | undefined) => boolean;
}

export async function mountDesk(options: DeskMountOptions = {}) {
  options.signal?.throwIfAborted();
  const mountController = new AbortController();
  const mountSignal = mountController.signal;
  const deskURL = new URL(location.href);
  const defaultMode = options.mode ?? await defaultAudioMode(deskURL);
  options.signal?.throwIfAborted();
  const mode = options.mode ?? audioMode(deskURL, defaultMode);
  const remote = mode === 'hardware';
  const elements = {
    'audio-mode-select': requiredElement('#audio-mode-select', HTMLSelectElement),
    'musical-input-select': requiredElement('#musical-input-select', HTMLSelectElement),
    'practice-desk': requiredElement('#practice-desk', HTMLElement),
    'song-select': requiredElement('#song-select', HTMLSelectElement),
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
  const pointerHeld = new Map<ChannelId, number>();
  let keyboardEpoch = 0;
  let pointerEpoch = 0;
  const keyboardProducer = createMusicalInputProducer({ kind: 'keyboard', endpoint: () => ensureAudio(), releasedMask: 0 });
  const pointerProducer = createMusicalInputProducer({ kind: 'pointer', endpoint: () => ensureAudio(), releasedMask: 223 });
  const inputPolicy = createMusicalInputPolicy({ changed: () => releasePresses() });
  elements['musical-input-select'].value = inputPolicy.selection();
  elements['musical-input-select'].addEventListener('change', () => inputPolicy.select(elements['musical-input-select'].value), { signal: mountSignal });
  const voiceAvatars = new Map<number, { root: HTMLElement; name: string }>();
  const liveVoiceStates = new Map<number, HTMLSpanElement>();
  const rotationControls: HTMLButtonElement[] = [];
  let effectsApplying = false;
  const voiceEffects = createVoiceEffectsEditor(profile => { void act(() => applyVoiceEffects(profile)); }, scheduleAuditionEffect);
  const auditionButtons: { button: HTMLButtonElement; profile: number }[] = [];
  let auditionTimer: ReturnType<typeof setTimeout> | undefined;
  let auditionApplying = false;
  let chart: Chart | undefined;
  let song: SongScript | undefined;
  let songGeneration = 0;
  let switching = false;
  const transport = requiredElement('.transport', HTMLElement);
  const songLoadingStatus = requiredElement('#song-loading-status', HTMLElement);
  let outputCapture: 'idle' | 'starting' | 'waiting' | 'recording' | 'stopping' = 'idle';
  let audio: PerformanceSession | undefined;
  let tunerPanel: TunerPanel | undefined;
  let tunerSession: PerformanceSession | undefined;
  let tunerPort: TunerPort | undefined;
  const tunerDialog = requiredElement('#tuner-dialog', HTMLDialogElement);
  let remoteDesk: RemoteDesk | undefined;
  let remoteDemoChanging = false;
  let remoteDemoDownloading = false;
  let remoteDemoCheck = '';
  let remoteDemoAvailable = false;

  let bindingBaseRevision = '0';
  let bindingBaseValues = '';
  let mountedHardwareSong = '';
  let catalogIds: readonly string[] = SONGS.map(song => song.id);
  let explicitlySelected: string | undefined;
  let mountingHardwareSong: { key: string; done: Promise<void> } | undefined;
  const buttonBindingPanel = createInputBindingPanel({ onSave: async (bindings) => {
    if (!remoteDesk) throw new Error('Connect to the hardware desk before saving assignments');
    const acknowledged = await remoteDesk.configureButtonBindings(bindings, bindingBaseRevision);
    if (remoteDesk.snapshot().revision !== acknowledged.revision)
      throw new Error('Assignments changed again. Reload the desk before applying another edit');
    bindingBaseRevision = acknowledged.revision;
    bindingBaseValues = JSON.stringify(acknowledged.bindings);
    return acknowledged.bindings;
  } });
  buttonBindingPanel.element.hidden = !remote;
  requiredElement('#hardware-audio', HTMLElement).after(buttonBindingPanel.element);
  function renderButtonBindings() {
    const view = remoteDesk?.snapshot();
    if (!view) { buttonBindingPanel.update({ bindings: [], editable: false, reason: 'Connect to the hardware desk first.' }); return; }
    const bindings = view.song.compiled?.inputBindings ?? [];
    const values = JSON.stringify(bindings);
    if (!buttonBindingPanel.pending && (!buttonBindingPanel.dirty || values === bindingBaseValues)) {
      bindingBaseRevision = view.revision; bindingBaseValues = values;
    }
    buttonBindingPanel.update({ bindings,
      editable: remoteDesk?.connection.kind === 'connected' && view.audio.kind === 'off' && !switching,
      reason: switching ? 'Wait for the selected song to load.' : 'Turn hardware audio off before changing button assignments.' });
  }
  async function mountHardwareSong(view: DeskView) {
    const key = `${view.song.id}/${view.song.compiled?.source.digest ?? ''}`;
    if (mountedHardwareSong === key) return;
    if (mountingHardwareSong?.key === key) return mountingHardwareSong.done;
    const done = switchSong(view.song.id, undefined, undefined, { remoteSong: view.song }).then(() => {
      const current = remoteDesk?.snapshot().song;
      if (current && `${current.id}/${current.compiled?.source.digest ?? ''}` === key) mountedHardwareSong = key;
    }).finally(() => { if (mountingHardwareSong?.key === key) mountingHardwareSong = undefined; renderButtonBindings(); });
    mountingHardwareSong = { key, done }; return done;
  }
  let preparing: Promise<PerformanceSession> | null = null;
  let preparationAbort: AbortController | undefined;
  let phoneMotionAbort: AbortController | undefined;
  let phoneAuditionTransition = Promise.resolve();
  let starting = false;
  let offlineUpdate: { kind: 'current' } | { kind: 'waiting'; worker: ServiceWorker } | { kind: 'pending' } | { kind: 'reloading' } = { kind: 'current' };
  let transportGeneration = 0;
  let state: DisplayState = { phase: 'idle', bar: null, beat: 1, selectedChannel: 'R1', channels: CONTROLS.map(({ id }) => ({ id, gain: 1, muted: false, looping: false, ready: false, status: 'empty', light: { kind: 'off' } })) };
  const sampleDownloads = createSampleDownloads(requiredElement('#recording-controls', HTMLElement), () => ({ song: song?.compiled, state, source: mountSignal.aborted ? undefined : audio }), () => render(state));
  let recorder: MediaRecorder | undefined;
  let recordingURL: string | undefined;
  let chartFollower: ReturnType<typeof createChartFollower> | undefined;
  const voiceCatalog = installVoiceCatalog(requiredElement('#voice-library-root', HTMLElement), {
    drafts: voiceEffects,
    signal: mountSignal,
    assetBase: options.assetBase,
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
    if (mountSignal.aborted) return;
    elements.error.textContent = error instanceof Error ? error.message : String(error);
    elements.error.hidden = false;
  }

  async function act(action: () => unknown | Promise<unknown>): Promise<void> {
    if (mountSignal.aborted) return;
    elements.error.hidden = true;
    try { await action(); }
    catch (error) { showError(error); }
  }

  function isRunning() {
    return (!remote || remoteDesk?.snapshot().audio.kind === 'ready') && (state.phase === 'playing' || state.phase === 'count-in');
  }

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

  async function ensureAudio(initialEffects?: readonly VoiceEffectConfiguration[], unlock = false) {
    mountSignal.throwIfAborted();
    if (song?.compiled?.executable === false) throw new Error('Audio is unavailable for this chart preview.');
    if (audio) {
      if (unlock && !(audio instanceof RemoteSession)) await audio.tracker.resume();
      return audio;
    }
    if (remote) throw new Error('Hardware audio is unavailable. Enable audio and wait for ready.');
    if (!song || switching) throw new Error('The song script is still loading. Try again in a moment.');
    if (!window.isSecureContext) throw new Error('Audio needs HTTPS on your phone, or localhost on this computer. See Setup & notes.');
    if (preparing) return preparing;
    elements.start.disabled = true;
    startLabel.textContent = 'Preparing audio…';
    const generation = songGeneration;
    const currentSong = song;
    const audioContext = unlock ? new AudioContext({ latencyHint: 'interactive' }) : undefined;
    if (audioContext) void audioContext.resume().catch(() => {});
    const cancellation = new AbortController(); preparationAbort = cancellation;
    preparing = import('./audio.js').then(({ PracticeAudio }) => PracticeAudio.create({ chart: currentSong.chart, program: currentSong.program, compiled: currentSong.compiled, signal: cancellation.signal, audioContext, assetBase: options.assetBase, initialVoiceEffects: initialEffects ?? voiceCatalog.savedConfigurations() })).then(async instance => {
      if (generation !== songGeneration) {
        await instance.dispose();
        throw new Error('The song changed while audio was preparing.');
      }
      audio = instance;
      audio.subscribe(render);
      audio.onEvent(event => {
        if (generation === songGeneration && audio === instance) {
          receivePerformanceEvent(event);
          if (event.type === 'control' && event.applied === false && event.error) showError(new Error(event.error));
        }
      });
      return instance;
    }).catch(async error => {
      if (audioContext && audioContext.state !== 'closed') await audioContext.close().catch(() => {});
      throw error;
    }).finally(() => { if (preparationAbort === cancellation) preparationAbort = undefined; preparing = null; render(state); });
    return preparing;
  }

  function sharedTuner(instance: PerformanceSession): TunerPort {
    const prepareBank = instance.tuner.prepareBank;
    return {
      ...(prepareBank ? { prepareBank: (options: import('../../lib/tuner/model.js').TuningBankOptions) => {
        if (instance !== audio || isRunning() || starting) return Promise.reject(new Error('Stop practice before preparing a note bank'));
        return prepareBank(options);
      } } : {}),
      snapshot: () => instance.tuner.snapshot(),
      subscribe: listener => instance.tuner.subscribe(listener),
      command: command => {
        if (instance !== audio) return Promise.reject(new Error('The audio session changed. Reconnect the tuner.'));
        if (command.kind !== 'close' && command.kind !== 'silence' && (isRunning() || starting || outputCapture !== 'idle'))
          return Promise.reject(new Error('Stop practice and finish the demo recording before using the tuner.'));
        return instance.tuner.command(command);
      },
    };
  }

  function syncTunerSession() {
    if (!tunerPanel || tunerSession === audio) return;
    tunerSession = audio;
    tunerPort = audio ? sharedTuner(audio) : undefined;
    tunerPanel.setSession(tunerPort ?? null);
  }

  requiredElement('#open-tuner', HTMLButtonElement).addEventListener('click', () => {
    if (tunerDialog.open) return;
    tunerPanel = mountTuner(requiredElement('#tuner-root', HTMLElement), {
      assetBase: options.assetBase,
      banks: song?.compiled?.noteBanks?.flatMap((bank, index) => bank.capture ? [{ id: `${bank.buttonId}/${index}`, label: song?.chart.controlNames[bank.buttonId] ?? bank.buttonId, capture: bank.capture }] : []) ?? [],
      connect: async () => {
        if (isRunning() || starting || outputCapture !== 'idle') throw new Error('Stop practice and finish the demo recording before using the tuner.');
        const instance = await ensureAudio();
        if (instance !== audio) throw new Error('The audio session changed. Reconnect the tuner.');
        tunerSession = instance;
        tunerPort = sharedTuner(instance);
        return tunerPort;
      },
    });
    tunerSession = undefined;
    syncTunerSession();
    tunerDialog.showModal();
  }, { signal: mountSignal });
  function dismissTuner() {
    void act(async () => {
      await tunerPanel?.close();
      tunerPanel = undefined;
      tunerSession = undefined;
      tunerPort = undefined;
      tunerDialog.close();
    });
  }
  requiredElement('#close-tuner', HTMLButtonElement).addEventListener('click', dismissTuner, { signal: mountSignal });
  dismissOnBackdrop(tunerDialog, dismissTuner);
  tunerDialog.addEventListener('cancel', event => { event.preventDefault(); dismissTuner(); }, { signal: mountSignal });

  const settingsDialog = requiredElement('#settings-dialog', HTMLDialogElement);
  requiredElement('#open-settings', HTMLButtonElement).addEventListener('click', () => settingsDialog.showModal(), { signal: mountSignal });
  requiredElement('#close-settings', HTMLButtonElement).addEventListener('click', () => settingsDialog.close(), { signal: mountSignal });
  dismissOnBackdrop(settingsDialog, () => settingsDialog.close());

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
    keyboardEpoch++;
    for (const control of CONTROLS)
      if (heldKeys.has(control.key) && !pointerHeld.has(control.id)) pads.get(control.id)?.button.classList.remove('pressed');
    if (heldKeys.has('Escape')) elements.mushroom.classList.remove('pressed');
    heldKeys.clear();
    void keyboardProducer.reset().catch(error => { globalThis.reportError?.(error); });
  }

  function retirePointerInput() {
    pointerEpoch++;
    for (const control of CONTROLS)
      if (pointerHeld.has(control.id) && !heldKeys.has(control.key)) pads.get(control.id)?.button.classList.remove('pressed');
    pointerHeld.clear();
    void pointerProducer.reset().catch(error => { globalThis.reportError?.(error); });
  }

  function retirePageInputs() {
    retirePointerInput();
    releasePresses();
  }

  const pendingPadPresses = new Map<string, Promise<void>>();
  function triggerPad(id: ChannelId, source: 'keyboard' | 'pointer' = 'pointer') {
    const action = pressPad(id, source);
    pendingPadPresses.set(`${source}/${id}`, action);
    return action;
  }
  async function releasePad(id: ChannelId, source: 'keyboard' | 'pointer' = 'pointer') {
    const epoch = source === 'pointer' ? pointerEpoch : keyboardEpoch;
    try { await pendingPadPresses.get(`${source}/${id}`); }
    finally {
      if (audio && (source === 'pointer' ? epoch === pointerEpoch : epoch === keyboardEpoch && inputPolicy.allowsDomInput()))
        await (source === 'keyboard' ? keyboardProducer : pointerProducer).event(CONTROL_IDS.indexOf(id), 0);
    }
  }
  async function pressPad(id: ChannelId, source: 'keyboard' | 'pointer') {
    if (voiceCatalog.busy) return;
    const generation = transportGeneration;
    const epoch = source === 'pointer' ? pointerEpoch : keyboardEpoch;
    const inputCurrent = () => generation === transportGeneration
      && (source === 'pointer' ? epoch === pointerEpoch : epoch === keyboardEpoch && inputPolicy.allowsDomInput());
    const instance = await ensureAudio();
    if (!inputCurrent()) return;
    await instance.selectChannel(id);
    if (!inputCurrent()) return;
    await (source === 'keyboard' ? keyboardProducer : pointerProducer).event(CONTROL_IDS.indexOf(id), 1);
  }

  function scheduleAuditionEffect(profile: number) {
    const instance = audio;
    if (!(instance instanceof RemoteSession) || instance.auditionProfile() !== profile || isRunning() || starting) return;
    if (auditionTimer !== undefined) clearTimeout(auditionTimer);
    elements.start.disabled = true;
    auditionTimer = setTimeout(() => {
      auditionTimer = undefined;
      if (audio !== instance || instance.auditionProfile() !== profile || isRunning() || starting) { render(state); return; }
      if (effectsApplying) { scheduleAuditionEffect(profile); return; }
      void act(() => applyVoiceEffects(profile, true));
    }, 110);
  }

  function addAuditionButton(parent: HTMLElement, profile: number, name: string) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'audition-button secondary';
    button.textContent = 'Audition'; button.hidden = true;
    button.setAttribute('aria-label', `Audition ${name}`);
    button.addEventListener('click', () => {
      void act(async () => {
        const instance = audio;
        if (!(instance instanceof RemoteSession) || instance.auditionProfile() === undefined || isRunning() || effectsApplying) return;
        const next = instance.auditionProfile() === profile ? null : profile;
        await instance.audition(next);
        if (next !== null && voiceEffects.hasChanges(next)) scheduleAuditionEffect(next);
      });
    });
    parent.append(button);
    auditionButtons.push({ button, profile });
  }

  async function applyVoiceEffects(profile: number, audition = false) {
    if (isRunning() || starting || switching || effectsApplying || outputCapture !== 'idle') return;
    effectsApplying = true; auditionApplying = audition; render(state);
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
    } finally { effectsApplying = false; auditionApplying = false; render(state); }
  }

  async function rotate(value: number, source: 'keyboard' | 'pointer' = 'pointer') {
    if (!audio || !isRunning()) return;
    await (source === 'keyboard' ? keyboardProducer : pointerProducer).event(5, value);
  }

  function monitoringRelationship(value: string): MonitoringRelationship {
    switch (value) {
      case 'unknown': case 'different-devices': case 'same-usb-interface': case 'same-non-usb': return value;
      default: throw new Error('Choose the physical input/output relationship.');
    }
  }

  async function startPractice() {
    if (songChanging() || voiceCatalog.busy || starting || isRunning() || effectsApplying || auditionTimer !== undefined || outputCapture === 'starting' || outputCapture === 'stopping') return;
    if (song?.compiled?.executable === false) throw new Error('Audio is unavailable for this chart preview.');
    if (!chart) throw new Error('The song chart is still loading. Try again in a moment.');
    const bpm = Number(elements.bpm.value);
    const startBar = Number(elements['start-section'].value);
    const endBar = chart ? chartBarOrdinal(chart, elements['end-bar'].value) : NaN;
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('Choose a tempo between 40 and 240 BPM.');
    if (!Number.isInteger(endBar) || endBar < startBar || endBar > playableBars(chart)) throw new Error(`Choose an end bar from ${startBar} to ${playableBars(chart)}. Partial bars are not sequenced yet.`);
    phoneMotionAbort?.abort();
    if (remote) {
      const instance = remoteDesk?.performance();
      if (!instance) throw new Error('Enable hardware audio first.');
      starting = true;
      render(state);
      try {
        await instance.start({ bpm, countInBars: Number(elements['count-in'].value), startBar, endBar, loop: elements.loop.checked, automatic: false });
      } finally { starting = false; render(state); }
      return;
    }
    const effects = song?.compiled ? voiceEffects.configurations() : initialVoiceEffects();
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
    preparationAbort?.abort(new Error('Audio preparation canceled'));
    phoneMotionAbort?.abort();
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

  function panic() { return stopPerformance('panic'); }

  function receivePerformanceEvent(event: PracticeEvent) {
    if (event.type === 'control' && event.applied && event.control?.id === 'mushroom') {
      preparationAbort?.abort(new Error('Audio preparation canceled'));
      phoneMotionAbort?.abort(); transportGeneration++; chartFollower?.stop();
      finishOutputRecording(); releasePresses();
      if (audio && !remote) void audio.disableMicrophone().catch(showError);
    }
    postPerformanceEvent(event);
  }

  function makePads() {
    for (const control of CONTROLS) {
      const shell = document.createElement('article');
      shell.className = 'pad-shell';
      shell.dataset.channel = control.id;
      shell.style.setProperty('--pad-color', remote ? '#b4bcb0' : arcadeColorForRow(control.id) ?? control.color);
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
        if (event.button !== 0 || !event.isPrimary || pointerHeld.has(control.id)) return;
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        pointerHeld.set(control.id, event.pointerId); flash(control.id, true);
        act(() => triggerPad(control.id));
      });
      button.addEventListener('pointerup', event => {
        if (pointerHeld.get(control.id) !== event.pointerId) return;
        pointerHeld.delete(control.id);
        if (!heldKeys.has(control.key)) button.classList.remove('pressed');
        act(() => releasePad(control.id));
      });
      for (const type of ['pointercancel', 'lostpointercapture'] as const) {
        button.addEventListener(type, event => {
          if (pointerHeld.get(control.id) === event.pointerId) retirePointerInput();
        });
      }
      button.addEventListener('click', event => {
        if (event.detail !== 0 || !inputPolicy.allowsDomInput()) return;
        flash(control.id);
        act(async () => { await triggerPad(control.id); await releasePad(control.id); });
      });
    }
  }

  function mountVoiceRows() {
    voiceEffects.reset(initialVoiceEffects(remote ? undefined : song?.compiled)); liveVoiceStates.clear(); voiceAvatars.clear(); rotationControls.length = 0;
    for (const pad of pads.values()) {
      const avatar = requiredElement('.performance-avatar', HTMLElement, pad.button);
      avatar.hidden = true; delete avatar.dataset.avatar;
    }
    elements['live-voices'].replaceChildren();
    auditionButtons.length = 0;
    for (const pad of pads.values()) pad.shell.querySelector('.voice-effects')?.remove();
    const parts = [...song?.compiled?.parts ?? [], ...song?.compiled?.sourceProfiles?.map(profile => ({ ...profile, role: { kind: 'sampled-source' as const } })) ?? []];
    for (const part of parts) {
      if (part.role.kind === 'pad') {
        const pad = pads.get(part.role.buttonId);
        if (pad) {
          const editor = voiceEffects.mount(part, pad.shell, remote ? undefined : () => voiceCatalog.openProfile(part.profile));
          if (remote) addAuditionButton(editor, part.profile, part.name);
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
      main.title = part.role.kind === 'default-live' ? 'Default live voice' : part.role.kind === 'rotation-live' ? 'Use vertical scroll while playing to turn the knob' : 'Prepared sampled voice';
      identity.append(avatar, name);
      const tools = document.createElement('div'); tools.className = 'voice-tools';
      const status = document.createElement('span'); status.className = 'voice-state'; status.textContent = 'STANDBY';
      liveVoiceStates.set(part.profile, status); tools.append(status);
      if (remote) addAuditionButton(tools, part.profile, part.name);
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
    mountPhoneMotion();
  }

  function mountPhoneMotion() {
    phoneMotionAbort?.abort();
    document.getElementById('phone-motion-controls')?.remove();
    const sources = song?.compiled?.externalSamples?.filter(sample => sample.asset) ?? [];
    if (!sources.length) return;
    const group = document.createElement('section');
    group.id = 'phone-motion-controls';
    group.className = 'voice-row';
    const seen = new Set<string>();
    const tambourineSlots = sources.filter(source => source.voiceId === 'tambourine').map(source => source.slot);
    const recordedTambourine = [0, 1, 2, 3].every(slot => tambourineSlots.includes(slot));
    for (const source of sources) {
      const tambourine = song?.id === 'tribulations' && source.voiceId === 'tambourine' && (recordedTambourine || source.slot === 0);
      const motionSource = tambourine ? source.voiceId : String(source.slot);
      if (seen.has(motionSource)) continue;
      seen.add(motionSource);
      const recorded = tambourine && recordedTambourine;
      const tuning = recorded ? createTambourineTuning() : undefined;
      const trace = recorded ? createTambourineTrace() : undefined;
      const name = tambourine ? 'Tambourine' : source.voiceId;
      const addMotionButton = (auditioning: boolean) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.dataset.motionMode = auditioning ? 'audition' : 'chart';
        const inactiveLabel = auditioning ? 'Audition Tambourine' : `Enable shake · ${name}`;
        button.textContent = inactiveLabel;
        button.setAttribute('aria-pressed', 'false');
        let control: AbortController | undefined;
        button.addEventListener('click', () => { void act(async () => {
          if (control) { control.abort(); return; }
          const running = isRunning();
          if (starting || switching || (!running && !auditioning)) return;
          if (auditioning && remote && !audio) throw new Error('Switch hardware audio to Live to audition Tambourine.');
          phoneMotionAbort?.abort();
          const diagnostics = auditioning ? trace : undefined;
          if (tuning) diagnostics?.start(tuning.read, remote ? 'Hardware' : 'Browser', tuning.direction);
          const cancel = new AbortController();
          phoneMotionAbort = control = cancel;
          const generation = songGeneration;
          const session = crypto.randomUUID();
          const current = () => !cancel.signal.aborted && generation === songGeneration && !switching && !starting && isRunning() === running;
          let sequence = 0;
          let audition: PerformanceSession | undefined;
          let pendingHits = Promise.resolve();
          let ready = false;
          button.disabled = true;
          button.dataset.motion = 'pending';
          button.textContent = auditioning ? 'Opening Tambourine audition…' : 'Enabling shake…';
          cancel.signal.addEventListener('abort', () => {
            control = undefined;
            if (phoneMotionAbort === cancel) phoneMotionAbort = undefined;
            delete button.dataset.motion;
            button.textContent = inactiveLabel;
            button.setAttribute('aria-pressed', 'false');
            button.disabled = false;
            if (auditioning) tuning?.setAuditionActive(false);
            diagnostics?.note('Audition stopped');
            if (auditioning) queuePhoneAudition(async () => {
              await pendingHits;
              if (audition) await audition.auditionTambourine(-1);
            }).catch(error => {
              if (generation === songGeneration && audio === audition && !switching && !starting && isRunning() === running) showError(error);
            });
          }, { once: true });
          try {
            const motion = enablePhoneMotion({
              sensor: recorded ? 'tambourine' : auditioning ? 'gyroscope' : 'shake',
              tambourineTuning: tuning?.read,
              tambourineDirection: tuning?.direction,
              tambourineCalibration: auditioning ? tuning?.capture : undefined,
              tambourineTrace: diagnostics?.record,
              signal: cancel.signal,
              current,
              hit: stroke => {
                if (!ready || !current()) return;
                const instance = auditioning ? audition : audio;
                if (!instance || instance !== audio) return;
                const slot = recorded ? stroke : source.slot;
                if (!auditioning) {
                  const commandId = `phone-motion/${session}/${++sequence}`;
                  void instance.control({ id: 'external', slot }, { commandId }).catch(error => {
                    if (current() && audio === instance) showError(error);
                  });
                } else {
                  pendingHits = pendingHits.then(async () => {
                    if (!current() || instance !== audio) return;
                    diagnostics?.note(`Sending sample slot ${slot}`);
                    await instance.auditionTambourine(recorded ? 127 : stroke, recorded ? slot : undefined);
                    if (current()) diagnostics?.note(`Audio accepted sample slot ${slot}`);
                  }).catch(error => {
                    if (current() && audio === instance) {
                      diagnostics?.note(`Audio command failed: ${error instanceof Error ? error.message : String(error)}`);
                      showError(error);
                    }
                    cancel.abort();
                  });
                }
              },
              stopped: () => cancel.abort(),
            });
            // Safari requires permission and audio unlock to begin in the click handler.
            const unlocked = auditioning ? ensureAudio(undefined, !remote) : undefined;
            void unlocked?.catch(() => {});
            await motion;
            if (unlocked) {
              const instance = await unlocked;
              await queuePhoneAudition(async () => {
                if (!current() || instance !== audio) return;
                audition = instance;
                if (diagnostics) {
                  const detach = instance.onEvent((event: PracticeEvent, outputTime?: number) => diagnostics.recordClick(event, outputTime));
                  cancel.signal.addEventListener('abort', detach, { once: true });
                }
                await audition.auditionTambourine(0);
              });
            }
            if (!current()) { cancel.abort(); return; }
            ready = true;
            if (auditioning) tuning?.setAuditionActive(true);
            diagnostics?.note('Audition ready');
            button.dataset.motion = 'active';
            button.textContent = auditioning ? 'End Tambourine audition' : `Disable shake · ${name}`;
            button.setAttribute('aria-pressed', 'true');
            button.disabled = false;
          } catch (error) {
            if (cancel.signal.aborted && error instanceof DOMException && error.name === 'AbortError') return;
            diagnostics?.note(`Audition failed: ${error instanceof Error ? error.message : String(error)}`);
            cancel.abort();
            throw error;
          }
        }); });
        group.append(button);
      };
      addMotionButton(false);
      if (tambourine) addMotionButton(true);
      if (tuning) group.append(tuning.root);
      if (trace) group.append(trace.root);
      if (song && source.begin.beat === 0 && source.end.beat === 0 && !sources.some(other => other !== source && other.slot === source.slot)) {
        const hint = document.createElement('small');
        const first = chartBarLabel(song.chart, source.begin.bar);
        const last = chartBarLabel(song.chart, source.end.bar - 1);
        hint.textContent = first === last ? `Chart shake plays in bar ${first}` : `Chart shake plays in bars ${first}–${last}`;
        group.append(hint);
      }
    }
    elements['live-voices'].insertAdjacentElement('afterend', group);
  }

  function queuePhoneAudition(command: () => Promise<void>) {
    const next = phoneAuditionTransition.then(command);
    phoneAuditionTransition = next.catch(() => {});
    return next;
  }

  function browserModeBusy(): boolean {
    return sampleDownloads.busy || voiceCatalog.busy || isRunning() || starting || switching || effectsApplying || Boolean(preparing) || outputCapture !== 'idle' || state.channels.some(channel => ['armed', 'recording', 'stopping'].includes(channel.status));
  }

  let changingAudioMode = false;
  elements['audio-mode-select'].value = mode;
  elements['audio-mode-select'].addEventListener('change', () => {
    const select = elements['audio-mode-select'];
    const next = select.value;
    if (next !== 'browser' && next !== 'hardware') { select.value = mode; return; }
    if (next === mode || changingAudioMode) return;
    const warning = remote && isRunning() ? 'The EliteDesk will keep performing after you leave Hardware mode. Switch audio mode?'
      : !remote && browserModeBusy() ? 'Switching audio mode ends browser audio and discards any take you have not downloaded. Switch audio mode?' : '';
    if (warning && !window.confirm(warning)) { select.value = mode; return; }
    phoneMotionAbort?.abort();
    changingAudioMode = true;
    select.disabled = true;
    void changeAudioMode({ current: mode, next, browserBusy: false, url: deskURL, fallback: defaultMode,
      dispose: options.onModeChange ? dispose : async () => {
        await phoneAuditionTransition;
        if (remote) await remoteDesk?.dispose();
        else await audio?.dispose();
      }, navigate: url => options.onModeChange ? options.onModeChange(next) : location.assign(url.href) })
      .then(changed => { if (!changed) { changingAudioMode = false; select.value = mode; select.disabled = false; } })
      .catch(error => { changingAudioMode = false; select.value = mode; select.disabled = false; showError(error); });
  }, { signal: mountSignal });

  function songChanging() {
    return switching || explicitlySelected !== undefined;
  }

  function renderSongLoading() {
    const loading = songChanging();
    if (transport.hasAttribute('data-song-loading') === loading) return;
    transport.toggleAttribute('data-song-loading', loading);
    transport.setAttribute('aria-busy', String(loading));
    songLoadingStatus.textContent = loading ? 'Loading song' : '';
  }

  function render(next: Partial<PracticeState>) {
    if (mountSignal.aborted) return;
    syncTunerSession();
    const ended = next.phase === 'ended' && state.phase !== 'ended';
    const newPhase = next.phase ?? state.phase;
    if ((newPhase === 'playing' || newPhase === 'count-in') !== (state.phase === 'playing' || state.phase === 'count-in')) phoneMotionAbort?.abort();
    state = { ...state, ...next };
    renderSongLoading();
    sampleDownloads.render();
    beginOutputRecording(state.phase);
    if (ended) {
      finishOutputRecording();
      if (audio && !remote) void audio.disableMicrophone().catch(showError);
    }
    applyPendingPracticeUpdate();
    elements['audio-mode-select'].disabled = changingAudioMode;
    if (remote && !audio) { renderHardwareUnavailable(); return; }
    if (remote) {
      renderHardwareAudio();
      renderButtonBindings();
      renderRemoteDemo();
    }
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
    elements['phase-label'].textContent = inCountIn ? `COUNT-IN · ${state.countInRemaining ?? '…'} TO GO` : state.phase === 'playing' ? 'PLAYING' : state.phase === 'ended' ? 'RANGE COMPLETE' : song?.compiled?.executable === false ? 'CHART PREVIEW' : 'READY TO PLAY';
    elements['range-label'].textContent = `BARS ${chartBarLabel(chart, running ? state.startBar ?? 1 : Number(elements['start-section'].value))}–${running ? chartBarLabel(chart, state.endBar ?? chart.bars.length) : elements['end-bar'].value}`;
    elements['bar-number'].textContent = inCountIn ? 'IN' : currentBar?.label ?? String(displayBar).padStart(2, '0');
    elements['bar-number'].classList.toggle('pickup', Boolean(currentBar?.label && !/^\d/.test(currentBar.label)));
    elements['beat-number'].textContent = String(state.beat || 1);
    elements['beat-dots'].querySelectorAll('i').forEach((dot, index) => dot.classList.toggle('active', running && index === (state.beat || 1) - 1));
    elements.start.disabled = voiceCatalog.busy || song?.compiled?.executable === false || running || starting || songChanging() || effectsApplying || Boolean(preparing) || outputCapture === 'starting' || outputCapture === 'stopping' || remoteDemoChanging || auditionTimer !== undefined || (remote && remoteDesk?.demoState() === 'finishing');
    elements['song-select'].disabled = remote && remoteDesk?.connection.kind !== 'connected' || voiceCatalog.busy || songChanging() || starting || effectsApplying || Boolean(preparing) || outputCapture !== 'idle';
    if (!remote) elements['record-demo'].disabled = voiceCatalog.busy || outputCapture === 'starting' || outputCapture === 'stopping';
    const effectsLocked = running || starting || switching || Boolean(preparing) || (effectsApplying && !auditionApplying) || outputCapture !== 'idle';
    renderSongVoices(state, effectsLocked);
    elements['monitor-relationship'].disabled = remote || !audio?.microphone || starting;
    elements['monitor-relationship'].value = audio?.monitoringRelationship || 'unknown';
    elements['monitor-hint'].textContent = remote ? 'Audio, monitoring, and demo recording run on the EliteDesk.' : audio?.monitoringRelationship === 'different-devices' || audio?.monitoringRelationship === 'same-usb-interface'
      ? 'Confirmed setup. Live monitoring follows the active voice. Downloads include processed voice.'
      : audio?.monitoringRelationship === 'same-non-usb'
        ? 'Same non-USB device confirmed. Live monitoring stays off. Downloads include processed voice.'
        : 'Live monitoring is off. Confirm your physical setup after Start. Downloads still include processed voice.';
    startLabel.textContent = preparing ? 'Preparing audio…' : state.phase === 'ended' ? 'Play again' : 'Start';
    elements.stop.disabled = !starting && !running && !recording;
    for (const element of [elements.bpm, elements['count-in'], elements['start-section'], elements['end-bar'], elements.loop]) element.disabled = running || starting || songChanging();
    renderPads(displayBar, state);
    if (state.error) showError(new Error(state.error));
  }

  function renderSongVoices(observed: DisplayState | undefined, effectsLocked: boolean) {
    const preview = observed ? remoteDesk?.auditionProfile() : undefined;
    const motionControls = document.getElementById('phone-motion-controls');
    motionControls?.toggleAttribute('hidden', !observed);
    motionControls?.querySelectorAll<HTMLButtonElement>('[data-motion-mode="chart"]').forEach(button => {
      button.hidden = !isRunning();
    });
    for (const { button, profile } of auditionButtons) {
      button.hidden = preview === undefined;
      button.disabled = effectsLocked || effectsApplying;
      button.textContent = preview === profile ? 'End audition' : 'Audition';
      button.setAttribute('aria-pressed', String(preview === profile));
    }
    voiceEffects.render(observed?.voiceEffects, effectsLocked, observed ? undefined : remoteDesk?.snapshot().defaultVoiceEffects ?? []);
    voiceCatalog.update({ bar: observed?.bar ?? null, voiceEffects: observed?.voiceEffects });
    for (const [profile, avatar] of voiceAvatars) renderVoiceAvatar(avatar.root, voiceCatalog.voiceForProfile(profile), avatar.name, options.assetBase);
    for (const [profile, label] of liveVoiceStates) {
      const applied = observed?.voiceEffects?.find(voice => voice.profile === profile);
      label.textContent = preview === profile ? 'AUDITIONING' : applied?.activity === 'live' ? 'LIVE' : applied?.activity === 'tail' ? 'RELEASING' : applied?.activity === 'capture' ? 'RECORDING' : 'STANDBY';
      label.dataset.activity = preview === profile ? 'live' : applied?.activity || 'standby';
      if (applied?.rotationEligible) label.textContent += applied.rotationRemainingBeats > 0 ? ` · ${applied.rotationRemainingBeats.toFixed(2)} BEAT` : ' · KNOB CUE';
    }
    const canRotate = audio && isRunning() && observed?.voiceEffects?.some(voice => voice.rotationEligible);
    for (const button of rotationControls) button.disabled = !canRotate;
  }
  function renderPads(displayBar: number, observed?: DisplayState) {
    const inCountIn = observed?.phase === 'count-in';
    const currentBar = chart?.bars[displayBar - 1];
    const songLeadIn = inCountIn && (!song?.compiled || (observed.startBar ?? displayBar) === 1);
    const shownCues = inCountIn ? songLeadIn ? chart?.leadInCues : undefined : currentBar?.cues;
    const shownActions = inCountIn ? songLeadIn ? song?.program.controls?.leadIn : undefined : song?.program.controls?.bars[displayBar - 1];
    const bindings = remoteDesk?.snapshot().song.compiled?.inputBindings;
    for (const control of CONTROLS) {
      const pad = pads.get(control.id);
      if (!pad) continue;
      const channel = observed?.channels?.find(channel => channel.id === control.id);
      const looping = channel?.looping || observed?.looping?.includes(control.id);
      const cue = shownCues?.[control.id] ?? '';
      const compiledCue = shownActions?.[control.id];
      const capture = compiledCue && (compiledCue.kind === 'arm' || compiledCue.kind === 'commit-arm') ? compiledCue.capture : undefined;
      const replay = song?.program.barPlayback?.some(entry => entry.bar === displayBar && entry.channelId === control.id);
      const action = (replay && compiledCue?.kind === 'none' ? 'Auto · recorded bar' : cueLabel(cue))
        + (capture?.kind === 'sparse' ? ` · Extract ${capture.beats.map(beatName).join(' + ')}` : capture?.kind === 'bar' ? ' · Full-bar take' : '');
      const sampleStatus = channel?.status || 'empty';
      pad.shell.classList.toggle('selected', control.id === observed?.selectedChannel);
      pad.shell.classList.toggle('muted', Boolean(channel?.muted));
      pad.shell.dataset.sampleStatus = observed ? sampleStatus : 'standby';
      pad.button.disabled = !observed;
      pad.volume.disabled = !observed;
      pad.volume.closest('label')?.toggleAttribute('hidden', !observed);
      pad.sampleStatus.hidden = !observed;
      const light = channel?.light || { kind: 'off' };
      if (pad.shell.dataset.light !== light.kind) {
        if (light.kind === 'releasing') pad.shell.style.setProperty('--pad-release-ms', `${light.remainingMs}ms`);
        pad.shell.dataset.light = light.kind;
      }
      const name = controlName(control.id);
      const padName = pad.button.querySelector('.pad-name');
      if (padName) padName.textContent = name;
      const binding = bindings?.find(({ target }) => target.kind === 'cue-rows' && target.rows.includes(control.id));
      const physical = binding && arcadeButton(binding.controlId);
      if (remote) {
        pad.shell.style.setProperty('--pad-color', physical?.color ?? '#b4bcb0');
        const padId = pad.button.querySelector('.pad-id');
        if (padId) padId.textContent = physical ? `${control.id} · ${physical.name}` : control.id;
      }
      pad.button.setAttribute('aria-label', `${control.id}${physical ? ` ${physical.name}` : ''} ${name}, ${action}`);
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
      const take = takePresentation(song?.compiled, control.id, observed);
      if (take.summary) pad.sampleStatus.textContent = take.summary;
      pad.takePlan.textContent = take.plan;
      pad.takePlan.hidden = !take.plan;
      pad.cue.textContent = cue || '·';
      pad.cue.title = 'Original chart notation';
    }
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

  function renderRemoteDemo() {
    const desk = remoteDesk;
    const connected = desk?.connection.kind === 'connected';
    const demo = desk?.demoState();
    const active = demo === 'armed' || demo === 'recording' || demo === 'finishing';
    const label = demo === 'armed' ? 'Cancel take' : demo === 'recording' ? 'Finish take' : 'Record demo';
    recordLabel.textContent = label;
    elements['record-demo'].setAttribute('aria-pressed', String(active));
    elements['record-demo'].disabled = !connected || demo === undefined || demo === 'finishing' || remoteDemoChanging || starting || switching;
    elements['recording-hint'].textContent = demo === 'armed' ? 'Armed · recording starts after count-in.'
      : demo === 'recording' ? 'Recording on the EliteDesk.'
      : demo === 'finishing' ? 'Preparing WAV…'
      : demo === 'failed' ? 'Demo recording failed. Any earlier completed demo is still available.'
      : remoteDemoAvailable ? 'WAV ready.'
      : demo === undefined ? 'Enable hardware audio to record a demo.' : 'Demo recording starts with practice.';
    elements['download-demo'].hidden = !connected || !remoteDemoAvailable;
    elements['download-demo'].href = '#download-demo';
    if (!desk || !connected) return;
    const current = desk.snapshot();
    const key = [current.serverEpoch, current.audio.kind, 'attempt' in current.audio ? current.audio.attempt : '', demo].join('/');
    if (remoteDemoCheck === key) return;
    remoteDemoCheck = key;
    void desk.hasDemo().then(available => {
      if (remoteDesk !== desk || remoteDemoCheck !== key) return;
      remoteDemoAvailable = available;
      renderRemoteDemo();
    }).catch(() => {});
  }

  async function toggleOutputRecording() {
    if (remote) {
      if (remoteDemoChanging || starting || switching) return;
      const instance = remoteDesk?.performance();
      if (!instance) throw new Error('Enable hardware audio first.');
      remoteDemoChanging = true;
      render(state);
      try { await instance.recordDemo(instance.demoState() !== 'armed' && instance.demoState() !== 'recording'); }
      finally { remoteDemoChanging = false; render(state); }
      return;
    }
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
        if (mountSignal.aborted) return;
        outputCapture = 'stopping';
        elements['recording-hint'].textContent = 'Preparing MP3…';
        render(state);
        try {
          const type = activeRecorder.mimeType || mimeType || 'audio/webm';
          const mp3 = await recordingToMp3(new Blob(chunks, { type }), options.assetBase, mountSignal);
          if (mountSignal.aborted) return;
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

  elements.start.addEventListener('click', () => act(async () => {
    if (remote && !audio && remoteDesk?.snapshot().audio.kind === 'off') { await changeHardwareAudio(remoteDesk, true); return; }
    await startPractice();
  }), { signal: mountSignal });
  elements['song-select'].addEventListener('change', () => act(() => selectSong(elements['song-select'].value)), { signal: mountSignal });

  async function selectSong(id: string) {
    mountSignal.throwIfAborted();
    if (songChanging()) return;
    if ((remote ? remoteDesk?.snapshot().song.id : song?.id) === id) return;
    if (remote && isRunning()) {
      if (!window.confirm('Switching songs stops the current performance and clears its captured samples. Continue?')) {
        elements['song-select'].value = remoteDesk?.snapshot().song.id ?? id;
        return;
      }
      try { await stopPractice(); }
      catch (error) { elements['song-select'].value = remoteDesk?.snapshot().song.id ?? id; throw error; }
    }
    explicitlySelected = id;
    try {
      render(state);
      await switchSong(id);
    } finally {
      explicitlySelected = undefined;
      render(state);
    }
  }

  elements.stop.addEventListener('click', () => act(stopPractice), { signal: mountSignal });
  elements.mushroom.addEventListener('click', () => { flash('mushroom'); act(panic); }, { signal: mountSignal });
  elements['record-demo'].addEventListener('click', () => act(toggleOutputRecording), { signal: mountSignal });
  elements['download-demo'].addEventListener('click', event => {
    if (!remote) return;
    event.preventDefault();
    void act(async () => {
      const desk = remoteDesk;
      if (!desk) throw new Error('Connect to the hardware desk first.');
      if (remoteDemoDownloading) return;
      remoteDemoDownloading = true;
      try {
        const blob = await desk.downloadDemo();
        if (mountSignal.aborted) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `practice-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } finally { remoteDemoDownloading = false; }
    });
  }, { signal: mountSignal });
  elements['monitor-relationship'].addEventListener('change', () => act(() => {
    if (!audio) throw new Error('Start the microphone before confirming the monitoring setup.');
    if (audio instanceof RemoteSession) throw new Error('Monitoring belongs to the remote host');
    audio.setMonitoringRelationship(monitoringRelationship(elements['monitor-relationship'].value));
  }), { signal: mountSignal });
  elements.click.addEventListener('change', () => act(async () => {
    if (audio) await audio.setClick(elements.click.checked);
  }), { signal: mountSignal });
  elements['start-section'].addEventListener('change', () => {
    if (remote) renderButtonBindings();
    if (remote && !audio) { renderHardwareUnavailable(); return; }
    if (!chart) return;
    const start = Number(elements['start-section'].value);
    elements['end-bar'].min = String(start);
    if (!Number.isFinite(chartBarOrdinal(chart, elements['end-bar'].value)) || chartBarOrdinal(chart, elements['end-bar'].value) < start) elements['end-bar'].value = chartBarLabel(chart, Math.min(playableBars(chart), chart.sections.find(section => section.startBar === start)?.endBar || playableBars(chart)));
    render(state);
  }, { signal: mountSignal });
  for (const element of [elements['count-in'], elements['end-bar']]) element.addEventListener('change', () => render(state), { signal: mountSignal });

  const acceptsRouteInput = () => options.allowSongInput?.(song?.id) ?? true;
  window.addEventListener('wheel', event => {
    if (!acceptsRouteInput() || !inputPolicy.allowsDomInput() || !audio || !isRunning() || !song?.compiled?.rotation || !Number.isFinite(event.deltaY) || event.deltaY === 0
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input,select,textarea,[contenteditable=true],details[open]')
      || document.querySelector('dialog[open]')
      || document.activeElement?.closest('input,select,textarea,[contenteditable=true]')) return;
    event.preventDefault(); void act(() => rotate(event.deltaY, 'keyboard'));
  }, { passive: false, signal: mountSignal });

  window.addEventListener('keydown', event => {
    if (!acceptsRouteInput()) return;
    if (!inputPolicy.allowsDomInput()) {
      const target = event.target instanceof Element ? event.target : null;
      if ((event.code === 'Space' || event.code === 'Enter') && target?.closest('#start,#stop,#mushroom,#pads button,.rotation-controls button')) event.preventDefault();
      return;
    }
    if (event.repeat || heldKeys.has(event.code) || document.querySelector('dialog[open]') || (remote && !audio)) return;
    if (event.code === 'Escape') {
      event.preventDefault(); heldKeys.add(event.code); flash('mushroom', true);
      act(panic); return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || keyboardFocusBlocksShortcut(event.code, Boolean(target?.closest('input,select,textarea,[contenteditable=true]')), Boolean(target?.closest('button,summary,a,[role=button]')))) return;
    const control = CONTROLS.find(control => control.key === event.code);
    if (!control && event.code !== 'Space') return;
    event.preventDefault(); heldKeys.add(event.code);
    if (control) {
      flash(control.id, true); act(() => triggerPad(control.id, 'keyboard'));
    } else act(() => isRunning() ? stopPractice() : startPractice());
  }, { signal: mountSignal });
  window.addEventListener('keyup', event => {
    if (!acceptsRouteInput() || !inputPolicy.allowsDomInput()) return;
    heldKeys.delete(event.code);
    const control = CONTROLS.find(control => control.key === event.code);
    if (control) {
      if (!pointerHeld.has(control.id)) pads.get(control.id)?.button.classList.remove('pressed');
      if (audio) act(() => releasePad(control.id, 'keyboard'));
    }
    if (event.code === 'Escape') {
      elements.mushroom.classList.remove('pressed');
    }
  }, { signal: mountSignal });

  function postPerformanceEvent(event: PracticeEvent): void {
    if (remote) return;
    window.postMessage({ kind: 'show-tools-performance', event }, location.origin);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return;
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
  }, { signal: mountSignal });

  window.addEventListener('blur', retirePageInputs, { signal: mountSignal });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    retirePageInputs();
    phoneMotionAbort?.abort();
  }, { signal: mountSignal });
  window.addEventListener('beforeunload', event => {
    if (isRunning() && !changingAudioMode) { event.preventDefault(); event.returnValue = ''; }
  }, { signal: mountSignal });
  window.addEventListener('pagehide', event => {
    if (!event.persisted) { abortMount(); return; }
    retireRoute();
    if (recorder?.state === 'recording') recorder.stop();
  }, { signal: mountSignal });

  makePads();
  for (const entry of SONGS) {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = entry.title;
    elements['song-select'].append(option);
  }
  elements.start.disabled = true;
  async function switchSong(id: string, imported?: CompiledSong, source?: SongSource, loadedOptions: { remoteSong?: SongScript; voiceMetadata?: CatalogDocument } = {}): Promise<void> {
    const { remoteSong, voiceMetadata } = loadedOptions;
    if (remote && !remoteSong) {
      phoneMotionAbort?.abort();
      if (!remoteDesk) throw new Error('Connect to the hardware desk before choosing a song');
      const desk = remoteDesk;
      try {
        await desk.selectSong(id);
        await mountHardwareSong(desk.snapshot());
      } finally {
        elements['song-select'].value = desk.snapshot().song.id;
      }
      return;
    }
    mountSignal.throwIfAborted();
    if (voiceCatalog.busy) throw new Error('Wait for the voice library save before switching songs.');
    if (outputCapture !== 'idle') throw new Error('Finish the output recording before switching songs.');
    chartFollower?.stop();
    phoneMotionAbort?.abort();
    tunerPanel?.dispose(); tunerPanel = undefined; tunerSession = undefined; tunerPort = undefined;
    if (tunerDialog.open) tunerDialog.close();
    const generation = ++songGeneration;
    preparationAbort?.abort(new Error('The song changed while audio was preparing.'));
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
      if (generation !== songGeneration || mountSignal.aborted) return;
      if (remoteSong && audio instanceof RemoteSession) {
        for (const voice of audio.snapshot().voiceEffects ?? []) voiceEffects.setEffects(voice.profile, voice.effects);
      }
      const installedOption = remoteSong && [...elements['song-select'].options].find(option => option.value === loaded.id);
      if (installedOption) installedOption.textContent = loaded.chart.title;
      if (remoteSong && ![...elements['song-select'].options].some(option => option.value === loaded.id)) {
        const option = document.createElement('option'); option.value = loaded.id; option.textContent = loaded.chart.title;
        elements['song-select'].append(option);
      }
      elements['song-select'].value = loaded.id;
      document.title = `${loaded.chart.title} · Performance Desk`;
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
      elements['end-bar'].value = chartBarLabel(loaded.chart, loaded.practice.endBar);
      options.onSong?.({ id: loaded.id, digest: loaded.compiled?.source.digest, installedIds: catalogIds, reason: explicitlySelected === loaded.id ? 'selected' : 'observed' });
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
    assetBase: options.assetBase,
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
      const option = document.createElement('option'); option.value = start; option.textContent = `Bar ${chart ? chartBarLabel(chart, current.startBar) : start}`;
      elements['start-section'].append(option);
    }
    elements['start-section'].value = start;
    elements['end-bar'].min = start;
    elements['end-bar'].value = chart ? chartBarLabel(chart, current.endBar) : String(current.endBar);
    elements.loop.checked = current.loop;
    elements.click.checked = current.click;
  }

  const hardwareCard = requiredElement('#hardware-audio', HTMLElement);
  const hardwareStatus = requiredElement('#hardware-audio-status', HTMLSpanElement);
  const audioSwitch = requiredElement('#audio-switch', HTMLButtonElement);
  const audioSwitchStatus = requiredElement('#audio-switch-status', HTMLSpanElement);
  const hardwareReconnect = requiredElement('#hardware-reconnect', HTMLButtonElement);
  const resetAudioFault = requiredElement('#reset-audio-fault', HTMLButtonElement);
  const chartPublish = requiredElement('#chart-publish', HTMLElement);
  const chartFile = requiredElement('#chart-update-file', HTMLInputElement);
  const chartPublishButton = requiredElement('#chart-update-publish', HTMLButtonElement);
  const chartPublishStatus = requiredElement('#chart-update-status', HTMLParagraphElement);
  let publishingChart = false;

  function renderChartPublish() {
    chartPublish.hidden = !remote;
    const available = remoteDesk?.connection.kind === 'connected' && remoteDesk.snapshot().audio.kind === 'off';
    chartPublishButton.disabled = publishingChart || !available || !chartFile.files?.length;
    chartFile.disabled = publishingChart || !available;
  }
  chartFile.addEventListener('change', renderChartPublish, { signal: mountSignal });
  chartPublishButton.addEventListener('click', async () => {
    const file = chartFile.files?.[0], desk = remoteDesk;
    if (!file || !desk || chartPublishButton.disabled) return;
    const revision = desk.snapshot().revision;
    publishingChart = true;
    chartPublishStatus.textContent = 'Validating chart…';
    renderChartPublish();
    try {
      const view = await desk.publishChart(await file.text(), revision);
      chartPublishStatus.textContent = `Published ${view.song.chart.title}.`;
      chartFile.value = '';
    } catch (error) { chartPublishStatus.textContent = error instanceof Error ? error.message : String(error); }
    finally { publishingChart = false; renderChartPublish(); }
  }, { signal: mountSignal });

  let audioSwitchPending = false;
  let hardwareConnecting = false;

  function renderHardwareAudio() {
    renderChartPublish();
    const connection = remoteDesk?.connection.kind ?? (hardwareConnecting ? 'connecting' : 'disconnected');
    const status = remoteDesk?.snapshot().audio;
    const kind = status?.kind ?? 'off';
    const connected = connection === 'connected';
    const disconnected = connection === 'disconnected';
    const live = kind === 'starting' || kind === 'ready';
    const description = hardwareConnecting || connection === 'connecting' ? 'Connecting to desk…'
      : disconnected ? 'Hardware desk disconnected. Audio may still be running.'
      : kind === 'off' ? 'Standby · audio off'
      : kind === 'ready' ? 'Live · audio on'
      : kind === 'fault' ? 'Hardware audio fault. Switch to Live to retry.'
      : kind === 'starting' ? 'Starting hardware audio…' : 'Stopping hardware audio…';
    hardwareCard.dataset.connection = connection;
    hardwareCard.dataset.audio = connected ? kind : '';
    const detail = connected && status?.kind === 'fault' ? `Audio fault · ${status.error}`
      : connected && status?.kind === 'stopping' && status.error ? status.error : description;
    if (hardwareStatus.textContent !== detail) hardwareStatus.textContent = detail;
    if (audioSwitchStatus.textContent !== description) audioSwitchStatus.textContent = description;
    audioSwitch.hidden = disconnected;
    audioSwitch.dataset.state = connected ? kind : connection;
    audioSwitch.setAttribute('aria-checked', String(live));
    audioSwitch.disabled = audioSwitchPending || hardwareConnecting || !connected || kind === 'stopping' || (!live && switching);
    audioSwitch.title = live ? 'Switch to Standby to stop audio and clear captured loops' : 'Switch to Live to enable hardware audio';
    hardwareReconnect.hidden = !disconnected;
    hardwareReconnect.disabled = hardwareConnecting;
    resetAudioFault.hidden = !connected || kind !== 'fault';
    resetAudioFault.disabled = audioSwitchPending;
  }

  async function changeHardwareAudio(desk: RemoteDesk, live: boolean) {
    if (audioSwitchPending) return;
    if (!live) phoneMotionAbort?.abort();
    audioSwitchPending = true;
    renderHardwareAudio();
    try {
      await (live ? desk.enableAudio() : desk.terminateAudio());
    } finally {
      audioSwitchPending = false;
      renderHardwareAudio();
    }
  }

  async function replaceHardwareDesk(desk: RemoteDesk) {
    try {
      const releases = await Promise.allSettled([keyboardProducer.pause(), pointerProducer.pause()]);
      for (const release of releases) if (release.status === 'rejected') throw release.reason;
      await remoteDesk?.dispose();
      mountSignal.throwIfAborted();
      remoteDesk = desk;
      remoteDemoCheck = '';
      remoteDemoAvailable = false;
      audio = undefined;
    } catch (error) {
      await desk.dispose();
      throw error;
    } finally {
      keyboardProducer.resume();
      pointerProducer.resume();
    }
  }

  function renderHardwareUnavailable() {
    renderHardwareAudio();
    renderButtonBindings();
    renderRemoteDemo();
    const displayBar = Number(elements['start-section'].value) || 1;
    if (chart) elements['range-label'].textContent = `BARS ${chartBarLabel(chart, displayBar)}–${elements['end-bar'].value}`;
    for (const control of [elements.start, elements.stop, elements.bpm, elements['count-in'], elements['start-section'], elements['end-bar'], elements.loop, elements.click, elements.mushroom, elements['record-demo'], elements['song-select'], elements['monitor-relationship']]) control.disabled = true;
    const canEnable = remoteDesk?.connection.kind === 'connected' && remoteDesk.snapshot().audio.kind === 'off';
    if (canEnable && !songChanging()) elements.start.disabled = false;
    startLabel.textContent = canEnable ? 'Enable audio' : 'Start';
    elements['song-select'].disabled = !canEnable || songChanging();
    elements['phase-label'].textContent = remoteDesk?.connection.kind === 'connected' && remoteDesk.snapshot().audio.kind === 'off' ? 'AUDIO OFF' : 'AUDIO UNAVAILABLE';
    elements['bar-number'].textContent = '··';
    elements['beat-number'].textContent = '·';
    elements['beat-dots'].querySelectorAll('i').forEach(dot => dot.classList.remove('active'));
    elements['pads'].hidden = !chart;
    elements['live-voices'].hidden = !liveVoiceStates.size;
    elements['practice-desk'].dataset.phase = '';
    elements['practice-desk'].dataset.bar = '';
    elements['practice-desk'].dataset.beat = '';
    renderSongVoices(undefined, true);
    if (chart) renderPads(displayBar);
  }

  function retireRoute() {
    retirePageInputs();
    phoneMotionAbort?.abort();
    preparationAbort?.abort();
    tunerPanel?.dispose();
    tunerPanel = undefined;
    tunerSession = undefined;
    tunerPort = undefined;
    if (tunerDialog.open) tunerDialog.close();
  }

  function canBrowseSong() { return !remote && !browserModeBusy() && !mountSignal.aborted; }

  async function requestBrowserSong(id: string) {
    if (song?.id === id) return;
    if (!canBrowseSong()) throw new Error('Stop practice and finish pending work before switching songs.');
    await switchSong(id);
  }

  async function previewSong(id: string, signal?: AbortSignal): Promise<SongPreview> {
    if (!remoteDesk) throw new Error('Connect to the hardware desk before previewing a song.');
    return remoteDesk.previewSong(id, signal);
  }

  let disposal: Promise<void> | undefined;
  function dispose() {
    return disposal ??= (async () => {
      mountController.abort();
      options.signal?.removeEventListener('abort', abortMount);
      songGeneration++;
      transportGeneration++;
      retireRoute();
      if (!remote && recorder?.state === 'recording') recorder.stop();
      clearTimeout(auditionTimer);
      chartFollower?.stop();
      chartPanel.dispose();
      voiceCatalog.dispose();
      if (recordingURL) URL.revokeObjectURL(recordingURL);
      if (testView && window.practiceDesk === testView) delete window.practiceDesk;
      await Promise.allSettled([keyboardProducer.pause(), pointerProducer.pause(), phoneAuditionTransition]);
      if (remote) await remoteDesk?.dispose();
      else await audio?.dispose();
      if (preparing) await preparing.catch(() => {});
    })();
  }

  const abortMount = () => { void dispose().catch(error => globalThis.reportError?.(error)); };
  let testView: Window['practiceDesk'];
  options.signal?.addEventListener('abort', abortMount, { once: true });
  if (options.signal?.aborted) {
    await dispose();
    options.signal.throwIfAborted();
  }

  if (remote) {
    const hardwareKey = requiredElement('#hardware-key', HTMLButtonElement);
    const hardwareKeyStatus = requiredElement('#hardware-key-status', HTMLSpanElement);
    const hardwareAuth = createHardwareAuth({ endpoint: new URL('/api/session', location.href).href });
    hardwareCard.hidden = false;
    elements['monitor-relationship'].closest('label')?.setAttribute('hidden', '');
    elements['monitor-hint'].hidden = true;
    elements['offline-status'].textContent = 'Audio runs on the remote host.';
    chartSource.hidden = true;
    renderHardwareUnavailable();
    audioSwitch.addEventListener('click', () => {
      const desk = remoteDesk;
      if (!desk || audioSwitch.disabled) return;
      const kind = desk.snapshot().audio.kind;
      void act(() => changeHardwareAudio(desk, kind === 'off' || kind === 'fault'));
    }, { signal: mountSignal });
    resetAudioFault.addEventListener('click', () => {
      const desk = remoteDesk;
      if (desk?.snapshot().audio.kind === 'fault') void act(() => changeHardwareAudio(desk, false));
    }, { signal: mountSignal });
    const connectHardware = async () => {
      if (hardwareConnecting) return;
      hardwareConnecting = true;
      hardwareKey.disabled = true;
      renderHardwareAudio();
      let replacement: RemoteDesk | undefined;
      try {
        const desk = await hardwareAuth.connect(key => RemoteDesk.connect(key, mountSignal), reason => window.prompt(reason === 'rejected'
          ? 'Saved key was rejected. Enter the hardware session key' : 'Enter the hardware session key. This browser will remember it.'));
        hardwareKeyStatus.textContent = hardwareAuth.remembered() ? 'Key remembered in this browser.' : 'Key kept for this page only. Browser storage is unavailable.';
        await replaceHardwareDesk(desk);
        replacement = desk;
        const choices = await desk.songs();
        mountSignal.throwIfAborted();
        catalogIds = choices.map(choice => choice.id);
        elements['song-select'].replaceChildren(...choices.map(choice => { const option = document.createElement('option'); option.value = choice.id; option.textContent = choice.title; return option; }));
        await mountHardwareSong(desk.snapshot());
        mountSignal.throwIfAborted();
        desk.subscribe(view => {
          const remoteKey = `${view.song.id}/${view.song.compiled?.source.digest ?? ''}`;
          if (mountedHardwareSong !== remoteKey && mountingHardwareSong?.key !== remoteKey) void act(() => mountHardwareSong(view));
          renderButtonBindings();
          const status = view.audio;
          const connected = desk.connection.kind === 'connected';
          renderHardwareAudio();
          if (!connected || status.kind !== 'ready') {
            audio = undefined;
            phoneMotionAbort?.abort();
            syncTunerSession();
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
            session.onEvent(event => { receivePerformanceEvent(event); if (event.type === 'control' && event.applied === false && event.error) showError(new Error(event.error)); });
          }
          render(session.snapshot());
        });
        void desk.listen();
        renderRemoteDemo();
      } catch (error) {
        if (replacement) {
          await replacement.dispose();
          remoteDesk = undefined;
          renderHardwareUnavailable();
        }
        throw error;
      } finally {
        hardwareConnecting = false;
        hardwareKey.disabled = false;
        hardwareKey.textContent = hardwareAuth.hasKey() ? 'Forget key' : 'Enter key';
        renderHardwareAudio();
      }
    };
    hardwareReconnect.addEventListener('click', () => { void act(connectHardware); }, { signal: mountSignal });
    hardwareKey.addEventListener('click', () => {
      if (hardwareAuth.hasKey()) {
        const cleared = hardwareAuth.forget();
        hardwareKey.textContent = 'Enter key';
        hardwareKeyStatus.textContent = cleared ? 'Key forgotten. Current audio is unchanged.' : 'Browser storage could not be cleared. Clear this site\'s data to remove its saved key.';
      } else void act(connectHardware);
    }, { signal: mountSignal });
    const entry = audioModeURL(deskURL, 'hardware', defaultMode);
    if (!options.mode && entry.pathname !== deskURL.pathname) location.replace(entry);
    else await act(connectHardware);
  } else await act(() => switchSong(options.initialSongId ?? 'dance-yrself-clean'));

  if (mountSignal.aborted) throw mountSignal.reason;

  if (new URLSearchParams(location.search).has('test')) {
    testView = { get audio() { return remote ? undefined : audio; }, get state() { return remote && !audio ? undefined : state; }, get chart() { return chart; }, get hardware() { return remoteDesk?.snapshot(); }, get connection() { return remoteDesk?.connection; } };
    window.practiceDesk = testView;
  }

  function applyPendingPracticeUpdate() {
    if (mountSignal.aborted) return;
    if (offlineUpdate.kind === 'current' || offlineUpdate.kind === 'reloading') return;
    elements['offline-status'].textContent = 'Update ready. It will apply when practice, recording, and voice editing finish.';
    if (sampleDownloads.busy || voiceCatalog.busy || document.querySelector('dialog[open]') || isRunning() || starting || switching || preparing || effectsApplying || outputCapture !== 'idle') return;
    if (offlineUpdate.kind === 'waiting') {
      offlineUpdate.worker.postMessage({ type: 'activate-when-idle' });
      return;
    }
    offlineUpdate = { kind: 'reloading' };
    location.reload();
  }

  document.addEventListener('close', () => applyPendingPracticeUpdate(), { capture: true, signal: mountSignal });

  if (!remote && (!options.mode || options.workerURL) && 'serviceWorker' in navigator && window.isSecureContext && !new URLSearchParams(location.search).has('test')) {
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!navigator.serviceWorker.controller) return;
      if (hadController) {
        offlineUpdate = { kind: 'pending' };
        applyPendingPracticeUpdate();
      }
      hadController = true;
    }, { signal: mountSignal });
    navigator.serviceWorker.register(options.workerURL ?? './sw.js', { type: 'module', updateViaCache: 'none' }).then(async registration => {
      if (mountSignal.aborted) return;
      const noticeWaiting = () => {
        if (!mountSignal.aborted && registration.waiting) {
          offlineUpdate = { kind: 'waiting', worker: registration.waiting };
          applyPendingPracticeUpdate();
        }
      };
      registration.addEventListener('updatefound', () => {
        registration.installing?.addEventListener('statechange', noticeWaiting, { signal: mountSignal });
      }, { signal: mountSignal });
      const checkForUpdate = () => {
        noticeWaiting();
        void registration.update().catch(() => {});
      };
      window.addEventListener('focus', checkForUpdate, { signal: mountSignal });
      window.addEventListener('online', checkForUpdate, { signal: mountSignal });
      noticeWaiting();
      await navigator.serviceWorker.ready;
      if (!mountSignal.aborted && registration.active && offlineUpdate.kind === 'current') elements['offline-status'].textContent = 'Practice files cached for offline use.';
    }).catch(() => { if (!mountSignal.aborted) elements['offline-status'].textContent = 'Offline cache unavailable.'; });
  }

  return { dispose, selectSong, previewSong, requestBrowserSong, canBrowseSong, retireRoute };
}

declare global {
  interface Window {
    practiceDesk?: { readonly audio: PerformanceSession | undefined; readonly state: DisplayState | undefined; readonly chart: Chart | undefined; readonly hardware: DeskView | undefined; readonly connection: RemoteConnection | undefined };
  }
}
