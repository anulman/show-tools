import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import type { createInputBindingPanel } from '../input-binding-panel.js';
import type { InputBindings } from '../../../lib/performance/input-bindings.js';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const candidates = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
let browser: string | undefined;
for (const candidate of candidates) {
	if (candidate && await access(candidate).then(() => true, () => false)) { browser = candidate; break; }
}

async function browserChecks(create: typeof createInputBindingPanel) {
	function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
	type Panel = ReturnType<typeof create>;
	function selectControl(panel: Panel, name: string) {
		const select = panel.element.querySelector(`[aria-label="${name} action"]`);
		expect(select instanceof HTMLSelectElement, `${name} action is an accessible select`);
		return select;
	}
	function action(panel: Panel, name: string, value: string) {
		const select = selectControl(panel, name); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); return select;
	}
	function checkbox(panel: Panel, name: string) {
		const input = panel.element.querySelector(`[aria-label="${name}"]`);
		expect(input instanceof HTMLInputElement, `${name} has a checkbox`);
		return input;
	}
	function row(panel: Panel, name: string, checked: boolean) {
		const input = checkbox(panel, name); input.checked = checked; input.dispatchEvent(new Event('change', { bubbles: true })); return input;
	}
	function apply(panel: Panel) {
		const form = panel.element.querySelector('form'); expect(form instanceof HTMLFormElement, 'Panel has a form'); form.requestSubmit();
	}
	function button(panel: Panel) {
		const button = panel.element.querySelector('button'); expect(button instanceof HTMLButtonElement, 'Panel has an Apply button'); return button;
	}
	const flush = () => new Promise(resolve => setTimeout(resolve, 0));
	let fail = true;
	let settle: ((bindings: InputBindings) => void) | undefined;
	const requests: InputBindings[] = [];
	const savedSongs: string[] = [];
	const requestCount = () => requests.length;
	const panel = create({ onSave: async (bindings, songId) => {
		requests.push(bindings); savedSongs.push(songId);
		if (fail) throw new Error('Connection lost. Retry Apply.');
		return new Promise(resolve => { settle = resolve; });
	} });
	document.body.append(panel.element);
	panel.element.style.width = '390px';
	expect(!panel.element.open, 'Panel starts collapsed');
	panel.element.open = true;
	const initial = { songId: 'dyc', title: 'Dance Yrself Clean', bindings: [], editable: true };
	panel.update(initial);
	expect(panel.element.querySelectorAll('select').length === 6, 'All six physical controls are available');
	expect([...panel.element.querySelectorAll('select')].every(select => select.value === 'unassigned'), 'No control receives a default role');
	expect(button(panel).disabled && !panel.dirty, 'Unchanged unassigned state cannot be applied');
	expect(panel.element.textContent?.includes('Dance Yrself Clean'), 'Panel identifies the selected song');
	action(panel, 'Blue', 'cue-rows');
	expect(button(panel).disabled && panel.element.textContent?.includes('choose at least one cue row'), 'Incomplete row choice has an actionable validation error');
	row(panel, 'Blue R1', true); row(panel, 'Blue R2', true);
	action(panel, 'Yellow', 'cue-rows'); row(panel, 'Yellow R1', true);
	expect(button(panel).disabled && panel.element.textContent?.includes('R1 is assigned to both Blue and Yellow'), 'Duplicate row ownership is rejected');
	row(panel, 'Yellow R1', false); row(panel, 'Yellow L1', true);
	action(panel, 'Pedal', 'tempo'); action(panel, 'Mushroom', 'panic');
	expect(!button(panel).disabled && panel.dirty, 'Explicit grouped rows, tempo and Panic form a valid draft');
	apply(panel); await flush();
	expect(requestCount() === 1 && !panel.pending, 'Failed save settles once');
	expect(checkbox(panel, 'Blue R1').checked && checkbox(panel, 'Blue R2').checked, 'Failed save retains grouped row choices');
	expect(panel.element.textContent?.includes('Connection lost. Retry Apply.'), 'Save failure is visible');
	expect(panel.dirty && !button(panel).disabled, 'Failed save remains retryable');
	fail = false; apply(panel);
	expect(panel.pending && button(panel).disabled, 'Pending save locks Apply');
	expect([...panel.element.querySelectorAll('select')].every(select => select.matches(':disabled')), 'Pending save locks the real DOM controls');
	panel.update(initial);
	expect(panel.pending && checkbox(panel, 'Blue R1').checked, 'Routine same-song observations preserve the pending draft');
	const acknowledged: InputBindings = [
		{ controlId: 'blue', target: { kind: 'cue-rows', rows: ['R2'] } },
		{ controlId: 'yellow', target: { kind: 'cue-rows', rows: ['L1'] } },
		{ controlId: 'pedal', target: { kind: 'tempo' } },
		{ controlId: 'mushroom', target: { kind: 'panic' } },
	];
	expect(settle, 'Deferred save is in flight'); settle(acknowledged); await flush();
	const blueR1 = panel.element.querySelector('[aria-label="Blue R1"]');
	expect(blueR1 instanceof HTMLInputElement && !blueR1.checked, 'Only acknowledged assignments are rendered as saved');
	expect(!panel.dirty && button(panel).disabled && panel.element.textContent?.includes('Assignments saved.'), 'Acknowledged readback clears dirty state');
	panel.update({ ...initial, bindings: acknowledged, editable: false, reason: 'Turn hardware audio off before editing.' });
	expect([...panel.element.querySelectorAll('select')].every(select => select.matches(':disabled')), 'Audio-on observations lock all controls');
	expect(panel.element.textContent?.includes('Turn hardware audio off before editing.'), 'Disabled state explains its cause');
	apply(panel); await flush();
	expect(requestCount() === 2, 'Direct form submission cannot save while audio is on');
	panel.update({ ...initial, bindings: acknowledged });
	row(panel, 'Blue R1', true); apply(panel);
	expect(panel.pending, 'A later edit can be saved');
	const oldSave = settle; expect(oldSave, 'Later save is deferred');
	panel.update({ songId: 'dg', title: 'Drunk Girls', bindings: [], editable: true });
	expect(!panel.pending && !panel.dirty, 'Song change starts from that song’s acknowledged assignments');
	expect([...panel.element.querySelectorAll('select')].every(select => select.value === 'unassigned'), 'Assignments are never copied across songs');
	oldSave(acknowledged); await flush();
	expect(!panel.dirty && panel.element.textContent?.includes('Drunk Girls'), 'Late save cannot overwrite the next song');
	expect([...panel.element.querySelectorAll('select')].every(select => select.value === 'unassigned'), 'Late save leaves the next song unassigned');
	action(panel, 'Blue', 'tempo');
	panel.update({ songId: 'dg', title: 'Drunk Girls', bindings: [], editable: true });
	expect(panel.dirty && selectControl(panel, 'Blue').value === 'tempo', 'Unrelated same-song observations retain unsaved edits');
	expect(panel.element.scrollWidth <= panel.element.clientWidth, 'Panel fits a 390px container');
	expect(requests[0].find(binding => binding.controlId === 'blue')?.target.kind === 'cue-rows', 'Save uses the canonical binding schema');
	expect(savedSongs.join(',') === 'dyc,dyc,dyc', 'Each save carries the song identity captured before awaiting');
	return { requestCount: requests.length, width: panel.element.clientWidth };
}

