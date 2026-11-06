import { readMusicXmlSong, writeMusicXmlSong, type MusicXmlSong } from './musicxml-song.js';
import type { CatalogDocument } from '../voice-catalog/model.js';

export async function exportMusicXmlWithVoices(input: string, loadedDigest: string | undefined,
    savedVoices: (document: MusicXmlSong) => Promise<CatalogDocument>): Promise<string> {
  const document = await readMusicXmlSong(input);
  if (document.voices && loadedDigest !== document.song.source.digest) return input;
  const voices = await savedVoices(document);
  return writeMusicXmlSong({ song: document.song, report: document.report, voices,
    ...(document.source ? { source: document.source } : {}), ...(document.mapping !== null ? { mapping: document.mapping } : {}) });
}
