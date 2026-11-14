import { VOICE_PROFILE_COUNT, ROTATION_LIVE_PROFILE, DEFAULT_LIVE_PROFILE } from '../../lib/performance/model.js';
import type { LiveEffectDefinition, VoiceEffectConfiguration, VoiceEffectsState } from '../../lib/performance/model.js';

type Voice = { id: string; name: string; profile: number };
type Footer = { edit?: () => void; voice: Voice; root: HTMLDetailsElement; summary: HTMLSpanElement; pending: HTMLSpanElement; controls: HTMLInputElement[]; buttons: HTMLButtonElement[] };
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
      const summary = native ? effectSummary(native.effects) : effectSummary(draft(footer.voice.profile));
      if (footer.summary.textContent !== summary) footer.summary.textContent = summary;
      const status = dirty(footer.voice.profile) ? 'Unapplied' : 'Applied';
      if (footer.pending.textContent !== status) footer.pending.textContent = status;
      footer.pending.dataset.dirty = String(dirty(footer.voice.profile));
      footer.root.dataset.prepared = String(Boolean(native));
      for (const input of footer.controls) input.disabled = locked;
      for (const button of footer.buttons) button.disabled = locked || button.dataset.unavailable === 'true';
    }
  }
  function renderFields(footer: Footer) {
    footer.root.querySelector('.fx-body')?.remove();
    if (footer.edit) return;
    footer.controls = []; footer.buttons = [];
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
      stage.append(legend);
      function field(label: string, value: number, min: number, max: number, step: number, update: (value: number) => void) {
        const wrapper = document.createElement('label'); wrapper.textContent = label;
        const input = document.createElement('input'); input.type = 'number'; input.value = String(value);
        input.required = true; input.min = String(min); input.max = String(max); input.step = String(step); input.inputMode = 'decimal';
        input.setAttribute('aria-label', `${footer.voice.name}, ${index + 1}. ${legend.textContent?.split('. ')[1]}, ${label}`);
        input.addEventListener('input', () => update(input.valueAsNumber));
        wrapper.append(input); stage.append(wrapper); footer.controls.push(input);
      }
      const current = () => draft(footer.voice.profile)[index];
      if (effect.kind === 'slapback') {
        field('Delay · ms', effect.delayMs, 40, 250, 1, value => { const old = current(); if (old?.kind === 'slapback') replace(index, { ...old, delayMs: value }); });
        field('Feedback', effect.feedback, 0, .7, .01, value => { const old = current(); if (old?.kind === 'slapback') replace(index, { ...old, feedback: value }); });
        field('Wet', effect.wet, 0, 1, .01, value => { const old = current(); if (old?.kind === 'slapback') replace(index, { ...old, wet: value }); });
      } else {
        field('Rate · Hz', effect.rateHz, .05, 5, .05, value => { const old = current(); if (old?.kind === 'chorus') replace(index, { ...old, rateHz: value }); });
        field('Depth · ms', effect.depthMs, 0, 9, .1, value => { const old = current(); if (old?.kind === 'chorus') replace(index, { ...old, depthMs: value }); });
        field('Delay · ms', effect.baseDelayMs, 10, 40, .1, value => { const old = current(); if (old?.kind === 'chorus') replace(index, { ...old, baseDelayMs: value }); });
        field('Wet', effect.wet, 0, 1, .01, value => { const old = current(); if (old?.kind === 'chorus') replace(index, { ...old, wet: value }); });
      }
      const actions = document.createElement('div'); actions.className = 'fx-stage-actions';
      function change(stages: readonly LiveEffectDefinition[]) {
        drafts = drafts.map(item => item.profile === footer.voice.profile ? { ...item, effects: stages } : item);
        renderFields(footer); refresh();
      }
      actions.append(action('↑', () => {
        const next = [...draft(footer.voice.profile)]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; change(next);
      }, index === 0));
      actions.lastElementChild?.setAttribute('aria-label', `Move ${legend.textContent} earlier for ${footer.voice.name}`);
      actions.append(action('↓', () => {
        const next = [...draft(footer.voice.profile)]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; change(next);
      }, index === effects.length - 1));
      actions.lastElementChild?.setAttribute('aria-label', `Move ${legend.textContent} later for ${footer.voice.name}`);
      actions.append(action('Remove', () => change(draft(footer.voice.profile).filter((_, i) => i !== index))));
      stage.append(actions); body.append(stage);
    }
    const actions = document.createElement('div'); actions.className = 'fx-actions';
    for (const [label, factory] of [['+ Slapback', slapback], ['+ Chorus', chorus]] satisfies readonly [string, () => LiveEffectDefinition][]) {
      actions.append(action(label, () => {
        drafts = drafts.map(item => item.profile === footer.voice.profile ? { ...item, effects: [...item.effects, factory()] } : item);
        renderFields(footer); refresh();
      }, effects.length >= 64));
    }
    const note = document.createElement('p'); note.className = 'fx-note'; note.textContent = 'Retained takes keep recorded effects.'; body.append(note);
    const apply = action('Apply settings', () => {
      if (footer.controls.every(input => input.reportValidity())) onApply(footer.voice.profile);
    }); apply.className = 'fx-apply'; actions.append(apply); body.append(actions); footer.root.append(body);
  }
  return {
    reset(nextMode: 'compiled' | 'dry') { mode = nextMode; drafts = initialVoiceEffects(mode); applied = []; footers.length = 0; },
    setEffects(profile: number, effects: readonly LiveEffectDefinition[]) {
      drafts = drafts.map(item => item.profile === profile ? { ...item, effects: effects.map(effect => ({ ...effect })) } : item);
      for (const footer of footers.filter(item => item.voice.profile === profile)) renderFields(footer);
      refresh();
    },
    mount(voice: Voice, container: HTMLElement, edit?: () => void) {
      const root = document.createElement('details'); root.className = 'voice-effects'; root.dataset.voice = voice.id;
      const summaryElement = document.createElement('summary');
      const label = document.createElement('span'); label.className = 'fx-label'; label.textContent = 'FX';
      const summary = document.createElement('span'); summary.className = 'fx-summary';
      const pending = document.createElement('span'); pending.className = 'fx-state';
      summaryElement.append(label, summary, pending); root.append(summaryElement); container.append(root);
      if (edit) summaryElement.addEventListener('click', event => { event.preventDefault(); edit(); });
      const footer: Footer = { edit, voice, root, summary, pending, controls: [], buttons: [] };
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