test('real browser edits, validates, saves and locks explicit per-song button assignments', { skip: browser ? false : 'Chrome or Chromium is not installed', timeout: 30000 }, async () => {
	assert(browser);
	const temporary = await mkdtemp(join(tmpdir(), 'input-binding-panel-'));
	try {
		const source = await readFile(fileURLToPath(import.meta.url), 'utf8');
		const start = source.indexOf('async function browserChecks('), end = source.indexOf('\ntest(', start);
		assert(start >= 0 && end > start);
		const contents = `import { createInputBindingPanel } from './ui/practice/input-binding-panel.ts';
${source.slice(start, end)}
browserChecks(createInputBindingPanel).then(result => { document.title='PASS: input binding panel'; const output=document.createElement('pre');output.id='result';output.textContent=JSON.stringify(result);document.body.append(output);document.querySelector('script')?.remove(); },error=>{document.title='FAIL: input binding panel';document.body.textContent=String(error.stack||error);});`;
		const bundle = await build({ absWorkingDir: root, stdin: { contents, resolveDir: root, loader: 'ts' }, bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' });
		const output = bundle.outputFiles[0]; assert(output);
		const html = join(temporary, 'index.html');
		await writeFile(html, `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Running</title></head><body style="margin:0"><script>${output.text.replace(/<\/script/gi, '<\\/script')}</script></body></html>`);
		const result = await execute(browser, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${join(temporary, 'profile')}`, '--virtual-time-budget=5000', '--dump-dom', pathToFileURL(html).href], { timeout: 20000, maxBuffer: 2 * 1024 * 1024 });
		await writeFile(join(temporary, 'result.html'), result.stdout);
		assert.match(result.stdout, /<title>PASS: input binding panel<\/title>/, result.stdout.slice(-8000));
		assert.match(await readFile(join(temporary, 'result.html'), 'utf8'), /"requestCount":3/);
	} finally { await rm(temporary, { recursive: true, force: true }); }
});
