import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Schema, Predicate } from 'effect';

interface Toolkit {
  setOptions(options: Record<string, string | number | boolean>): void;
  loadData(xml: string): boolean;
  getPageCount(): number;
  renderToSVG(page: number): string;
  getLog(): string;
  destroy(): void;
}
const ToolkitSchema = Schema.declare((value): value is Toolkit => Predicate.isObject(value)
  && 'setOptions' in value && typeof value.setOptions === 'function'
  && 'loadData' in value && typeof value.loadData === 'function'
  && 'getPageCount' in value && typeof value.getPageCount === 'function'
  && 'renderToSVG' in value && typeof value.renderToSVG === 'function'
  && 'getLog' in value && typeof value.getLog === 'function'
  && 'destroy' in value && typeof value.destroy === 'function');

const args = process.argv.slice(2);
if (args.length !== 4 || args[0] !== '--study' || args[2] !== '--verovio-root') {
  throw new Error('Usage: node --import tsx scripts/render-musicxml-study.ts --study DIRECTORY --verovio-root VEROVIO_PACKAGE_DIRECTORY');
}
const directory = resolve(args[1]), renderer = resolve(args[3]);
const manifest: unknown = JSON.parse(await readFile(join(renderer, 'package.json'), 'utf8'));
Schema.decodeUnknownSync(Schema.Struct({ name: Schema.Literal('verovio'), version: Schema.Literal('5.6.0') }))(manifest);
const [wasm, wrapper] = await Promise.all([
  import(pathToFileURL(join(renderer, 'dist/verovio-module.mjs')).href),
  import(pathToFileURL(join(renderer, 'dist/verovio.mjs')).href),
]);
if (typeof wasm.default !== 'function' || typeof wrapper.VerovioToolkit !== 'function') throw new Error('Invalid Verovio toolkit exports.');
const toolkit = Schema.decodeUnknownSync(ToolkitSchema)(Reflect.construct(wrapper.VerovioToolkit, [await wasm.default()]));
try {
  toolkit.setOptions({ inputFrom: 'xml', pageWidth: 2400, pageHeight: 3000, scale: 35, breaks: 'auto',
    header: 'none', footer: 'auto', svgViewBox: true });
  if (!toolkit.loadData(await readFile(join(directory, 'score.musicxml'), 'utf8'))) throw new Error('Verovio rejected MusicXML.');
  const pages = Schema.decodeUnknownSync(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })))(toolkit.getPageCount());
  const links: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const svg = Schema.decodeUnknownSync(Schema.String)(toolkit.renderToSVG(page));
    await writeFile(join(directory, `score-${page}.svg`), svg);
    links.push(`<section><h2>Page ${page}</h2><img src="score-${page}.svg" alt="Engraved MusicXML page ${page}"></section>`);
  }
  await writeFile(join(directory, 'engraved.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MusicXML rhythm-guide engraving</title><style>body{font:16px/1.5 system-ui;margin:24px;background:#eceee9;color:#242b28}header,section{max-width:1400px;margin:20px auto;background:white;padding:24px}h2{font-size:14px;color:#777}img{width:100%;height:auto}a{color:#145c48}</style><header><h1>MusicXML rhythm-guide engraving</h1><p>Independent renderer: Verovio 5.6.0 · ${pages} pages</p><p>Short x-note glyphs show attacks, not authored pitches or played durations. Text-only measures do not establish silence.</p><p><a href="index.html">Compare with source cells</a> · <a href="score.musicxml">Download MusicXML</a></p></header>${links.join('\n')}</html>\n`);
  await writeFile(join(directory, 'render.log'), Schema.decodeUnknownSync(Schema.String)(toolkit.getLog()));
  process.stdout.write(`Verovio 5.6.0 rendered ${pages} pages.\n`);
} finally { toolkit.destroy(); }
