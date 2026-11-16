import type { SongMapping } from '../../lib/performance/compiled-song.js';
import type { SongSource } from '../../lib/performance/song-source.js';
import type { CatalogDocument } from '../../lib/voice-catalog/model.js';
import type { InputBinding, InputBindings } from '../../lib/performance/input-bindings.js';
import type { ChannelId, PhysicalSwitchId } from '../../lib/performance/model.js';

export const bindingGrammar = {
  controls: ['blue', 'yellow', 'red', 'green', 'pedal', 'mushroom'] satisfies PhysicalSwitchId[],
  rows: ['L1', 'L2', 'R1', 'R2'] satisfies ChannelId[],
  maximumBindings: 2,
};
function bindingTargets(): InputBinding['target'][] {
  const targets: InputBinding['target'][] = [{ kind: 'tempo' }, { kind: 'panic' }];
  for (let mask = 1; mask < 16; mask++) {
    let rows: [ChannelId, ...ChannelId[]] | undefined;
    for (const [index, row] of bindingGrammar.rows.entries()) if (mask & 1 << index) {
      if (rows) rows.push(row); else rows = [row];
    }
    if (!rows) throw new Error('Nonzero binding mask requires a row');
    targets.push({ kind: 'cue-rows', rows });
  }
  return targets;
}
function sharedRows(left: InputBinding['target'], right: InputBinding['target']): boolean {
  return left.kind === 'cue-rows' && right.kind === 'cue-rows' && left.rows.some(row => right.rows.includes(row));
}
export function* bindingCases(): Generator<{ id: string; bindings: InputBindings | undefined; valid: boolean }> {
  yield { id: 'absent', bindings: undefined, valid: true };
  yield { id: 'empty', bindings: [], valid: true };
  const targets = bindingTargets();
  for (const [index, controlId] of bindingGrammar.controls.entries()) for (const target of targets) {
    const bindings = [{ controlId, target }];
    yield { id: JSON.stringify(bindings), bindings, valid: true };
    for (let second = index; second < bindingGrammar.controls.length; second++) for (const other of targets) {
      const pair = [...bindings, { controlId: bindingGrammar.controls[second], target: other }];
      yield { id: JSON.stringify(pair), bindings: pair, valid: second !== index && !sharedRows(target, other) };
    }
  }
}

export const grammar = {
  meters: [{ numerator: 4, denominator: 4 }, { numerator: 6, denominator: 8 }],
  barCounts: [1, 2, 3],
  referenceCells: ['', '1', "(4)&a'"],
  texts: ['plain', 'escaped'],
  liveVocals: [false, true],
  commands: ['x', '2x&'],
  voices: ['absent', 'slapback', 'chorus'] satisfies ('absent' | 'slapback' | 'chorus')[],
  archives: ['neither', 'source', 'mapping', 'both'] satisfies ('neither' | 'source' | 'mapping' | 'both')[],
};
export interface ScoreCase {
  id: string;
  meter: { numerator: number; denominator: number };
  cells: string[];
  text: string;
  liveVocals: boolean;
  command: string;
}

function* words(length: number, prefix: string[] = []): Generator<string[]> {
  if (prefix.length === length) { yield prefix; return; }
  for (const token of grammar.referenceCells) yield* words(length, [...prefix, token]);
}

export function* scoreCases(): Generator<ScoreCase> {
  for (const meter of grammar.meters) for (const count of grammar.barCounts) for (const cells of words(count))
    for (const text of grammar.texts) for (const liveVocals of grammar.liveVocals) for (const command of grammar.commands) {
      const fields = [meter.numerator, meter.denominator, cells, text, liveVocals, command];
      yield { id: JSON.stringify(fields), meter, cells, text, liveVocals, command };
    }
}

export function scoreInput(example: ScoreCase): { source: SongSource; mapping: SongMapping } {
  const values = Array.from({ length: 21 }, () => Array<string>(6).fill(''));
  values[0][1] = example.text === 'plain' ? 'Verification' : 'Vox <&> "🎵"\r\n';
  values[1][5] = '98'; values[3][2] = 'A';
  for (const [index, cell] of example.cells.entries()) {
    values[4][index + 2] = String(index + 1);
    values[13][index + 2] = cell;
    if (example.liveVocals) values[7][index + 2] = example.text === 'plain' ? 'la' : 'a & e <🎵>';
  }
  if (example.liveVocals) values[7][0] = 'AF - Vocals';
  for (let index = 0; index < 4; index++) values[9 + index][0] = 'AF - Pad ' + index;
  values[13][0] = 'Bass'; values[17][2] = example.command;
  const source: SongSource = { sourceVersion: 1, spreadsheetId: 'verificationabcdefghijklmnop', sheetId: 101,
    sheetName: 'Verification', range: 'A1:F21', values,
    notes: { A18: 'Pad 0', A19: 'Pad 1', A20: 'Pad 2', A21: 'Pad 3' } };
  const mapping: SongMapping = { mappingVersion: 6, notationVersion: 'dyc-v1', songId: 'verification',
    spreadsheetId: source.spreadsheetId, sheetId: source.sheetId, sheetName: source.sheetName,
    titleCell: 'B1', bpmCell: 'F2', sectionRow: 4, barRow: 5, leadInColumn: 2, startBar: 1,
    endBar: example.cells.length, meter: example.meter,
    controls: [
      { buttonId: 'R1', voiceId: 'pad0', cueRow: 18, arrangementRow: 10, nameNoteCell: 'A18' },
      { buttonId: 'R2', voiceId: 'pad1', cueRow: 19, arrangementRow: 11, nameNoteCell: 'A19' },
      { buttonId: 'L1', voiceId: 'pad2', cueRow: 20, arrangementRow: 12, nameNoteCell: 'A20' },
      { buttonId: 'L2', voiceId: 'pad3', cueRow: 21, arrangementRow: 13, nameNoteCell: 'A21' },
    ], liveParts: example.liveVocals ? [{ id: 'live', labelCell: 'A8', role: 'default-live' }] : [],
    cueWindow: { earlyMs: 25, lateMs: 12.5, ties: 'reject' }, capturePolicies: [], layerGroups: [],
    variantRules: [], variantReuses: [], overrides: [], deferredRows: [],
  };
  return { source, mapping };
}

export function voiceCatalog(variant: typeof grammar.voices[number]): CatalogDocument | undefined {
  if (variant === 'absent') return undefined;
  return { version: 2, revision: 0, voices: [{ id: 'pad0', name: 'Pad 0', notes: 'Voice <&> 🎵',
    characterId: variant === 'slapback' ? 'A07' : 'A02', avatarToken: 'amber', effects: variant === 'slapback'
      ? [{ kind: 'slapback', delayMs: 100, feedback: .2, wet: .4 }]
      : [{ kind: 'chorus', rateHz: 1, depthMs: 3, baseDelayMs: 20, wet: .2 }] }],
    bindings: [{ spreadsheetId: 'verificationabcdefghijklmnop', sheetId: 101, labelCell: 'A10',
      sourceLabel: 'AF - Pad 0', voiceId: 'pad0', cueRow: { labelCell: 'A18', sourceLabel: 'R1' } }] };
}
