import { readMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { readBundledMusicXml, musicXmlSongScript } from './load-musicxml.js';

const document = await readMusicXmlSong(await readBundledMusicXml('all-i-want'));
export default musicXmlSongScript(document);
