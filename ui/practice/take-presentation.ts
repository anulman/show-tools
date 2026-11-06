import type { CompiledSong, CompiledTake } from '../../lib/performance/compiled-song.js';
import type { ChannelId, PracticeState } from '../../lib/performance/model.js';

type DisplayState = Pick<PracticeState, 'channels'> & Pick<Partial<PracticeState>, 'compiledTakes'>;
type Point = CompiledTake['begin'];
type Selection = CompiledSong['selections'][number];

function count(point: Point, beats: number) { return (point.bar - 1) * beats + point.beat; }
function range(take: CompiledTake): string {
  if (!take.captureEnd) return String(take.begin.bar);
  const last = take.captureEnd.bar - Number(take.captureEnd.beat === 0);
  return last === take.begin.bar ? String(last) : `${take.begin.bar}–${last}`;
}
function period(take: CompiledTake, beats: number): string {
  if (!take.loopEnd) return 'Loop length unresolved';
  const counts = count(take.loopEnd, beats) - count(take.begin, beats);
  return counts % beats === 0 ? `${counts / beats}-bar loop` : `${counts}-count loop`;
}
function barViewCount(selections: readonly Selection[], beats: number): number {
  return new Set(selections.flatMap(selection => selection.window.kind === 'slice'
    && selection.window.loopCounts === beats && selection.window.beginCount % beats === 0
    ? [`${selection.takeIds.join(',')}:${selection.window.beginCount}`] : [])).size;
}
function plan(takes: readonly CompiledTake[], beats: number, selections: readonly Selection[]): string {
  if (!takes.length) return '';
  if (takes.every(take => take.retention === 'variant')) {
    const views = barViewCount(selections, beats);
    if (views) return `${takes.length} captures · bars ${takes.map(range).join(' + ')} · ${views} reusable bar views`;
    return `${takes.length} separate versions · ${takes.map(take => `bar ${range(take)} ${take.phrase}`).join(' · ')}`;
  }
  const first = takes[0];
  const second = takes[1];
  if (!first) return '';
  if (takes.some(take => take.retention !== 'layer' || take.groupId !== first.groupId || period(take, beats) !== period(first, beats))) {
    return `Capture bars ${takes.map(range).join(' · ')}`;
  }
  let text = takes.length === 1 ? `Record bars ${range(first)} · ${period(first, beats)}`
    : `Layer bars ${takes.map(range).join(' + ')} · ${period(first, beats)}`;
  if (takes.length === 2 && second && first.groupId === second.groupId && first.loopEnd && second.loopEnd
    && first.begin.beat === 0 && second.begin.beat === 0) {
    const bars = (count(first.loopEnd, beats) - count(first.begin, beats)) / beats;
    const secondBars = (count(second.loopEnd, beats) - count(second.begin, beats)) / beats;
    if (Number.isInteger(bars) && bars > 0 && bars <= 4 && bars === secondBars) {
      text += ` · ${Array.from({ length: bars }, (_, offset) => `${first.begin.bar + offset}+${second.begin.bar + offset}`).join(', ')}`;
    }
  }
  for (const [index, take] of takes.entries()) if (take.captureEnd && take.loopEnd) {
    const rest = count(take.loopEnd, beats) - count(take.captureEnd, beats);
    if (rest > 0) text += ` · Layer ${index + 1} ends at ${take.captureEnd.bar}:${take.captureEnd.beat + 1}; ${rest} counts rest`;
  }
  return text;
}

