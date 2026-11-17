import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import { zipSync } from 'fflate';
import { createMusicianSheets, createMusicianFormSheet, type MusicianSheet, type MusicianFormSheet } from '../lib/performance/musician-sheets.js';
import { readMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { scoreXmlText as xml } from '../lib/performance/score-xml.js';
import { isCliEntrypoint } from './cli-entry.js';

const instruments = ['drums', 'bass', 'keys'] as const;
const instrumentNames = { drums: 'Drums', bass: 'Bass', keys: 'Keys' } as const;
const Selection = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('parts'), parts: Schema.Array(Schema.Struct({ labelCell: Schema.String.check(Schema.isPattern(/^A[1-9]\d*$/)), name: Schema.NonEmptyString })) }),
  Schema.Struct({ kind: Schema.Literal('form') }),
]);
const decodeSpec = Schema.decodeUnknownSync(Schema.Struct({ schemaVersion: Schema.Literal(1), songs: Schema.Array(Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)), musicxml: Schema.NonEmptyString,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  instruments: Schema.Struct({ drums: Selection, bass: Selection, keys: Selection }),
})) }), { onExcessProperty: 'error' });
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
type Sheet = MusicianSheet | MusicianFormSheet;

export function verifyMusicianCoverage(sheet: Sheet, measureCount: number) {
  const actual: number[] = [];
  for (const page of sheet.pages) {
    for (const match of page.matchAll(/data-bar="(\d+)"/g)) actual.push(Number(match[1]));
    for (const match of page.matchAll(/data-(?:rest|reference)-start="(\d+)" data-(?:rest|reference)-end="(\d+)"/g))
      for (let bar = Number(match[1]); bar <= Number(match[2]); ++bar) actual.push(bar);
  }
  actual.sort((a, b) => a - b);
  if (actual.length !== measureCount || actual.some((bar, index) => bar !== index + 1)) throw new Error(`Incomplete or duplicate measure coverage for ${sheet.name}.`);
  if ('kind' in sheet && (sheet.condensation.rests.length || sheet.pages.some(page => /data-rest-start/.test(page)))) throw new Error('Uncharted forms cannot assert authored rests.');
}

async function filesBelow(root: string, directory = root): Promise<Record<string, Uint8Array>> {
  const files: Record<string, Uint8Array> = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await filesBelow(root, path));
    else if (entry.isFile()) files[relative(root, path).split('\\').join('/')] = new Uint8Array(await readFile(path));
    else throw new Error('Packages cannot contain symbolic links or special files.');
  }
  return files;
}

