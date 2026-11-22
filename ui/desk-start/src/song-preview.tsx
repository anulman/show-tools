import { Await, notFound } from '@tanstack/react-router';
import { Suspense, useContext, useState } from 'react';
import { SET_SONGS, songForRoute } from '../../../songs/routes.js';
import type { AudioMode } from '../../practice/audio-mode.js';
import type { DeskRouterContext } from './router';
import { DeskState, type DeskMount } from './desk-state';
import { LoadingSkeleton } from './loading';

type PreviewResult =
  | { kind: 'ready'; detail: Awaited<ReturnType<DeskMount['previewSong']>> }
  | { kind: 'cancelled' }
  | { kind: 'unavailable' };

async function loadPreview(runtime: DeskMount, id: string, signal: AbortSignal): Promise<PreviewResult> {
  try {
    return { kind: 'ready', detail: await runtime.previewSong(id, signal) };
  } catch {
    return { kind: signal.aborted ? 'cancelled' : 'unavailable' };
  }
}

export async function loadDeskRoute(slug: string, mode: AudioMode, context: DeskRouterContext, signal: AbortSignal) {
  const entry = songForRoute(slug);
  if (!entry) throw notFound();
  if (mode === 'browser') {
    const { loadSong } = await import('../../../songs/index.js');
    await loadSong(entry.id);
    return { entry, preview: undefined };
  }
  const { current, installedIds } = context.runtime;
  const preview = current && installedIds?.includes(entry.id) ? loadPreview(current, entry.id, signal) : undefined;
  return { entry, preview };
}

export function SongPreview({ data }: { data: Awaited<ReturnType<typeof loadDeskRoute>> }) {
  const { active, runtime } = useContext(DeskState);
  const [failure, setFailure] = useState('');
  const [selecting, setSelecting] = useState(false);
  if (!active || active.id === data.entry.id) return null;
  const available = active.installedIds?.includes(data.entry.id);
  const fallback = <LoadingSkeleton label="Loading chart and effects…" />;
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
        {data.preview ? (
          <Suspense fallback={fallback}>
            <Await promise={data.preview}>
              {result => {
                if (result.kind === 'cancelled') return null;
                if (result.kind === 'unavailable') return <p role="status">Chart details could not be loaded.</p>;
                const chart = result.detail.song.chart;
                const effects = new Set(result.detail.defaultVoiceEffects.flatMap(voice => voice.effects.map(effect => effect.kind)));
                return chart ? <p>{chart.bars.length} charted bars{effects.size ? ` · Effects: ${[...effects].join(', ')}` : ''}</p> : null;
              }}
            </Await>
          </Suspense>
        ) : available && fallback}
        {!available && <p>This song is unavailable on the hardware Desk.</p>}
        {available && <button type="button" className="primary" disabled={!runtime || selecting} onClick={() => void select()}>{selecting ? 'Selecting…' : 'Select on Desk'}</button>}
        {failure && <p role="alert">{failure}</p>}
      </div>
    </section>
  );
}
