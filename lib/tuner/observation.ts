import { PF } from '../performance/wasm-abi.js';
import type { TunerCommand, TunerNote, TunerScale, TunerState } from './model.js';

const scales: readonly TunerScale[] = ['major', 'natural-minor', 'chromatic'];

function note(midi: number, letter: number, accidental: number, octave: number): TunerNote {
  if (!Number.isInteger(midi) || midi < 0 || midi > 127 || !Number.isInteger(letter) || letter < 65 || letter > 71
    || !Number.isInteger(accidental) || Math.abs(accidental) > 2 || !Number.isInteger(octave) || octave < -1 || octave > 9)
    throw new Error('Invalid native tuner note');
  return { midi, letter: String.fromCharCode(letter), accidental, octave };
}

export function decodeTunerState(data: ArrayLike<number>): TunerState {
  if (data.length < PF.TUNER_FIELDS) throw new Error('Incomplete native tuner observation');
  for (let i = 0; i < PF.TUNER_FIELDS; i++) if (!Number.isFinite(data[i])) throw new Error('Invalid native tuner number');
  const count = data[PF.TUNER_COUNT], step = data[PF.TUNER_STEP], revision = data[PF.TUNER_REVISION];
  const scale = scales[data[PF.TUNER_SCALE]];
  if (!scale || !Number.isSafeInteger(count) || count < 2 || count > 13 || !Number.isSafeInteger(step) || step < 0 || step >= count
    || !Number.isInteger(revision) || revision < 0 || revision > 0xffffffff) throw new Error('Invalid native tuner state');
  const targets = Array.from({ length: count }, (_, i) => {
    const offset = PF.TUNER_TARGETS + i * PF.TUNER_TARGET_FIELDS;
    return note(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
  });
  let pitch: TunerState['pitch'];
  let preview: TunerState['preview'];
  switch (data[PF.TUNER_PREVIEW_KIND]) {
    case 0: preview = { kind: 'silent' }; break;
    case 1: preview = { kind: 'note', step: data[PF.TUNER_PREVIEW_STEP] }; break;
    case 2: preview = { kind: 'scale', step: data[PF.TUNER_PREVIEW_STEP] }; break;
    default: throw new Error('Invalid native tuner preview');
  }
  if (preview.kind !== 'silent' && (!Number.isInteger(preview.step) || preview.step < 0 || preview.step >= count)) throw new Error('Invalid native preview step');
  switch (data[PF.TUNER_PITCH_STATUS]) {
    case 0: pitch = { kind: 'off' }; break;
    case 1: pitch = { kind: 'microphone' }; break;
    case 2: pitch = { kind: 'warming' }; break;
    case 3: pitch = { kind: 'reference' }; break;
    case 4: pitch = { kind: 'unvoiced' }; break;
    case 5:
      pitch = { kind: 'pitched', frequency: data[PF.TUNER_FREQUENCY], midi: data[PF.TUNER_MIDI],
        cents: data[PF.TUNER_CENTS], confidence: data[PF.TUNER_CONFIDENCE], rms: data[PF.TUNER_RMS],
        note: note(data[PF.TUNER_ROUNDED_MIDI], data[PF.TUNER_LETTER], data[PF.TUNER_ACCIDENTAL], data[PF.TUNER_OCTAVE]) };
      break;
    default: throw new Error('Invalid native tuner pitch status');
  }
  return { revision, root: data[PF.TUNER_ROOT], scale, step, targets, complete: data[PF.TUNER_COMPLETE] === 1,
    listening: data[PF.TUNER_LISTENING] === 1, preview, pitch };
}

export function tunerCommandValues(command: TunerCommand): readonly [number, number, number, number] {
  const revision = command.expectedRevision;
  if (!Number.isInteger(revision) || revision < 0 || revision > 0xffffffff) throw new Error('Invalid tuner revision');
  switch (command.kind) {
    case 'configure': {
      const scale = scales.indexOf(command.scale);
      if (!Number.isInteger(command.root) || command.root < 0 || command.root > 115 || scale < 0) throw new Error('Invalid tuner scale');
      return [PF.TUNER_CONFIGURE, revision, command.root, scale];
    }
    case 'cue': return [PF.TUNER_CUE, revision, 0, 0];
    case 'play-scale': return [PF.TUNER_PLAY_SCALE, revision, 0, 0];
    case 'silence': return [PF.TUNER_SILENCE, revision, 0, 0];
    case 'confirm': return [PF.TUNER_CONFIRM, revision, 0, 0];
    case 'listen':
      if (typeof command.enabled !== 'boolean') throw new Error('Invalid tuner listening state');
      return [PF.TUNER_LISTEN, revision, Number(command.enabled), 0];
    case 'close': return [PF.TUNER_CLOSE, revision, 0, 0];
    default: { const exhaustive: never = command; throw new Error(`Unknown tuner command ${String(exhaustive)}`); }
  }
}