export async function runMusicianPackages(args: readonly string[]) {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--spec', '--out-dir', '--python', '--instrument'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw new Error('Usage: build-musician-packages --spec SPEC.json --out-dir NEW_DIRECTORY [--python PYTHON] [--instrument drums|bass|keys]');
    options.set(key, value);
  }
  const required = (name: string) => { const value = options.get(name); if (!value) throw new Error(`Specify ${name}.`); return value; };
  const specPath = resolve(required('--spec')), output = resolve(required('--out-dir')), python = options.get('--python') ?? 'python3';
  const selected = options.get('--instrument');
  if (selected && !instruments.some(instrument => instrument === selected)) throw new Error('Unknown instrument.');
  const spec = decodeSpec(JSON.parse(await readFile(specPath, 'utf8')));
  if (!spec.songs.length || new Set(spec.songs.map(song => song.id)).size !== spec.songs.length) throw new Error('Song IDs must be nonempty and unique.');
  const prepared = [];
  for (const song of spec.songs) {
    const input = await readFile(resolve(dirname(specPath), song.musicxml), 'utf8');
    if (hash(input) !== song.sha256) throw new Error(`Canonical input changed for ${song.id}. Review the new chart and update its package spec.`);
    const document = await readMusicXmlSong(input);
    if (document.song.id !== song.id) throw new Error(`Canonical song identity mismatch for ${song.id}.`);
    const groups = [];
    for (const instrument of instruments.filter(value => !selected || value === selected)) {
      const selection = song.instruments[instrument];
      let sheets: Sheet[];
      if (selection.kind === 'form') sheets = [await createMusicianFormSheet({ musicxml: input, instrument: instrumentNames[instrument] })];
      else {
        if (!selection.parts.length || new Set(selection.parts.map(part => part.labelCell)).size !== selection.parts.length) throw new Error('Select distinct charted parts.');
        for (const part of selection.parts) if (!document.report.parts.some(candidate => candidate.labelCell === part.labelCell && candidate.name === part.name && !candidate.managed))
          throw new Error(`Missing or changed ${instrument} part ${part.labelCell} ${part.name} in ${song.id}. Review its source row.`);
        sheets = await createMusicianSheets({ musicxml: input, selectedRows: selection.parts.map(part => Number(part.labelCell.slice(1))) });
      }
      for (const sheet of sheets) verifyMusicianCoverage(sheet, document.report.measureCount);
      groups.push({ instrument, sheets });
    }
    prepared.push({ song, input, document, groups });
  }
  execFileSync(python, ['-c', 'import reportlab, svglib, xml.parsers.expat'], { stdio: 'pipe' });
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const generator = Object.fromEntries(await Promise.all(['scripts/build-musician-packages.ts', 'scripts/render-musician-pdf.py',
    'lib/performance/musician-sheets.ts', 'lib/performance/musician-annotations.ts', 'lib/performance/musician-sheet-plan.ts',
    'lib/performance/musicxml-song.ts'].map(async path => [path, hash(await readFile(join(repository, path)))])));
  await mkdir(dirname(output), { recursive: true }); await mkdir(output);
  const rows: { instrument: string; song: string; name: string; pages: number; kind: string; pdf: string; html: string; sha256: string }[] = [];
  for (const { song, input, document, groups } of prepared) for (const { instrument, sheets } of groups) {
    const directory = join(output, instrument, song.id), sources = join(output, instrument, 'sources');
    await mkdir(directory, { recursive: true }); await mkdir(sources, { recursive: true });
    await writeFile(join(sources, `${song.id}.musicxml`), input, { flag: 'wx' });
    for (const sheet of sheets) {
      const stem = join(directory, sheet.stem), pageFiles: string[] = [];
      await writeFile(`${stem}.html`, sheet.html, { flag: 'wx' }); await writeFile(`${stem}.musicxml`, sheet.xml, { flag: 'wx' });
      for (const [index, page] of sheet.pages.entries()) { const path = `${stem}-page-${index + 1}.svg`; await writeFile(path, page, { flag: 'wx' }); pageFiles.push(path); }
      execFileSync(python, [fileURLToPath(new URL('./render-musician-pdf.py', import.meta.url)), '--output', `${stem}.pdf`, '--title', `${document.report.title} - ${sheet.name}`, ...pageFiles], { stdio: 'pipe' });
      await writeFile(`${stem}.provenance.json`, JSON.stringify({ songId: song.id, canonicalSha256: song.sha256, semanticDigest: document.song.source.digest,
        source: 'labelCell' in sheet ? { kind: 'charted', labelCell: sheet.labelCell, name: sheet.name } : { kind: 'uncharted', instrument },
        measureCount: document.report.measureCount, barLabels: document.song.chart.bars.map(bar => ({ ordinal: bar.bar, label: bar.label ?? String(bar.bar) })),
        boundaryCues: document.report.annotations.boundaryCues ?? [], condensation: sheet.condensation }, null, 2) + '\n', { flag: 'wx' });
      rows.push({ instrument, song: document.report.title, name: sheet.name, pages: sheet.pages.length, kind: 'labelCell' in sheet ? 'charted part' : 'uncharted form',
        pdf: `${song.id}/${sheet.stem}.pdf`, html: `${song.id}/${sheet.stem}.html`, sha256: hash(await readFile(`${stem}.pdf`)) });
    }
  }
  for (const instrument of instruments.filter(value => !selected || value === selected)) {
    const directory = join(output, instrument), own = rows.filter(row => row.instrument === instrument);
    const links = own.map(row => `<tr><td>${xml(row.song)}</td><td>${xml(row.name)}</td><td>${row.pages}</td><td>${xml(row.kind)}</td><td><a href="${row.pdf}">PDF</a> · <a href="${row.html}">Print / view</a></td></tr>`).join('');
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${instrumentNames[instrument]} musician sheets</title><style>body{font:16px/1.5 system-ui;max-width:1100px;margin:auto;padding:24px;color:#27372f;background:#f3f3ee}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #ccd3ca;text-align:left}a{color:#245d40}</style><h1>${instrumentNames[instrument]}</h1><p>Normal playing is implicit. ! = Funky; !! = Extra funky; !!! = Higher intensity. Other count and phrase marks retain their source spelling. Uncharted form worksheets leave activity undecided.</p><table><tr><th>Song</th><th>Part</th><th>Pages</th><th>Sheet</th><th>Open</th></tr>${links}</table></html>\n`, { flag: 'wx' });
    await writeFile(join(directory, 'README.md'), `# ${instrumentNames[instrument]} musician sheets\n\nPrint the PDFs or use index.html to open the writing sheets. Each song has its own folder. Separate charted layers keep separate sheets. Full staves are for your notes; pitches, harmony and grooves are not inferred. Source-count labels, pickups, literal entry patterns and uncounted tails are preserved. Blank authored passages become counted rests; missing parts get uncharted form worksheets.\n\nTo regenerate with this repository, use: node --import tsx scripts/build-musician-packages.ts --spec /path/to/extracted/${instrument}/${instrument}-spec.json --out-dir NEW_DIRECTORY --instrument ${instrument} --python YOUR_PDF_PYTHON\n\nUpdate the source MusicXML and its SHA only after reviewing the changed chart. The source rows and names must match the spec. Do not add repeats without musician confirmation.\n`, { flag: 'wx' });
    await writeFile(join(directory, `${instrument}-spec.json`), JSON.stringify({ ...spec, songs: spec.songs.map(song => ({ ...song, musicxml: `sources/${song.id}.musicxml` })) }, null, 2) + '\n', { flag: 'wx' });
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 1, instrument, generator, sheets: own }, null, 2) + '\n', { flag: 'wx' });
    const files = await filesBelow(directory);
    await writeFile(join(output, `${instrument}.zip`), zipSync(files, { level: 6, mtime: new Date(1980, 0, 1) }), { flag: 'wx' });
  }
  await writeFile(join(output, 'index.html'), `<!doctype html><html><meta charset="utf-8"><title>First three songs: musician sheets</title><style>body{font:18px/1.6 system-ui;margin:40px;color:#27372f}a{color:#245d40}</style><h1>Musician sheet packages</h1>${instruments.filter(value => !selected || value === selected).map(instrument => `<p><a href="${instrument}/index.html">${instrumentNames[instrument]} sheets</a> · <a href="${instrument}.zip">Download package</a></p>`).join('')}</html>\n`, { flag: 'wx' });
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, status: 'complete', generator, sources: spec.songs, sheets: rows }, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`Created ${rows.length} musician PDFs. Open ${join(output, 'index.html')}\n`);
}
if (await isCliEntrypoint(import.meta.url)) await runMusicianPackages(process.argv.slice(2));
