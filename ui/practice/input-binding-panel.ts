import { decodeInputBindings, type InputBindings } from '../../lib/performance/input-bindings.js';
import { CONTROL_IDS, PHYSICAL_SWITCH_IDS, type ChannelId, type PhysicalSwitchId } from '../../lib/performance/model.js';

export type InputBindingPanelView = {
	songId: string;
	title: string;
	bindings: InputBindings;
	editable: boolean;
	reason?: string;
};

const names = { blue: 'Blue', yellow: 'Yellow', red: 'Red', green: 'Green' };
const arcadeSwitches = PHYSICAL_SWITCH_IDS.filter(id => id !== 'pedal' && id !== 'mushroom');
const rowOrder: readonly ChannelId[] = ['L1', 'R1', 'L2', 'R2'];

const arcadeButtons = {
	blue: { row: 'L2', color: '#8bb7ff' },
	yellow: { row: 'L1', color: '#dfbe78' },
	green: { row: 'R1', color: '#a8c6ab' },
	red: { row: 'R2', color: '#ee9696' },
} satisfies Partial<Record<PhysicalSwitchId, { row: ChannelId; color: string }>>;

export function arcadeColorForRow(row: ChannelId) {
	return Object.values(arcadeButtons).find(button => button.row === row)?.color;
}

export function arcadeButton(id: PhysicalSwitchId) {
	return id === 'pedal' || id === 'mushroom' ? undefined : { ...arcadeButtons[id], name: names[id] };
}
type Editor = { controlId: (typeof arcadeSwitches)[number]; action: HTMLSelectElement; rows: Map<ChannelId, HTMLInputElement>; fieldset: HTMLFieldSetElement };

function bindingKey(bindings: InputBindings) {
	return JSON.stringify(arcadeSwitches.map(controlId => {
		const target = bindings.find(binding => binding.controlId === controlId)?.target;
		return target?.kind === 'cue-rows' ? { kind: target.kind, rows: CONTROL_IDS.filter(row => target.rows.includes(row)) } : target ?? null;
	}));
}

