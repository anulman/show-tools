import { build, transform } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildSheetsMusicXml(directory: string): Promise<void> {
  const [server, browser, wrappers, template] = await Promise.all([
    build({ absWorkingDir: root, entryPoints: ['scripts/sheets-musicxml/server.ts'], bundle: true, write: false,
      format: 'iife', globalName: 'ShowToolsMusicXmlServer', target: 'es2020', legalComments: 'none' }),
    build({ absWorkingDir: root, entryPoints: ['ui/sheets-musicxml/app.ts'], bundle: true, write: false,
      format: 'iife', platform: 'browser', target: 'es2022', minify: true, legalComments: 'inline' }),
    readFile(join(root, 'scripts/sheets-musicxml/globals.ts'), 'utf8').then(text => transform(text, { loader: 'ts', target: 'es2020' })),
    readFile(join(root, 'ui/sheets-musicxml/index.html'), 'utf8'),
  ]);
  const files = {
    'Code.gs': '/** @OnlyCurrentDoc */\n' + server.outputFiles[0].text + '\n' + wrappers.code,
    'Export.html': template.replace('<!-- export-bundle -->', () => `<script>${browser.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}</script>`),
    'appsscript.json': JSON.stringify({ runtimeVersion: 'V8', oauthScopes: [
      'https://www.googleapis.com/auth/spreadsheets.currentonly', 'https://www.googleapis.com/auth/script.container.ui',
    ] }, null, 2) + '\n',
    'INSTALL.md': `# Show Tools MusicXML exporter (experimental)\n\nThis build supports the configured 01 Dance Yrself Clean worksheet (gid 101).\n\n1. Open that spreadsheet and choose Extensions → Apps Script.\n2. In a new bound script project, paste Code.gs into its Code.gs file. Create an HTML file named Export and paste Export.html into it.\n3. Open Project Settings and enable “Show appsscript.json manifest file in editor”. Paste the supplied appsscript.json into it. Save.\n4. Reload the spreadsheet. Select voice/instrument rows (DYC rows 8–15, or a subset). Choose Show Tools → Export selected voices….\n5. Authorize access to the current spreadsheet when Google asks, then reopen the export dialog if needed. Check the listed voices and click Download chart MusicXML. Selected non-AF parts also offer separate printable notes sheets and MusicXML. Open a saved notes sheet to print or save a PDF.\n\nIf the bound project already contains scripts, preserve those files, merge the onOpen menu registration, and merge the manifest settings/scopes. Do not replace existing project code blindly. No web-app deployment is needed.\n\nSelection chooses complete voice rows, not a bar crop. All 218 mapped bars are exported. Headers, controls, cell notes and the full source—including unselected rows—are retained as metadata. No cells are changed, no Drive file is created, and no external service receives chart data.\n\nThis package is locally verified, not installed in Google Sheets. First-run Google authorization and the actual Sheets iframe download still need operator verification.\n`,
  };
  const output = resolve(directory);
  await mkdir(output);
  await Promise.all(Object.entries(files).map(([name, text]) => writeFile(join(output, name), text, { flag: 'wx' })));
  const archive = zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, [strToU8(text), { mtime: new Date(2000, 0, 1) }]])), { level: 9 });
  await writeFile(join(output, 'show-tools-musicxml.zip'), archive, { flag: 'wx' });
  process.stdout.write(`Built installable Sheets exporter in ${output}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--out-dir') throw new Error('Usage: node --import tsx scripts/build-sheets-musicxml.ts --out-dir NEW_DIRECTORY');
  await buildSheetsMusicXml(args[1]);
}
