import ballSource from '../../../assets/video/tuner/manifest.json';
import type { TunerNote, TunerState } from '../../../lib/tuner/model.js';
import { paintTunerScene, type BallAsset, type TunerSceneAspect } from '../scene.js';

// Explicit synthetic observations, never a musical scale planner or production default.
const major: readonly TunerNote[] = [
  { midi:48, letter:'C', accidental:0, octave:3 }, { midi:50, letter:'D', accidental:0, octave:3 },
  { midi:52, letter:'E', accidental:0, octave:3 }, { midi:53, letter:'F', accidental:0, octave:3 },
  { midi:55, letter:'G', accidental:0, octave:3 }, { midi:57, letter:'A', accidental:0, octave:3 },
  { midi:59, letter:'B', accidental:0, octave:3 }, { midi:60, letter:'C', accidental:0, octave:4 },
];
const chromatic: readonly TunerNote[] = [
  major[0], { midi:49, letter:'C', accidental:1, octave:3 }, major[1],
  { midi:51, letter:'E', accidental:-1, octave:3 }, major[2], major[3],
  { midi:54, letter:'F', accidental:1, octave:3 }, major[4],
  { midi:56, letter:'A', accidental:-1, octave:3 }, major[5],
  { midi:58, letter:'B', accidental:-1, octave:3 }, major[6], major[7],
];
const idle: TunerState = { revision:1, root:48, scale:'major', step:0, targets:major,
  complete:false, listening:true, preview:{ kind:'silent' }, pitch:{ kind:'unvoiced' } };
function hit(note: TunerNote): TunerState {
  return { ...idle, pitch:{ kind:'pitched', note, midi:note.midi, cents:0, frequency:130.8128, confidence:0.95, rms:0.2 } };
}
export const reviewStates: Readonly<Record<string, TunerState | null>> = {
  idle, low:hit(major[0]), middle:hit(major[4]), high:hit(major[7]),
  unvoiced:idle, 'out-of-scale':hit({ midi:54, letter:'F', accidental:1, octave:3 }),
  'below-range':hit({ midi:47, letter:'B', accidental:0, octave:2 }),
  'above-range':hit({ midi:61, letter:'C', accidental:1, octave:4 }),
  reference:{ ...idle, preview:{ kind:'scale', step:4 }, pitch:{ kind:'reference' } },
  off:{ ...idle, listening:false, pitch:{ kind:'off' } },
  chromatic:{ ...hit(chromatic[6]), scale:'chromatic', targets:chromatic },
  detached:null,
};

function requiredElement<T extends HTMLElement>(selector: string, type: { new(): T }): T {
  const node = document.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`Missing review element ${selector}`);
  return node;
}
const canvas = requiredElement('canvas', HTMLCanvasElement);
const context = canvas.getContext('2d');
if (!context) throw new Error('Canvas 2D is unavailable');
const stateSelect = requiredElement('#state', HTMLSelectElement);
const aspectSelect = requiredElement('#aspect', HTMLSelectElement);
const timeInput = requiredElement('#time', HTMLInputElement);
const status = requiredElement('#status', HTMLParagraphElement);
for (const name of Object.keys(reviewStates)) {
  const option = document.createElement('option'); option.value=name; option.textContent=name; stateSelect.append(option);
}
const parameters = new URLSearchParams(location.search);
stateSelect.value = parameters.get('state') ?? 'middle';
if (!(stateSelect.value in reviewStates)) stateSelect.value = 'middle';
aspectSelect.value = parameters.get('aspect') === '4:3' ? '4:3' : '16:9';

const bytes = await fetch('/ui/tuner/assets/disco-ball.png').then(response => {
  if (!response.ok) throw new Error('Missing approved disco ball');
  return response.arrayBuffer();
});
const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2,'0')).join('');
if (digest !== ballSource.sha256) throw new Error('Approved disco-ball bytes changed');
const image = await createImageBitmap(new Blob([bytes], { type:'image/png' }));
if (image.width !== ballSource.width || image.height !== ballSource.height) throw new Error('Approved disco-ball dimensions changed');
const ball: BallAsset = { image, width:image.width, height:image.height, scale:1 };
function render(name: string, aspect: TunerSceneAspect, timeSeconds: number) {
  if (!Object.hasOwn(reviewStates, name)) throw new Error(`Unknown synthetic state ${name}`);
  if (!context) throw new Error('Canvas 2D is unavailable');
  const frame = paintTunerScene({ context, state:reviewStates[name], aspect, timeSeconds, ball });
  stateSelect.value = name; aspectSelect.value = aspect; timeInput.value = String(timeSeconds);
  const scale = Math.max(1, Math.min(4, Math.floor((document.documentElement.clientWidth - 32) / frame.width)));
  canvas.style.width=`${frame.width * scale}px`; canvas.style.height=`${frame.height * scale}px`;
  canvas.setAttribute('aria-label', `Synthetic tuner scene, ${name}, ${aspect}`);
  canvas.dataset.state=name; canvas.dataset.aspect=aspect;
  status.textContent=`Synthetic ${name} · ${aspect} · native ${frame.width}×${frame.height} · integer scale ${scale}`;
  return frame;
}
function selectedAspect(): TunerSceneAspect { return aspectSelect.value === '4:3' ? '4:3' : '16:9'; }
function update() { render(stateSelect.value, selectedAspect(), Number(timeInput.value)); }
stateSelect.addEventListener('change', update); aspectSelect.addEventListener('change', update); timeInput.addEventListener('change', update);
window.addEventListener('resize', update);
declare global {
  interface Window { tunerSceneReview: { render: typeof render; states: typeof reviewStates; capture(): string } }
}
window.tunerSceneReview = { render, states:reviewStates, capture:() => canvas.toDataURL('image/png') };
update();
document.title='Ready: synthetic tuner scene';
