export type RGB = readonly [number, number, number];
export type GradientAxis = 'down' | 'diagonal';
export const palette: readonly [RGB, ...RGB[]] = [
  [219, 63, 111], [236, 125, 52], [230, 210, 76], [71, 180, 124],
  [40, 153, 199], [83, 83, 181], [157, 68, 182],
];
export const wrap = (value: number): number => ((value % 1) + 1) % 1;
export function sample(position: number): RGB {
  const p = wrap(position) * palette.length;
  const i = Math.floor(p), f = p - i;
  const a = palette[i] ?? palette[0], b = palette[(i + 1) % palette.length] ?? palette[0];
  const mix = (c: 0 | 1 | 2): number => Math.round(a[c] + (b[c] - a[c]) * f);
  return [mix(0), mix(1), mix(2)];
}
export function gradientRGB(axis: GradientAxis, u: number, v: number, phase: number): RGB {
  return sample((axis === 'down' ? v : (u + v) / 2) - wrap(phase));
}
export function colour(position: number): string { return `rgb(${sample(position).join(',')})`; }
