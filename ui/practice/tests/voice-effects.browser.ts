import { initialVoiceEffects } from '../../../lib/performance/vocal-effects.js';
import { createVoiceEffectsEditor } from '../voice-effects.js';
import { DEFAULT_LIVE_PROFILE, ROTATION_LIVE_PROFILE, type VoiceEffectsState } from '../../../lib/performance/model.js';
const status = document.createElement('pre'); status.id = 'test-results'; document.body.prepend(status);
const results: string[] = [];
window.addEventListener('error', event => { status.textContent += `\nFAIL ${event.message}`; document.title = 'FAIL: effect rows'; });
function check(value: unknown, name: string) { if (!value) throw new Error(name); results.push(`PASS ${name}`); status.textContent = results.join('\n'); }
const host = document.createElement('div'); host.id = 'fx-test-host'; host.style.cssText = 'position:fixed; left:-200vw; width:420px'; document.body.append(host);
let applying: number | undefined;
const editor = createVoiceEffectsEditor(profile => { applying = profile; });
const voice = { id: 'vocals', name: 'Vocals', profile: DEFAULT_LIVE_PROFILE };
const backing = { id: 'backup', name: 'Backup Vocals', profile: ROTATION_LIVE_PROFILE };
const configurations = initialVoiceEffects({ parts: [], sourceProfiles: [
  { ...voice, source: { sheetId: 0, a1: 'A1', text: '', note: '' } },
  { ...backing, source: { sheetId: 0, a1: 'A2', text: '', note: '' } },
] });
editor.reset(configurations);
const vox = document.createElement('div'), backup = document.createElement('div'), dry = document.createElement('div'); host.append(vox, backup, dry);
editor.mount(voice, vox, () => {});
editor.mount(backing, backup, () => {});
editor.mount({ id: 'dry', name: 'Dry', profile: 0 }, dry, () => {});
check(vox.querySelectorAll('.fx-stage').length === 1, 'one Vocals effect row');
check(backup.querySelectorAll('.fx-stage').length === 2, 'two Backup Vocals effect rows');
check(!dry.querySelectorAll('.fx-stage').length && dry.querySelector<HTMLElement>('.voice-effects')?.hidden, 'dry voice has no visible effect region');
const input = vox.querySelector<HTMLInputElement>('input'); if (!input) throw new Error('missing knob');
input.value = '125'; input.dispatchEvent(new Event('input', { bubbles: true }));
const effect = editor.configurations().find(item => item.profile === DEFAULT_LIVE_PROFILE)?.effects[0];
check(effect?.kind === 'slapback' && effect.delayMs === 125, 'knob changes actual effect draft');
const states: VoiceEffectsState[] = configurations.map(config => ({ ...config, prepared: true, revision: 1, activity: 'standby', rotationEligible: false, rotationRemainingBeats: 0 }));
editor.render(states, false); editor.render(states, false);
check(vox.querySelector('input') === input && input.value === '125', 'native render preserves knob identity and pending edit');
check(editor.configurations(ROTATION_LIVE_PROFILE).find(item => item.profile === DEFAULT_LIVE_PROFILE)?.effects[0]?.kind === 'slapback' && JSON.stringify(editor.configurations(ROTATION_LIVE_PROFILE).find(item => item.profile === DEFAULT_LIVE_PROFILE)?.effects) === JSON.stringify(states.find(item => item.profile === DEFAULT_LIVE_PROFILE)?.effects), 'applying another profile preserves applied Vocals');
vox.querySelector<HTMLButtonElement>('.fx-apply')?.click(); check(applying === DEFAULT_LIVE_PROFILE, 'Apply targets this voice');
check(!vox.querySelector<HTMLButtonElement>('.fx-apply')?.hidden, 'Apply waits for native acknowledgement');
const changed = editor.configurations().find(item => item.profile === DEFAULT_LIVE_PROFILE); if (!changed) throw new Error('missing draft');
editor.render(states.map(state => state.profile === DEFAULT_LIVE_PROFILE ? { ...state, effects: changed.effects } : state), false);
check(vox.querySelector<HTMLButtonElement>('.fx-apply')?.hidden, 'native acknowledgement clears pending state');
editor.render(states, true); check(input.disabled && vox.querySelector<HTMLButtonElement>('.fx-apply')?.disabled, 'running lock disables knobs and Apply');
editor.setEffects(DEFAULT_LIVE_PROFILE, []); editor.render(states, false);
check(!vox.querySelectorAll('.fx-stage').length && !vox.querySelector<HTMLElement>('.voice-effects')?.hidden && !vox.querySelector<HTMLButtonElement>('.fx-apply')?.hidden, 'pending dry change keeps Apply accessible');
editor.render(states.map(state => state.profile === DEFAULT_LIVE_PROFILE ? { ...state, effects: [] } : state), false);
check(vox.querySelector<HTMLElement>('.voice-effects')?.hidden, 'acknowledged dry hides effect region');
const remote = document.createElement('div'); host.append(remote); editor.mount({ id: 'remote', name: 'Remote', profile: DEFAULT_LIVE_PROFILE }, remote);
const openStack = remote.querySelector<HTMLButtonElement>('.fx-empty');
check(openStack?.textContent === 'Effects', 'remote dry voice retains stack management');
openStack?.click();
const stack = remote.querySelector<HTMLDialogElement>('.fx-editor');
check(stack?.open, 'effects open a dialog without expanding the voice');
stack?.querySelector<HTMLButtonElement>('.fx-editor-add button')?.click();
check(remote.querySelectorAll('.fx-stage').length === 1, 'remote dry voice can add an effect');
stack?.querySelector<HTMLButtonElement>('.dialog-heading button')?.click();
check(stack && !stack.open, 'Done closes the stack editor');
editor.setEffects(DEFAULT_LIVE_PROFILE, [
  { kind: 'slapback', delayMs: 100.4, feedback: .203, wet: .357 },
  { kind: 'chorus', rateHz: .82, depthMs: 5.13, baseDelayMs: 20.17, wet: .321 },
]);
const precise = Array.from(vox.querySelectorAll<HTMLInputElement>('input')).map(control => control.valueAsNumber);
check(JSON.stringify(precise) === JSON.stringify([100.4, .203, .357, .82, 5.13, 20.17, .321]), 'saved off-step values remain exact in every knob');
check(vox.querySelector('input')?.getAttribute('aria-valuetext') === '100.4 ms', 'accessible value preserves saved decimal precision');
editor.setEffects(DEFAULT_LIVE_PROFILE, [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: NaN }]);
const invalidWet = vox.querySelectorAll<HTMLInputElement>('input')[2];
check(invalidWet?.getAttribute('aria-invalid') === 'true' && !invalidWet.checkValidity(), 'invalid library draft stays visibly invalid and cannot apply');
const frame = document.querySelector<HTMLIFrameElement>('iframe');
frame?.addEventListener('load', () => {
  const doc = frame.contentDocument;
  if (!doc) throw new Error('Missing same-origin practice document');
  const verifyLayout = () => {
    if (!doc.querySelector('.live-voices .fx-stage')) return;
    observer.disconnect();
    check(doc.documentElement.scrollWidth <= 390, '390px practice page has no horizontal overflow');
    document.title = 'PASS: effect rows';
  };
  const observer = new MutationObserver(verifyLayout);
  observer.observe(doc.body, { childList: true, subtree: true }); verifyLayout();
});
status.textContent = results.join('\n');
