/** Versioned Sheets ingestion syntax. Musical execution belongs to C++. */
export type CueOperation = 'cr' | 'cx' | 'ru' | 'r' | 'c' | 'x' | 'pp' | 'po' | 'p' | 'g' | 'h';
export type CueExecution = { kind: 'now' } | { kind: 'next-bar' } | { kind: 'beat'; beat: number; barOffset: 0 | 1 };
export interface SheetCue {
  group?: number;
  operation: CueOperation;
  pressBeat: number | null;
  sourceName: string | null;
  execution: CueExecution;
  padToBarEnd?: true;
  playbackPhrases?: { first: number; last: number };
  repeatBars?: { first: number; last: number; overlapFinalEighth?: true };
}
export type CueParse = { kind: 'parsed'; actions: SheetCue[] } | { kind: 'invalid'; token: string; message: string };
const fractions: Readonly<Record<string, number>> = { e: .25, '&': .5, a: .75 };
function position(text: string, anchor: number, beats: number): number | null {
  const match = /^([1-9]\d*)?([e&a])?$/.exec(text);
  if (!match || !text) return null;
  const beat = match[1] ? Number(match[1]) - 1 : anchor;
  const value = beat + (fractions[match[2]] ?? 0);
  return value >= 0 && value < beats ? value : null;
}
function operation(text: string): CueOperation | null {
  switch (text) {
    case 'cr': case 'cx': case 'ru': case 'r': case 'c': case 'x': case 'pp': case 'po': case 'p': case 'g': case 'h': return text;
    default: return null;
  }
}
/** Anchors are cell-local; only a numeric prefix/anchor changes the inherited count. */
export function parseSheetCues(text: string, beatsPerBar = 4): CueParse {
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 1) return { kind: 'invalid', token: text, message: 'Invalid measure count.' };
  let anchor = 0;
  const actions: SheetCue[] = [];
  let group = 0;
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const tokens: string[] = word.match(/(?:[^+()]|\([^()]*\))+/g) ?? [];
    if (tokens.join('+') !== word) return { kind: 'invalid', token: word, message: 'A group needs an action on each side of +.' };
    let sharedPress: number | null = null;
    const grouped = tokens.length > 1 || /x\([^()]*\+/.test(word);
    if (grouped) group++;
    for (const [tokenIndex, token] of tokens.entries()) {
      const match = /^(?:\(([1-9]\d*)\))?([1-9]\d*(?:[e&a])?|[e&a])?(cr|cx|ru|r|c|x|pp|po|p|g|h)(?:\(([A-Za-z][A-Za-z0-9_-]*(?:\+[A-Za-z][A-Za-z0-9_-]*)*)\))?(b|[1-9]\d*(?:[e&a])?|[e&a])?(?:~(?:(b)|([1-9]\d*)(?:\.\.([1-9]\d*)(\^&)?)?))?$/.exec(token);
      if (!match) return { kind: 'invalid', token, message: 'Expected [press] operation [(source)] [execution], separated by whitespace.' };
      if (match[1] && match[2] && /^\d/.test(match[2])) return { kind: 'invalid', token, message: 'Use one numeric press anchor.' };
      if (match[1]) anchor = Number(match[1]) - 1;
      if (anchor < 0 || anchor >= beatsPerBar) return { kind: 'invalid', token, message: 'Anchor is outside this measure.' };
      const prefix = match[2] ?? (match[1] ? match[1] : '');
      const pressBeat: number | null = prefix ? position(prefix, anchor, beatsPerBar) : sharedPress;
      if (tokenIndex === 0) sharedPress = pressBeat;
      else if (pressBeat !== sharedPress) return { kind: 'invalid', token, message: 'Grouped actions share one press position.' };
      if (prefix && pressBeat === null) return { kind: 'invalid', token, message: 'Press is outside this measure.' };
      if (match[2] && /^\d/.test(match[2])) anchor = Math.floor(pressBeat ?? 0);
      const op = operation(match[3]);
      if (op === null) return { kind: 'invalid', token, message: 'Unknown operation.' };
      let execution: CueExecution = { kind: 'now' };
      if (match[5] === 'b') execution = { kind: 'next-bar' };
      else if (match[5]) {
        const beat = position(match[5], Math.floor(pressBeat ?? anchor), beatsPerBar);
        if (beat === null) return { kind: 'invalid', token, message: 'Execution is outside this measure.' };
        execution = { kind: 'beat', beat, barOffset: pressBeat !== null && beat < pressBeat ? 1 : 0 };
      }
      const padToBarEnd = match[6] === 'b';
      if (padToBarEnd && ((op !== 'c' && op !== 'cx') || execution.kind !== 'beat' || execution.beat === 0))
        return { kind: 'invalid', token, message: 'Use ~b after a commit beat inside the bar, for example cx4~b.' };
      const range = match[7] ? { first: Number(match[7]), last: Number(match[8] ?? match[7]) } : undefined;
      if (range && (!Number.isSafeInteger(range.last) || range.first > range.last))
        return { kind: 'invalid', token, message: 'Use an ascending range of positive integers.' };
      const playbackPhrases = op === 'p' && !match[9] ? range : undefined;
      const repeatBars: SheetCue['repeatBars'] = range && (op === 'c' || op === 'cx') && match[8]
        ? { ...range, ...(match[9] ? { overlapFinalEighth: true } : {}) } : undefined;
      if (range && !playbackPhrases && !repeatBars)
        return { kind: 'invalid', token, message: 'Use a recorded-bar range on c or cx, or a phrase selection on p, for example p~2.' };
      const names = match[4]?.split('+') ?? [null];
      if (op === 'po' && (grouped || execution.kind !== 'beat' || execution.barOffset !== 0 || execution.beat !== pressBeat))
        return { kind: 'invalid', token, message: 'Use one press and launch on the same written beat, for example 1po(ahoh)1.' };
      if (op === 'pp') {
        if (pressBeat === null || execution.kind !== 'now' || grouped || names.length !== 2 || names[0] === names[1])
          return { kind: 'invalid', token, message: 'Use a count and two distinct names, for example 4pp(drunk+girls).' };
        actions.push({ operation: op, pressBeat, sourceName: names.join('+'), execution });
        continue;
      }
      if (op === 'ru' && (pressBeat === null || execution.kind !== 'now' || names.length !== 1 || names[0] === null))
        return { kind: 'invalid', token, message: 'Use a release count and one name, for example 4ru(drunk).' };
      if (names.length > 1 && op !== 'x') return { kind: 'invalid', token, message: 'A source list is supported only for stop.' };
      for (const sourceName of names) actions.push({ operation: op, pressBeat, sourceName, execution, ...(padToBarEnd ? { padToBarEnd: true } : {}), ...(repeatBars ? { repeatBars } : {}), ...(playbackPhrases ? { playbackPhrases } : {}), ...(grouped ? { group } : {}) });
    }
  }
  return { kind: 'parsed', actions };
}

/** One counted take, with an optional reference placed before it in the same lead-in cell. */
export function parsePreflightCue(text: string, beatsPerBar = 4) {
  const match = /^(?:ref\(([A-Ga-g])([#b]?)(-?[0-9])\)\s+)?pre\(([A-Za-z][A-Za-z0-9_-]*)\)([1-9]\d*[e&a]?)~([1-4])b$/.exec(text.trim());
  if (!match) return null;
  const beat = position(match[5], 0, beatsPerBar);
  if (beat === null || beat < beatsPerBar - 1) return null;
  let referenceMidi: number | null = null;
  if (match[1]) {
    const natural = [0, 2, 4, 5, 7, 9, 11]['CDEFGAB'.indexOf(match[1].toUpperCase())];
    referenceMidi = (Number(match[3]) + 1) * 12 + natural + (match[2] === '#' ? 1 : match[2] === 'b' ? -1 : 0);
    if (referenceMidi < 0 || referenceMidi > 115) return null;
  }
  return { referenceMidi, sourceName: match[4], beat, bars: Number(match[6]) };
}
