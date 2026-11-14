import { readMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { readBundledMusicXml, musicXmlSongScript } from './load-musicxml.js';

const document = await readMusicXmlSong(await readBundledMusicXml('tribulations'));
export default musicXmlSongScript(document);
