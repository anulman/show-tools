import type { TambourineTrace, TambourineTuning } from './phone-motion.js';

const TRACE_LIMIT = 300;
const labels = ['hit v1', 'hit v2', 'shake rr1', 'shake rr2'];
const number = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '-';

function formatTambourineTrace(entry: TambourineTrace): string {
  const { reading, magnitude, comparedMs, turnDegrees, rearm, decision, slots } = entry;
  const { rotation } = reading;
  const source = magnitude === undefined ? 'missing' : reading.gravity ? 'gravity' : 'linear';
  return [
    `t=${number(reading.time)}ms`,
    `src=${source} a=[${number(reading.x)},${number(reading.y)},${number(reading.z)}] mag=${number(magnitude)}`,
    `gyro=[${number(rotation?.x)},${number(rotation?.y)},${number(rotation?.z)}]`,
    `turn=${number(turnDegrees)}deg anchor=${number(comparedMs)}ms`,
    `rearm=${rearm ?? '-'} decision=${decision} samples=${slots.map(slot => labels[slot]).join('+') || '-'}`,
  ].join(' ');
}

export function createTambourineTrace() {
  const root = document.createElement('section');
  root.className = 'tambourine-trace'; root.hidden = true;
  const heading = document.createElement('strong');
  heading.textContent = 'Audition motion log';
  const copy = document.createElement('button');
  copy.type = 'button'; copy.className = 'secondary'; copy.textContent = 'Copy motion log';
  const status = document.createElement('small');
  status.setAttribute('role', 'status');
  const output = document.createElement('textarea');
  output.readOnly = true; output.rows = 7; output.wrap = 'off';
  output.setAttribute('aria-label', 'Audition motion log');
  root.append(heading, copy, status, output);

  const rows: string[] = [];
  let dropped = 0;
  let tuning: (() => TambourineTuning) | undefined;
  let lastTuning: TambourineTuning | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const content = () => [
    'Tambourine audition v1 · acceleration m/s² · gyro °/s',
    `Latest tuning: ${JSON.stringify(tuning?.())} · older entries discarded: ${dropped}`,
    ...rows,
  ].join('\n');
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (document.activeElement === output) return;
    output.value = content();
    output.scrollTop = output.scrollHeight;
  };
  const note = (line: string) => {
    if (rows.length === TRACE_LIMIT) { rows.shift(); dropped++; }
    rows.push(line.replace(/[\r\n]+/g, ' ').slice(0, 500));
    if (timer === undefined) timer = setTimeout(flush, 200);
  };
  output.addEventListener('blur', flush);
  copy.addEventListener('click', async () => {
    const report = content();
    try {
      await navigator.clipboard.writeText(report);
      status.textContent = 'Copied';
    } catch {
      output.value = report;
      output.focus();
      output.select();
      status.textContent = 'Text selected. Use your phone’s Copy command.';
    }
  });
  return {
    root,
    start(read: () => TambourineTuning, mode: 'Hardware' | 'Browser') {
      root.hidden = false;
      rows.length = 0; dropped = 0; tuning = read; status.textContent = '';
      lastTuning = read();
      note(`Audition opening · ${mode} · ${JSON.stringify(lastTuning)}`);
      flush();
    },
    note,
    record(entry: TambourineTrace) {
      const settings = tuning?.();
      if (settings !== lastTuning) {
        lastTuning = settings;
        note(`Tuning updated · ${JSON.stringify(settings)}`);
      }
      note(formatTambourineTrace(entry));
    },
  };
}
