import source from '../../practice/index.html?raw';

function section(start: string, end: string) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin + start.length);
  if (begin < 0 || finish < 0) throw new Error('The shared Performance Desk template changed.');
  return source.slice(begin + start.length, finish);
}

export const template = {
  header: section('<header class="topline">', '</header>').replace('href="./"', 'href="/preview/tanstack/"'),
  song: section('</header>', '</main>').replace('href="./README.md"', 'href="/ui/practice/README.md"'),
  dialogs: section('</main>', '<script type="module"'),
};
