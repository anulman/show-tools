import { readMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { readBundledMusicXml, musicXmlSongScript } from './load-musicxml.js';

const document = await readMusicXmlSong(await readBundledMusicXml('dance-yrself-clean'));
export default { ...musicXmlSongScript(document), compiled: document.song };
