import { createEffectKnob, steppedKnobValue } from './effect-knob.js';
import { TAMBOURINE_DEFAULTS, type MotionReading, type TambourineTuning } from './phone-motion.js';
import { captureDownstrokeAxis, normalizeDownstrokeAxis, type DownstrokeAxis } from './tambourine-direction.js';

const DIRECTION_KEY = 'show-tools.tambourine-downstroke.v1';
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
  let downstrokesOnly = false;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(DIRECTION_KEY) ?? 'null');
    if (typeof saved === 'object' && saved !== null && 'axis' in saved) {
      axis = normalizeDownstrokeAxis(saved.axis);
      downstrokesOnly = !!axis && 'enabled' in saved && saved.enabled === true;
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
  directionLabel.className = 'switch';
  const directionToggle = document.createElement('input');
  directionToggle.type = 'checkbox';
  directionLabel.append(directionToggle, document.createTextNode('Downstrokes only'));
  const calibrate = document.createElement('button');
  calibrate.type = 'button';
  calibrate.className = 'secondary';
  calibrate.textContent = 'Calibrate downstroke';
  const directionStatus = document.createElement('small');
  directionStatus.setAttribute('role', 'status');
  directionControls.append(calibrate, directionLabel, directionStatus);
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
    directionToggle.checked = downstrokesOnly;
    directionToggle.disabled = !axis || !!capture;
    calibrate.disabled = !auditionActive;
    calibrate.textContent = capture ? 'Cancel calibration' : 'Calibrate downstroke';
    hits.hidden = downstrokesOnly;
    hitsToggle.checked = tuning.hitsEnabled;
    for (const { key, dial, hit } of dials) {
      dial.root.hidden = Boolean(hit && (downstrokesOnly || !tuning.hitsEnabled));
      dial.setValue(tuning[key]);
    }
  }
  function describeDirection() {
    directionStatus.textContent = downstrokesOnly ? 'Downstrokes play. Return strokes and hits are silent.'
      : auditionActive ? 'Calibrate to play downstrokes only.' : 'Start Tambourine audition to calibrate.';
  }
  function setDownstrokesOnly(enabled: boolean) {
    downstrokesOnly = enabled;
    try { localStorage.setItem(DIRECTION_KEY, JSON.stringify({ axis, enabled })); } catch { /* Still live for this page. */ }
    describeDirection();
    render();
  }
  function endCapture() {
    if (captureTimeout !== undefined) clearTimeout(captureTimeout);
    captureTimeout = undefined;
    capture = undefined;
    render();
  }

  directionToggle.addEventListener('change', () => setDownstrokesOnly(directionToggle.checked));
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
    setDownstrokesOnly(false);
    update(TAMBOURINE_DEFAULTS);
  });
  root.append(summary, directionControls, hits, knobs, defaults, hint);
  describeDirection();
  render();
  return {
    root,
    read: () => tuning,
    direction: () => downstrokesOnly ? axis : undefined,
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
        setDownstrokesOnly(true);
        directionStatus.textContent = 'Downstroke calibrated. Lift once, then play.';
      } else if (result.kind === 'retry') {
        endCapture();
        directionStatus.textContent = 'Try again with one downstroke and a pause before lifting.';
      }
      return true;
    },
  };
}
