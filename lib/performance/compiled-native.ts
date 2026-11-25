import { CONTROL_IDS, INPUT_PACKET_MAGIC, inputBindingRows } from './model.js';
import { decodeCompiledSong } from './compiled-song.js';
import type { CompiledSong } from './compiled-song.js';
import { PF } from './wasm-abi.js';

export function encodeCompiledProgram(input: unknown): Float64Array {
  return encodeProgram(decodeCompiledSong(input));
}

function encodeProgram(song: CompiledSong): Float64Array {
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
  const groups = new Map([...new Set(song.cues.flatMap(cue => cue.groupId === null ? [] : [cue.groupId]))].map((id, index) => [id, index]));
  const members = song.selections.flatMap((selection, index) => selection.takeIds.flatMap((id, member) => [index, indexOf(takes, id), selection.gains[member]]));
  let inactive = song.voices.length;
  const binding = CONTROL_IDS.map(button => {
    const voice = song.voices.find(voice => voice.buttonId === button);
    if (!voice) return inactive++;
    return indexOf(voices, voice.id);
  });
  const kinds: Record<CompiledSong['cues'][number]['kind'], number> = { arm: PF.ARM, commit: PF.COMMIT, 'commit-arm': PF.COMMIT_ARM, stop: PF.STOP, play: PF.PLAY };
  const profileRows = song.takes.flatMap((take, index) => take.profile === undefined || take.profile === indexOf(voices, take.voiceId) ? [] : [index, take.profile]);
  const profiles = profileRows.length ? [PF.COMPILED_PROFILES_MAGIC, profileRows.length / PF.COMPILED_PROFILES_FIELDS, ...profileRows] : [];
  const legacy = song.inputBindings === undefined && !song.releaseCapturePairs?.length && !song.playbackPairs?.length && !profileRows.length && song.notationVersion === 'dyc-v1' && !song.externalSamples?.length && !song.noteBanks?.length && song.cues.every(cue =>
    !cue.captureReplacement && cue.launchPolicy === 'autoplay' && cue.playbackMode === 'loop' && cue.groupId === null && cue.sourceName === null
    && (cue.execution.kind !== 'beat' || !cue.execution.barOffset));
  const cueFields = legacy ? PF.COMPILED_LEGACY_CUE_FIELDS : PF.COMPILED_CUE_FIELDS;
  const header = [PF.COMPILED_MAGIC, legacy ? PF.COMPILED_LEGACY_VERSION : PF.COMPILED_VERSION, song.meter.numerator, song.chart.bars.length,
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
    optionalIndex(takes, cue.commitTakeId), optionalIndex(selections, cue.selectionId), cue.tempoBeatHint,
    ...(legacy ? [] : [cue.launchPolicy === 'store' ? 1 : 0, { loop: 0, 'one-shot': 1, held: 2, gated: 3 }[cue.playbackMode],
      cue.execution.kind === 'beat' ? cue.execution.barOffset ?? 0 : 0, optionalIndex(groups, cue.groupId), cue.captureReplacement ? 1 : 0])]);
  const playback = song.playback.flatMap(cue => [cue.bar, indexOf(voices, cue.voiceId), indexOf(selections, cue.selectionId)]);
  const rotation = song.rotation ? [PF.COMPILED_ROTATION_MAGIC, song.rotation.windows.length, song.rotation.inactivityBeats,
    ...song.rotation.windows.flatMap(window => [window.begin.bar, window.begin.beat, window.end.bar, window.end.beat])] : [];
  const windowRows = song.selections.flatMap((selection, index) => {
    if (selection.window.kind === 'full' || selection.window.kind === 'sustain' || selection.window.kind === 'intro-loop') return [];
    if (selection.window.kind === 'slice') return [index, selection.window.beginCount, selection.window.endCount, selection.window.loopCounts];
    const take = song.takes.find(take => take.id === selection.takeIds[0]);
    if (!take?.loopEnd) throw new Error('Missing prefix capture period.');
    const counts = (take.loopEnd.bar - take.begin.bar) * song.meter.numerator + take.loopEnd.beat - take.begin.beat;
    return [index, 0, selection.window.endCount, counts];
  });
  const windows = windowRows.length ? [PF.COMPILED_WINDOW_MAGIC, windowRows.length / PF.COMPILED_WINDOW_FIELDS, ...windowRows] : [];
  const introLoopRows = song.selections.flatMap((selection, index) => selection.window.kind === 'intro-loop'
    ? [index, selection.window.repeatBeginCount, selection.window.endCount] : []);
  const introLoops = introLoopRows.length
    ? [PF.COMPILED_INTRO_LOOP_MAGIC, introLoopRows.length / PF.COMPILED_INTRO_LOOP_FIELDS, ...introLoopRows] : [];
  const external = song.externalSamples?.length ? [PF.COMPILED_EXTERNAL_MAGIC, song.externalSamples.length,
    ...song.externalSamples.flatMap(sample => [sample.slot, sample.begin.bar, sample.begin.beat, sample.end.bar, sample.end.beat])] : [];
  const notes = song.noteBanks?.length ? [PF.COMPILED_NOTES_MAGIC, song.noteBanks.reduce((count, bank) => count + bank.notes.length, 0),
    ...song.noteBanks.flatMap(bank => bank.notes.flatMap(note => [CONTROL_IDS.indexOf(bank.buttonId), note.slot, note.at.bar, note.at.beat, bank.toleranceMs]))] : [];
  const sustains = song.selections.flatMap((selection, index) => selection.window.kind === 'sustain' ? [index] : []);
  const autoSustains = sustains.length ? [PF.COMPILED_SUSTAIN_MAGIC, sustains.length, ...sustains] : [];
  const inputRows = inputBindingRows(song.inputBindings ?? []);
  const inputs = song.inputBindings === undefined ? [] : [INPUT_PACKET_MAGIC, inputRows.length, ...inputRows.flat()];
  const edges = song.releaseCapturePairs?.length || song.playbackPairs?.length ? [PF.COMPILED_EDGE_MAGIC,
    song.releaseCapturePairs?.length ?? 0, song.playbackPairs?.length ?? 0,
    ...(song.releaseCapturePairs ?? []).flatMap(pair => [indexOf(takes, pair.firstTakeId), indexOf(takes, pair.secondTakeId)]),
    ...(song.playbackPairs ?? []).flatMap(pair => [CONTROL_IDS.indexOf(pair.buttonId), pair.first.bar, pair.first.beat, indexOf(selections, pair.firstSelectionId), indexOf(selections, pair.secondSelectionId)]),
  ] : [];
  const fields = [...header, ...takeRows, ...cueRows, ...members, ...playback, ...rotation, ...windows, ...introLoops, ...external, ...notes, ...profiles, ...autoSustains, ...edges, ...inputs];
  if (header.length !== PF.COMPILED_HEADER_FIELDS || takeRows.length !== song.takes.length * PF.COMPILED_TAKE_FIELDS
    || cueRows.length !== song.cues.length * cueFields || fields.some(value => !Number.isFinite(value))) throw new Error('Invalid compiled native program layout.');
  if (song.meter.denominator !== (song.meter.numerator === 6 ? 8 : 4)) throw new Error('This native build supports 4/4 and 6/8 compiled programs.');
  return Float64Array.from(fields);
}

function programBytes(program: Float64Array): Uint8Array {
  const bytes = new Uint8Array(program.length * 8);
  const view = new DataView(bytes.buffer);
  program.forEach((value, index) => view.setFloat64(index * 8, value, true));
  return bytes;
}

export function decodeCompiledProgram(input: unknown):
  | { kind: 'blocked'; song: CompiledSong }
  | { kind: 'encoded'; song: CompiledSong; bytes: Uint8Array } {
  const song = decodeCompiledSong(input);
  if (!song.executable) return { kind: 'blocked', song };
  return { kind: 'encoded', song, bytes: programBytes(encodeProgram(song)) };
}

export function compiledProgramBytes(input: unknown): Uint8Array {
  return programBytes(encodeCompiledProgram(input));
}
