const setList = [
  { number: 1, id: 'dance-yrself-clean', title: 'Dance Yrself Clean' },
  { number: 2, id: 'drunk-girls', title: 'Drunk Girls' },
  { number: 3, id: 'i-can-change', title: 'I Can Change' },
  { number: 4, id: 'tribulations', title: 'Tribulations' },
] as const;

export type SetSong = (typeof setList)[number];
export type SongId = SetSong['id'];
export const SET_SONGS = setList;

const slug = (song: SetSong) => `${String(song.number).padStart(2, '0')}-${song.id}`;

export function songRoute(id: string): string | undefined {
  const entry = setList.find(song => song.id === id);
  return entry && slug(entry);
}

export function songForRoute(segment: string): SetSong | undefined {
  return setList.find(song => slug(song) === segment);
}

export function nextSetSong(id: string, available: readonly string[]): SetSong | undefined {
  const index = setList.findIndex(song => song.id === id);
  return index < 0 ? undefined : setList.slice(index + 1).find(song => available.includes(song.id));
}
