import type { CaptureHint, ChannelId, Chart, ChartControls, CueAction } from './model.js';

export function parseControlCue(notation: string): CueAction {
  const cue = notation.trim();
  if (!cue) return { kind: 'none' };
  const match = /^(cr|r|c|x|p)(b)?$/.exec(cue);
  if (!match) {
    const phrase = cue.replace(/[\[\]'\s]/g, '');
    if (!phrase || !/^[1-4e&a]+$/.test(phrase)) return { kind: 'unsupported', notation };
    let beat: number | null = cue.includes(']') ? 4 : null;
    const beats: number[] = [];
    for (const symbol of phrase) {
      if (/^[1-4]$/.test(symbol)) { beat = Number(symbol); beats.push(beat - 1); }
      else {
        if (beat === null) return { kind: 'unsupported', notation };
        const fraction = symbol === 'e' ? 0.25 : symbol === '&' ? 0.5 : 0.75;
        beats.push(beat - 1 + fraction);
      }
    }
    return { kind: 'tap', notation, beats };
  }
  const timing = match[2] ? 'bar' : 'now';
  switch (match[1]) {
    case 'r': return { kind: 'arm', timing };
    case 'c': return { kind: 'commit', timing };
    case 'cr': return { kind: 'commit-arm', timing };
    case 'x': return { kind: 'stop', timing };
    case 'p': return { kind: 'play', timing };
    default: return { kind: 'unsupported', notation };
  }
}

export interface CaptureAssignment { id: ChannelId; bar: number | 'lead-in'; capture: CaptureHint }

export function compileChartControls(chart: Chart, captures: CaptureAssignment[] = []): ChartControls {
  const cue = (id: ChannelId, notation: string, bar: number | 'lead-in'): CueAction => {
    const action = parseControlCue(notation);
    const capture = captures.find(assignment => assignment.id === id && assignment.bar === bar)?.capture;
    return capture && (action.kind === 'arm' || action.kind === 'commit-arm') ? { ...action, capture } : action;
  };
  const row = (cues: Record<ChannelId, string>, bar: number | 'lead-in'): Record<ChannelId, CueAction> => ({
    L1: cue('L1', cues.L1, bar), L2: cue('L2', cues.L2, bar), R1: cue('R1', cues.R1, bar), R2: cue('R2', cues.R2, bar),
  });
  return { leadIn: row(chart.leadInCues, 'lead-in'), bars: chart.bars.map(bar => row(bar.cues, bar.bar)) };
}
