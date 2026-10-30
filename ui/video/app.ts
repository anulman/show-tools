import { parseStreetScene } from '../../lib/video/street-score.js';
import { createStreetSampler } from '../../lib/video/street-sampler.js';
import { createStreetStudio } from './renderer.js';
import { parsePerformanceTime, parsePreviewSeconds } from './time.js';

function element<T extends HTMLElement>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing studio control ${selector}`);
  return found;
}
const host = element<HTMLElement>('#studio'), status = element<HTMLElement>('#status');
const play = element<HTMLButtonElement>('#play'), seek = element<HTMLInputElement>('#seek');
const output = element<HTMLOutputElement>('#position');
try {
  const sceneUrl = new URLSearchParams(location.search).get('scene') || './street-scene.json';
  const response = await fetch(sceneUrl);
  if (!response.ok) throw new Error('Prepare a verified Street scene first (scripts/prepare-street-preview.ts), then supply ?scene=its-URL.');
  const scene = parseStreetScene(await response.json());
  const wasm = await fetch(new URL('./wasm/video-scene.wasm', import.meta.url));
  if (!wasm.ok) throw new Error('Street sampler WASM is missing; run npm run build:video.');
  const studio = await createStreetStudio(host, scene, await createStreetSampler(await wasm.arrayBuffer(), scene));
  const duration = scene.durationCounts / scene.previewCountsPerSecond;
  seek.max = String(duration);
  let anchor = performance.now(), pausedAt = 0, playing = true, frame = 0, preview = true;
  function showSeconds(seconds: number) {
    seek.value = String(seconds); output.value = `${seconds.toFixed(2)} / ${duration.toFixed(2)}`;
    return studio.draw(seconds * scene.previewCountsPerSecond);
  }
  function pause() {
    if (playing && preview) pausedAt = (pausedAt + (performance.now() - anchor) / 1000) % duration;
    playing = false; play.textContent = 'Play preview'; play.setAttribute('aria-pressed', 'false');
  }
  function setPreview(seconds: number) {
    pausedAt = parsePreviewSeconds(seconds); anchor = performance.now(); preview = true;
    status.textContent = 'Authored visual preview · silent · no live Performance Engine subscription';
    return showSeconds(pausedAt);
  }
  play.addEventListener('click', () => {
    if (playing) pause();
    else { setPreview(pausedAt); playing = true; play.textContent = 'Pause preview'; play.setAttribute('aria-pressed', 'true'); }
  });
  element<HTMLButtonElement>('#restart').addEventListener('click', () => setPreview(0));
  seek.addEventListener('input', () => { pause(); setPreview(Number(seek.value)); });
  element<HTMLButtonElement>('#fullscreen').addEventListener('click', () => host.requestFullscreen());
  function tick(now: number) {
    if (playing && preview) showSeconds((pausedAt + (now - anchor) / 1000) % duration);
    frame = requestAnimationFrame(tick);
  }
  Object.assign(window, { videoStudio: {
    ready: true, modelIds: scene.actors.map(actor => actor.characterId),
    renderAt(seconds: number) { pause(); return setPreview(seconds); },
    renderCount(count: number) { pause(); preview = false; return studio.draw(count); },
    setPerformanceTime(input: unknown) {
      const sample = parsePerformanceTime(input); pause(); preview = false;
      status.textContent = 'Injected position sampling the authored visual score · not live voice activity';
      return studio.draw(sample.quarterPosition * scene.countedBeatUnit / 4);
    },
    snapshot: studio.snapshot, capture: () => studio.canvas.toDataURL('image/png'),
  } });
  setPreview(0); frame = requestAnimationFrame(tick);
  window.addEventListener('pagehide', event => { if (!event.persisted) { cancelAnimationFrame(frame); studio.dispose(); } });
} catch (error) {
  status.textContent = error instanceof Error ? error.message : String(error);
  status.setAttribute('role', 'alert'); play.disabled = true;
}
