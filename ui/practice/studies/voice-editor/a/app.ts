export {};
type Character = 'unassigned' | 'gator-original' | 'tapir-original';
type Effect = { kind: 'Slapback' | 'Chorus'; amount: number };
type Voice = { id: string; name: string; cell: string; managed: boolean; character: Character; effects: Effect[]; saved: boolean };
const voices: Voice[] = [
  { id: 'bass', name: 'Bass', cell: 'A14', managed: false, character: 'unassigned', effects: [], saved: true },
  { id: 'drums', name: 'Drums', cell: 'A15', managed: false, character: 'unassigned', effects: [], saved: true },
  ...[['vocals','Vocals','A8'],['backup','Backup Vocals','A9'],['drums-claps','Drums & Claps','A10'],['cowbell','Cowbell','A11'],['bing-bong','Bing Bong','A12'],['whistle','Whistle','A13']].map(([id,name,cell]): Voice => ({ id, name, cell, managed: true, character: 'unassigned', effects: [], saved: true })),
];
function element<T extends Element>(selector: string, kind: { new(): T }): T {
  const found = document.querySelector(selector);
  if (!(found instanceof kind)) throw new Error(`Missing ${selector}`);
  return found;
}
function escape(value: string) { return value.replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character] ?? character); }
function portrait(voice: Voice) { return voice.character === 'unassigned' ? escape(voice.name.slice(0, 1)) : `<img src="/assets/video/poses/${voice.character}-0.png" alt="${voice.character === 'gator-original' ? 'Gator' : 'Tapir'} character artwork">`; }
function selected(value: string, expected: string) { return value === expected ? 'selected' : ''; }
function toast(message: string) { const target = element('#toast', HTMLDivElement); target.textContent = message; target.hidden = false; }
function renderVoice(voice: Voice, open = false) {
  const row = document.createElement('details'); row.className = 'voice'; row.dataset.voice = voice.id; row.open = open;
  row.innerHTML = `<summary><span class="avatar">${portrait(voice)}</span><span><span class="voice-title">${escape(voice.name)}</span>${voice.managed ? '<span class="managed">AF</span>' : ''}<span class="voice-source" style="display:block">DYC · ${voice.cell} · ${voice.managed ? 'Managed voice' : 'Sheet part'}</span></span><span class="cue">${voice.managed ? 'Edit voice' : 'No cue in this bar'}<small>${voice.managed ? `${voice.effects.length} EFFECT${voice.effects.length === 1 ? '' : 'S'}` : 'CHART CUE · NOT AUDIO DETECTION'}</small></span></summary>
    <div class="inspector"><p class="inspect-heading">${escape(voice.name)} <span style="font-weight:400;color:#8d9980">/ voice settings</span></p><div class="fields"><label class="field">Voice name<input name="name" aria-label="${escape(voice.name)} name"></label><label class="field">Character<select name="character" aria-label="Character for ${escape(voice.name)}"><option value="unassigned" ${selected(voice.character,'unassigned')}>Unassigned</option><option value="gator-original" ${selected(voice.character,'gator-original')}>Gator · Original</option><option value="tapir-original" ${selected(voice.character,'tapir-original')}>Tapir · Original</option></select></label></div><div class="character"><span class="portrait">${portrait(voice)}</span><div><p>${voice.character === 'unassigned' ? 'No character attached' : `${voice.character === 'gator-original' ? 'Gator' : 'Tapir'} · Original`}</p><small>${voice.character === 'unassigned' ? 'Choose artwork for the Video engine.' : 'Approved artwork · Figma-linked character'}</small></div></div><div class="subhead"><span>Ordered effects</span><small>${voice.managed ? 'Saved settings ≠ native applied state' : 'No audio input assigned'}</small></div><div class="stages">${voice.effects.length ? voice.effects.map((effect,index) => `<div class="stage"><span class="order">${String(index+1).padStart(2,'0')}</span><span><span class="effect-name">${effect.kind}</span><span class="effect-params" style="display:block">${effect.kind === 'Slapback' ? '100 ms delay · no feedback' : '.8 Hz · 5 ms depth'} · ${effect.amount}% wet</span></span><span class="stage-actions"><button type="button" data-up="${index}" aria-label="Move effect ${index+1} up" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-down="${index}" aria-label="Move effect ${index+1} down" ${index === voice.effects.length-1 ? 'disabled' : ''}>↓</button><button type="button" data-remove="${index}" aria-label="Remove effect ${index+1}">×</button></span></div>`).join('') : '<div class="empty">Dry · no effects in this voice’s stack.</div>'}</div><div class="effect-add"><button type="button" data-add="Slapback">+ Slapback</button><button type="button" data-add="Chorus">+ Chorus</button></div><div class="binding"><span>Sheet binding <strong>01 Dance Yrself Clean · ${voice.cell}</strong></span><span>${voice.managed ? 'AF managed' : 'Other part'}</span></div><div class="inspect-footer"><span class="save-state">${voice.saved ? 'Saved in this preview' : 'Unsaved changes'}<br>Existing takes keep their recorded effects.</span><button type="button" class="save">Save voice</button></div></div>`;
  const name = row.querySelector('input');
  if (name instanceof HTMLInputElement) {
    name.value = voice.name;
    name.addEventListener('input', () => { voice.name = name.value; voice.saved = false; const status = row.querySelector('.save-state'); if (status) status.textContent = 'Unsaved changes'; });
  }
  const character = row.querySelector('select');
  if (character instanceof HTMLSelectElement) character.addEventListener('change', () => {
    const value = character.value;
    if (value !== 'unassigned' && value !== 'gator-original' && value !== 'tapir-original') return;
    voice.character = value; voice.saved = false; row.replaceWith(renderVoice(voice, true));
  });
  for (const button of row.querySelectorAll('button')) button.addEventListener('click', () => {
    if (button.classList.contains('save')) { voice.saved = true; row.replaceWith(renderVoice(voice, true)); toast(`${voice.name} saved in this preview`); return; }
    const added = button.dataset.add;
    if (added === 'Slapback' || added === 'Chorus') voice.effects.push({ kind: added, amount: added === 'Slapback' ? 25 : 35 });
    if (button.dataset.remove !== undefined) voice.effects.splice(Number(button.dataset.remove), 1);
    const up = button.dataset.up, down = button.dataset.down;
    if (up !== undefined) { const index = Number(up); [voice.effects[index - 1],voice.effects[index]] = [voice.effects[index],voice.effects[index - 1]]; }
    if (down !== undefined) { const index = Number(down); [voice.effects[index + 1],voice.effects[index]] = [voice.effects[index],voice.effects[index + 1]]; }
    voice.saved = false; row.replaceWith(renderVoice(voice, true));
  });
  return row;
}
for (const voice of voices) element(voice.managed ? '#managed-rows' : '#ensemble-rows', HTMLDivElement).append(renderVoice(voice));
const libraryToggle = element('#library-toggle', HTMLButtonElement), library = element('#library', HTMLElement);
libraryToggle.addEventListener('click', () => { library.hidden = !library.hidden; libraryToggle.setAttribute('aria-expanded', String(!library.hidden)); libraryToggle.textContent = library.hidden ? 'Manage voices ↗' : 'Close library −'; });
element('#export', HTMLButtonElement).addEventListener('click', () => {
  const data = new Blob([JSON.stringify({ prototype: 'A', sampleStates: true, voices }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(data), link = document.createElement('a'); link.href = url; link.download = 'voice-library-preview.json'; link.click(); URL.revokeObjectURL(url);
});
element('#preview-status', HTMLButtonElement).addEventListener('click', () => toast('Sample transport only — this prototype does not run audio.'));
