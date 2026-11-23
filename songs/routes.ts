const setList = [
  { number: 1, id: 'dance-yrself-clean', title: 'Dance Yrself Clean', previewOnly: false },
  { number: 2, id: 'drunk-girls', title: 'Drunk Girls', previewOnly: false },
  { number: 3, id: 'i-can-change', title: 'I Can Change', previewOnly: true },
  { number: 4, id: 'tribulations', title: 'Tribulations', previewOnly: false },
  { number: 5, id: 'daft-punk', title: 'Daft Punk Is Playing at My House', previewOnly: true },
  { number: 6, id: 'all-i-want', title: 'All I Want', previewOnly: true },
  { number: 7, id: 'you-wanted-a-hit', title: 'You Wanted a Hit', previewOnly: true },
] as const;

export type SetSong = (typeof setList)[number];
export type PreviewSong = Extract<SetSong, { previewOnly: true }>;
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
