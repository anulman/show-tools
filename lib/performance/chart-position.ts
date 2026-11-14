import type { Chart } from './model.js';
export function chartBarLabel(chart: Pick<Chart, 'bars'>, ordinal: number): string {
  return chart.bars[ordinal - 1]?.label ?? String(ordinal);
}
export function chartBarOrdinal(chart: Pick<Chart, 'bars'>, label: string): number {
  const value = label.trim();
  const measure = chart.bars.find(bar => (bar.label ?? String(bar.bar)).toLowerCase() === value.toLowerCase()
    || /^\d+$/.test(value) && /^(\d+)(?:\*| \(part\))?$/.exec(bar.label ?? String(bar.bar))?.[1] === value);
  return measure?.bar ?? NaN;
}
