import type { SongScript } from '../lib/performance/model.js';

import { SET_SONGS, type SongId } from './routes.js';

const loaders = {
  'dance-yrself-clean': () => import('./dance-yrself-clean.js'),
  'drunk-girls': () => import('./drunk-girls.js'),
  'i-can-change': () => import('./i-can-change.js'),
  tribulations: () => import('./tribulations.js'),
} satisfies Record<SongId, () => Promise<{ default: SongScript }>>;

export const SONGS = SET_SONGS.map(({ id, number, title }) => ({
  id,
  title: `${String(number).padStart(2, '0')} · ${title}${id === 'i-can-change' ? ' · not ready' : ''}`,
  load: loaders[id],
}));

export async function loadSong(id: string): Promise<SongScript> {
  const entry = SONGS.find(song => song.id === id);
  if (!entry) throw new Error('Choose a registered song script');
  return (await entry.load()).default;
}
