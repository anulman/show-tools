import { CONTROL_IDS } from './model.js';
import { decodeCompiledSong } from './compiled-song.js';
import type { CompiledSong } from './compiled-song.js';
import { PF } from './wasm-abi.js';

export function encodeCompiledProgram(input: unknown): Float64Array {
  const song = decodeCompiledSong(input);
  if (!song.executable || song.diagnostics.some(d => d.severity === 'error')) throw new Error('Resolve the song inspection errors before loading audio.');
  if (!song.cueWindow) throw new Error('The song has no approved cue window.');
  const voices = new Map(song.voices.map((voice, index) => [voice.id, index]));
  const takes = new Map(song.takes.map((take, index) => [take.id, index]));
  const selections = new Map(song.selections.map((selection, index) => [selection.id, index]));
  const indexOf = (map: ReadonlyMap<string, number>, id: string): number => {
    const index = map.get(id);
    if (index === undefined) throw new Error(`Unknown compiled resource ${id}.`);
    return index;
  };
  const optionalIndex = (map: ReadonlyMap<string, number>, id: string | null) => id === null ? -1 : indexOf(map, id);
  const members = song.selections.flatMap((selection, index) => selection.takeIds.flatMap((id, member) => [index, indexOf(takes, id), selection.gains[member]]));
  const binding = CONTROL_IDS.map(button => {
    const voice = song.voices.find(voice => voice.buttonId === button);
    if (!voice) throw new Error(`Missing compiled input binding ${button}.`);
    return indexOf(voices, voice.id);
  });
  const kinds: Record<CompiledSong['cues'][number]['kind'], number> = { arm: PF.ARM, commit: PF.COMMIT, 'commit-arm': PF.COMMIT_ARM, stop: PF.STOP, play: PF.PLAY };
  const header = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, song.meter.numerator, song.chart.bars.length,
    song.chart.bpm, song.chart.annotatedThroughBar, song.cueWindow.earlyMs, song.cueWindow.lateMs,
    song.takes.length, song.cues.length, members.length / PF.COMPILED_MEMBER_FIELDS, song.playback.length, ...binding];
  const takeRows = song.takes.flatMap(take => {
    if (!take.captureEnd || !take.loopEnd) throw new Error(`Take ${take.id} has no capture/loop boundary.`);
    return [indexOf(voices, take.voiceId), take.begin.bar, take.begin.beat, take.captureEnd.bar, take.captureEnd.beat, 1,
      take.loopEnd.bar, take.loopEnd.beat, indexOf(takes, take.phraseAnchorTakeId)];
  });
  const cueRows = song.cues.flatMap(cue => [CONTROL_IDS.indexOf(cue.buttonId), indexOf(voices, cue.voiceId), cue.bar,
    cue.cueBeat ?? -1, kinds[cue.kind], cue.execution.kind === 'now' ? 0 : cue.execution.kind === 'next-bar' ? 1 : 2,
    cue.execution.kind === 'beat' ? cue.execution.beat : 0, optionalIndex(takes, cue.takeId),
    optionalIndex(takes, cue.commitTakeId), optionalIndex(selections, cue.selectionId), cue.tempoBeatHint]);
  const playback = song.playback.flatMap(cue => [cue.bar, indexOf(voices, cue.voiceId), indexOf(selections, cue.selectionId)]);
  const rotation = song.rotation ? [PF.COMPILED_ROTATION_MAGIC, song.rotation.windows.length, song.rotation.holdBeats,
    ...song.rotation.windows.flatMap(window => [window.begin.bar, window.begin.beat, window.end.bar, window.end.beat])] : [];
  const fields = [...header, ...takeRows, ...cueRows, ...members, ...playback, ...rotation];
  if (header.length !== PF.COMPILED_HEADER_FIELDS || takeRows.length !== song.takes.length * PF.COMPILED_TAKE_FIELDS
    || cueRows.length !== song.cues.length * PF.COMPILED_CUE_FIELDS || fields.some(value => !Number.isFinite(value))) throw new Error('Invalid compiled native program layout.');
  if (song.meter.denominator !== (song.meter.numerator === 6 ? 8 : 4)) throw new Error('This native build supports 4/4 and 6/8 compiled programs.');
  return Float64Array.from(fields);
}

export function compiledProgramBytes(song: unknown): Uint8Array {
  const program = encodeCompiledProgram(song);
  const bytes = new Uint8Array(program.length * 8);
  const view = new DataView(bytes.buffer);
  program.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return bytes;
}
