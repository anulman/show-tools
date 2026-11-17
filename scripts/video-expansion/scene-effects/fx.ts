import { gradientRGB } from './palette.js';

export type Point = Readonly<{ x: number; y: number }>;
export type ChorusWindow = Readonly<{
  startSeconds: number;
  endSeconds: number;
  expansionFinishSeconds: number;
  source: string;
}>;
export type ChorusConfig = Readonly<{
  fadeInSeconds: number;
  expandSeconds: number;
  contractSeconds: number;
  fadeOutSeconds: number;
}>;
export const chorusDefaults: ChorusConfig = {
  fadeInSeconds: .1,
  expandSeconds: .1,
  contractSeconds: .1,
  fadeOutSeconds: .1,
};
export type ChorusState =
  | Readonly<{ visible: false; opacity: 0; spread01: 0; windowIndex: null; source: null }>
  | Readonly<{ visible: true; opacity: number; spread01: number; windowIndex: number; source: string }>;

const clamp = (value: number): number => Math.min(1, Math.max(0, value));
const ease = (value: number): number => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function chorusState(timeSeconds: number, windows: readonly ChorusWindow[], config: ChorusConfig = chorusDefaults): ChorusState {
  if (!Number.isFinite(timeSeconds) || Object.values(config).some(value => !Number.isFinite(value) || value <= 0)) throw Error('Invalid chorus time/configuration');
  const inside = windows.findIndex(window => timeSeconds >= window.startSeconds && timeSeconds < window.endSeconds);
  const windowIndex = inside >= 0 ? inside : windows.findIndex(window => timeSeconds >= window.endSeconds && timeSeconds < window.endSeconds + config.fadeOutSeconds);
  const window = windows[windowIndex];
  if (!window) return { visible: false, opacity: 0, spread01: 0, windowIndex: null, source: null };
  if (!(window.startSeconds <= window.expansionFinishSeconds - config.expandSeconds && window.expansionFinishSeconds <= window.endSeconds - config.contractSeconds)) throw Error('Chorus window cannot fit the declared expansion and contraction');
  const expanding = ease((timeSeconds - window.expansionFinishSeconds + config.expandSeconds) / config.expandSeconds);
  const contracting = 1 - ease((timeSeconds - window.endSeconds + config.contractSeconds) / config.contractSeconds);
  const opacity = timeSeconds < window.endSeconds
    ? ease((timeSeconds - window.startSeconds) / config.fadeInSeconds)
    : 1 - ease((timeSeconds - window.endSeconds) / config.fadeOutSeconds);
  if (opacity <= 0) return { visible: false, opacity: 0, spread01: 0, windowIndex: null, source: null };
  return { visible: true, opacity, spread01: Math.min(expanding, contracting), windowIndex, source: window.source };
}

export function tintSurfaceRgba(source: Uint8Array, width: number, height: number, phase: number, amount = 1): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || source.length !== width * height * 4 || !Number.isFinite(phase) || !Number.isFinite(amount)) throw Error('Invalid surface pixels');
  const result = new Uint8Array(source);
  const mix = clamp(amount);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (source[i + 3] === 0) continue;
    const rgb = gradientRGB('diagonal', (p % width) / width, Math.floor(p / width) / height, phase);
    const shade = .32 + .68 * (source[i] * .2126 + source[i + 1] * .7152 + source[i + 2] * .0722) / 255;
    for (let channel = 0; channel < 3; channel++) result[i + channel] = Math.round(source[i + channel] + (Math.round(rgb[channel] * shade) - source[i + channel]) * mix);
  }
  return result;
}

export type BeamGeometry = Readonly<{
  width: number;
  height: number;
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  moonPoint: Point;
  pivot: Point;
  axisRadians: number;
  offscreenExitPoint: Point;
  reach: number;
  initialHalfAngleRadians: number;
  exitHalfWidth: number;
  maxSweepRadians: number;
}>;

const angleDifference = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

export function createBeamGeometry({ width, height, moonPoint, offscreenExitPoint = { x: -width / 8, y: height + 100 }, exitHalfWidth = 32, cellSize = 4 }: {
  width: number;
  height: number;
  moonPoint: Point;
  offscreenExitPoint?: Point;
  exitHalfWidth?: number;
  cellSize?: number;
}): BeamGeometry {
  if (![width, height, cellSize].every(value => Number.isInteger(value) && value > 0) || width % cellSize || height % cellSize || ![moonPoint.x, moonPoint.y, exitHalfWidth].every(Number.isFinite) || exitHalfWidth <= 0) throw Error('Invalid beam canvas/grid');
  if (!(offscreenExitPoint.x < 0 && offscreenExitPoint.y > height) || ![offscreenExitPoint.x, offscreenExitPoint.y].every(Number.isFinite)) throw Error('Beam exit must be offscreen below-left');
  if (!(moonPoint.x >= 0 && moonPoint.x < width && moonPoint.y >= 0 && moonPoint.y < height)) throw Error('Moon point must lie inside scene');
  const pivot = { ...moonPoint };
  const dx = offscreenExitPoint.x - pivot.x, dy = offscreenExitPoint.y - pivot.y;
  const axisRadians = Math.atan2(dy, dx);
  const initialHalfAngleRadians = Math.atan2(exitHalfWidth, Math.hypot(dx, dy));
  const corners = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: 0, y: height }, { x: width, y: height }];
  const reach = Math.max(...corners.map(point => Math.hypot(point.x - pivot.x, point.y - pivot.y))) + cellSize;
  const maxSweepRadians = Math.PI - initialHalfAngleRadians;
  return { width, height, gridWidth: width / cellSize, gridHeight: height / cellSize, cellSize, moonPoint, pivot, offscreenExitPoint, axisRadians, reach, initialHalfAngleRadians, exitHalfWidth, maxSweepRadians };
}

export function beamMaskAt(geometry: BeamGeometry, progress: number): { width: number; height: number; alpha: Uint8Array } {
  if (!Number.isFinite(progress)) throw Error('Invalid beam progress');
  const p = clamp(progress), { gridWidth, gridHeight, cellSize, pivot } = geometry;
  const halfAngle = geometry.initialHalfAngleRadians + p * geometry.maxSweepRadians;
  const alpha = new Uint8Array(gridWidth * gridHeight);
  for (let y = 0; y < gridHeight; y++) for (let x = 0; x < gridWidth; x++) {
    const dx = (x + .5) * cellSize - pivot.x, dy = (y + .5) * cellSize - pivot.y;
    const radius = Math.hypot(dx, dy);
    const angle = Math.abs(angleDifference(Math.atan2(dy, dx), geometry.axisRadians));
    if (radius <= geometry.reach && angle <= halfAngle + 1e-8) alpha[y * gridWidth + x] = 255;
  }
  return { width: gridWidth, height: gridHeight, alpha };
}

export function beamRgbaAt(geometry: BeamGeometry, progress: number, phase: number): { width: number; height: number; rgba: Uint8Array } {
  const mask = beamMaskAt(geometry, progress);
  const rgba = new Uint8Array(mask.alpha.length * 4);
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const index = y * mask.width + x;
    const rgb = gradientRGB(progress >= 1 ? 'down' : 'diagonal', x / mask.width, y / mask.height, phase);
    rgba[index * 4] = rgb[0]; rgba[index * 4 + 1] = rgb[1]; rgba[index * 4 + 2] = rgb[2]; rgba[index * 4 + 3] = mask.alpha[index];
  }
  return { width: mask.width, height: mask.height, rgba };
}
