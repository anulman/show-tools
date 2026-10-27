import { Schema } from 'effect';

const integer = Schema.Int.check(Schema.isBetween({ minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }));
const natural = integer.check(Schema.isGreaterThanOrEqualTo(0));
const timestamp = Schema.String.check(Schema.isPattern(/^\d+$/));
const mac = Schema.Struct({
  type: Schema.Literal('input'), platform: Schema.Literal('macos'), device: Schema.NonEmptyString,
  sequence: natural, hostTimeNs: timestamp, deviceTicks: timestamp,
  timestampDomain: Schema.Literal('mach_absolute_time'), usagePage: natural, usage: natural,
  relative: Schema.Boolean, value: integer,
});
const linux = Schema.Struct({
  type: Schema.Literal('input'), platform: Schema.Literal('linux-evdev'), device: Schema.NonEmptyString,
  sequence: natural, hostTimeNs: timestamp, deviceSeconds: integer, deviceMicroseconds: natural,
  eventType: natural, code: natural, relative: Schema.Boolean, value: integer,
});
const metadata = Schema.Struct({
  type: Schema.Literals(['device', 'disconnect', 'stopped', 'gap', 'key-snapshot', 'error']),
});
const decode = Schema.decodeUnknownSync(Schema.Union([mac, linux, metadata]));

interface Observation {
  device: string; platform: 'macos' | 'linux-evdev'; code: string;
  presses: number; releases: number; repeats: number; events: number;
  signedDistance: number; absoluteDistance: number;
}

export function summarizeCapture(text: string) {
  const inputs = new Map<string, Observation>();
  const sequences = new Map<string, number>();
  let gaps = 0, disconnects = 0, stops = 0, errors = 0;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let event: ReturnType<typeof decode>;
    try { event = decode(JSON.parse(line)); }
    catch (cause) { throw new Error(`Invalid probe record on line ${index + 1}`, { cause }); }
    if (event.type === 'gap') gaps++;
    if (event.type === 'disconnect') disconnects++;
    if (event.type === 'stopped') stops++;
    if (event.type === 'error') errors++;
    if (event.type !== 'input') continue;
    const source = `${event.platform}/${event.device}`;
    const previous = sequences.get(source);
    if (previous !== undefined && event.sequence <= previous) throw new Error(`Out-of-order source sequence on line ${index + 1}; keep probe sessions separate`);
    sequences.set(source, event.sequence);
    const code = event.platform === 'macos' ? `hid:${event.usagePage}:${event.usage}` : `evdev:${event.eventType}:${event.code}`;
    const key = `${source}/${code}`;
    let observation = inputs.get(key);
    if (!observation) {
      observation = { device: event.device, platform: event.platform, code, presses: 0, releases: 0, repeats: 0, events: 0, signedDistance: 0, absoluteDistance: 0 };
      inputs.set(key, observation);
    }
    observation.events++;
    if (event.relative) {
      observation.signedDistance += event.value;
      observation.absoluteDistance += Math.abs(event.value);
      if (!Number.isSafeInteger(observation.signedDistance) || !Number.isSafeInteger(observation.absoluteDistance))
        throw new Error(`Rotation distance exceeds exact integer range on line ${index + 1}`);
    } else if ((event.platform === 'macos' && event.usagePage === 7) || (event.platform === 'linux-evdev' && event.eventType === 1)) {
      if (event.value === 1) observation.presses++;
      if (event.value === 0) observation.releases++;
      if (event.value === 2 && event.platform === 'linux-evdev') observation.repeats++;
    }
  }
  return { v: 1, description: 'Raw observations only; codes and distance units are not musical bindings.', gaps, disconnects, stops, errors, inputs: [...inputs.values()] };
}
