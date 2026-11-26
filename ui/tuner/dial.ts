import type { TunerState } from '../../lib/tuner/model.js';
import ballManifest from '../../assets/video/tuner/manifest.json';
import { paintTunerScene, type BallAsset, type TunerSceneAspect } from './scene.js';

export function createTunerDial(assetBase?: URL) {
  const element = document.createElement('div');
  element.className = 'tuner-dial';
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.hidden = true;
  const error = document.createElement('p');
  error.className = 'tuner-muted tuner-dial-error';
  error.hidden = true;
  element.append(canvas, error);
  const context = canvas.getContext('2d');
  let disposed = false;
  let pending: number | null = null;
  let state: TunerState | null = null;
  let ball: BallAsset | null = null;
  const image = new Image();

  function unavailable() {
    if (disposed) return;
    canvas.hidden = true;
    error.textContent = 'Scale dial unavailable.';
    error.hidden = false;
    element.dataset.ready = 'false';
  }
  function schedule() {
    if (disposed || pending !== null || !context || !ball) return;
    pending = requestAnimationFrame(time => {
      pending = null;
      if (disposed || !ball) return;
      const available = element.clientWidth;
      const aspect: TunerSceneAspect = available >= 640 ? '16:9' : '4:3';
      const width = aspect === '16:9' ? 320 : 240;
      const scale = Math.max(1, Math.floor(available / width));
      canvas.style.width = `${width * scale}px`;
      canvas.style.height = `${180 * scale}px`;
      const frame = paintTunerScene({ context, state, timeSeconds: time / 1000, aspect, ball });
      canvas.hidden = false;
      element.dataset.hit = frame.hitIndex === null ? 'none' : String(frame.hitIndex);
      element.dataset.notches = String(frame.notches.length);
      element.dataset.aspect = aspect;
      element.dataset.ready = 'true';
    });
  }
  const resize = new ResizeObserver(schedule);
  resize.observe(element);
  image.src = new URL(`./assets/tuner/${ballManifest.file}`, assetBase ?? document.baseURI).href;
  void image.decode().then(() => {
    if (disposed) return;
    if (image.naturalWidth !== ballManifest.width || image.naturalHeight !== ballManifest.height) {
      unavailable();
      return;
    }
    ball = { image, width: ballManifest.width, height: ballManifest.height, scale: ballManifest.scale };
    if (!context) unavailable();
    else schedule();
  }, unavailable);
  return {
    element,
    update(value: TunerState | null) { state = value; schedule(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (pending !== null) cancelAnimationFrame(pending);
      pending = null;
      resize.disconnect();
      image.removeAttribute('src');
      ball = null;
      element.remove();
    },
  };
}
