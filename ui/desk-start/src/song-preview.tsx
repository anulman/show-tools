import { notFound } from '@tanstack/react-router';
import { useContext, useState } from 'react';
import type { SongScript } from '../../../lib/performance/model.js';
import type { SongSource } from '../../../lib/performance/song-source.js';
import { SET_SONGS, songForRoute } from '../../../songs/routes.js';
import type { AudioMode } from '../../practice/audio-mode.js';
import type { DeskRouterContext } from './router';
import { DeskState } from './desk-state';

export async function loadDeskRoute(slug: string, mode: AudioMode, context: DeskRouterContext, signal: AbortSignal) {
  const entry = songForRoute(slug);
  if (!entry) throw notFound();
  if (entry.previewOnly) {
    const { loadSongPreview } = await import('../../../songs/index.js');
    const { song: { chart, source }, archive } = await loadSongPreview(entry.id);
    return { kind: 'draft', entry, chart, source, archive } as const;
  }
  if (mode === 'browser') {
    const { loadSong } = await import('../../../songs/index.js');
    await loadSong(entry.id);
    return { kind: 'song', entry, preview: undefined } as const;
  }
  const preview = context.runtime.installedIds?.includes(entry.id)
    ? await context.runtime.current?.previewSong(entry.id, signal) : undefined;
  return { kind: 'song', entry, preview } as const;
}

type RouteData = Awaited<ReturnType<typeof loadDeskRoute>>;

export function ChartPreview({
  chart, source, archive,
}: Pick<SongScript, 'chart' | 'source'> & { archive: SongSource | null }) {
  const [currentSection, setCurrentSection] = useState(chart.sections[0]?.id);
  const section = chart.sections.find(item => item.id === currentSection);
  const header = archive?.values.find(row => row[0] === 'Bar') ?? [];
  const columns: { index: number; label: string | number; charted: boolean }[] = [];
  if (section) {
    const first = section.startBar === 1 ? 1 : chart.bars[section.startBar - 1].column - 1;
    const sectionEnd = chart.bars[section.endBar - 1].column;
    const end = section.endBar === chart.bars.length ? Math.max(header.length, sectionEnd) : sectionEnd;
    const bars = chart.bars.slice(section.startBar - 1, section.endBar);
    const charted = new Map(bars.map(bar => [bar.column - 1, bar.label ?? bar.bar]));
    for (let index = first; index < end; index++) {
      const barLabel = charted.get(index);
      const label = barLabel ?? header[index];
      if (label) columns.push({ index, label, charted: barLabel !== undefined });
    }
  }
  const rows = source?.values.flatMap((cells, index) => cells[0] ? [{ id: index, label: cells[0], cells }] : []);
  return (
    <section aria-label="Chart preview">
      <h1>{chart.title}</h1>
      <p role="status">Chart preview · Audio and performance cues are unavailable while this chart is in progress.</p>
      <p>{chart.bpm} BPM · {chart.bars.length} charted bars</p>
      <label className="field">
        <span>Section</span>
        <select value={currentSection} onChange={event => setCurrentSection(event.target.value)}>
          {chart.sections.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      {section && <div className="chart-preview-scroll" tabIndex={0} role="region" aria-label={section.label + ' arrangement'}>
        <table className="chart-preview-table">
          <thead><tr><th scope="col">Part</th>{columns.map(column => <th scope="col" key={column.index}>{column.label}</th>)}</tr></thead>
          <tbody>{rows?.map(row => <tr key={row.id}>
            <th scope="row">{row.label}</th>
            {columns.map(column => <td key={column.index}>{column.charted ? row.cells[column.index] : archive?.values[row.id]?.[column.index]}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  );
}

export function SongPreview({ data }: { data: Extract<RouteData, { kind: 'song' }> }) {
  const { active, runtime } = useContext(DeskState);
  const [failure, setFailure] = useState('');
  const [selecting, setSelecting] = useState(false);
  if (!active || active.id === data.entry.id) return null;
  const available = active.installedIds?.includes(data.entry.id);
  const chart = data.preview?.song.chart;
  const effects = data.preview?.defaultVoiceEffects.flatMap(voice => voice.effects.map(effect => effect.kind));
  async function select() {
    if (!runtime || selecting) return;
    setFailure('');
    setSelecting(true);
    try { await runtime.selectSong(data.entry.id); }
    catch (error) { setFailure(error instanceof Error ? error.message : 'Could not change songs.'); }
    finally { setSelecting(false); }
  }
  return (
    <section className="utility" aria-label="Song preview">
      <div>
        <h1>{data.entry.title}</h1>
        <p role="status">On the Desk now: {SET_SONGS.find(song => song.id === active.id)?.title ?? active.id}.</p>
        {chart && <p>{chart.bars.length} charted bars{effects?.length ? ` · Effects: ${[...new Set(effects)].join(', ')}` : ''}</p>}
        {!available && <p>This song is unavailable on the hardware Desk.</p>}
        {available && <button type="button" className="primary" disabled={!runtime || selecting} onClick={() => void select()}>Select on Desk</button>}
        {failure && <p role="alert">{failure}</p>}
      </div>
    </section>
  );
}
