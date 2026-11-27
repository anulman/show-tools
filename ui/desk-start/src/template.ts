import source from '../../practice/index.html?raw';
import { SET_SONGS, songRoute } from '../../../songs/routes.js';

export const firstSongPath = '/' + songRoute(SET_SONGS[0].id);

function section(start: string, end: string) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin + start.length);
  if (begin < 0 || finish < 0) throw new Error('The shared Performance Desk template changed.');
  return source.slice(begin + start.length, finish);
}

const cameraSection = '<section id="crt-cameras"';

export const template = {
  header: section('<header class="topline">', '</header>').replace(
    '<select id="song-select" aria-label="Song"></select>',
    '<select id="song-select" hidden></select>',
  ),
  song: section('</header>', cameraSection),
  tail: (cameraSection + section(cameraSection, '</main>')).replace('href="./README.md"', 'href="/ui/practice/README.md"'),
  dialogs: section('</main>', '<script type="module"'),
};
