import { createEffectKnob, steppedKnobValue } from './effect-knob.js';
import { TAMBOURINE_DEFAULTS, type MotionReading, type TambourineTuning } from './phone-motion.js';
import { captureDownstrokeAxis, normalizeDownstrokeAxis, type DownstrokeAxis, type TambourineDirection } from './tambourine-direction.js';

const DIRECTION_KEY = 'show-tools.tambourine-downstroke.v2';
const LEGACY_DIRECTION_KEY = 'show-tools.tambourine-downstroke.v1';
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

  let axis: DownstrokeAxis | undefined;
  let mode: 'all' | 'gravity' | 'wrist' = 'all';
  try {
    const current = localStorage.getItem(DIRECTION_KEY);
    const saved: unknown = JSON.parse(current ?? localStorage.getItem(LEGACY_DIRECTION_KEY) ?? 'null');
    if (typeof saved === 'object' && saved !== null) {
      axis = 'axis' in saved ? normalizeDownstrokeAxis(saved.axis) : undefined;
      if ('mode' in saved && saved.mode === 'gravity') {
        // Legacy Gravity selections return to All strokes until the operator selects Gravity again.
        if (current !== null) mode = 'gravity';
      } else if (axis && 'enabled' in saved && saved.enabled === true) mode = 'wrist';
    }
  } catch { /* Motion settings are still available when storage is disabled. */ }

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
  const directionControls = document.createElement('div');
  directionControls.className = 'tambourine-direction';
  const directionLabel = document.createElement('label');
  directionLabel.className = 'field';
  const directionSelect = document.createElement('select');
  const wristOption = document.createElement('option');
  for (const [value, title] of [['all', 'All strokes'], ['gravity', 'Gravity'], ['wrist', 'Downstrokes · Calibrated wrist']]) {
    const option = value === 'wrist' ? wristOption : document.createElement('option');
    option.value = value;
    option.textContent = title;
    directionSelect.append(option);
  }
  directionLabel.append(document.createTextNode('Motion direction'), directionSelect);
  const calibrate = document.createElement('button');
  calibrate.type = 'button';
  calibrate.className = 'secondary';
  calibrate.textContent = 'Calibrate downstroke';
  const directionStatus = document.createElement('small');
  directionStatus.setAttribute('role', 'status');
  directionControls.append(directionLabel, calibrate, directionStatus);
  let auditionActive = false;
  let capture: ReturnType<typeof captureDownstrokeAxis> | undefined;
  let captureTimeout: ReturnType<typeof setTimeout> | undefined;

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
    knobs.append(dial.root);
    return { key, dial, hit };
  });
  function update(value: TambourineTuning) {
    const next = normalizeTambourineTuning(value);
    if (next.hitsEnabled !== tuning.hitsEnabled || controls.some(({ key }) => next[key] !== tuning[key])) {
      tuning = next;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tuning)); } catch { /* Still live for this page. */ }
    }
    render();
  }
  function render() {
    directionSelect.value = mode;
    directionSelect.disabled = !!capture;
    wristOption.disabled = !axis;
    calibrate.disabled = !auditionActive;
    calibrate.textContent = capture ? 'Cancel calibration' : 'Calibrate downstroke';
    hits.hidden = mode === 'wrist';
    hitsToggle.checked = tuning.hitsEnabled;
    for (const { key, dial, hit } of dials) {
      dial.root.hidden = Boolean(hit && (mode === 'wrist' || !tuning.hitsEnabled));
      dial.setValue(tuning[key]);
    }
  }
  function describeDirection() {
    directionStatus.textContent = mode === 'gravity' ? 'Hold still briefly, then play. Down and return strokes both sound.'
      : mode === 'wrist' ? 'Downstrokes play. Return strokes and hits are silent.'
      : auditionActive ? '' : 'Start Tambourine audition to calibrate a wrist stroke.';
  }
  function setDirection(value: typeof mode) {
    mode = value;
    try { localStorage.setItem(DIRECTION_KEY, JSON.stringify({ axis, mode, enabled: mode === 'wrist' })); }
    catch { /* Still live for this page. */ }
    describeDirection();
    render();
  }
  function endCapture() {
    if (captureTimeout !== undefined) clearTimeout(captureTimeout);
    captureTimeout = undefined;
    capture = undefined;
    render();
  }

  directionSelect.addEventListener('change', () => {
    const value = directionSelect.value;
    if (value === 'gravity' || value === 'all' || (value === 'wrist' && axis)) setDirection(value);
  });
  calibrate.addEventListener('click', () => {
    if (!auditionActive) return;
    if (capture) {
      endCapture();
      describeDirection();
      return;
    }
    capture = captureDownstrokeAxis();
    directionStatus.textContent = 'Hold still in your playing grip. Make one downstroke, then pause before lifting.';
    captureTimeout = setTimeout(() => {
      endCapture();
      directionStatus.textContent = 'No clear downstroke captured. Try again with one wrist stroke.';
    }, 6000);
    render();
  });
  defaults.addEventListener('click', () => {
    endCapture();
    setDirection('all');
    update(TAMBOURINE_DEFAULTS);
  });
  root.append(summary, directionControls, hits, knobs, defaults, hint);
  describeDirection();
  render();
  return {
    root,
    read: () => tuning,
    direction: (): TambourineDirection | undefined => mode === 'gravity' ? 'gravity' : mode === 'wrist' ? axis : undefined,
    setAuditionActive(active: boolean) {
      auditionActive = active;
      endCapture();
      describeDirection();
    },
    capture(reading: MotionReading) {
      if (!capture) return false;
      const result = capture(reading);
      if (result.kind === 'calibrated') {
        axis = result.axis;
        endCapture();
        setDirection('wrist');
        directionStatus.textContent = 'Downstroke calibrated. Lift once, then play.';
      } else if (result.kind === 'retry') {
        endCapture();
        directionStatus.textContent = 'Try again with one downstroke and a pause before lifting.';
      }
      return true;
    },
  };
}
