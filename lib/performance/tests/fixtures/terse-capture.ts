import { compileSheetsSong, type SongMapping } from '../../compiled-song.js';
import type { SongSource } from '../../song-source.js';

export function terseCaptureInput() {
  const values = Array.from({ length: 24 }, () => Array<string>(12).fill(''));
  values[0][1] = 'Terse native fixture'; values[1][5] = '120'; values[3][2] = 'A';
  values[4] = ['Bar', '', ...Array.from({ length: 10 }, (_, index) => String(index + 1))];
  values[9][0] = 'AF - Words'; values[10][0] = 'AF - Dry stop'; values[11][0] = 'AF - Guitar'; values[12][0] = 'AF - Gated live';
  values[17][2] = '(3)&r4 (4)&cr1'; values[17][3] = '&cx2';
  values[17][4] = '1p 2p 3p 4p'; values[17][9] = '1h';
  values[18][4] = '1x';
  values[19][5] = '1r(strum)'; values[19][6] = '1cx(strum)';
  values[19][7] = '1r(pick)'; values[19][8] = '1c(pick)+p(strum)';
  values[19][10] = '1x(strum+words)';
  values[20][9] = '1g(strum)'; values[20][10] = '1x';
  const source: SongSource = { sourceVersion: 1, spreadsheetId: 'tersefixtureabcdefghijklmnop', sheetId: 101,
    sheetName: 'Terse fixture', range: 'A1:L24', values,
    notes: { A18: 'Words', A19: 'Dry stop', A20: 'Guitar', A21: 'Gated live' } };
  const mapping: SongMapping = { mappingVersion: 6, notationVersion: 'terse-v2', songId: 'terse-fixture',
    spreadsheetId: source.spreadsheetId, sheetId: source.sheetId, sheetName: source.sheetName,
    titleCell: 'B1', bpmCell: 'F2', sectionRow: 4, barRow: 5, leadInColumn: 2, startBar: 1, endBar: 10,
    meter: { numerator: 4, denominator: 4 }, liveParts: [],
    controls: [
      { buttonId: 'R1', voiceId: 'words', cueRow: 18, arrangementRow: 10, nameNoteCell: 'A18', playbackMode: 'one-shot' },
      { buttonId: 'R2', voiceId: 'dry', cueRow: 19, arrangementRow: 11, nameNoteCell: 'A19', playbackMode: 'loop' },
      { buttonId: 'L1', voiceId: 'guitar', cueRow: 20, arrangementRow: 12, nameNoteCell: 'A20', playbackMode: 'loop' },
      { buttonId: 'L2', voiceId: 'gate', cueRow: 21, arrangementRow: 13, nameNoteCell: 'A21', playbackMode: 'loop' },
    ], sourceBindings: [
      { buttonId: 'R1', sourceName: 'words', playbackMode: 'one-shot', default: true, sustain: { beginCount: 0, endCount: .5, loopCounts: .5 } },
      { buttonId: 'L1', sourceName: 'strum', playbackMode: 'loop', captureReplacement: true, default: true, sustain: { beginCount: .25, endCount: .75, loopCounts: .5 } },
      { buttonId: 'L1', sourceName: 'pick', playbackMode: 'loop', captureReplacement: true },
    ], cueWindow: { earlyMs: 25, lateMs: 25, ties: 'reject' },
    capturePolicies: [{ voiceId: 'words', retention: 'variant', gain: 1 }, { voiceId: 'guitar', retention: 'replace', gain: 1 }],
    layerGroups: [], variantRules: [], variantReuses: [], overrides: [], deferredRows: [],
  };
  return { source, mapping };
}
export async function terseCaptureFixture() {
  const { source, mapping } = terseCaptureInput();
  return compileSheetsSong(source, mapping);
}
