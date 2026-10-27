import { compileSong } from '../../compiled-song.js';

export async function compiledCaptureFixture() {
  const values = Array.from({ length: 24 }, () => Array<string>(6).fill(''));
  values[0][1] = 'Compiled capture fixture'; values[1][5] = '120'; values[3][2] = 'A';
  values[4] = ['Bar', '', '1', '2', '3', '4'];
  values[17][1] = 'rb'; values[17][2] = 'crb'; values[17][3] = 'cb'; values[17][4] = '4xe';
  values[9] = ['', '', '-', '-', "-'", "-'"];
  return compileSong({ sourceVersion: 1, spreadsheetId: 'abcdefghijklmnopqrstuv', sheetId: 101, sheetName: 'Fixture', range: 'A1:F24', values, notes: {} }, {
    mappingVersion: 1, notationVersion: 'dyc-v1', songId: 'fixture', spreadsheetId: 'abcdefghijklmnopqrstuv', sheetId: 101, sheetName: 'Fixture',
    titleCell: 'B1', bpmCell: 'F2', sectionRow: 4, barRow: 5, leadInColumn: 2, startBar: 1, endBar: 4,
    meter: { numerator: 4, denominator: 4 }, controls: [
      { buttonId: 'R1', voiceId: 'drums', cueRow: 18, arrangementRow: 10, nameNoteCell: 'A18' },
      { buttonId: 'R2', voiceId: 'cowbell', cueRow: 19, arrangementRow: 11, nameNoteCell: 'A19' },
      { buttonId: 'L1', voiceId: 'whistle', cueRow: 20, arrangementRow: 13, nameNoteCell: 'A20' },
      { buttonId: 'L2', voiceId: 'synth', cueRow: 21, arrangementRow: 12, nameNoteCell: 'A21' },
    ], cueWindow: { earlyBeats: .2, lateBeats: .2 }, capturePolicies: [{ voiceId: 'drums', retention: 'layer', gain: 1 }], variantRules: [], overrides: [], deferredRows: [],
  });
}
