import { createEffectKnob, steppedKnobValue } from './effect-knob.js';
import { TAMBOURINE_DEFAULTS, type TambourineTuning } from './phone-motion.js';

const STORAGE_KEY = 'show-tools.tambourine-tuning.v1';
const controls: readonly {
  key: Exclude<keyof TambourineTuning, 'hitsEnabled'>;
  label: string; min: number; max: number; step: number; unit: string; hit?: true;
}[] = [
  { key: 'shake', label: 'Shake starts', min: 4, max: 20, step: .5, unit: 'm/s²' },
  { key: 'hardShake', label: 'Hard shake', min: 5, max: 40, step: .5, unit: 'm/s²' },
  { key: 'brake', hit: true, label: 'Hit braking', min: 2, max: 24, step: .5, unit: 'm/s²' },
  { key: 'hardHitSpeed', hit: true, label: 'Hard hit speed', min: .2, max: 1.5, step: .05, unit: 'm/s' },
  { key: 'angularBrake', hit: true, label: 'Wrist braking', min: 200, max: 4000, step: 50, unit: '°/s²' },
  { key: 'hardHitAngularSpeed', hit: true, label: 'Hard wrist speed', min: 175, max: 900, step: 25, unit: '°/s' },
  { key: 'minimumIntervalMs', label: 'Retrigger gap', min: 0, max: 300, step: 5, unit: 'ms' },
];

export function normalizeTambourineTuning(input: unknown): TambourineTuning {
  const result = { ...TAMBOURINE_DEFAULTS };
  if (typeof input !== 'object' || input === null) return result;
  const hitsEnabled: unknown = Object.hasOwn(input, 'hitsEnabled') ? Reflect.get(input, 'hitsEnabled') : undefined;
  if (typeof hitsEnabled === 'boolean') result.hitsEnabled = hitsEnabled;
  for (const { key, min, max, step } of controls) {
    // Existing saved calibrations predate shake-only practice. Keep the thresholds and reset the old gap.
    if (key === 'minimumIntervalMs' && typeof hitsEnabled !== 'boolean') continue;
    const value: unknown = Object.hasOwn(input, key) ? Reflect.get(input, key) : undefined;
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = steppedKnobValue(value, min, max, step);
  }
  result.hardShake = Math.max(result.hardShake, result.shake + 1);
  return result;
}

export function createTambourineTuning() {
  let tuning: TambourineTuning = TAMBOURINE_DEFAULTS;
  try { tuning = normalizeTambourineTuning(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')); }
  catch { /* Private browsing and invalid saved JSON leave the defaults available. */ }

  const root = document.createElement('details');
  root.className = 'tambourine-tuning';
  const summary = document.createElement('summary');
  summary.textContent = 'Tune motion';
  const hits = document.createElement('label');
  hits.className = 'switch';
  const hitsToggle = document.createElement('input');
  hitsToggle.type = 'checkbox'; hitsToggle.checked = tuning.hitsEnabled;
  hits.append(hitsToggle, document.createTextNode('Enable hits'));
  hitsToggle.addEventListener('change', () => update({ ...tuning, hitsEnabled: hitsToggle.checked }));
  const knobs = document.createElement('div');
  knobs.className = 'fx-knobs';
  const defaults = document.createElement('button');
  defaults.type = 'button'; defaults.className = 'secondary'; defaults.textContent = 'Reset motion defaults';
  const hint = document.createElement('small');
  hint.textContent = 'Try these while auditioning. Settings are saved in this browser.';
  const dials = controls.map(({ key, label, min, max, step, unit, hit }) => {
    const dial = createEffectKnob({
      label, accessibleName: `Tambourine ${label.toLowerCase()}`, value: tuning[key], min, max, step,
      format: value => `${value} ${unit}`,
      onInput: value => update({ ...tuning, [key]: value }),
    });
    dial.root.hidden = Boolean(hit && !tuning.hitsEnabled);
    knobs.append(dial.root);
    return { key, dial, hit };
  });
  function update(value: TambourineTuning) {
    const next = normalizeTambourineTuning(value);
    if (next.hitsEnabled !== tuning.hitsEnabled || controls.some(({ key }) => next[key] !== tuning[key])) {
      tuning = next;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning)); } catch { /* Still live for this page. */ }
    }
    hitsToggle.checked = tuning.hitsEnabled;
    for (const { key, dial, hit } of dials) {
      dial.root.hidden = Boolean(hit && !tuning.hitsEnabled);
      dial.setValue(tuning[key]);
    }
  }
  defaults.addEventListener('click', () => update(TAMBOURINE_DEFAULTS));
  root.append(summary, hits, knobs, defaults, hint);
  return { root, read: () => tuning };
}
