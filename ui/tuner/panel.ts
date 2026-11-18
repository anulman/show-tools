import type { TunerCommand, TunerNote, TunerPort, TunerScale, TunerState, TuningBankOptions } from '../../lib/tuner/model.js';
import { createTunerDial } from './dial.js';

type WithoutRevision<T> = T extends { expectedRevision: number } ? Omit<T, 'expectedRevision'> : never;
type TunerAction = WithoutRevision<TunerCommand> | { kind: 'prepare-bank'; capture: TuningBankOptions };
type ScaleSelection = Extract<TunerAction, { kind: 'configure' }>;
export type TunerCaptureBank = { readonly id: string; readonly label: string; readonly capture: TuningBankOptions };
type TunerPanelOptions = { connect: () => Promise<TunerPort>; banks?: readonly TunerCaptureBank[] };
export type TunerPanel = {
  setSession(port: TunerPort | null): void;
  close(): Promise<void>;
  dispose(): void;
};

const roots = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const accidentals: Record<number, string> = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
function noteLabel(note: TunerNote): string {
  return `${note.letter}${accidentals[note.accidental] ?? ''}${note.octave}`;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}
function button(text: string, action: () => void): HTMLButtonElement {
  const node = element('button', 'tuner-button', text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}
function selectField(label: string, options: readonly { value: string; label: string }[], initial: string) {
  const field = element('label', 'tuner-field');
  const select = element('select', 'tuner-select');
  for (const item of options) {
    const option = element('option', '', item.label);
    option.value = item.value;
    select.append(option);
  }
  select.value = initial;
  field.append(element('span', '', label), select);
  return { field, select };
}

export function mountTuner(root: HTMLElement, options: TunerPanelOptions): TunerPanel {
  let port: TunerPort | null = null;
  let state: TunerState | null = null;
  let unsubscribe: (() => void) | null = null;
  let generation = 0;
  let disposed = false;
  let busy = false;
  let pending: Promise<void> = Promise.resolve();
  let releaseBindingWait: (() => void) | undefined;
  let selection: ScaleSelection | null = null;
  let queuedSelection: ScaleSelection | null = null;
  let queuedAction: TunerAction | null = null;
  let closing: Promise<void> | null = null;
  const panel = element('section', 'tuner-panel');
  panel.setAttribute('aria-label', 'Pitch and scale tuner');
  const intro = element('div', 'tuner-intro');
  intro.append(element('p', 'tuner-eyebrow', 'SHARED PRACTICE AUDIO'), element('h2', 'tuner-title', 'Tuner'));
  const connection = element('div', 'tuner-connection');
  const connectionText = element('p', 'tuner-muted', 'Use the Performance Desk audio to hear a reference or listen to your voice.');
  const connect = button('Use shared audio', () => { void connectSession(); });
  connection.append(connectionText, connect);
  const error = element('p', 'tuner-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const scaleCard = element('section', 'tuner-card');
  scaleCard.append(element('h3', 'tuner-card-title', 'Scale practice'));
  const fields = element('div', 'tuner-fields');
  const rootField = selectField('Root note', roots.map((label, index) => ({ value: String(index), label })), '0');
  const octaveField = selectField('Octave', [0, 1, 2, 3, 4, 5, 6, 7].map(value => ({ value: String(value), label: String(value) })), '3');
  const scaleField = selectField('Scale', [{ value: 'major', label: 'Major' }, { value: 'natural-minor', label: 'Natural minor' }, { value: 'chromatic', label: 'Chromatic' }], 'major');
  fields.append(rootField.field, octaveField.field, scaleField.field);
  function selectedScale(): TunerScale {
    switch (scaleField.select.value) {
      case 'natural-minor': return 'natural-minor';
      case 'chromatic': return 'chromatic';
      default: return 'major';
    }
  }
  for (const select of [rootField.select, octaveField.select, scaleField.select]) {
    select.addEventListener('change', () => {
      if (disposed || closing) return;
      selection = { kind: 'configure', root: 12 * (Number(octaveField.select.value) + 1) + Number(rootField.select.value), scale: selectedScale() };
      queuedSelection = selection;
      drain(true);
    });
  }
  const steps = element('ol', 'tuner-steps');
  steps.setAttribute('aria-label', 'Scale notes');
  const targetHeading = element('p', 'tuner-eyebrow', 'CURRENT TARGET');
  const target = element('div', 'tuner-target', '—');
  const progress = element('p', 'tuner-muted', 'Set a scale to begin.');
  progress.setAttribute('role', 'status');
  const actions = element('div', 'tuner-actions');
  const hear = button('Hear note', () => run({ kind: 'cue' }));
  const playScale = button('Play scale', () => run({ kind: 'play-scale' }));
  const silence = button('Stop sound', () => run({ kind: 'silence' }));
  const audition = element('div', 'tuner-actions tuner-audition');
  audition.setAttribute('aria-label', 'Reference playback');
  audition.append(hear, playScale, silence);
  const previewStatus = element('p', 'tuner-muted tuner-preview', 'Reference is silent.');
  previewStatus.setAttribute('role', 'status');
  const confirm = button('Confirm', () => run({ kind: 'confirm' }));
  confirm.classList.add('tuner-primary');
  const reset = button('Reset scale', () => {
    if (state) run({ kind: 'configure', root: state.root, scale: state.scale });
  });
  reset.classList.add('tuner-quiet');
  actions.append(confirm, reset);
  const banks = options.banks ?? [];
  const bankCard = element('section', 'tuner-bank');
  const bankStatus = element('p', 'tuner-muted');
  bankStatus.setAttribute('role', 'status');
  const bankField = selectField('Note bank', banks.map(bank => ({ value: bank.id, label: bank.label })), banks[0]?.id ?? '');
  bankField.field.hidden = banks.length < 2;
  const recordBank = button('Record selected scale', () => {
    const bank = banks.find(candidate => candidate.id === bankField.select.value);
    if (bank) run({ kind: 'prepare-bank', capture: bank.capture });
  });
  recordBank.hidden = banks.length === 0;
  bankField.select.addEventListener('change', render);
  bankCard.append(bankField.field, recordBank, bankStatus);
  scaleCard.append(fields, steps, targetHeading, target, progress, audition, previewStatus, actions, bankCard);
  const sungCard = element('section', 'tuner-card tuner-sung');
  const sungHeader = element('div', 'tuner-card-header');
  const listen = button('Listen', () => { if (state) run({ kind: 'listen', enabled: !state.listening }); });
  sungHeader.append(element('h3', 'tuner-card-title', 'Sung note'), listen);
  const sungNote = element('div', 'tuner-pitch', '—');
  sungNote.setAttribute('aria-label', 'Detected note');
  const pitchStatus = element('p', 'tuner-muted', 'Listening is off.');
  const dial = createTunerDial();
  const measurement = element('p', 'tuner-measurement', 'No pitch detected');
  sungCard.append(sungHeader, dial.element, sungNote, pitchStatus, measurement);
  panel.append(intro, connection, error, scaleCard, sungCard);
  root.append(panel);

  function showError(cause: unknown) {
    error.textContent = cause instanceof Error ? cause.message : String(cause);
    error.hidden = false;
  }
  function render() {
    dial.update(state);
    const attached = state !== null;
    connect.hidden = attached;
    connect.disabled = busy || closing !== null;
    connectionText.textContent = attached ? 'Shared performance audio connected.' : 'Use the Performance Desk audio to hear a reference or listen to your voice.';
    panel.setAttribute('aria-busy', String(busy || closing !== null));
    for (const control of [hear, playScale, silence, confirm, reset, listen]) control.disabled = !attached || busy || closing !== null;
    for (const control of [rootField.select, octaveField.select, scaleField.select]) control.disabled = closing !== null;
    if (state && !selection) {
      rootField.select.value = String(state.root % 12);
      octaveField.select.value = String(Math.floor(state.root / 12) - 1);
      scaleField.select.value = state.scale;
    }
    const captureBank = banks.find(candidate => candidate.id === bankField.select.value);
    recordBank.disabled = !state || busy || closing !== null || !port?.prepareBank || !captureBank || captureBank.capture.slots.length !== state.targets.length;
    bankField.select.disabled = busy || closing !== null;
    bankStatus.textContent = !captureBank ? 'This song has no source-note capture order.'
      : !port?.prepareBank && attached ? 'Note-bank capture is unavailable in this audio session.'
      : state && captureBank.capture.slots.length !== state.targets.length ? 'Select a scale matching the authored source-note order.'
      : 'Record this scale, then sing each target and Confirm or turn the knob right to lock it.';
    const current = state?.targets[state.step];
    hear.disabled ||= !current;
    playScale.disabled ||= !state?.targets.length;
    silence.disabled ||= state?.preview.kind === 'silent';
    confirm.disabled ||= !current || state?.complete === true;
    reset.disabled ||= !state?.targets.length;
    target.textContent = current ? noteLabel(current) : '—';
    progress.textContent = state?.complete ? 'Scale complete. Reset to practice again.' : current && state ? `Note ${state.step + 1} of ${state.targets.length}` : 'Set a scale to begin.';
    confirm.textContent = state && state.step === state.targets.length - 1 ? 'Confirm & finish' : 'Confirm';
    const preview = state?.preview;
    const previewNote = state && preview && preview.kind !== 'silent' ? state.targets[preview.step] : undefined;
    previewStatus.textContent = previewNote && preview && preview.kind !== 'silent'
      ? `${preview.kind === 'scale' ? 'Playing scale' : 'Playing note'} · ${noteLabel(previewNote)} · Note ${preview.step + 1} of ${state?.targets.length}`
      : 'Reference is silent.';
    const nextSteps = (state?.targets ?? []).map((note, index) => {
      const item = element('li', 'tuner-step', noteLabel(note));
      if (state && (index < state.step || state.complete)) item.dataset.done = 'true';
      if (state && index === state.step && !state.complete) item.setAttribute('aria-current', 'step');
      if (preview && preview.kind !== 'silent' && index === preview.step) {
        item.dataset.preview = 'true';
        item.setAttribute('aria-label', `${noteLabel(note)}, reference playing`);
      }
      return item;
    });
    steps.replaceChildren(...nextSteps);
    listen.textContent = state?.listening ? 'Stop listening' : 'Listen';
    const pitch = state?.pitch;
    const pitched = pitch?.kind === 'pitched' ? pitch : null;
    sungNote.textContent = pitched ? noteLabel(pitched.note) : '—';
    const messages = { off: 'Listening is off.', microphone: 'Waiting for microphone input.', warming: 'Listening is warming up.', reference: 'Reference playing. Waiting for your voice.', unvoiced: 'Listening. Sing a steady note.', pitched: 'Listening to your voice.' };
    pitchStatus.textContent = pitch ? messages[pitch.kind] : messages.off;
    measurement.textContent = pitched ? `${pitched.cents > 0 ? '+' : ''}${pitched.cents.toFixed(1)} cents · ${pitched.frequency.toFixed(1)} Hz · ${Math.round(pitched.confidence * 100)}% confidence` : 'No pitch detected';
  }
  function attach(next: TunerPort | null) {
    unsubscribe?.();
    unsubscribe = null;
    port = next;
    state = next?.snapshot() ?? null;
    if (next) {
      const attachedGeneration = generation;
      unsubscribe = next.subscribe(value => {
        if (!disposed && generation === attachedGeneration) { state = value; render(); }
      });
    }
    render();
  }
  function setSession(next: TunerPort | null) {
    if (disposed) return;
    generation++;
    releaseBindingWait?.();
    busy = false;
    queuedAction = null;
    queuedSelection = selection;
    pending = Promise.resolve();
    error.hidden = true;
    attach(next);
    if (next && queuedSelection && !closing) drain(false);
  }
  function connectSession() {
    if (!port) drain(true);
  }
  function run(command: TunerAction) {
    if (disposed || closing || busy || !port || !state) return;
    queuedAction = command;
    drain(false);
  }
  function drain(allowConnect: boolean) {
    if (disposed || busy || closing) return;
    if (!port && !allowConnect) return;
    const commandGeneration = generation;
    busy = true;
    error.hidden = true;
    render();
    pending = (async () => {
      try {
        if (!port) {
          const next = await options.connect();
          if (disposed || generation !== commandGeneration) return;
          attach(next);
        }
        while (!disposed && generation === commandGeneration && port && state) {
          const configuration = queuedSelection;
          const command = configuration ?? queuedAction;
          if (!command) break;
          if (configuration) queuedSelection = null;
          else queuedAction = null;
          try {
            let next: TunerState;
            if (command.kind === 'prepare-bank') {
              const session = port;
              const prepare = session.prepareBank;
              if (!prepare || command.capture.slots.length !== state.targets.length) throw new Error('This session cannot prepare the selected note bank.');
              const configured = await session.command({ kind: 'configure', root: state.root, scale: state.scale, expectedRevision: state.revision });
              if (disposed || generation !== commandGeneration) return;
              state = configured;
              await prepare(command.capture);
              if (disposed || generation !== commandGeneration) return;
              next = await session.command({ kind: 'listen', enabled: true, expectedRevision: state.revision });
            } else next = await port.command({ ...command, expectedRevision: state.revision });
            if (disposed || generation !== commandGeneration) return;
            state = next;
            if (configuration && selection === configuration) selection = null;
          } catch (cause) {
            if (disposed || generation !== commandGeneration) return;
            showError(cause);
          }
        }
      } catch (cause) {
        if (!disposed && generation === commandGeneration) showError(cause);
      } finally {
        if (!disposed && generation === commandGeneration) { busy = false; render(); }
      }
    })();
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    generation++;
    releaseBindingWait?.();
    unsubscribe?.();
    unsubscribe = null;
    port = null;
    state = null;
    dial.dispose();
    panel.remove();
  }
  function waitForSession(operation: Promise<unknown>): Promise<'settled' | 'changed'> {
    return new Promise((resolve, reject) => {
      const changed = () => {
        if (releaseBindingWait === changed) releaseBindingWait = undefined;
        resolve('changed');
      };
      releaseBindingWait = changed;
      operation.then(() => {
        if (releaseBindingWait === changed) releaseBindingWait = undefined;
        resolve('settled');
      }, cause => {
        if (releaseBindingWait === changed) releaseBindingWait = undefined;
        reject(cause);
      });
    });
  }
  async function close() {
    while (!disposed) {
      if (!port || !state) { dispose(); return; }
      const closingGeneration = generation;
      await waitForSession(pending);
      if (disposed) return;
      if (generation !== closingGeneration) continue;
      const session = port;
      const revision = state.revision;
      try {
        const result = await waitForSession(session.command({ kind: 'close', expectedRevision: revision }));
        if (disposed) return;
        if (result === 'changed' || generation !== closingGeneration) continue;
      }
      catch (cause) {
        if (disposed) return;
        if (generation !== closingGeneration) continue;
        showError(cause);
        throw cause;
      }
      dispose();
    }
  }
  render();
  return {
    setSession,
    close() {
      if (!closing) {
        const result = close().catch(cause => {
          if (closing === result) { closing = null; render(); }
          throw cause;
        });
        closing = result;
        render();
      }
      return closing;
    },
    dispose,
  };
}
