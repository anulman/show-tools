export function bindKeyboard(sequence, target = globalThis.window) {
  if (!target?.addEventListener) throw new TypeError('A keyboard event target is required');
  const held = new Set();
  const editable = event => {
    const path = event.composedPath?.() || [event.target];
    return path.some(node => node?.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(node?.tagName));
  };
  const down = event => {
    if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
      editable(event) || held.has(event.code)) return;
    const button = sequence.snapshot().buttons.find(candidate => candidate.key === event.code);
    if (!button || sequence.snapshot().state === 'disposed') return;
    held.add(event.code);
    if (button.action === null) return;
    event.preventDefault();
    sequence.trigger(button.id);
  };
  const up = event => held.delete(event.code);
  const blur = () => held.clear();
  const blurTarget = target.defaultView || target.ownerDocument?.defaultView || target;
  target.addEventListener('keydown', down);
  target.addEventListener('keyup', up);
  blurTarget.addEventListener('blur', blur);
  return () => {
    target.removeEventListener('keydown', down);
    target.removeEventListener('keyup', up);
    blurTarget.removeEventListener('blur', blur);
    held.clear();
  };
}
