import { dismissOnBackdrop } from './dialog.js';
import { createEffectKnob } from './effect-knob.js';
import { VOICE_PROFILE_COUNT, ROTATION_LIVE_PROFILE, DEFAULT_LIVE_PROFILE } from '../../lib/performance/model.js';
import type { LiveEffectDefinition, VoiceEffectConfiguration, VoiceEffectsState } from '../../lib/performance/model.js';

type Voice = { id: string; name: string; profile: number };
type Knob = ReturnType<typeof createEffectKnob> & { value: () => number };
type Footer = { titles: HTMLButtonElement[]; edit?: () => void; voice: Voice; root: HTMLElement; editor: HTMLDialogElement; editorBody: HTMLElement; open: HTMLButtonElement; controls: HTMLInputElement[]; buttons: HTMLButtonElement[]; knobs: Knob[]; apply?: HTMLButtonElement };
const slapback = (): LiveEffectDefinition => ({ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 });
const chorus = (): LiveEffectDefinition => ({ kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 });
export function initialVoiceEffects(mode: 'compiled' | 'dry' = 'compiled', sourceProfiles: readonly number[] = []): VoiceEffectConfiguration[] {
  return Array.from({ length: VOICE_PROFILE_COUNT }, (_, profile) => ({ profile,
    effects: mode === 'dry' || sourceProfiles.includes(profile) ? [] : profile === ROTATION_LIVE_PROFILE ? [slapback(), chorus()] : profile === DEFAULT_LIVE_PROFILE ? [slapback()] : [] }));
}
const dryDefaults = initialVoiceEffects('dry');
export function effectSummary(effects: readonly LiveEffectDefinition[]): string {
  return effects.map(effect => effect.kind === 'slapback'
    ? `Slapback · ${effect.delayMs} ms · ${Math.round(effect.wet * 100)}%`
    : `Chorus · ${effect.rateHz} Hz · ${Math.round(effect.wet * 100)}%`).join(' → ') || 'Dry';
}
export function createVoiceEffectsEditor(onApply: (profile: number) => void, onChange?: (profile: number) => void) {
  let baseline: readonly VoiceEffectConfiguration[] = initialVoiceEffects();
  let drafts = baseline;
  let applied: readonly VoiceEffectsState[] = [];
  let locked = false;
  let readOnly = false;
  const footers: Footer[] = [];
  function draft(profile: number) { return drafts.find(item => item.profile === profile)?.effects ?? []; }
  function dirty(profile: number) {
    const native = applied.find(item => item.profile === profile && item.prepared);
    const original = native?.effects ?? baseline.find(item => item.profile === profile)?.effects ?? [];
    return JSON.stringify(original) !== JSON.stringify(draft(profile));
  }
  function refresh() {
    for (const footer of footers) {
      const native = applied.find(item => item.profile === footer.voice.profile && item.prepared);
      const empty = !draft(footer.voice.profile).length && !native?.effects.length;
      footer.root.hidden = empty;
      footer.open.hidden = !empty || readOnly;
      if (readOnly && footer.editor.open) footer.editor.close();
      footer.open.disabled = locked && Boolean(footer.edit);
      footer.root.dataset.prepared = String(Boolean(native));
      for (const knob of footer.knobs) {
        knob.setValue(knob.value());
        if (locked) knob.cancelDrag();
      }
      for (const input of footer.controls) input.disabled = locked;
      for (const title of footer.titles) title.disabled = readOnly;
      for (const button of footer.buttons) button.disabled = locked || button.dataset.unavailable === 'true';
      if (footer.apply) { footer.apply.hidden = empty || locked || !dirty(footer.voice.profile); footer.apply.disabled = locked || !dirty(footer.voice.profile); }
    }
  }
  function setProfileEffects(profile: number, effects: readonly LiveEffectDefinition[]) {
    drafts = drafts.map(item => item.profile === profile ? { ...item, effects: effects.map(effect => ({ ...effect })) } : item);
    for (const footer of footers.filter(item => item.voice.profile === profile)) renderFields(footer);
    refresh();
  }
  function renderFields(footer: Footer) {
    for (const knob of footer.knobs) knob.cancelDrag();
    const restoreFocus = footer.editorBody.contains(document.activeElement);
    footer.root.replaceChildren();
    footer.editorBody.replaceChildren();
    footer.titles = []; footer.controls = []; footer.buttons = []; footer.knobs = [];
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
      onChange?.(footer.voice.profile);
    }
    for (const [index, effect] of effects.entries()) {
      const stage = document.createElement('div'); stage.className = 'fx-stage';
      const name = effect.kind === 'slapback' ? 'Slapback' : 'Chorus';
      const stageName = `${index + 1}. ${name}`;
      stage.setAttribute('role', 'group'); stage.setAttribute('aria-label', stageName);
      const title = document.createElement('button'); title.type = 'button'; title.className = 'fx-title'; title.textContent = name;
      title.setAttribute('aria-label', `Manage ${footer.voice.name} effects · ${name}`);
      title.setAttribute('aria-haspopup', 'dialog');
      title.disabled = readOnly;
      title.addEventListener('click', () => footer.edit ? footer.edit() : footer.editor.showModal());
      footer.titles.push(title);
      stage.dataset.effect = effect.kind; stage.append(title);
      const knobs = document.createElement('div'); knobs.className = 'fx-knobs';
      knobs.style.setProperty('--knob-count', String(effect.kind === 'slapback' ? 3 : 4)); stage.append(knobs);
      function field(label: string, read: () => number, min: number, max: number, step: number, format: (value: number) => string, update: (value: number) => void) {
        const knob = createEffectKnob({ label, accessibleName: `${footer.voice.name}, ${stageName}, ${label}`,
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
        const row = document.createElement('div'); row.className = 'fx-editor-row';
        const label = document.createElement('strong'); label.textContent = name;
        const actions = document.createElement('div'); actions.className = 'fx-stage-actions';
        const change = (stages: readonly LiveEffectDefinition[]) => {
          setProfileEffects(footer.voice.profile, stages);
          onChange?.(footer.voice.profile);
        };
        actions.append(action('↑', () => {
          const next = [...draft(footer.voice.profile)]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; change(next);
        }, index === 0));
        actions.lastElementChild?.setAttribute('aria-label', `Move ${stageName} earlier for ${footer.voice.name}`);
        actions.append(action('↓', () => {
          const next = [...draft(footer.voice.profile)]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; change(next);
        }, index === effects.length - 1));
        actions.lastElementChild?.setAttribute('aria-label', `Move ${stageName} later for ${footer.voice.name}`);
        actions.append(action('Remove', () => change(draft(footer.voice.profile).filter((_, i) => i !== index))));
        row.append(label, actions); footer.editorBody.append(row);
      }
      body.append(stage);
    }
    if (!footer.edit) {
      const additions = document.createElement('div'); additions.className = 'fx-editor-add';
      for (const [label, factory] of [['Add Slapback', slapback], ['Add Chorus', chorus]] satisfies readonly [string, () => LiveEffectDefinition][]) {
        additions.append(action(label, () => {
          setProfileEffects(footer.voice.profile, [...draft(footer.voice.profile), factory()]);
          onChange?.(footer.voice.profile);
        }, effects.length >= 64));
      }
      footer.editorBody.append(additions);
    }
    const apply = action('Apply changes', () => {
      if (footer.controls.every(input => input.reportValidity())) onApply(footer.voice.profile);
    });
    apply.className = 'fx-apply';
    footer.apply = apply;
    body.append(apply);
    footer.root.append(body);
    if (restoreFocus) footer.editor.querySelector<HTMLButtonElement>('button[autofocus]')?.focus();
  }
  return {
    reset(nextMode: 'compiled' | 'dry') { for (const footer of footers) { for (const knob of footer.knobs) knob.cancelDrag(); footer.editor.remove(); footer.open.remove(); } baseline = initialVoiceEffects(nextMode); drafts = baseline; applied = []; footers.length = 0; },
    setEffects(profile: number, effects: readonly LiveEffectDefinition[]) {
      baseline = baseline.map(item => item.profile === profile ? { ...item, effects } : item);
      setProfileEffects(profile, effects);
    },
    hasChanges: dirty,
    mount(voice: Voice, container: HTMLElement, edit?: () => void) {
      const root = document.createElement('section'); root.className = 'voice-effects'; root.dataset.voice = voice.id;
      root.setAttribute('aria-label', `${voice.name} effects`);
      root.addEventListener('wheel', event => event.stopPropagation());
      container.append(root);
      const editor = document.createElement('dialog'); editor.className = 'desk-dialog fx-editor';
      editor.setAttribute('aria-label', `${voice.name} effect stack`);
      const heading = document.createElement('div'); heading.className = 'dialog-heading';
      const title = document.createElement('h2'); title.textContent = `${voice.name} effects`;
      const done = document.createElement('button'); done.type = 'button'; done.textContent = 'Done'; done.autofocus = true;
      done.addEventListener('click', () => editor.close());
      dismissOnBackdrop(editor, () => editor.close());
      const editorBody = document.createElement('div');
      heading.append(title, done); editor.append(heading, editorBody); container.append(editor);
      const open = document.createElement('button'); open.type = 'button'; open.className = 'fx-empty secondary'; open.textContent = 'Effects';
      open.setAttribute('aria-label', `Manage ${voice.name} effects`); open.setAttribute('aria-haspopup', 'dialog');
      open.addEventListener('click', () => edit ? edit() : editor.showModal());
      (container.querySelector('.pad-volume, .voice-tools') ?? container).append(open);
      const footer: Footer = { edit, voice, root, editor, editorBody, open, titles: [], controls: [], buttons: [], knobs: [] };
      footers.push(footer); renderFields(footer); refresh();
      return editor;
    },
    configurations(profile?: number): readonly VoiceEffectConfiguration[] {
      return drafts.map(item => ({ profile: item.profile, effects: (profile === undefined || profile === item.profile ? item.effects
        : applied.find(state => state.profile === item.profile && state.prepared)?.effects ?? baseline.find(state => state.profile === item.profile)?.effects ?? []).map(effect => ({ ...effect })) }));
    },
    render(states: readonly VoiceEffectsState[] | undefined, isLocked: boolean, defaults?: readonly VoiceEffectConfiguration[]) {
      applied = states ?? [];
      locked = isLocked;
      readOnly = defaults !== undefined;
      const configured = defaults?.length === 0 ? dryDefaults : defaults;
      if (configured && JSON.stringify(drafts) !== JSON.stringify(configured)) {
        const before = drafts;
        baseline = drafts = configured;
        for (const footer of footers) {
          const previous = before.find(item => item.profile === footer.voice.profile)?.effects ?? [];
          if (JSON.stringify(previous) !== JSON.stringify(draft(footer.voice.profile))) renderFields(footer);
        }
      }
      refresh();
    },
  };
}
