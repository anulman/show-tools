import type { SongScript } from '../lib/performance/model.js';

export const SONGS: readonly { id: string; title: string; load: () => Promise<{ default: SongScript }> }[] = [
  { id: 'dance-yrself-clean', title: '01 · Dance Yrself Clean', load: () => import('./dance-yrself-clean.js') },
  { id: 'drunk-girls', title: '02 · Drunk Girls', load: () => import('./drunk-girls.js') },
  { id: 'i-can-change', title: '03 · I Can Change · not ready', load: () => import('./i-can-change.js') },
  { id: 'tribulations', title: '04 · Tribulations', load: () => import('./tribulations.js') },
];

export async function loadSong(id: string): Promise<SongScript> {
  const entry = SONGS.find(song => song.id === id);
  if (!entry) throw new Error('Choose a registered song script');
  return (await entry.load()).default;
}
