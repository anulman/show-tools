import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMusicianSheets } from '../lib/performance/musician-sheets.js';
import { scoreXmlText as xml } from '../lib/performance/score-xml.js';

const options = new Map<string, string>();
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const key = args[i];
  if (!['--musicxml', '--out-dir', '--pdf', '--python', '--reuse'].includes(key) || options.has(key)) throw new Error(`Unknown or repeated option ${key}.`);
  if (key === '--pdf') options.set(key, 'true');
  else {
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Specify a value for ${key}.`);
    options.set(key, value);
  }
}
const required = (key: string) => {
  const value = options.get(key);
  if (!value) throw new Error(`Specify ${key}.`);
  return value;
};
const musicxml = await readFile(required('--musicxml'), 'utf8');
const reuseFile = options.get('--reuse');
const reuse: unknown = reuseFile ? JSON.parse(await readFile(reuseFile, 'utf8')) : undefined;
const sheets = await createMusicianSheets({ musicxml, reuse });
if (!sheets.length) throw new Error('This chart has no non-AF musician parts.');
const python = options.get('--python') ?? 'python3';
if (options.has('--pdf')) {
  try { execFileSync(python, ['-c', 'import reportlab, svglib'], { stdio: 'pipe' }); }
  catch (cause) { throw new Error('PDF generation requires Python with scripts/musician-pdf-requirements.txt installed. Choose its interpreter with --python, or omit --pdf for printable HTML/SVG.', { cause }); }
}
const output = resolve(required('--out-dir'));
await mkdir(dirname(output), { recursive: true });
await mkdir(output);
await writeFile(join(output, 'repeat-candidates.json'), JSON.stringify({ sourceDigest: sheets[0].condensation.sourceDigest,
  mappingDigest: sheets[0].condensation.mappingDigest, requiresMusicalConfirmation: true,
  parts: sheets.map(sheet => ({ name: sheet.name, labelCell: sheet.labelCell, candidates: sheet.condensation.repeatCandidates })) }, null, 2) + '\n', { flag: 'wx' });
await writeFile(join(output, 'reuse-template.json'), JSON.stringify({ sourceDigest: sheets[0].condensation.sourceDigest,
  mappingDigest: sheets[0].condensation.mappingDigest, references: [] }, null, 2) + '\n', { flag: 'wx' });
for (const sheet of sheets) {
  await writeFile(join(output, `${sheet.stem}.musicxml`), sheet.xml, { flag: 'wx' });
  await writeFile(join(output, `${sheet.stem}.html`), sheet.html, { flag: 'wx' });
  const pageFiles: string[] = [];
  for (const [index, svg] of sheet.pages.entries()) {
    const filename = join(output, `${sheet.stem}-page-${index + 1}.svg`);
    await writeFile(filename, svg, { flag: 'wx' }); pageFiles.push(filename);
  }
  if (options.has('--pdf')) {
    execFileSync(python, [fileURLToPath(new URL('./render-musician-pdf.py', import.meta.url)),
      '--output', join(output, `${sheet.stem}.pdf`), '--title', `${sheet.name} - musician notes`, ...pageFiles], { stdio: 'pipe' });
  }
}
const links = sheets.map(sheet => `<article><h2>${xml(sheet.name)}</h2><p>${sheet.pages.length} A4 pages · blank five-line staves</p><a href="${sheet.stem}.html">View / print</a>${options.has('--pdf') ? ` · <a href="${sheet.stem}.pdf">PDF</a>` : ''} · <a href="${sheet.stem}.musicxml">MusicXML</a><p><img src="${sheet.stem}-page-1.svg" alt="${xml(sheet.name)} first page"></p></article>`).join('');
await writeFile(join(output, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Musician sheets</title><style>body{font:16px/1.5 system-ui;background:#f3f3ee;color:#27372f;max-width:1200px;padding:28px;margin:auto}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}article{background:white;padding:24px}img{width:100%;height:auto;border:1px solid #ddd}a{color:#245d40}</style><h1>Musician sheets</h1><p>Separate focused parts with full writing staves, counted rests, section names and vocal cues. All chart bars are retained.</p><p><a href="repeat-candidates.json">Review repeated chart cues</a> · <a href="reuse-template.json">Section-reuse template</a></p><main>${links}</main></html>\n`, { flag: 'wx' });
process.stdout.write(`Created ${sheets.map(sheet => `${sheet.name}: ${sheet.pages.length} pages`).join('; ')}.\nOpen ${join(output, 'index.html')}\n`);
