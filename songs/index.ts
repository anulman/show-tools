import type { SongScript } from '../lib/performance/model.js';
import { SET_SONGS, type RehearsalSong, type SetSong } from './routes.js';

const loaders = {
  'dance-yrself-clean': () => import('./dance-yrself-clean.js'),
  'drunk-girls': () => import('./drunk-girls.js'),
  tribulations: () => import('./tribulations.js'),
} satisfies Record<Extract<SetSong, { rehearsal: false }>['id'], () => Promise<{ default: SongScript }>>;

export async function loadSongPreview(id: RehearsalSong['id']) {
  const [{ readBundledMusicXml, musicXmlSongScript }, { readMusicXmlSong }] = await Promise.all([
    import('./load-musicxml.js'),
    import('../lib/performance/musicxml-song.js'),
  ]);
  const document = await readMusicXmlSong(await readBundledMusicXml(id));
  const song = musicXmlSongScript(document);
  if (song.id !== id || song.compiled?.executable !== false) throw new Error(`Incorrect chart preview for ${id}.`);
  return { song, archive: document.source };
}

export const SONGS = SET_SONGS.map(entry => ({
  id: entry.id,
  title: `${String(entry.number).padStart(2, '0')} · ${entry.title}${entry.rehearsal ? ' · Rehearsal' : ''}`,
  load: entry.rehearsal ? async () => {
    const [{ song }, { rehearsalProgram }] = await Promise.all([loadSongPreview(entry.id), import('./rehearsal.js')]);
    if (!song.compiled) throw new Error('The rehearsal chart is missing its source program.');
    const compiled = rehearsalProgram(song.compiled);
    return { default: { ...song, chart: compiled.chart, compiled, description: 'Timing rehearsal chart. Draft cues are disabled.' } };
  } : loaders[entry.id],
}));

export async function loadSong(id: string): Promise<SongScript> {
  const entry = SONGS.find(song => song.id === id);
  if (!entry) throw new Error('Choose a registered song script');
  return (await entry.load()).default;
}
