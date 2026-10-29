import type { CatalogDocument, SheetBinding, Voice, CueRow } from '../../lib/voice-catalog/model.js';
import type { SheetCueRow, SheetVoiceRow } from '../../lib/voice-catalog/sheet-voices.js';
import type { LiveEffectDefinition, PracticeState } from '../../lib/performance/model.js';

export interface VoiceCharacter {
  readonly id: string;
  readonly label: string;
  readonly publishedAvatarPath?: string;
  readonly figmaRef?: string;
}
export interface VoiceLibraryOptions {
  readonly characters: readonly VoiceCharacter[];
  readonly onSave: (voice: Voice, binding: SheetBinding | undefined, expectedRevision: number) => Promise<{ message: string }>;
  readonly onExport: (format: 'json' | 'sqlite') => void;
  readonly onImport: (file: File) => Promise<void>;
  readonly onDraftEffects?: (voiceId: string, effects: readonly LiveEffectDefinition[]) => void;
  readonly getDraftEffects?: (voiceId: string) => readonly LiveEffectDefinition[];
}
export interface VoiceLibraryUpdate {
  readonly document: CatalogDocument;
  readonly rows: readonly SheetVoiceRow[];
  readonly cueRows?: readonly SheetCueRow[];
  readonly commandRows?: ReadonlyMap<string, readonly number[]>;
  readonly state?: Pick<PracticeState, 'bar' | 'voiceEffects'>;
  readonly locked: boolean;
  /** A nonempty loading/error message makes library editing unavailable. */
  readonly availability?: string;
}
const tokens = ['neutral', 'olive', 'amber', 'blue', 'plum'] satisfies readonly Voice['avatarToken'][];
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text: string, run: () => void, className = '') {
  const node = el('button', className, text); node.type = 'button'; node.addEventListener('click', run); return node;
}
function field(text: string, control: HTMLElement) { const label = el('label', 'vl-field'); label.append(el('span', '', text), control); return label; }
function sameSource(row: SheetVoiceRow, binding: SheetBinding) {
  return row.spreadsheetId === binding.spreadsheetId && row.sheetId === binding.sheetId && row.labelCell === binding.labelCell;
}
function sameEffects(a: readonly LiveEffectDefinition[], b: readonly LiveEffectDefinition[]) { return JSON.stringify(a) === JSON.stringify(b); }

