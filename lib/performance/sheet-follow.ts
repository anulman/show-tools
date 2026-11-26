type Point = { bar: number; beat: number };
type SheetBar = { bar: number; text: string; a1: string };
type Window = { beginCount: number; endCount: number; loopCounts: number };
type Track = {
  kind: 'piano' | 'guitar';
  beat: number;
  beatsPerBar: number;
  bars: readonly SheetBar[];
  take: { begin: Point; end: Point };
  stop: Point;
  restarts?: readonly number[];
};
type Action = { at: Point; window: Window | null };
type Issue = { a1: string; message: string };

export function compileSheetFollow(track: Track): { events: Action[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const byBar = new Map(track.bars.map(bar => [bar.bar, bar]));
  function report(bar: number, message: string) {
    issues.push({ a1: byBar.get(bar)?.a1 ?? byBar.get(track.take.begin.bar)?.a1 ?? '', message });
  }
  function absolute({ bar, beat }: Point) { return (bar - 1) * track.beatsPerBar + beat; }
  function window(bar: number): Window {
    const beginCount = absolute({ bar, beat: track.beat }) - absolute(track.take.begin);
    return { beginCount, endCount: beginCount + track.beatsPerBar, loopCounts: track.beatsPerBar };
  }
  const { begin, end } = track.take;
  if (begin.beat !== track.beat || end.beat !== track.beat || begin.bar >= end.bar
    || absolute(track.stop) <= absolute(end) || !byBar.has(begin.bar) || !byBar.has(end.bar)) {
    report(begin.bar, 'Follow needs a captured source with matching bar seams and a later stop.');
    return { events: [], issues };
  }
  const events = track.kind === 'piano' ? piano(track, window, report) : guitar(track, window, report);
  if (events.length) events.push({ at: track.stop, window: null });
  return { events, issues };
}

function piano(track: Track, window: (bar: number) => Window, report: (bar: number, message: string) => void): Action[] {
  const pitches = new Map<number, { pitch: string; sampled: boolean }>();
  for (const { bar, text } of track.bars) {
    if (!text.trim() || bar < track.take.begin.bar || bar > track.stop.bar + 1) continue;
    const match = /^([A-G](?:#|b)?[0-9])('?)$/.exec(text.trim());
    if (!match) { report(bar, 'Use a written pitch such as A3 or sampled A3\'.'); continue; }
    pitches.set(bar, { pitch: match[1], sampled: match[2] !== '' });
  }
  function pair(bar: number) {
    const previous = pitches.get(bar)?.pitch;
    const next = pitches.get(bar + 1)?.pitch;
    return previous && next ? `${previous}→${next}` : null;
  }
  const sources = new Map<string, Window>();
  for (let bar = track.take.begin.bar; bar < track.take.end.bar; bar++) {
    const key = pair(bar);
    if (key && !sources.has(key)) sources.set(key, window(bar));
  }
  const events: Action[] = [];
  for (let bar = track.take.end.bar; bar < track.stop.bar + Number(track.beat < track.stop.beat); bar++) {
    if (!pitches.get(bar + 1)?.sampled) {
      if (events.at(-1)?.window) events.push({ at: { bar, beat: track.beat }, window: null });
      continue;
    }
    const key = pair(bar), view = key && sources.get(key);
    if (!view) { report(bar + 1, `No captured piano transition matches ${key ?? 'this sampled entrance'}.`); continue; }
    events.push({ at: { bar, beat: track.beat }, window: view });
  }
  return events;
}

type Pitch = string | null;
type Note = { beat: number; pitch: Pitch };
type GuitarBar = { carry: Pitch; notes: Note[]; repetition?: number };
type GuitarWindow = { bar: number; carry: Pitch; notes: Note[]; duration: number };
type GuitarSource = GuitarWindow & { repetition: number; window: Window };

function guitarBars(track: Track, report: (bar: number, message: string) => void): Map<number, GuitarBar> {
  const result = new Map<number, GuitarBar>();
  let carry: Pitch = null;
  for (const { bar, text } of track.bars) {
    if (bar < track.take.begin.bar || bar > track.stop.bar) continue;
    const marker = /\/([1-4])\//.exec(text);
    const plain = text.replace(/\/[1-4]\//g, '').trim();
    const notes: Note[] = [];
    const cell: GuitarBar = { carry, notes, ...(marker ? { repetition: Number(marker[1]) } : {}) };
    result.set(bar, cell);
    if (!plain) {
      if (carry !== null) notes.push({ beat: 0, pitch: null });
      carry = null;
      continue;
    }
    const tokens = /(?:\(([1-9])\)([e&a])|([1-9])([e&a])?)?(?:\(([A-G](?:#|b)?[0-9])\)|(\]))/g;
    let previousEnd = 0;
    let previousBeat = -1;
    const allowed = /^[-\s\[]*$/;
    for (const match of plain.matchAll(tokens)) {
      if (!allowed.test(plain.slice(previousEnd, match.index))) {
        report(bar, 'Unrecognized guitar notation before an event.');
        break;
      }
      previousEnd = match.index + match[0].length;
      const count = match[1] ?? match[3];
      const pitch = match[5] ?? null;
      if (!count) {
        if (pitch !== carry || pitch === null) report(bar, 'A carried guitar note must match the preceding pitch.');
        continue;
      }
      const subdivision = match[2] ?? match[4];
      const beat = Number(count) - 1 + (subdivision === 'e' ? .25 : subdivision === '&' ? .5 : subdivision === 'a' ? .75 : 0);
      if (beat >= track.beatsPerBar || beat <= previousBeat) report(bar, 'Guitar events must be written in ascending order within the bar.');
      carry = pitch;
      previousBeat = beat;
      notes.push({ beat, pitch });
    }
    if (!allowed.test(plain.slice(previousEnd))) report(bar, 'Unrecognized guitar notation after the final event.');
  }
  return result;
}

function guitar(track: Track, window: (bar: number) => Window, report: (bar: number, message: string) => void): Action[] {
  const rows = guitarBars(track, report);
  const empty: GuitarBar = { carry: null, notes: [] };
  function at(bar: number, duration = track.beatsPerBar): GuitarWindow {
    const row = rows.get(bar) ?? empty;
    const offsets = [
      ...row.notes.filter(note => note.beat >= track.beat).map(note => ({ ...note, beat: note.beat - track.beat })),
      ...(rows.get(bar + 1) ?? empty).notes.map(note => ({ ...note, beat: note.beat + track.beatsPerBar - track.beat })),
    ];
    const onset = row.notes.filter(note => note.beat < track.beat).at(-1);
    return { bar, carry: onset ? onset.pitch : row.carry, notes: offsets.filter(note => note.beat < duration), duration };
  }
  function matches(source: GuitarWindow, target: GuitarWindow) {
    if (source.carry !== target.carry) return false;
    const notes = source.notes.filter(note => note.beat < target.duration);
    return notes.length === target.notes.length && notes.every(({ pitch, beat }, index) => target.notes[index].pitch === pitch && target.notes[index].beat === beat);
  }
  const source: GuitarSource[] = [];
  const starts: number[] = [];
  let repetition = 0;
  for (let bar = track.take.begin.bar; bar < track.take.end.bar; bar++) {
    const marker = rows.get(bar)?.repetition;
    if (marker !== undefined) {
      if (marker !== starts.length + 1) report(bar, 'Number guitar source repetitions in ascending order from /1/.');
      repetition = marker;
      starts.push(source.length);
    }
    source.push({ ...at(bar), repetition, window: window(bar) });
  }
  if (starts.length !== 4 || starts[0] !== 0) {
    report(track.take.begin.bar, 'Mark four guitar source repetitions within the capture, starting at /1/.');
    return [];
  }
  const first = source[0].notes.find(note => note.pitch !== null);
  if (!first) { report(track.take.begin.bar, 'The first guitar repetition needs a written attack.'); return []; }
  const target: GuitarWindow[] = [];
  for (let bar = track.take.end.bar; bar < track.stop.bar + Number(track.beat < track.stop.beat); bar++) {
    const remaining = (track.stop.bar - bar) * track.beatsPerBar + track.stop.beat - track.beat;
    target.push(at(bar, Math.min(track.beatsPerBar, remaining)));
  }
  function restart(index: number) {
    const row = target[index];
    const attack = row.notes.find(note => note.pitch !== null);
    return row.carry === null && attack?.pitch === first?.pitch && attack?.beat === first?.beat;
  }
  function runLength(from: number, to: number) {
    let length = 0;
    const repetition = source[from].repetition;
    while (target[to + length] && (length === 0 || !restart(to + length)) && source[from + length]?.repetition === repetition
      && matches(source[from + length], target[to + length])) length++;
    return length;
  }
  function sustain(row: GuitarWindow) { return row.carry !== null && row.notes.length === 0; }
  const restarts = new Set(track.restarts);
  const held = source.at(-1);
  const events: Action[] = [];
  let previous = -1;
  let nextRegular = 1;
  for (const [index, row] of target.entries()) {
    const forced = restarts.has(row.bar);
    let chosen = -1;
    if (!forced && held && sustain(held) && sustain(row) && matches(held, row)) chosen = source.length - 1;
    else if (forced || restart(index)) {
      const lengths = starts.map(start => runLength(start, index));
      const regular = forced ? 0 : nextRegular - 1;
      const winner = forced ? 0 : lengths[3] > Math.max(...lengths.slice(0, 3)) ? 3 : regular;
      if (lengths[winner] > 0) {
        chosen = starts[winner];
        if (winner !== 3) nextRegular = winner === 1 ? 3 : 2;
      }
    } else if (previous >= 0 && source[previous + 1]?.repetition === source[previous].repetition
      && matches(source[previous + 1], row)) chosen = previous + 1;
    if (chosen < 0 && !forced) {
      let bestLength = 0;
      for (const [sourceIndex] of source.entries()) {
        const length = runLength(sourceIndex, index);
        if (length > bestLength) { bestLength = length; chosen = sourceIndex; }
      }
    }
    if (chosen < 0) {
      report(row.bar, forced ? 'This restart does not match the /1/ source entrance.' : 'No captured guitar window matches these attacks and carried pitch.');
      continue;
    }
    events.push({ at: { bar: row.bar, beat: track.beat }, window: source[chosen].window });
    previous = chosen;
  }
  return events;
}
