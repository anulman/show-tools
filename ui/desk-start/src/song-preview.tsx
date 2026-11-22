import { notFound } from '@tanstack/react-router';
import { useContext, useState } from 'react';
import { SET_SONGS, songForRoute } from '../../../songs/routes.js';
import type { AudioMode } from '../../practice/audio-mode.js';
import type { DeskRouterContext } from './router';
import { DeskState } from './desk-state';

export async function loadDeskRoute(slug: string, mode: AudioMode, context: DeskRouterContext, signal: AbortSignal) {
  const entry = songForRoute(slug);
  if (!entry) throw notFound();
  if (mode === 'browser') {
    const { loadSong } = await import('../../../songs/index.js');
    await loadSong(entry.id);
    return { entry, preview: undefined };
  }
  const preview = context.runtime.installedIds?.includes(entry.id)
    ? await context.runtime.current?.previewSong(entry.id, signal) : undefined;
  return { entry, preview };
}

export function SongPreview({ data }: { data: Awaited<ReturnType<typeof loadDeskRoute>> }) {
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