export function createInputBindingPanel({ onSave }: { onSave: (bindings: InputBindings, songId: string) => Promise<InputBindings> }) {
	const element = document.createElement('details');
	element.className = 'input-binding-panel';
	const summary = document.createElement('summary'); summary.textContent = 'Button assignments';
	const song = document.createElement('p'); song.className = 'input-binding-song';
	const status = document.createElement('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
	const error = document.createElement('p'); error.setAttribute('role', 'alert'); error.hidden = true;
	const form = document.createElement('form');
	const grid = document.createElement('div'); grid.className = 'input-binding-grid';
	const preset = document.createElement('button'); preset.type = 'button'; preset.textContent = 'Use four-colour layout';
	const apply = document.createElement('button'); apply.type = 'submit'; apply.textContent = 'Apply button assignments';
	const style = document.createElement('style');
	style.textContent = `.input-binding-panel{margin-block:1rem}.input-binding-panel summary{cursor:pointer}.input-binding-song{font-weight:600}.input-binding-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:.65rem}.input-binding-grid>fieldset{min-width:0;margin:0;padding:.5rem .65rem}.input-binding-grid legend{font-weight:600}.input-binding-grid select{font:inherit;max-width:100%;margin-left:.5rem}.input-binding-cues{border:0;padding:.45rem 0 0;margin:0;display:flex;gap:.8rem;flex-wrap:wrap}.input-binding-cues[hidden]{display:none}.input-binding-cues legend{font-size:.8em;font-weight:400}.input-binding-cues label{white-space:nowrap}.input-binding-panel [role=alert]{color:var(--danger,#b42318)}.input-binding-panel button{margin-top:.75rem;margin-inline-end:.5rem}`;
	element.append(style, summary, song, status, error, form);
	const fixed = document.createElement('p');
	fixed.textContent = 'Pedal · Tap tempo. Mushroom · Undo capture and restart, or panic.';
	form.append(grid, fixed, preset, apply);
	let view: InputBindingPanelView | undefined;
	let applied: InputBindings = [];
	let generation = 0;
	let saving = false;
	let notice = '';
	let failure = '';
	const editors: Editor[] = [];
	for (const controlId of arcadeSwitches) {
		const fieldset = document.createElement('fieldset');
		const legend = document.createElement('legend'); legend.textContent = names[controlId];
		const label = document.createElement('label'); label.textContent = 'Action';
		const action = document.createElement('select'); action.setAttribute('aria-label', `${names[controlId]} action`);
		for (const [value, text] of [['unassigned', 'Unassigned'], ['cue-rows', 'Cue rows'], ['tempo', 'Tempo tap'], ['panic', 'Panic']]) {
			const option = document.createElement('option'); option.value = value; option.textContent = text; action.append(option);
		}
		label.append(action);
		const cues = document.createElement('fieldset'); cues.className = 'input-binding-cues';
		const cueLegend = document.createElement('legend'); cueLegend.textContent = 'Cue rows'; cues.append(cueLegend);
		const rows = new Map<ChannelId, HTMLInputElement>();
		for (const row of rowOrder) {
			const rowLabel = document.createElement('label');
			const input = document.createElement('input'); input.type = 'checkbox'; input.setAttribute('aria-label', `${names[controlId]} ${row}`);
			rowLabel.append(input, document.createTextNode(` ${row}`)); cues.append(rowLabel); rows.set(row, input);
		}
		fieldset.append(legend, label, cues); grid.append(fieldset);
		editors.push({ controlId, action, rows, fieldset });
		action.addEventListener('change', changed);
		for (const input of rows.values()) input.addEventListener('change', changed);
	}

	function readDraft() {
		const bindings: unknown[] = [];
		for (const editor of editors) {
			if (editor.action.value === 'unassigned') continue;
			const target = editor.action.value === 'cue-rows'
				? { kind: editor.action.value, rows: CONTROL_IDS.filter(row => editor.rows.get(row)?.checked) }
				: { kind: editor.action.value };
			bindings.push({ controlId: editor.controlId, target });
		}
		return decodeInputBindings(bindings);
	}
	function draftProblem() {
		const owners = new Map<ChannelId, string>();
		for (const editor of editors) {
			if (editor.action.value !== 'cue-rows') continue;
			const rows = CONTROL_IDS.filter(row => editor.rows.get(row)?.checked);
			if (!rows.length) return `${names[editor.controlId]}: choose at least one cue row.`;
			for (const row of rows) {
				const owner = owners.get(row);
				if (owner) return `${row} is assigned to both ${owner} and ${names[editor.controlId]}. Choose one button for that row.`;
				owners.set(row, names[editor.controlId]);
			}
		}
		return 'Choose a supported action for each button.';
	}
	function renderBindings(bindings: InputBindings) {
		for (const editor of editors) {
			const target = bindings.find(binding => binding.controlId === editor.controlId)?.target;
			editor.action.value = target?.kind ?? 'unassigned';
			for (const [row, input] of editor.rows) input.checked = target?.kind === 'cue-rows' && target.rows.includes(row);
		}
	}
	function dirty() {
		try { return bindingKey(readDraft()) !== bindingKey(applied); }
		catch { return true; }
	}
	function refresh() {
		const locked = !view?.editable || saving;
		form.setAttribute('aria-busy', String(saving));
		let invalid = '';
		try { readDraft(); } catch { invalid = draftProblem(); }
		for (const editor of editors) {
			editor.fieldset.disabled = locked;
			const cueRows = editor.fieldset.querySelector('fieldset');
			if (cueRows) cueRows.hidden = editor.action.value !== 'cue-rows';
		}
		preset.disabled = locked;
		apply.disabled = locked || !dirty() || Boolean(invalid);
		apply.textContent = saving ? 'Saving assignments…' : 'Apply button assignments';
		status.textContent = saving ? 'Saving assignments…' : !view ? 'Select a song to assign buttons.'
			: !view.editable ? view.reason ?? 'Turn audio off to change button assignments.'
			: notice || (dirty() ? 'Unsaved assignments.' : applied.length ? 'Saved assignments.' : 'No buttons assigned.');
		error.textContent = failure || invalid; error.hidden = !error.textContent;
	}
	function changed() { notice = ''; failure = ''; refresh(); }
	preset.addEventListener('click', () => {
		if (!view?.editable || saving) return;
		for (const editor of editors) {
			const button = arcadeButton(editor.controlId);
			if (!button) continue;
			editor.action.value = 'cue-rows';
			for (const [row, input] of editor.rows) input.checked = row === button.row;
		}
		changed();
	});
	form.addEventListener('submit', event => {
		event.preventDefault();
		if (!view?.editable || saving) return;
		let bindings: InputBindings;
		try { bindings = readDraft(); }
		catch { failure = draftProblem(); refresh(); return; }
		if (!dirty()) return;
		const attempt = generation, songId = view.songId;
		saving = true; failure = ''; notice = ''; refresh();
		void (async () => {
			try {
				const acknowledged = decodeInputBindings(await onSave(bindings, songId));
				if (attempt !== generation) return;
				applied = acknowledged; renderBindings(applied); notice = 'Assignments saved.';
			} catch (cause) {
				if (attempt !== generation) return;
				failure = cause instanceof Error ? cause.message : 'Assignments could not be saved. Your changes are still here.';
			} finally {
				if (attempt === generation) { saving = false; refresh(); }
			}
		})();
	});
	refresh();
	return {
		element,
		get pending() { return saving; },
		get dirty() { return dirty(); },
		update(next: InputBindingPanelView) {
			const bindings = decodeInputBindings(next.bindings);
			const candidate = { ...next, bindings };
			const newSong = next.songId !== view?.songId;
			const keepDraft = !newSong && (dirty() || saving);
			if (newSong) { generation++; saving = false; notice = ''; failure = ''; }
			view = candidate; applied = bindings; song.textContent = candidate.title;
			if (!keepDraft) renderBindings(applied);
			refresh();
		},
	};
}