export function takePresentation(song: CompiledSong | undefined, channelId: ChannelId, state: DisplayState): { plan: string; summary: string | null } {
  const voice = song?.voices.find(voice => voice.buttonId === channelId);
  if (!song || !voice) return { plan: '', summary: null };
  const takes = song.takes.flatMap((take, index) => take.voiceId === voice.id ? [{ take, index }] : []);
  const descriptions = takes.map(({ take }) => take);
  const selections = song.selections.filter(selection => selection.voiceId === voice.id);
  const views = barViewCount(selections, song.chart.beatsPerBar);
  const annotation = plan(descriptions, song.chart.beatsPerBar, selections);
  const takeStates = state.compiledTakes;
  if (!takes.length || !takeStates) return { plan: annotation, summary: null };
  const readings = takes.map(({ index, take }) => ({ take, state: takeStates.find(reading => reading.index === index) }));
  if (readings.some(reading => !reading.state)) return { plan: annotation, summary: null };
  const saved = readings.filter(reading => reading.state?.ready).length;
  const variants = descriptions.every(take => take.retention === 'variant');
  const unit = variants ? views ? 'capture' : 'version' : 'layer';
  const savedLabel = `${saved} of ${takes.length} ${unit}${takes.length === 1 ? '' : 's'} saved`;
  const channel = state.channels.find(channel => channel.id === channelId);
  if (channel?.status === 'recording' || channel?.status === 'armed') {
    return { plan: annotation, summary: `${channel.status === 'recording' ? 'Recording' : 'Capture queued'} · ${savedLabel}` };
  }
  if (channel?.status === 'stopping') {
    return { plan: annotation, summary: `${channel.looping ? 'Stop queued' : 'Releasing'} · ${savedLabel}` };
  }
  const playing = readings.filter(reading => reading.state?.playback === 'playing');
  const releasing = readings.filter(reading => reading.state?.playback === 'releasing');
  let summary = savedLabel;
  if (variants && playing.length === 1) {
    const active = playing[0].take;
    const index = playing[0].state?.selectionIndex;
    const selection = index === null || index === undefined ? undefined : song.selections[index];
    if (views && selection?.voiceId === voice.id && selection.takeIds.includes(active.id)) {
      if (selection.window.kind === 'slice') {
        const begin = active.begin.beat + selection.window.beginCount;
        const bar = active.begin.bar + Math.floor(begin / song.chart.beatsPerBar);
        const beat = begin % song.chart.beatsPerBar;
        const phrase = active.phrase.split('|')[Math.floor(selection.window.beginCount / song.chart.beatsPerBar)] ?? '';
        const loop = selection.window.loopCounts;
        const length = loop % song.chart.beatsPerBar === 0 ? `${loop / song.chart.beatsPerBar}-bar loop` : `${loop}-count loop`;
        summary = `Playing bar ${bar}${beat ? `:${beat + 1}` : ''} · ${phrase} · ${length} · capture ${descriptions.indexOf(active) + 1}/${takes.length}`;
      } else summary = `Playing capture ${descriptions.indexOf(active) + 1}/${takes.length} · bars ${range(active)} · ${period(active, song.chart.beatsPerBar)}`;
    } else if (views) summary = '1 capture playing · view unavailable';
    else summary = `Playing version ${descriptions.indexOf(active) + 1}/${takes.length} · bar ${range(active)} · ${active.phrase}`;
  } else if (playing.length) {
    summary = `${playing.length} ${unit}${playing.length === 1 ? '' : 's'} playing`;
    const length = period(playing[0].take, song.chart.beatsPerBar);
    if (playing.every(reading => period(reading.take, song.chart.beatsPerBar) === length)) summary += ` · ${length}`;
  } else if (releasing.length) {
    summary = `Releasing · ${savedLabel}`;
  }
  if (playing.some(reading => {
    const index = reading.state?.selectionIndex;
    const selection = index === null || index === undefined ? undefined : song.selections[index];
    if (views && (!selection || selection.voiceId !== voice.id || !selection.takeIds.includes(reading.take.id))) return false;
    if (selection?.window.kind === 'slice') return selection.window.endCount - selection.window.beginCount < selection.window.loopCounts;
    return reading.state && reading.state.sourceEndFrames !== null;
  })) summary += ' · Trimmed';
  return { plan: annotation, summary };
}
