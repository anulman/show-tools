import type { PracticeEvent } from '../../lib/performance/model.js';
import type { TambourineDirection } from './tambourine-direction.js';
import type { MotionReading, TambourineTrace, TambourineTuning } from './phone-motion.js';

const TRACE_LIMIT = 480;
const CLICK_LIMIT = 32;
const labels = ['hit v1', 'hit v2', 'shake rr1', 'shake rr2'];
const number = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '-';

const axes = (reading?: MotionReading['rotation']) =>
  `[${number(reading?.x)},${number(reading?.y)},${number(reading?.z)}]`;

function formatTambourineTrace(entry: TambourineTrace): string {
  const { reading, magnitude, comparedMs, turnDegrees, signedSpeed, verticalAcceleration, verticalVelocity, gravityMagnitude, rearm, decision, slots } = entry;
  const { rotation } = reading;
  const gesture = entry.gesture ? ` gesture=${entry.gesture}` : '';
  const source = reading.x === null || reading.y === null || reading.z === null ? 'missing' : reading.gravity ? 'gravity' : 'linear';
  return [
    `t=${number(reading.time)}ms`,
    `src=${source} a=${axes(reading)} mag=${number(magnitude)}`,
    `gyro=${axes(rotation)}`,
    ...(reading.accelerationIncludingGravity ? [`a+g=${axes(reading.accelerationIncludingGravity)}`] : []),
    ...(verticalVelocity === undefined ? [] : [`g=${number(gravityMagnitude)} aDown=${number(verticalAcceleration)} vDown=${number(verticalVelocity)}`]),
    ...(signedSpeed !== undefined ? [`down=${number(signedSpeed)}°/s`]
      : verticalVelocity === undefined ? [`turn=${number(turnDegrees)}deg anchor=${number(comparedMs)}ms`] : []),
    `rearm=${rearm ?? '-'} decision=${decision}${gesture} samples=${slots.map(slot => labels[slot]).join('+') || '-'}`,
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
  const clicks: string[] = [];
  let dropped = 0;
  let clicksDropped = 0;
  let mode: 'Hardware' | 'Browser';
  let tuning: (() => TambourineTuning) | undefined;
  let direction: (() => TambourineDirection | undefined) | undefined;
  let lastDirection: TambourineDirection | undefined;
  let lastTuning: TambourineTuning | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const content = () => [
    'Tambourine audition v5 · acceleration m/s² · velocity m/s · gyro °/s',
    `Latest tuning: ${JSON.stringify(tuning?.())} · older entries discarded: ${dropped}`,
    `Motion direction: ${JSON.stringify(direction?.() ?? null)}`,
    clicks.length
      ? `Desk clicks on the phone timeline · older clicks discarded: ${clicksDropped}`
      : 'No desk clicks captured. Start the song with Song click enabled before opening audition.',
    ...clicks,
    ...rows,
  ].join('\n');
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (document.activeElement === output) return;
    output.value = content();
    output.scrollTop = output.scrollHeight;
  };
  const append = (line: string) => {
    if (rows.length === TRACE_LIMIT) { rows.shift(); dropped++; }
    rows.push(line.replace(/[\r\n]+/g, ' ').slice(0, 500));
    if (timer === undefined) timer = setTimeout(flush, 200);
  };
  const note = (line: string) => append(`t=${number(performance.now())}ms ${line}`);
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
    start(read: () => TambourineTuning, route: 'Hardware' | 'Browser', readDirection?: () => TambourineDirection | undefined) {
      root.hidden = false;
      rows.length = 0; clicks.length = 0; dropped = 0; clicksDropped = 0;
      tuning = read; mode = route; status.textContent = '';
      lastTuning = read();
      direction = readDirection;
      lastDirection = direction?.();
      note(`Audition opening · ${mode} · ${JSON.stringify(lastTuning)}`);
      flush();
    },
    note,
    recordClick(event: PracticeEvent, outputTime?: number) {
      if (event.type !== 'beat' || !event.state.click || event.frame === undefined || !event.sampleRate) return;
      const received = performance.now();
      const mapped = outputTime !== undefined && Number.isFinite(outputTime) && outputTime >= 0;
      const source = mapped ? 'browser-output-estimate' : mode === 'Hardware' ? 'hardware-event-receipt' : 'browser-event-receipt';
      const { bar, beat, bpm, phase } = event.state;
      if (clicks.length === CLICK_LIMIT) { clicks.shift(); clicksDropped++; }
      clicks.push(`t=${number(mapped ? outputTime : received)}ms click source=${source} phase=${phase} bar=${bar ?? '-'} beat=${beat ?? '-'} bpm=${number(bpm)} frame=${number(event.frame)} rate=${event.sampleRate} received=${number(received)}ms`);
      if (timer === undefined) timer = setTimeout(flush, 200);
    },
    record(entry: TambourineTrace) {
      const settings = tuning?.();
      if (settings !== lastTuning) {
        lastTuning = settings;
        note(`Tuning updated · ${JSON.stringify(settings)}`);
      }
      const axis = direction?.();
      if (axis !== lastDirection) {
        lastDirection = axis;
        note(`Motion direction updated · ${JSON.stringify(axis ?? null)}`);
      }
      append(formatTambourineTrace(entry));
    },
  };
}
