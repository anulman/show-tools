import { createEffectKnob } from './effect-knob.js';
import { VOICE_PROFILE_COUNT, ROTATION_LIVE_PROFILE, DEFAULT_LIVE_PROFILE } from '../../lib/performance/model.js';
import type { LiveEffectDefinition, VoiceEffectConfiguration, VoiceEffectsState } from '../../lib/performance/model.js';

type Voice = { id: string; name: string; profile: number };
type Knob = ReturnType<typeof createEffectKnob> & { value: () => number };
type Footer = { edit?: () => void; voice: Voice; root: HTMLElement; pending: HTMLSpanElement; controls: HTMLInputElement[]; buttons: HTMLButtonElement[]; knobs: Knob[]; apply?: HTMLButtonElement };
const slapback = (): LiveEffectDefinition => ({ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 });
const chorus = (): LiveEffectDefinition => ({ kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 });
export function initialVoiceEffects(mode: 'compiled' | 'dry' = 'compiled', sourceProfiles: readonly number[] = []): VoiceEffectConfiguration[] {
  return Array.from({ length: VOICE_PROFILE_COUNT }, (_, profile) => ({ profile,
    effects: mode === 'dry' || sourceProfiles.includes(profile) ? [] : profile === ROTATION_LIVE_PROFILE ? [slapback(), chorus()] : profile === DEFAULT_LIVE_PROFILE ? [slapback()] : [] }));
}
export function effectSummary(effects: readonly LiveEffectDefinition[]): string {
  return effects.map(effect => effect.kind === 'slapback'
    ? `Slapback · ${effect.delayMs} ms · ${Math.round(effect.wet * 100)}%`
    : `Chorus · ${effect.rateHz} Hz · ${Math.round(effect.wet * 100)}%`).join(' → ') || 'Dry';
}
export function createVoiceEffectsEditor(onApply: (profile: number) => void) {
  let mode: 'compiled' | 'dry' = 'compiled';
  let drafts = initialVoiceEffects(mode);
  let applied: readonly VoiceEffectsState[] = [];
  let locked = false;
  const footers: Footer[] = [];
  function draft(profile: number) { return drafts.find(item => item.profile === profile)?.effects ?? []; }
  function dirty(profile: number) {
    const native = applied.find(item => item.profile === profile && item.prepared);
    return !native || JSON.stringify(native.effects) !== JSON.stringify(draft(profile));
  }
  function refresh() {
    for (const footer of footers) {
      const native = applied.find(item => item.profile === footer.voice.profile && item.prepared);
      const empty = !draft(footer.voice.profile).length && !native?.effects.length;
      footer.root.hidden = empty && Boolean(footer.edit);
      footer.pending.hidden = empty;
      footer.pending.title = native ? `Applied: ${effectSummary(native.effects)}` : 'Not yet prepared by the audio engine';
      const status = dirty(footer.voice.profile) ? 'Unapplied' : 'Applied';
      if (footer.pending.textContent !== status) footer.pending.textContent = status;
      footer.pending.dataset.dirty = String(dirty(footer.voice.profile));
      footer.root.dataset.prepared = String(Boolean(native));
      for (const knob of footer.knobs) {
        knob.setValue(knob.value());
        if (locked) knob.cancelDrag();
      }
      for (const input of footer.controls) input.disabled = locked;
      for (const button of footer.buttons) button.disabled = locked || button.dataset.unavailable === 'true';
      if (footer.apply) { footer.apply.hidden = empty || !dirty(footer.voice.profile); footer.apply.disabled = locked || !dirty(footer.voice.profile); }
    }
  }
  function setProfileEffects(profile: number, effects: readonly LiveEffectDefinition[]) {
    drafts = drafts.map(item => item.profile === profile ? { ...item, effects: effects.map(effect => ({ ...effect })) } : item);
    for (const footer of footers.filter(item => item.voice.profile === profile)) renderFields(footer);
    refresh();
  }
  function renderFields(footer: Footer) {
    for (const knob of footer.knobs) knob.cancelDrag();
    footer.root.replaceChildren();
    footer.controls = []; footer.buttons = []; footer.knobs = [];
    const body = document.createElement('div'); body.className = 'fx-body';
    const effects = draft(footer.voice.profile);
    function action(label: string, run: () => void, unavailable = false) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
      button.dataset.unavailable = String(unavailable); button.disabled = locked || unavailable;
      button.addEventListener('click', run); footer.buttons.push(button); return button;
    }
    function replace(index: number, effect: LiveEffectDefinition) {
      drafts = drafts.map(item => item.profile === footer.voice.profile ? { ...item, effects: item.effects.map((old, i) => i === index ? effect : old) } : item);
      refresh();
    }
    for (const [index, effect] of effects.entries()) {
      const stage = document.createElement('fieldset'); stage.className = 'fx-stage';
      const legend = document.createElement('legend'); legend.textContent = `${index + 1}. ${effect.kind === 'slapback' ? 'Slapback' : 'Chorus'}`;
      stage.dataset.effect = effect.kind; stage.append(legend);
      const knobs = document.createElement('div'); knobs.className = 'fx-knobs';
      knobs.style.setProperty('--knob-count', String(effect.kind === 'slapback' ? 3 : 4)); stage.append(knobs);
      function field(label: string, read: () => number, min: number, max: number, step: number, format: (value: number) => string, update: (value: number) => void) {
        const knob = createEffectKnob({ label, accessibleName: `${footer.voice.name}, ${legend.textContent}, ${label}`,
          value: read(), min, max, step, format, onInput: update });
        knobs.append(knob.root); footer.controls.push(knob.input); footer.knobs.push({ ...knob, value: read });
      }
      const ms = (value: number) => `${value} ms`;
      const percent = (value: number) => `${Number((value * 100).toFixed(4))}%`;
      const current = () => draft(footer.voice.profile)[index];
      if (effect.kind === 'slapback') {
        field('Delay', () => { const old = current(); return old?.kind === 'slapback' ? old.delayMs : effect.delayMs; }, 40, 250, 1, ms, value => { const old = current(); if (old?.kind === 'slapback') replace(index, { ...old, delayMs: value }); });
        field('Feedback', () => { const old = current(); return old?.kind === 'slapback' ? old.feedback : effect.feedback; }, 0, .7, .01, percent, value => { const old = current(); if (old?.kind === 'slapback') replace(index, { ...old, feedback: value }); });
        field('Wet', () => current()?.wet ?? effect.wet, 0, 1, .01, percent, value => { const old = current(); if (old?.kind === 'slapback') replace(index, { ...old, wet: value }); });
      } else {
        field('Rate', () => { const old = current(); return old?.kind === 'chorus' ? old.rateHz : effect.rateHz; }, .05, 5, .05, value => `${value} Hz`, value => { const old = current(); if (old?.kind === 'chorus') replace(index, { ...old, rateHz: value }); });
        field('Depth', () => { const old = current(); return old?.kind === 'chorus' ? old.depthMs : effect.depthMs; }, 0, 9, .1, ms, value => { const old = current(); if (old?.kind === 'chorus') replace(index, { ...old, depthMs: value }); });
        field('Delay', () => { const old = current(); return old?.kind === 'chorus' ? old.baseDelayMs : effect.baseDelayMs; }, 10, 40, .1, ms, value => { const old = current(); if (old?.kind === 'chorus') replace(index, { ...old, baseDelayMs: value }); });
        field('Wet', () => current()?.wet ?? effect.wet, 0, 1, .01, percent, value => { const old = current(); if (old?.kind === 'chorus') replace(index, { ...old, wet: value }); });
      }
      if (!footer.edit) {
        const actions = document.createElement('div'); actions.className = 'fx-stage-actions';
        const change = (stages: readonly LiveEffectDefinition[]) => setProfileEffects(footer.voice.profile, stages);
        actions.append(action('↑', () => {
          const next = [...draft(footer.voice.profile)]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; change(next);
        }, index === 0));
        actions.lastElementChild?.setAttribute('aria-label', `Move ${legend.textContent} earlier for ${footer.voice.name}`);
        actions.append(action('↓', () => {
          const next = [...draft(footer.voice.profile)]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; change(next);
        }, index === effects.length - 1));
        actions.lastElementChild?.setAttribute('aria-label', `Move ${legend.textContent} later for ${footer.voice.name}`);
        actions.append(action('Remove', () => change(draft(footer.voice.profile).filter((_, i) => i !== index))));
        stage.append(actions);
      }
      body.append(stage);
    }
    const actions = document.createElement('div'); actions.className = 'fx-actions';
    const management = document.createElement('details'); management.className = 'fx-management';
    const managementLabel = document.createElement('summary'); managementLabel.textContent = effects.length ? 'Edit stack' : 'Add effect';
    management.append(managementLabel);
    management.open = footer.root.dataset.editing === 'true';
    management.addEventListener('toggle', () => { footer.root.dataset.editing = String(management.open); });
    if (footer.edit) actions.append(action('Edit stack', footer.edit));
    else actions.append(management);
    for (const [label, factory] of [['+ Slapback', slapback], ['+ Chorus', chorus]] satisfies readonly [string, () => LiveEffectDefinition][]) {
      if (!footer.edit) management.append(action(label, () => {
        setProfileEffects(footer.voice.profile, [...draft(footer.voice.profile), factory()]);
      }, effects.length >= 64));
    }
    actions.append(footer.pending);
    const apply = action('Apply settings', () => {
      if (footer.controls.every(input => input.reportValidity())) onApply(footer.voice.profile);
    }); apply.className = 'fx-apply'; footer.apply = apply; actions.append(apply); body.append(actions); footer.root.append(body);
  }
  return {
    reset(nextMode: 'compiled' | 'dry') { for (const footer of footers) for (const knob of footer.knobs) knob.cancelDrag(); mode = nextMode; drafts = initialVoiceEffects(mode); applied = []; footers.length = 0; },
    setEffects: setProfileEffects,
    mount(voice: Voice, container: HTMLElement, edit?: () => void) {
      const root = document.createElement('section'); root.className = 'voice-effects'; root.dataset.voice = voice.id;
      root.setAttribute('aria-label', `${voice.name} effects`);
      root.addEventListener('wheel', event => event.stopPropagation());
      container.append(root);
      const pending = document.createElement('span'); pending.className = 'fx-state';
      const footer: Footer = { edit, voice, root, pending, controls: [], buttons: [], knobs: [] };
      footers.push(footer); renderFields(footer); refresh();
    },
    configurations(profile?: number): readonly VoiceEffectConfiguration[] {
      const defaults = initialVoiceEffects(mode);
      return drafts.map(item => ({ profile: item.profile, effects: (profile === undefined || profile === item.profile ? item.effects
        : applied.find(state => state.profile === item.profile && state.prepared)?.effects ?? defaults.find(state => state.profile === item.profile)?.effects ?? []).map(effect => ({ ...effect })) }));
    },
    render(states: readonly VoiceEffectsState[] | undefined, isLocked: boolean) { applied = states ?? []; locked = isLocked; refresh(); },
  };
}
