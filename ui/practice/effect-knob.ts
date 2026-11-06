export function steppedKnobValue(value: number, min: number, max: number, step: number): number {
  const bounded = Math.max(min, Math.min(max, value));
  return Number(Math.max(min, Math.min(max, min + Math.round((bounded - min) / step) * step)).toFixed(6));
}

export function createEffectKnob(options: {
  label: string; accessibleName: string; value: number; min: number; max: number; step: number;
  format: (value: number) => string; onInput: (value: number) => void;
}) {
  const root = document.createElement('label'); root.className = 'fx-knob';
  const label = document.createElement('span'); label.className = 'fx-knob-label'; label.textContent = options.label;
  const control = document.createElement('span'); control.className = 'fx-knob-control';
  const input = document.createElement('input'); input.type = 'range'; input.className = 'fx-knob-input';
  input.min = String(options.min); input.max = String(options.max); input.step = 'any';
  input.setAttribute('aria-label', options.accessibleName);
  const dial = document.createElement('span'); dial.className = 'fx-knob-dial'; dial.setAttribute('aria-hidden', 'true');
  const indicator = document.createElement('span'); indicator.className = 'fx-knob-indicator'; dial.append(indicator);
  const output = document.createElement('output'); output.className = 'fx-knob-value'; output.setAttribute('aria-hidden', 'true');
  control.append(input, dial); root.append(label, control, output);
  function setValue(value: number) {
    const valid = Number.isFinite(value) && value >= options.min && value <= options.max;
    input.setCustomValidity(valid ? '' : 'Enter a valid effect value.');
    input.setAttribute('aria-invalid', String(!valid));
    if (!valid) { output.value = 'Invalid'; input.setAttribute('aria-valuetext', 'Invalid draft value'); return; }
    input.value = String(value);
    const actual = input.valueAsNumber;
    const text = options.format(actual);
    output.value = text; input.setAttribute('aria-valuetext', text);
    control.style.setProperty('--knob-angle', `${-135 + 270 * (actual - options.min) / (options.max - options.min)}deg`);
  }
  function change(value: number) {
    setValue(steppedKnobValue(value, options.min, options.max, options.step));
    options.onInput(input.valueAsNumber);
  }
  input.addEventListener('input', () => change(input.valueAsNumber));
  input.addEventListener('keydown', event => {
    if (input.disabled) return;
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1
      : event.key === 'ArrowDown' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!direction) return;
    event.preventDefault(); change(input.valueAsNumber + direction * options.step);
  });
  let drag: { pointer: number; x: number; y: number; value: number } | undefined;
  function cancelDrag() {
    const pointer = drag?.pointer; drag = undefined;
    if (pointer !== undefined && input.hasPointerCapture(pointer)) input.releasePointerCapture(pointer);
  }
  input.addEventListener('pointerdown', event => {
    if (input.disabled || drag || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault(); input.focus();
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, value: input.valueAsNumber };
    input.setPointerCapture(event.pointerId);
  });
  input.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    if (input.disabled) { cancelDrag(); return; }
    const movement = drag.y - event.clientY + event.clientX - drag.x;
    change(drag.value + movement * (options.max - options.min) / (event.shiftKey ? 1800 : 180));
  });
  input.addEventListener('pointerup', cancelDrag);
  input.addEventListener('pointercancel', cancelDrag);
  input.addEventListener('lostpointercapture', () => { drag = undefined; });
  setValue(options.value);
  return { root, input, setValue, cancelDrag };
}
