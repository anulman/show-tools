import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import { zipSync } from 'fflate';
import { createMusicianChart, type MusicianSheet, type MusicianChart } from '../lib/performance/musician-sheets.js';
import { readMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { scoreXmlText as xml } from '../lib/performance/score-xml.js';
import { isCliEntrypoint } from './cli-entry.js';

const instruments = ['drums', 'bass', 'keys', 'guitar'] as const;
const instrumentNames = { drums: 'Drums', bass: 'Bass', keys: 'Keys', guitar: 'Guitar' } as const;
const Selection = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('parts'), parts: Schema.Array(Schema.Struct({ labelCell: Schema.String.check(Schema.isPattern(/^A[1-9]\d*$/)), name: Schema.NonEmptyString })) }),
  Schema.Struct({ kind: Schema.Literal('none') }),
]);
const decodeSpec = Schema.decodeUnknownSync(Schema.Struct({ schemaVersion: Schema.Literal(2), songs: Schema.Array(Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)), musicxml: Schema.NonEmptyString,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  instruments: Schema.Struct({ drums: Selection, bass: Selection, keys: Selection, guitar: Selection }),
})) }), { onExcessProperty: 'error' });
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

export function verifyMusicianCoverage(sheet: MusicianSheet | MusicianChart, measureCount: number) {
  const actual: number[] = [];
  for (const page of sheet.pages) {
    for (const match of page.matchAll(/data-bar="(\d+)"/g)) actual.push(Number(match[1]));
    for (const match of page.matchAll(/data-(?:rest|reference)-start="(\d+)" data-(?:rest|reference)-end="(\d+)"/g))
      for (let bar = Number(match[1]); bar <= Number(match[2]); ++bar) actual.push(bar);
  }
  actual.sort((a, b) => a - b);
  if (actual.length !== measureCount || actual.some((bar, index) => bar !== index + 1)) throw new Error(`Incomplete or duplicate measure coverage for ${sheet.name}.`);
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
    if (!['--spec', '--out-dir', '--python', '--instrument', '--format'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw new Error('Usage: build-musician-packages --spec SPEC.json --out-dir NEW_DIRECTORY [--python PYTHON] [--instrument drums|bass|keys|guitar] [--format preview|pdf]');
    options.set(key, value);
  }
  const required = (name: string) => { const value = options.get(name); if (!value) throw new Error(`Specify ${name}.`); return value; };
  const specPath = resolve(required('--spec')), output = resolve(required('--out-dir')), python = options.get('--python') ?? 'python3';
  const selected = options.get('--instrument'), format = options.get('--format') ?? 'pdf';
  if (selected && !instruments.some(instrument => instrument === selected)) throw new Error('Unknown instrument.');
  if (format !== 'preview' && format !== 'pdf') throw new Error('Choose --format preview or pdf.');
  const spec = decodeSpec(JSON.parse(await readFile(specPath, 'utf8')));
  if (!spec.songs.length || new Set(spec.songs.map(song => song.id)).size !== spec.songs.length) throw new Error('Song IDs must be nonempty and unique.');
  const prepared = [], skipped: { song: string; instrument: string; reason: string }[] = [];
  for (const song of spec.songs) {
    const input = await readFile(resolve(dirname(specPath), song.musicxml), 'utf8');
    if (hash(input) !== song.sha256) throw new Error(`Canonical input changed for ${song.id}. Review the new chart and update its package spec.`);
    const document = await readMusicXmlSong(input);
    if (document.song.id !== song.id) throw new Error(`Canonical song identity mismatch for ${song.id}.`);
    for (const instrument of instruments.filter(value => !selected || value === selected)) {
      const selection = song.instruments[instrument];
      if (selection.kind === 'none') { skipped.push({ song: song.id, instrument, reason: 'No charted part selected.' }); continue; }
      if (!selection.parts.length || new Set(selection.parts.map(part => part.labelCell)).size !== selection.parts.length) throw new Error('Select distinct charted parts, or use kind: none for an absent musician.');
      const sheet = await createMusicianChart({ musicxml: input, instrument: instrumentNames[instrument], parts: selection.parts });
      if (!sheet) throw new Error('Configured musician parts did not produce a chart.');
      verifyMusicianCoverage(sheet, document.report.measureCount);
      prepared.push({ song, input, document, instrument, sheet });
    }
  }
  if (format === 'pdf' && prepared.length) execFileSync(python, ['-c', 'import reportlab, svglib, xml.parsers.expat'], { stdio: 'pipe' });
  const repository = fileURLToPath(new URL('../', import.meta.url));
  const generator = Object.fromEntries(await Promise.all(['scripts/build-musician-packages.ts', 'scripts/render-musician-pdf.py',
    'lib/performance/musician-sheets.ts', 'lib/performance/musician-annotations.ts', 'lib/performance/musician-sheet-plan.ts',
    'lib/performance/musicxml-song.ts'].map(async path => [path, hash(await readFile(join(repository, path)))])));
  await mkdir(dirname(output), { recursive: true }); await mkdir(output);
  const rows: { instrument: string; song: string; name: string; pages: number; voices: MusicianChart['sourceParts']; pdf: string | null; html: string; sha256: string }[] = [];
  for (const { song, input, document, instrument, sheet } of prepared) {
    const directory = join(output, instrument, song.id), sources = join(output, instrument, 'sources');
    await mkdir(directory, { recursive: true }); await mkdir(sources, { recursive: true });
    await writeFile(join(sources, `${song.id}.musicxml`), input, { flag: 'wx' });
    const stem = join(directory, sheet.stem), pageFiles: string[] = [];
    await writeFile(`${stem}.html`, sheet.html, { flag: 'wx' }); await writeFile(`${stem}.musicxml`, sheet.xml, { flag: 'wx' });
    for (const [index, page] of sheet.pages.entries()) { const path = `${stem}-page-${index + 1}.svg`; await writeFile(path, page, { flag: 'wx' }); pageFiles.push(path); }
    if (format === 'pdf') execFileSync(python, [fileURLToPath(new URL('./render-musician-pdf.py', import.meta.url)), '--output', `${stem}.pdf`, '--title', `${document.report.title} - ${sheet.name}`, ...pageFiles], { stdio: 'pipe' });
    await writeFile(`${stem}.provenance.json`, JSON.stringify({ songId: song.id, canonicalSha256: song.sha256, semanticDigest: document.song.source.digest,
      sourceParts: sheet.sourceParts, measureCount: document.report.measureCount,
      barLabels: document.song.chart.bars.map(bar => ({ ordinal: bar.bar, label: bar.label ?? String(bar.bar) })),
      boundaryCues: (document.report.annotations.boundaryCues ?? []).filter(cue => sheet.sourceParts.some(part => part.id === cue.partId)), condensation: sheet.condensation }, null, 2) + '\n', { flag: 'wx' });
    rows.push({ instrument, song: document.report.title, name: sheet.name, pages: sheet.pages.length, voices: sheet.sourceParts,
      pdf: format === 'pdf' ? `${song.id}/${sheet.stem}.pdf` : null, html: `${song.id}/${sheet.stem}.html`, sha256: hash(await readFile(`${stem}.${format === 'pdf' ? 'pdf' : 'html'}`)) });
  }
  const included = instruments.filter(instrument => rows.some(row => row.instrument === instrument));
  for (const instrument of included) {
    const directory = join(output, instrument), own = rows.filter(row => row.instrument === instrument);
    const links = own.map(row => `<tr><td>${xml(row.song)}</td><td>${xml(row.voices.map(voice => voice.name).join(' / '))}</td><td>${row.pages}</td><td>${row.pdf ? `<a href="${row.pdf}">PDF</a> · ` : ''}<a href="${row.html}">View chart</a></td></tr>`).join('');
    await writeFile(join(directory, 'index.html'), `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${instrumentNames[instrument]} musician sheets</title><style>body{font:16px/1.5 system-ui;max-width:1100px;margin:auto;padding:24px;color:#27372f;background:#f3f3ee}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #ccd3ca;text-align:left}a{color:#245d40}</style><h1>${instrumentNames[instrument]}</h1><p>One chart per musician. ! = Funky; !! = Extra funky; !!! = Higher intensity. Counted fills and voice changes are labeled.</p><table><tr><th>Song</th><th>Voices</th><th>Pages</th><th>Open</th></tr>${links}</table></html>\n`, { flag: 'wx' });
    await writeFile(join(directory, 'README.md'), `# ${instrumentNames[instrument]} musician sheets\n\nOpen index.html to read the charts. Each song combines this musician's configured voices. No chart is produced for an absent part. Full staves are for your notes; pitches, harmony and grooves are not inferred.\n\nRegenerate with: node --import tsx scripts/build-musician-packages.ts --spec /path/to/extracted/${instrument}/${instrument}-spec.json --out-dir NEW_DIRECTORY --instrument ${instrument} --format preview\n\nUse --format pdf --python YOUR_PDF_PYTHON only when PDF generation is wanted. Review changed canonical sources and row bindings before updating their hashes.\n`, { flag: 'wx' });
    await writeFile(join(directory, `${instrument}-spec.json`), JSON.stringify({ ...spec, songs: spec.songs.map(song => ({ ...song, musicxml: `sources/${song.id}.musicxml` }))
      .filter(song => song.instruments[instrument].kind === 'parts') }, null, 2) + '\n', { flag: 'wx' });
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ schemaVersion: 2, format, instrument, generator, sheets: own }, null, 2) + '\n', { flag: 'wx' });
    await writeFile(join(output, `${instrument}.zip`), zipSync(await filesBelow(directory), { level: 6, mtime: new Date(1980, 0, 1) }), { flag: 'wx' });
  }
  await writeFile(join(output, 'index.html'), `<!doctype html><html><meta charset="utf-8"><title>Musician charts</title><style>body{font:18px/1.6 system-ui;margin:40px;color:#27372f}a{color:#245d40}</style><h1>Musician chart ${format === 'preview' ? 'previews' : 'packages'}</h1>${included.map(instrument => `<p><a href="${instrument}/index.html">${instrumentNames[instrument]} charts</a> · <a href="${instrument}.zip">Download package</a></p>`).join('')}<p>${skipped.length} song/instrument selections omitted because no part is charted.</p></html>\n`, { flag: 'wx' });
  await writeFile(join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 2, status: 'complete', format, generator, sources: spec.songs, sheets: rows, skipped }, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(`Created ${rows.length} musician ${format === 'pdf' ? 'PDFs' : 'HTML previews; no PDFs generated'}. Open ${join(output, 'index.html')}\n`);
}
if (await isCliEntrypoint(import.meta.url)) await runMusicianPackages(process.argv.slice(2));
