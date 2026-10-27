import { createStudio, models, treatments, treatmentName, type View } from './renderer.js';
import { loadPoseSampler } from './motion.js';
import { LOOP_SECONDS, parsePerformanceTime, parsePreviewSeconds, type SceneTime } from './time.js';

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing studio control ${selector}`);
  return found;
}
const host = element<HTMLElement>('#studio');
const play = element<HTMLButtonElement>('#play');
const seek = element<HTMLInputElement>('#seek');
const status = element<HTMLElement>('#status');
const output = element<HTMLOutputElement>('#position');
const styles = element<HTMLElement>('#treatments');

try {
  const studio = await createStudio(host, await loadPoseSampler());
  let view: View = { kind: 'gallery' };
  let time: SceneTime = { kind: 'preview', seconds: 0 };
  let anchor = performance.now(), pausedAt = 0;
  let playing = true;
  let frame = 0;
  const show = () => studio.draw({ time, view });
  function setPreview(seconds: number) {
    pausedAt = parsePreviewSeconds(seconds); anchor = performance.now();
    time = { kind: 'preview', seconds: pausedAt };
    seek.value = String(pausedAt % LOOP_SECONDS); output.value = `${(pausedAt % LOOP_SECONDS).toFixed(2)} / 4.00`;
    status.textContent = 'Studio preview · 4-second pose score';
    return show();
  }
  function pause() { if (playing && time.kind === 'preview') pausedAt += (performance.now() - anchor) / 1000; playing = false; play.textContent = 'Play loop'; play.setAttribute('aria-pressed', 'false'); }
  play.addEventListener('click', () => {
    if (playing) pause();
    else { setPreview(pausedAt); playing = true; play.textContent = 'Pause loop'; play.setAttribute('aria-pressed', 'true'); }
  });
  document.querySelector('#restart')?.addEventListener('click', () => setPreview(0));
  seek.addEventListener('input', () => { pause(); setPreview(Number(seek.value)); });
  document.querySelector('#gallery')?.addEventListener('click', () => {
    view = { kind: 'gallery' }; document.body.dataset.view = 'gallery'; show();
  });
  treatments.forEach(treatment => {
    const button = document.createElement('button'); button.textContent = treatmentName(treatment);
    button.addEventListener('click', () => { view = { kind: 'stage', treatment }; document.body.dataset.view = 'stage'; show(); });
    styles.append(button);
  });
  document.querySelector('#fullscreen')?.addEventListener('click', () => host.requestFullscreen());
  document.addEventListener('keydown', event => { if (event.code === 'Space' && event.target === document.body) { event.preventDefault(); play.click(); } });
  const resize = new ResizeObserver(show); resize.observe(host);
  function tick(now: number) {
    if (playing && time.kind === 'preview') {
      time = { kind: 'preview', seconds: pausedAt + (now - anchor) / 1000 };
      seek.value = String(time.seconds % LOOP_SECONDS); output.value = `${(time.seconds % LOOP_SECONDS).toFixed(2)} / 4.00`;
    }
    show(); frame = requestAnimationFrame(tick);
  }
  const api = {
    ready: true, modelIds: models.map(model => model.id),
    renderAt(seconds: number) { pause(); return setPreview(seconds); },
    setPerformanceTime(input: unknown) { const sample = parsePerformanceTime(input); pause(); time = { kind: 'performance', sample }; status.textContent = `Performance input · ${sample.runId}`; return show(); },
    setView(next: View) { view = next; return show(); },
    snapshot: studio.snapshot,
    capture: () => studio.canvas.toDataURL('image/png'),
  };
  Object.assign(window, { videoStudio: api });
  setPreview(0); frame = requestAnimationFrame(tick);
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    cancelAnimationFrame(frame); resize.disconnect(); studio.dispose();
  });
} catch (error) {
  status.textContent = `Studio could not start. ${error instanceof Error ? error.message : String(error)}`;
  status.setAttribute('role', 'alert'); play.disabled = true;
}