/** A catalog view only: musical timing and graph preparation remain in the native engine. */
export function installVoiceLibrary(root: HTMLElement, options: VoiceLibraryOptions) {
  let data: VoiceLibraryUpdate = { document: { version: 2, revision: 0, voices: [], bindings: [] }, rows: [], locked: false };
  let draft: Voice | null = null;
  let selectedSource: string | null = null;
  let selectedCue: CueRow | null = null;
  let cueNeedsReview = false;
  let confirmedMapping = false;
  let dirty = false;
  let baseRevision = 0;
  let saving = false;
  let returnFocus: HTMLElement | null = null;
  let rosterQuery = '';
  let renderedRosterKey = '';
  let ensembleKey = '';
  const section = el('section', 'voice-library');
  const heading = el('div', 'vl-heading');
  const title = el('div'); title.append(el('h2', '', 'The rest of the band'), el('p', '', 'Written chart cues · audio activity is shown on routed voices above.'));
  const manage = button('Manage voices', () => openFirst());
  heading.append(title, manage);
  const ensemble = el('div', 'vl-ensemble');
  const libraryNotice = el('p', 'vl-library-notice'); libraryNotice.setAttribute('role', 'status');
  section.append(heading, ensemble, libraryNotice); root.append(section);

  const dialog = el('dialog', 'vl-dialog'); dialog.setAttribute('aria-labelledby', 'vl-title');
  const shell = el('div', 'vl-shell');
  const head = el('header', 'vl-dialog-header'); const dialogTitle = el('h2', '', 'Voice library'); dialogTitle.id = 'vl-title'; head.append(dialogTitle);
  const close = button('Close ×', () => { if (canLeave()) dialog.close(); }); head.append(close);
  const body = el('div', 'vl-dialog-body');
  const sidebar = el('aside', 'vl-sidebar');
  const search = el('input'); search.type = 'search'; search.placeholder = 'Find a voice'; search.setAttribute('aria-label', 'Find a voice');
  const roster = el('div', 'vl-roster');
  sidebar.append(search, roster);
  const content = el('div', 'vl-content');
  const mobileSelect = el('select'); mobileSelect.setAttribute('aria-label', 'Select voice');
  const mobileField = field('Voice', mobileSelect); mobileField.classList.add('vl-mobile-selector');
  const form = el('form', 'vl-form'); form.id = 'vl-voice-form';
  const readback = el('p', 'vl-readback'); readback.setAttribute('role', 'status');
  const message = el('p', 'vl-message'); message.setAttribute('role', 'status');
  content.append(mobileField, form, readback, message); body.append(sidebar, content);
  const foot = el('footer', 'vl-footer');
  const tools = el('div', 'vl-backups');
  const exportButton = button('Export JSON', () => options.onExport('json'));
  const sqliteButton = button('SQLite backup', () => options.onExport('sqlite'));
  const importInput = el('input'); importInput.type = 'file'; importInput.accept = '.json,application/json'; importInput.hidden = true;
  const importButton = button('Import library', () => importInput.click());
  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0]; if (!file || saving) return;
    if (!window.confirm('Replace the local voice library with this backup? Export first to keep a copy of your current library.')) { importInput.value = ''; return; }
    importButton.disabled = true;
    try { await options.onImport(file); draft = null; dirty = false; openFirst(); message.textContent = 'Library imported.'; }
    catch (error) { message.textContent = error instanceof Error ? error.message : String(error); }
    finally { importButton.disabled = false; importInput.value = ''; }
  });
  tools.append(exportButton, sqliteButton, importButton, importInput);
  const save = el('button', 'vl-save', 'Save voice'); save.type = 'submit'; save.setAttribute('form', form.id);
  foot.append(tools, save); shell.append(head, body, foot); dialog.append(shell); root.append(dialog);
  search.addEventListener('input', () => { rosterQuery = search.value; renderRoster(true); });
  mobileSelect.addEventListener('change', () => selectVoice(mobileSelect.value));
  dialog.addEventListener('close', () => returnFocus?.focus());
  dialog.addEventListener('cancel', event => { if (!canLeave()) event.preventDefault(); });
  dialog.addEventListener('click', event => { if (event.target === dialog && canLeave()) dialog.close(); });
  form.addEventListener('invalid', event => {
    const control = event.target;
    const label = control instanceof HTMLElement ? control.getAttribute('aria-label') : null;
    message.textContent = label ? `Check ${label} before saving.` : 'Check the highlighted voice setting before saving.';
  }, true);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!draft) { message.textContent = 'Select a voice before saving.'; return; }
    if (saving) { message.textContent = 'Wait for the current save to finish.'; return; }
    if (data.locked) { message.textContent = 'Stop practice before saving voice effects.'; return; }
    if (baseRevision !== data.document.revision) { message.textContent = 'The library changed. Close and reopen this voice before saving.'; return; }
    if (!form.reportValidity()) { message.textContent = 'Check the highlighted voice setting before saving.'; return; }
    const row = data.rows.find(item => item.key === selectedSource);
    const existing = row && data.document.bindings.find(item => sameSource(row, item));
    if (row && existing && (existing.voiceId !== draft.id || existing.sourceLabel !== row.sourceLabel) && !confirmedMapping) {
      message.textContent = 'Confirm the changed source connection before saving.'; return;
    }
    if (cueNeedsReview) { message.textContent = 'Choose a current cue row to resolve its changed or missing label.'; return; }
    const binding: SheetBinding | undefined = row ? {
      spreadsheetId: row.spreadsheetId, sheetId: row.sheetId, labelCell: row.labelCell, sourceLabel: row.sourceLabel, voiceId: draft.id, cueRow: selectedCue,
    } : undefined;
    const voiceToSave = draft;
    saving = true; refreshStatus();
    try { const result = await options.onSave(voiceToSave, binding, baseRevision); baseRevision = data.document.revision; dirty = false; message.textContent = result.message; }
    catch (error) { message.textContent = error instanceof Error ? error.message : String(error); }
    finally { saving = false; refreshStatus(); }
  });

  function avatar(voice: Voice | undefined, name: string) {
    const frame = el('span', 'vl-avatar'); frame.dataset.token = voice?.avatarToken ?? 'neutral';
    const character = options.characters.find(item => item.id === voice?.characterId);
    if (character?.publishedAvatarPath) { const img = el('img'); img.src = character.publishedAvatarPath; img.alt = ''; frame.append(img); }
    else frame.textContent = name.split(/\s+/).slice(0, 2).map(word => word[0] ?? '').join('').toUpperCase();
    return frame;
  }
  function boundRow(voiceId: string) {
    return data.rows.find(row => data.document.bindings.some(binding => binding.voiceId === voiceId && sameSource(row, binding)));
  }
  function renderEnsemble() {
    const rows = data.rows.filter(row => row.partId === null && row.profile === null);
    const key = JSON.stringify([rows, data.document.voices, data.document.bindings, data.state?.bar]);
    if (key === ensembleKey) return; ensembleKey = key; ensemble.replaceChildren();
    for (const row of rows) {
      const binding = data.document.bindings.find(item => sameSource(row, item));
      const voice = data.document.voices.find(item => item.id === binding?.voiceId);
      const mappingChanged = Boolean(binding && binding.sourceLabel !== row.sourceLabel);
      const name = mappingChanged ? row.name : voice?.name ?? row.name;
      const item = button('', () => voice ? openVoice(voice.id) : openRow(row), 'vl-ensemble-row');
      const details = el('span', 'vl-ensemble-name'); details.append(el('strong', '', name), el('small', '', `${row.labelCell} · ${row.managed ? 'AF managed' : 'Sheet instrument'}`));
      if (mappingChanged) { item.dataset.mapping = 'review'; details.append(el('small', 'vl-mapping-warning', 'Mapping review · source label changed')); }
      const cue = row.cues.find(item => item.bar === data.state?.bar)?.text ?? '';
      const cueView = el('span', 'vl-cue'); cueView.append(el('small', '', cue.trim() ? 'Chart cue' : 'No cue'), el('span', '', cue || '—'));
      item.append(avatar(mappingChanged ? undefined : voice, name), details, cueView, el('span', 'vl-edit-arrow', '↗')); ensemble.append(item);
    }
    if (!rows.length) ensemble.append(el('p', 'vl-empty', 'Other sheet voices appear here when a song source is loaded.'));
  }
  function orderedVoices() {
    const order = new Map(data.rows.map((row, index) => [row.key, index]));
    const rank = (voice: Voice) => { const row = boundRow(voice.id); return row ? order.get(row.key) ?? Infinity : Infinity; };
    return [...data.document.voices].sort((a, b) => {
      const aRank = rank(a), bRank = rank(b);
      return aRank === bRank ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : aRank - bRank;
    });
  }
  function renderRoster(force = false) {
    const key = JSON.stringify([data.document.voices, data.document.bindings, data.rows, rosterQuery, draft?.id]);
    if (!force && key === renderedRosterKey) return; renderedRosterKey = key;
    roster.replaceChildren(); mobileSelect.replaceChildren();
    for (const voice of orderedVoices()) {
      const row = boundRow(voice.id);
      const option = el('option', '', `${voice.name}${row ? ` · ${row.labelCell}` : ''}`); option.value = voice.id; mobileSelect.append(option);
      if (!`${voice.name} ${row?.sourceLabel ?? ''} ${row?.labelCell ?? ''}`.toLowerCase().includes(rosterQuery.toLowerCase())) continue;
      const item = button('', () => selectVoice(voice.id), 'vl-roster-item'); item.dataset.selected = String(voice.id === draft?.id);
      item.append(el('strong', '', voice.name), el('small', '', row ? `${row.labelCell} · ${row.managed ? 'AF managed' : 'Sheet instrument'}` : 'No sheet connection')); roster.append(item);
    }
    if (draft) mobileSelect.value = draft.id;
    if (!roster.childElementCount) roster.append(el('p', 'vl-empty', 'No voices found.'));
  }
  function canLeave() { return !saving && (!dirty || window.confirm('Discard unsaved voice metadata? Effect drafts remain available until applied or reset.')); }
  function showDialog() {
    if (dialog.open) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : manage;
    dialog.showModal();
  }
  function selectVoice(id: string) {
    if (id === draft?.id || !canLeave()) { if (draft) mobileSelect.value = draft.id; return; }
    openVoice(id);
  }
  function openFirst() { const first = orderedVoices()[0]; if (first) openVoice(first.id); else { draft = null; form.replaceChildren(el('p', 'vl-empty', 'Load a song to discover its sheet voices.')); showDialog(); } }
  function openVoice(id: string) {
    if (saving || data.availability) return;
    const voice = data.document.voices.find(item => item.id === id); if (!voice) return;
    draft = { ...voice, effects: [...(options.getDraftEffects?.(id) ?? voice.effects)] };
    dirty = false; baseRevision = data.document.revision; selectedSource = boundRow(id)?.key ?? null;
    selectedCue = data.document.bindings.find(binding => binding.voiceId === id && data.rows.some(row => row.key === selectedSource && sameSource(row, binding)))?.cueRow ?? null; confirmedMapping = false;
    renderForm(); renderRoster(true); showDialog();
  }
  function openRow(row: SheetVoiceRow) {
    if (data.availability || !canLeave()) return;
    draft = { id: crypto.randomUUID(), name: row.name, notes: '', characterId: null, avatarToken: 'neutral', effects: [] };
    dirty = true; baseRevision = data.document.revision; selectedSource = row.key; selectedCue = null; confirmedMapping = false; renderForm(); showDialog();
  }
  function changed(next: Voice) { draft = next; dirty = true; message.textContent = ''; refreshStatus(); }
  function effectsChanged(effects: readonly LiveEffectDefinition[]) {
    if (!draft) return; changed({ ...draft, effects }); options.onDraftEffects?.(draft.id, effects);
  }
  function renderForm() {
    form.replaceChildren(); message.textContent = ''; if (!draft) return;
    const current = draft;
    const heading = el('h3', '', current.name); form.append(heading);
    const name = el('input'); name.value = current.name; name.required = true; name.maxLength = 300;
    name.addEventListener('input', () => { if (draft) changed({ ...draft, name: name.value }); heading.textContent = name.value; });
    form.append(field('Voice name', name));
    const identity = el('section', 'vl-identity');
    const preview = el('div', 'vl-character-preview'); preview.append(avatar(draft, draft.name));
    const character = el('select');
    const empty = el('option', '', 'Unassigned'); empty.value = ''; character.append(empty);
    if (current.characterId && !options.characters.some(item => item.id === current.characterId)) {
      const missing = el('option', '', `${current.characterId} · unavailable`); missing.value = current.characterId; character.append(missing);
    }
    for (const entry of options.characters) { const item = el('option', '', `${entry.label} · ${entry.id}`); item.value = entry.id; character.append(item); }
    character.value = current.characterId ?? '';
    const provenance = el('div', 'vl-provenance');
    function refreshIdentity() {
      if (!draft) return; preview.replaceChildren(avatar(draft, draft.name)); provenance.replaceChildren();
      const selected = options.characters.find(item => item.id === draft?.characterId);
      provenance.append(el('small', '', selected ? `${selected.publishedAvatarPath ? 'Preview avatar' : 'Avatar preview unavailable'} · ${selected.id}` : draft.characterId ? 'Character unavailable in this registry' : 'No Video character assigned'));
      if (selected?.figmaRef) { const link = el('a', '', 'Artwork provenance ↗'); link.href = selected.figmaRef; link.target = '_blank'; link.rel = 'noopener noreferrer'; provenance.append(link); }
    }
    character.addEventListener('change', () => { if (draft) changed({ ...draft, characterId: character.value || null }); refreshIdentity(); });
    const style = el('select');
    for (const token of tokens) { const option = el('option', '', token[0].toUpperCase() + token.slice(1)); option.value = token; style.append(option); }
    style.value = current.avatarToken;
    style.addEventListener('change', () => { const token = tokens.find(item => item === style.value); if (draft && token) changed({ ...draft, avatarToken: token }); refreshIdentity(); });
    const selectors = el('div', 'vl-identity-fields'); selectors.append(field('Video character', character), field('Avatar frame', style), provenance);
    identity.append(preview, selectors); form.append(identity); refreshIdentity();
    const effects = el('section', 'vl-effects'); form.append(effects); renderEffects(effects);
    const notes = el('textarea'); notes.value = current.notes; notes.maxLength = 4000; notes.rows = 3;
    notes.addEventListener('input', () => { if (draft) changed({ ...draft, notes: notes.value }); });
    form.append(field('Notes', notes));
    cueNeedsReview = false;
    const source = el('section', 'vl-source'); source.append(el('h4', '', 'Sheet connection'));
    const sourceSelect = el('select'); const noSource = el('option', '', 'Keep existing connections'); noSource.value = ''; sourceSelect.append(noSource);
    for (const row of data.rows) { const option = el('option', '', `${row.labelCell} · ${row.sourceLabel}`); option.value = row.key; sourceSelect.append(option); }
    sourceSelect.value = selectedSource ?? '';
    const sourceDetails = el('p', 'vl-source-details');
    const cueSelect = el('select'); const cueDetails = el('p', 'vl-source-details');
    function refreshCueRows() {
      const row = data.rows.find(item => item.key === selectedSource);
      const candidates = (data.cueRows ?? []).filter(cue => cue.spreadsheetId === row?.spreadsheetId && cue.sheetId === row.sheetId);
      const loaded = data.commandRows?.get(row?.key ?? '') ?? [];
      const loadedLabels = loaded.map(number => { const match = candidates.find(cue => Number(cue.labelCell.replace(/^[A-Z]+/, '')) === number); return match ? `${match.sourceLabel} · ${match.labelCell}` : `row ${number}`; }).join(', ') || 'No command row declared';
      cueSelect.replaceChildren();
      const inherited = el('option', '', `Loaded song default · ${loadedLabels}`); inherited.value = ''; cueSelect.append(inherited);
      for (const candidate of candidates) { const option = el('option', '', `${candidate.labelCell} · ${candidate.sourceLabel}`); option.value = candidate.labelCell; cueSelect.append(option); }
      const matching = candidates.find(candidate => candidate.labelCell === selectedCue?.labelCell && candidate.sourceLabel === selectedCue.sourceLabel);
      cueNeedsReview = selectedCue !== null && !matching;
      if (cueNeedsReview && selectedCue) { const missing = el('option', '', `Check mapping · ${selectedCue.labelCell} · ${selectedCue.sourceLabel}`); missing.value = '__missing__'; cueSelect.append(missing); }
      cueSelect.value = cueNeedsReview ? '__missing__' : selectedCue?.labelCell ?? '';
      cueDetails.textContent = `Loaded song: ${loadedLabels}. Saved cue-row changes take effect when you recompile and load the song mapping.${cueNeedsReview ? ' Saved cue label changed or is missing. Choose a current row.' : ''}${!data.cueRows?.length ? ' Load a source snapshot to select row labels.' : ''}`;
    }
    cueSelect.addEventListener('change', () => {
      const row = data.rows.find(item => item.key === selectedSource);
      const candidate = data.cueRows?.find(cue => cue.labelCell === cueSelect.value && cue.sheetId === row?.sheetId && cue.spreadsheetId === row.spreadsheetId);
      selectedCue = candidate ? { labelCell: candidate.labelCell, sourceLabel: candidate.sourceLabel } : null;
      dirty = true; refreshCueRows(); refreshStatus();
    });
    const confirmation = el('label', 'vl-confirm'); const checkbox = el('input'); checkbox.type = 'checkbox';
    confirmation.append(checkbox, el('span', '', 'Confirm replacing this row’s saved connection or changed label.'));
    checkbox.addEventListener('change', () => { confirmedMapping = checkbox.checked; });
    function refreshSource() {
      const row = data.rows.find(item => item.key === selectedSource);
      const binding = row && data.document.bindings.find(item => sameSource(row, item));
      sourceDetails.textContent = row ? `${row.sheetName} · worksheet ${row.sheetId} · ${row.labelCell}\n${row.sourceLabel}\nSpreadsheet ${row.spreadsheetId}${row.managed ? '\nAF managed · source-owned label' : ''}` : data.document.bindings.filter(item => item.voiceId === current.id).map(item => `${item.sourceLabel} · ${item.labelCell} · worksheet ${item.sheetId} · ${item.spreadsheetId}`).join('\n') || 'No sheet connection. Metadata does not assign an audio input.';
      confirmation.hidden = !binding || (binding.voiceId === current.id && binding.sourceLabel === row?.sourceLabel);
    }
    sourceSelect.addEventListener('change', () => { selectedSource = sourceSelect.value || null; selectedCue = null; confirmedMapping = false; checkbox.checked = false; dirty = true; refreshSource(); refreshCueRows(); refreshStatus(); });
    source.append(field('Voice row', sourceSelect), sourceDetails, confirmation, field('Cue row', cueSelect), cueDetails); form.append(source); refreshSource(); refreshCueRows(); refreshStatus();
  }
  function renderEffects(container: HTMLElement) {
    container.replaceChildren(el('h4', '', 'Ordered effects')); if (!draft) return;
    if (!draft.effects.length) container.append(el('p', 'vl-dry', 'Dry · no effects'));
    for (const [index, effect] of draft.effects.entries()) {
      const stage = el('fieldset', 'vl-stage'); stage.append(el('legend', '', `${index + 1}. ${effect.kind === 'slapback' ? 'Slapback' : 'Chorus'}`));
      function number(label: string, value: number, min: number, max: number, step: number, update: (value: number) => LiveEffectDefinition) {
        const input = el('input'); input.type = 'number'; input.value = String(value); input.min = String(min); input.max = String(max); input.step = String(step); input.required = true;
        input.dataset.fx = 'true'; input.inputMode = 'decimal'; input.setAttribute('aria-label', `${index + 1}. ${effect.kind}, ${label}`);
        input.addEventListener('input', () => { if (draft) effectsChanged(draft.effects.map((old, i) => i === index ? update(input.valueAsNumber) : old)); });
        stage.append(field(label, input));
      }
      if (effect.kind === 'slapback') {
        number('Delay · ms', effect.delayMs, 40, 250, 1, value => ({ ...(draft?.effects[index]?.kind === 'slapback' ? draft.effects[index] : effect), delayMs: value }));
        number('Feedback', effect.feedback, 0, .7, .01, value => ({ ...(draft?.effects[index]?.kind === 'slapback' ? draft.effects[index] : effect), feedback: value }));
        number('Wet', effect.wet, 0, 1, .01, value => ({ ...(draft?.effects[index]?.kind === 'slapback' ? draft.effects[index] : effect), wet: value }));
      } else {
        number('Rate · Hz', effect.rateHz, .05, 5, .05, value => ({ ...(draft?.effects[index]?.kind === 'chorus' ? draft.effects[index] : effect), rateHz: value }));
        number('Depth · ms', effect.depthMs, 0, 9, .1, value => ({ ...(draft?.effects[index]?.kind === 'chorus' ? draft.effects[index] : effect), depthMs: value }));
        number('Delay · ms', effect.baseDelayMs, 10, 40, .1, value => ({ ...(draft?.effects[index]?.kind === 'chorus' ? draft.effects[index] : effect), baseDelayMs: value }));
        number('Wet', effect.wet, 0, 1, .01, value => ({ ...(draft?.effects[index]?.kind === 'chorus' ? draft.effects[index] : effect), wet: value }));
      }
      const actions = el('div', 'vl-stage-actions');
      function order(delta: number) {
        if (!draft) return; const effects = [...draft.effects]; const other = effects[index + delta]; const selected = effects[index];
        if (!other || !selected) return; effects[index] = other; effects[index + delta] = selected; effectsChanged(effects); renderEffects(container); refreshStatus();
      }
      const up = button('↑', () => order(-1)); up.setAttribute('aria-label', `Move effect ${index + 1} earlier`); up.dataset.unavailable = String(index === 0);
      const down = button('↓', () => order(1)); down.setAttribute('aria-label', `Move effect ${index + 1} later`); down.dataset.unavailable = String(index === draft.effects.length - 1);
      const remove = button('Remove', () => { if (draft) effectsChanged(draft.effects.filter((_, i) => i !== index)); renderEffects(container); refreshStatus(); });
      for (const action of [up, down, remove]) action.dataset.fx = 'true';
      actions.append(up, down, remove); stage.append(actions); container.append(stage);
    }
    const add = el('div', 'vl-stage-actions');
    for (const kind of ['slapback', 'chorus'] satisfies readonly LiveEffectDefinition['kind'][]) {
      const action = button(`+ ${kind === 'slapback' ? 'Slapback' : 'Chorus'}`, () => {
        if (!draft) return;
        const effect: LiveEffectDefinition = kind === 'slapback' ? { kind, delayMs: 100, feedback: 0, wet: .25 } : { kind, rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 };
        effectsChanged([...draft.effects, effect]); renderEffects(container); refreshStatus();
      }); action.dataset.fx = 'true'; action.dataset.unavailable = String(draft.effects.length >= 64); add.append(action);
    }
    container.append(add, el('p', 'vl-note', 'Retained takes keep their recorded effects.')); refreshStatus();
  }
  function refreshStatus() {
    const revisionChanged = Boolean(draft && baseRevision !== data.document.revision);
    const saveDisabled = !draft || saving || data.locked || Boolean(data.availability) || revisionChanged;
    if (save.disabled !== saveDisabled) save.disabled = saveDisabled;
    // Native snapshots may arrive between pointer down/up. Preserve the button's text node.
    const saveLabel = saving ? 'Saving…' : 'Save voice';
    if (save.textContent !== saveLabel) save.textContent = saveLabel;
    for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>('input,select,textarea,button')) {
      control.disabled = saving || (control.dataset.fx === 'true' && data.locked) || control.dataset.unavailable === 'true';
    }
    for (const control of roster.querySelectorAll<HTMLButtonElement>('button')) control.disabled = saving;
    for (const control of [search, mobileSelect, close, importButton, importInput, exportButton, sqliteButton]) control.disabled = saving;
    manage.disabled = saving || Boolean(data.availability);
    if (!draft) { readback.textContent = ''; return; }
    const saved = data.document.voices.find(item => item.id === draft?.id);
    const row = data.rows.find(item => item.key === selectedSource) ?? boundRow(draft.id);
    const binding = row && data.document.bindings.find(item => sameSource(row, item));
    const mapped = row && binding?.voiceId === draft.id && binding.sourceLabel === row.sourceLabel;
    const native = mapped && row.profile !== null ? data.state?.voiceEffects?.find(item => item.profile === row.profile && item.prepared) : undefined;
    const persistence = revisionChanged ? 'Library changed · reopen this voice before saving' : dirty ? 'Unsaved changes' : saved ? 'Saved locally' : 'Not saved';
    const audio = !mapped || row.profile === null ? 'No audio input assigned' : native && saved && sameEffects(native.effects, saved.effects) ? 'Saved effects applied to audio' : 'Saved effects not applied to audio';
    readback.textContent = revisionChanged && !saving ? 'Library changed · reopen this voice to review the latest saved and applied state before saving.' : `${saving ? 'Saving locally…' : persistence} · ${audio}${data.locked ? ' · Stop transport to save effects.' : ''}`;
  }
  return {
    update(next: VoiceLibraryUpdate) {
      data = next; manage.disabled = Boolean(data.availability); libraryNotice.textContent = data.availability ?? '';
      renderEnsemble(); renderRoster(); refreshStatus();
    },
    openVoice,
    dispose() { if (dialog.open) dialog.close(); dialog.remove(); section.remove(); },
  };
}
