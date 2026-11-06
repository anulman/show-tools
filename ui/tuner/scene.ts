import type { TunerNote, TunerState } from '../../lib/tuner/model.js';

export type TunerSceneAspect = '16:9' | '4:3';
export const tunerScenePalette = {
  stage: '#0B101B', idle: '#263443', live: '#FFF0BE', trail: '#65BAC3', label: '#BDD0DE', dot: '#516575',
} as const;

// One bit is one source pixel. Labels use the native note spelling, including octaves.
export const tunerSceneGlyphs: Readonly<Record<string, readonly string[]>> = {
  A: ['01110','10001','10001','11111','10001','10001','10001'],
  B: ['11110','10001','10001','11110','10001','10001','11110'],
  C: ['01111','10000','10000','10000','10000','10000','01111'],
  D: ['11110','10001','10001','10001','10001','10001','11110'],
  E: ['11111','10000','10000','11110','10000','10000','11111'],
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  G: ['01111','10000','10000','10111','10001','10001','01111'],
  b: ['10000','10000','10000','11110','10001','10001','11110'],
  '#': ['01010','01010','11111','01010','11111','01010','01010'],
  '-': ['00000','00000','00000','11111','00000','00000','00000'],
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11110','00001','00001','01110','00001','00001','11110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','10000','11110','00001','00001','11110'],
  '6': ['01110','10000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00001','01110'],
};

export function tunerSceneNoteLabel(note: TunerNote): string {
  const accidental = note.accidental < 0 ? 'b'.repeat(-note.accidental) : '#'.repeat(note.accidental);
  return `${note.letter}${accidental}${note.octave}`;
}

type Point = { readonly x: number; readonly y: number };
export type TunerSceneInput = {
  readonly state: TunerState | null;
  readonly timeSeconds: number;
  readonly aspect: TunerSceneAspect;
};
export function tunerSceneFrame({ state, timeSeconds, aspect }: TunerSceneInput) {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) throw new Error('Scene time must be finite and nonnegative');
  const width = aspect === '16:9' ? 320 : 240;
  const height = 180;
  const center = { x: width / 2, y: height / 2 };
  const pitch = state?.pitch;
  const matched = state?.listening && state.preview.kind === 'silent' && pitch?.kind === 'pitched'
    ? state.targets.findIndex(note => note.midi === pitch.note.midi) : -1;
  const hitIndex = matched >= 0 ? matched : null;
  const targets = state?.targets ?? [];
  const arcDegrees = 270;
  const startAngle = 225;
  const interval = targets.length > 1 ? arcDegrees / (targets.length - 1) : 0;
  const radial = (clockAngle: number, radius: number): Point => {
    const angle = clockAngle * Math.PI / 180;
    return {
      x: Math.round(center.x + radius * Math.sin(angle)),
      y: Math.round(center.y - radius * Math.cos(angle)),
    };
  };
  const dotAngles = targets.length > 1 ? [
    startAngle - interval / 4,
    ...targets.slice(1).flatMap((_, index) => [1,2,3].map(part => startAngle + interval * (index + part / 4))),
    startAngle + arcDegrees + interval / 4,
  ] : [];
  const dots = dotAngles.map(clockAngle => ({ clockAngle, position:radial(clockAngle,57) }));
  const notches = targets.map((note, index) => {
    const clockAngle = startAngle + interval * index;
    const light: 'live' | 'trail' | 'idle' = hitIndex === index ? 'live' : hitIndex !== null && index < hitIndex ? 'trail' : 'idle';
    return { note, label: tunerSceneNoteLabel(note), clockAngle, position: radial(clockAngle,57), labelPosition: radial(clockAngle,72), light };
  });
  return { width, height, center, timeSeconds, hitIndex, notches, dots, arcDegrees };
}
export type BallAsset = {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
};
export function paintTunerScene(input: TunerSceneInput & {
  readonly context: CanvasRenderingContext2D;
  readonly ball: BallAsset;
}) {
  const frame = tunerSceneFrame(input);
  const { context, ball } = input;
  if (![ball.width, ball.height, ball.scale].every(value => Number.isInteger(value) && value > 0)) {
    throw new Error('Ball dimensions and scale must be positive native integers');
  }
  const width = ball.width * ball.scale;
  const height = ball.height * ball.scale;
  if (width > 96 || height > 96) throw new Error('Ball exceeds the central dial footprint');
  context.canvas.width = frame.width;
  context.canvas.height = frame.height;
  context.imageSmoothingEnabled = false;
  context.fillStyle = tunerScenePalette.stage;
  context.fillRect(0, 0, frame.width, frame.height);
  context.drawImage(ball.image, Math.floor(frame.center.x - width / 2), Math.floor(frame.center.y - height / 2), width, height);
  context.fillStyle = tunerScenePalette.dot;
  for (const dot of frame.dots) context.fillRect(dot.position.x,dot.position.y,1,1);
  for (const notch of frame.notches) {
    context.fillStyle = tunerScenePalette[notch.light];
    // Deliberate stepped 4×4 cluster; no stroked path or subpixel transform.
    context.fillRect(notch.position.x - 1, notch.position.y - 2, 2, 4);
    context.fillRect(notch.position.x - 2, notch.position.y - 1, 4, 2);
    context.fillStyle = notch.light === 'live' ? tunerScenePalette.live : tunerScenePalette.label;
    const labelWidth = notch.label.length * 6 - 1;
    const left = notch.labelPosition.x - Math.floor(labelWidth / 2);
    const top = notch.labelPosition.y - 3;
    for (const [index, letter] of [...notch.label].entries()) {
      const glyph = tunerSceneGlyphs[letter];
      if (!glyph) throw new Error(`Missing pixel glyph: ${letter}`);
      for (const [y, row] of glyph.entries()) for (const [x, bit] of [...row].entries()) {
        if (bit === '1') context.fillRect(left + index * 6 + x, top + y, 1, 1);
      }
    }
  }
  return frame;
}
