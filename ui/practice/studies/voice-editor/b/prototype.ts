export {};
type Effect = { kind: 'slapback'; delayMs: number; feedback: number; wet: number } | { kind: 'chorus'; rateHz: number; depthMs: number; baseDelayMs: number; wet: number };
type Character = '' | 'gator-original' | 'tapir-original' | 'gator-8bit' | 'tapir-16bit';
type Voice = { id: string; name: string; row: number; managed: boolean; character: Character; color: string; effects: Effect[]; notes: string };
const voices: Voice[] = [
 { id:'vocals',name:'Vocals',row:8,managed:true,character:'',color:'#e5e8da',effects:[{kind:'slapback',delayMs:100,feedback:0,wet:.25}],notes:'' },
 { id:'backup-vocals',name:'Backup Vocals',row:9,managed:true,character:'',color:'#e5e8da',effects:[{kind:'slapback',delayMs:100,feedback:0,wet:.25},{kind:'chorus',rateHz:.8,depthMs:5,baseDelayMs:20,wet:.35}],notes:'' },
 { id:'drums-claps',name:'Drums & Claps',row:10,managed:true,character:'',color:'#e9dfc3',effects:[],notes:'' },
 { id:'cowbell',name:'Cowbell',row:11,managed:true,character:'',color:'#e5e8da',effects:[],notes:'' },
 { id:'bing-bong',name:'Bing Bong',row:12,managed:true,character:'',color:'#e4ddeb',effects:[],notes:'' },
 { id:'whistle',name:'Whistle',row:13,managed:true,character:'',color:'#dde6ed',effects:[],notes:'' },
 { id:'bass',name:'Bass',row:14,managed:false,character:'tapir-original',color:'#e4ddeb',effects:[],notes:'Character preview only. No audio input is assigned.' },
 { id:'drums',name:'Drums',row:15,managed:false,character:'gator-original',color:'#e5e8da',effects:[],notes:'Character preview only. Sheet cue at the end of A.' },
];
const characters: readonly Character[] = ['', 'gator-original', 'tapir-original', 'gator-8bit', 'tapir-16bit'];
const colors = ['#e5e8da','#dde6ed','#e9dfc3','#e4ddeb'];
function element<T extends Element>(id:string, constructor:{new():T}):T { const value=document.getElementById(id); if(!(value instanceof constructor)) throw new Error(`Missing ${id}`); return value; }
const editor=element('editor',HTMLElement), shade=element('shade',HTMLElement), picker=element('voice-picker',HTMLSelectElement), character=element('character',HTMLSelectElement), binding=element('row-binding',HTMLSelectElement), name=element('voice-name',HTMLInputElement), notes=element('notes',HTMLTextAreaElement);
let selected=voices[6]; if(!selected) throw new Error('Missing sample voice');
let draft:Voice=structuredClone(selected);
let previouslyFocused:Element|null=null;
function escape(value:string) { return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c)); }
function avatar(voice:Voice):string { return voice.character ? `<img src="/assets/video/poses/${voice.character}-0.png" alt="${escape(voice.character.split('-')[0])} character preview">` : `<span class="initials">${escape(voice.name.slice(0,1))}</span>`; }
function renderCards() {
 const container=element('cast-strip',HTMLElement); container.replaceChildren();
 for(const voice of voices.filter(item=>!item.managed)) {
  const card=document.createElement('button'); card.type='button';card.className='cast-card';card.dataset.voice=voice.id;
  const active=voice.id==='drums';
  card.innerHTML=`<div class="avatar" style="background:${voice.color}">${avatar(voice)}</div><div><h3>${escape(voice.name)}</h3><div class="state ${active?'':'waiting'}"><i></i>${active?'Chart cue · 4e&a]':'No cue in this bar'}</div><div class="source">A${voice.row} · ${voice.effects.length?`${voice.effects.length} FX stages`:'Dry'}</div></div><span class="arrow">↗</span>`;
  card.addEventListener('click',()=>open(voice.id));container.append(card);
 }
}
function dirty() { element('editor-state',HTMLElement).textContent='Unsaved preview';element('save-message',HTMLElement).textContent='Changes do not edit Google Sheets.'; }
function renderCharacter() {
 const preview=element('character-preview',HTMLElement);preview.style.background=draft.color;preview.innerHTML=avatar(draft);
 const row=element('colors',HTMLElement);row.replaceChildren();
 for(const color of colors) { const button=document.createElement('button');button.type='button';button.className='color-dot';button.style.background=color;button.setAttribute('aria-label',`Avatar color ${colors.indexOf(color)+1}`);button.setAttribute('aria-pressed',String(draft.color===color));button.addEventListener('click',()=>{draft.color=color;renderCharacter();dirty();});row.append(button); }
}
function fields(effect:Effect):{label:string;key:string;value:number;min:number;max:number;step:number}[] {
 return effect.kind==='slapback' ? [{label:'Delay · ms',key:'delayMs',value:effect.delayMs,min:40,max:250,step:1},{label:'Feedback',key:'feedback',value:effect.feedback,min:0,max:.7,step:.01},{label:'Wet',key:'wet',value:effect.wet,min:0,max:1,step:.01}] : [{label:'Rate · Hz',key:'rateHz',value:effect.rateHz,min:.05,max:5,step:.05},{label:'Depth · ms',key:'depthMs',value:effect.depthMs,min:0,max:9,step:.1},{label:'Delay · ms',key:'baseDelayMs',value:effect.baseDelayMs,min:10,max:40,step:.1},{label:'Wet',key:'wet',value:effect.wet,min:0,max:1,step:.01}];
}
function renderEffects() {
 const container=element('effects',HTMLElement);container.replaceChildren();element('effect-count',HTMLElement).textContent=`${draft.effects.length} ${draft.effects.length===1?'stage':'stages'}`;
 if(!draft.effects.length){const empty=document.createElement('li');empty.className='dry';empty.textContent='Dry · no effect stages';container.append(empty);}
 draft.effects.forEach((effect,index)=>{
  const row=document.createElement('li');row.className='effect';
  row.innerHTML=`<div class="effect-line"><span class="effect-number">${index+1}</span><span class="effect-name">${effect.kind==='slapback'?'Slapback':'Chorus'}</span><button type="button" class="effect-action earlier" aria-label="Move stage ${index+1} earlier">↑</button><button type="button" class="effect-action later" aria-label="Move stage ${index+1} later">↓</button><button type="button" class="effect-action remove" aria-label="Remove stage ${index+1}">×</button></div><div class="effect-fields"></div>`;
  const earlier=row.querySelector('button.earlier'), later=row.querySelector('button.later'), remove=row.querySelector('button.remove'), controls=row.querySelector('.effect-fields');
  if(!(earlier instanceof HTMLButtonElement)||!(later instanceof HTMLButtonElement)||!(remove instanceof HTMLButtonElement)||!(controls instanceof HTMLElement))throw new Error('Missing stage controls');
  earlier.disabled=index===0;later.disabled=index===draft.effects.length-1;
  function move(direction:number){const other=index+direction;const next=[...draft.effects];const a=next[index],b=next[other];if(!a||!b)return;next[index]=b;next[other]=a;draft.effects=next;renderEffects();dirty();}
  earlier.addEventListener('click',()=>move(-1));later.addEventListener('click',()=>move(1));remove.addEventListener('click',()=>{draft.effects.splice(index,1);renderEffects();dirty();});
  for(const field of fields(effect)){const label=document.createElement('label');label.textContent=field.label;const input=document.createElement('input');input.type='number';input.required=true;input.value=String(field.value);input.min=String(field.min);input.max=String(field.max);input.step=String(field.step);input.addEventListener('input',()=>{const value=input.valueAsNumber;switch(field.key){case'wet':effect.wet=value;break;case'delayMs':if(effect.kind==='slapback')effect.delayMs=value;break;case'feedback':if(effect.kind==='slapback')effect.feedback=value;break;case'rateHz':if(effect.kind==='chorus')effect.rateHz=value;break;case'depthMs':if(effect.kind==='chorus')effect.depthMs=value;break;case'baseDelayMs':if(effect.kind==='chorus')effect.baseDelayMs=value;break;}dirty();});label.append(input);controls.append(label);}
  container.append(row);
 });
}
function renderEditor() {
 element('editor-name',HTMLElement).textContent=draft.name;picker.value=draft.id;character.value=draft.character;name.value=draft.name;notes.value=draft.notes;binding.value=String(draft.row);
 element('managed',HTMLElement).textContent=draft.managed?'AF · managed voice':'Reference voice · metadata enabled';
 element('source-note',HTMLElement).textContent=`Sheet 101 · A${draft.row} · ${draft.managed?'AF - ':''}${selected.name}. The source connection is stored separately from the voice label.`;
 element('editor-state',HTMLElement).textContent='Saved preview';element('save-message',HTMLElement).textContent='Changes do not edit Google Sheets.';element('error',HTMLElement).hidden=true;
 renderCharacter();renderEffects();
}
function open(id:string){const voice=voices.find(item=>item.id===id);if(!voice)return;selected=voice;draft=structuredClone(voice);previouslyFocused=document.activeElement;editor.hidden=false;shade.hidden=false;document.body.style.overflow='hidden';renderEditor();element('close',HTMLButtonElement).focus();}
function close(){editor.hidden=true;shade.hidden=true;document.body.style.overflow='';if(previouslyFocused instanceof HTMLElement)previouslyFocused.focus();}
for(const voice of voices){const option=document.createElement('option');option.value=voice.id;option.textContent=`${voice.name}${voice.managed?' · AF':''}`;picker.append(option);const row=document.createElement('option');row.value=String(voice.row);row.textContent=`A${voice.row} — ${voice.managed?'AF - ':''}${voice.name}`;binding.append(row);}
picker.addEventListener('change',()=>open(picker.value));
character.addEventListener('change',()=>{const value=characters.find(item=>item===character.value);if(value===undefined)return;draft.character=value;renderCharacter();dirty();});
name.addEventListener('input',()=>{draft.name=name.value;dirty();});notes.addEventListener('input',()=>{draft.notes=notes.value;dirty();});
binding.addEventListener('change',()=>{const row=Number(binding.value),owner=voices.find(voice=>voice.row===row&&voice.id!==draft.id);const error=element('error',HTMLElement);if(owner){error.textContent=`This row is connected to ${owner.name}. Choose an unassigned source row in the final editor.`;error.hidden=false;binding.value=String(draft.row);return;}draft.row=row;dirty();});
element('add-slapback',HTMLButtonElement).addEventListener('click',()=>{draft.effects.push({kind:'slapback',delayMs:100,feedback:0,wet:.25});renderEffects();dirty();});
element('add-chorus',HTMLButtonElement).addEventListener('click',()=>{draft.effects.push({kind:'chorus',rateHz:.8,depthMs:5,baseDelayMs:20,wet:.35});renderEffects();dirty();});
element('save',HTMLButtonElement).addEventListener('click',()=>{if(!draft.name.trim()){name.reportValidity();name.focus();return;}const inputs=[...editor.querySelectorAll('input')];if(!inputs.every(input=>input.reportValidity()))return;Object.assign(selected,structuredClone(draft));renderCards();element('editor-name',HTMLElement).textContent=selected.name;element('editor-state',HTMLElement).textContent='Saved preview';element('save-message',HTMLElement).textContent='Saved in this page. Reload resets the study.';});
element('close',HTMLButtonElement).addEventListener('click',close);shade.addEventListener('click',close);
document.addEventListener('keydown',event=>{if(editor.hidden)return;if(event.key==='Escape'){event.preventDefault();close();}if(event.key==='Tab'){const focusable=[...editor.querySelectorAll('button,select,input,textarea,a')].filter(item=>item instanceof HTMLElement&&!item.hasAttribute('disabled'));const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first&&last instanceof HTMLElement){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last&&first instanceof HTMLElement){event.preventDefault();first.focus();}}});
element('browse',HTMLButtonElement).addEventListener('click',()=>open('vocals'));
for(const button of document.querySelectorAll('[data-open]'))if(button instanceof HTMLButtonElement)button.addEventListener('click',()=>open(button.dataset.open??''));
for(const id of ['sample-start','sample-stop','sample-panic','demo-record'])element(id,HTMLButtonElement).addEventListener('click',()=>{element('desk-message',HTMLElement).textContent='Layout study only — no audio or microphone is started.';});
element('export',HTMLButtonElement).addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify({prototypeOnly:true,version:1,voices},null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='cast-strip-preview.json';link.click();URL.revokeObjectURL(url);});
renderCards();
