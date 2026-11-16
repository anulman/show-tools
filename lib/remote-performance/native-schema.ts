import { TunerStateSchema } from '../tuner/schema.js';
import { Schema } from 'effect';
import { PF as LIGHT } from '../performance/light-abi.js';
import { ChartSchema, CompiledSongSchema } from '../performance/compiled-song.js';
import { SongSourceSchema } from '../performance/song-source.js';
import { InputRoutingStateSchema } from '../performance/input-bindings.js';

const finite = Schema.Number.check(Schema.isFinite());
const frameCoordinate = finite.check(Schema.isGreaterThanOrEqualTo(0));
const count = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const text = Schema.String.check(Schema.isMaxLength(8192));
const id = Schema.NonEmptyString.check(Schema.isMaxLength(256));
const revision = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,19})$/));
const channel = Schema.Literals(['L1', 'L2', 'R1', 'R2']);
const list = <S extends Schema.Constraint>(item: S, maximum: number) => Schema.mutable(Schema.Array(item).check(Schema.isMaxLength(maximum)));
const control = Schema.Union([Schema.Struct({ id: Schema.Literals(['L1', 'L2', 'R1', 'R2']), edge: Schema.optionalKey(Schema.Literal('release')) }), Schema.Struct({ id: Schema.Literals(['mushroom', 'tempo']) }), Schema.Struct({ id: Schema.Literal('knob'), value: finite }), Schema.Struct({ id: Schema.Literal('cueButton'), value: Schema.Literals([0, 1]) }), Schema.Struct({ id: Schema.Literal('external'), slot: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 63 })) })]);
const effect = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('slapback'), delayMs: finite, feedback: finite, wet: finite }),
  Schema.Struct({ kind: Schema.Literal('chorus'), rateHz: finite, depthMs: finite, baseDelayMs: finite, wet: finite }),
]);
const light = Schema.Union([Schema.Struct({ kind: Schema.Literals(['off', 'cue', 'steady']) }), Schema.Struct({ kind: Schema.Literal('releasing'), remainingMs: finite })]);
const profile = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }));
const voice = Schema.Struct({ profile, effects: list(effect, 64), prepared: Schema.Boolean, revision: count,
  activity: Schema.Literals(['standby', 'live', 'tail', 'capture']), rotationEligible: Schema.Boolean, rotationRemainingBeats: finite });
const tempo = Schema.Struct({ beatHint: Schema.NullOr(Schema.Literal(1)), source: Schema.Literals(['pedal', 'chart']), estimated: Schema.Boolean });
const state = Schema.Struct({ phase: Schema.Literals(['idle', 'count-in', 'playing', 'ended']), bar: Schema.NullOr(finite), beat: Schema.NullOr(finite),
  countInRemaining: count, bpm: finite, startBar: count, endBar: count, loop: Schema.Boolean, automatic: Schema.Boolean, click: Schema.Boolean,
  selectedChannel: channel, runId: id, seq: count,
  channels: list(Schema.Struct({ id: channel, gain: finite, muted: Schema.Boolean, looping: Schema.Boolean, ready: Schema.Boolean,
    status: Schema.Literals(['empty', 'ready', 'armed', 'recording', 'stopping', 'looping']), light }), 4).check(Schema.isMinLength(4)),
  looping: list(channel, 4), recording: Schema.NullOr(Schema.Struct({ id: channel, status: Schema.Literals(['armed', 'recording', 'stopping']) })),
  microphone: Schema.Boolean, error: Schema.NullOr(text), lifecycle: Schema.optionalKey(text),
  inputRouting: Schema.optionalKey(InputRoutingStateSchema),
  chart: Schema.optionalKey(Schema.Struct({ spreadsheetId: text, sheetId: count, columns: list(count, 4096), leadInColumn: count })),
  liveEffects: Schema.optionalKey(Schema.Struct({ prepared: Schema.Boolean, active: Schema.Boolean, revision: count, stageCount: count, captureSupported: Schema.Boolean })),
  voiceEffects: Schema.optionalKey(list(voice, 6).check(Schema.isMinLength(6)).check(Schema.makeFilter(value => new Set(value.map(item => item.profile)).size === 6 || 'Duplicate voice profile'))),
  tempoHits: Schema.optionalKey(Schema.Struct({ count, latest: Schema.NullOr(Schema.Struct({ ...tempo.fields, frame: frameCoordinate, bpm: finite })) })),
  compiledTakes: Schema.optionalKey(list(Schema.Struct({ index: count, ready: Schema.Boolean, frames: count, period: count,
    playback: Schema.Literals(['idle', 'playing', 'releasing']), sourceEndFrames: Schema.NullOr(count), selectionIndex: Schema.NullOr(count) }), 32)),
}).check(Schema.makeFilter(value => new Set(value.channels.map(item => item.id)).size === 4 || 'Duplicate channel'));
const cue = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('none') }), Schema.Struct({ kind: Schema.Literal('unsupported'), notation: text }),
  Schema.Struct({ kind: Schema.Literal('tap'), notation: text, beats: list(finite, 64) }),
  Schema.Struct({ kind: Schema.Literals(['arm', 'commit-arm']), timing: Schema.Literals(['now', 'bar']), capture: Schema.optionalKey(Schema.Union([
    Schema.Struct({ kind: Schema.Literal('sparse'), beats: list(finite, 64), radiusBeats: finite }), Schema.Struct({ kind: Schema.Literal('bar'), variantKey: text })])) }),
  Schema.Struct({ kind: Schema.Literals(['commit', 'stop', 'play']), timing: Schema.Literals(['now', 'bar']) }),
]);
const cueRow = Schema.Struct({ L1: cue, L2: cue, R1: cue, R2: cue });
const song = Schema.Struct({ id, chart: ChartSchema, program: Schema.Struct({ lengthBeats: finite,
  events: list(Schema.Struct({ atBeat: finite, sampleId: channel, gain: Schema.optionalKey(finite) }), 4096),
  controls: Schema.optionalKey(Schema.Struct({ leadIn: cueRow, bars: list(cueRow, 4096) })),
  barPlayback: Schema.optionalKey(list(Schema.Struct({ bar: count, channelId: channel, variantKey: text }), 4096)) }),
  practice: Schema.Struct({ startBar: count, endBar: count }), description: text,
  compiled: Schema.optionalKey(CompiledSongSchema), source: Schema.optionalKey(SongSourceSchema) }).check(Schema.makeFilter(value => {
    if (value.chart.bars.length < 1 || value.chart.bars.length > 4096 || value.chart.sections.length > 4096) return 'Invalid chart size';
    if (value.compiled && (value.compiled.parts.length > 6 || value.compiled.voices.length > 4 || value.compiled.takes.length > 32 || value.compiled.cues.length > 4096 || value.compiled.playback.length > 4096 || value.compiled.selections.length > 4096 || value.compiled.diagnostics.length > 4096)) return 'Invalid compiled song size';
    if (value.source && (value.source.values.length > 4096 || value.source.values.some(row => row.length > 4096))) return 'Invalid source size';
  }));
const event = Schema.Struct({ v: Schema.Literal(1), runId: id, seq: count, type: Schema.Literals(['state', 'beat', 'control', 'fault', 'tempo-hit']), state,
  frame: Schema.optionalKey(frameCoordinate), sampleRate: Schema.optionalKey(finite), control: Schema.optionalKey(control), commandId: Schema.optionalKey(text),
  applied: Schema.optionalKey(Schema.Boolean), error: Schema.optionalKey(text), tempoHit: Schema.optionalKey(tempo), cueIndex: Schema.optionalKey(count) });
export const LightPublicationSchema = Schema.mutable(Schema.Array(finite)
  .check(Schema.isMinLength(LIGHT.LIGHT_FIELDS)).check(Schema.isMaxLength(LIGHT.LIGHT_FIELDS))
  .check(Schema.makeFilter(image => {
    const integer = (field: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER) =>
      Number.isSafeInteger(image[field]) && image[field] >= minimum && image[field] <= maximum;
    if (image[LIGHT.LIGHT_FORMAT] !== LIGHT.LIGHT_VERSION || !integer(LIGHT.LIGHT_GENERATION, 1)
      || !integer(LIGHT.LIGHT_RUN, 0) || !integer(LIGHT.LIGHT_EPOCH, 1) || !integer(LIGHT.LIGHT_TIMELINE, 0)
      || !integer(LIGHT.LIGHT_SEQUENCE, 1) || !integer(LIGHT.LIGHT_FRAME, 0) || !integer(LIGHT.LIGHT_RATE, 8000, 192000)
      || !integer(LIGHT.LIGHT_RUNNING, 0, 1) || !integer(LIGHT.LIGHT_PENDING, 0, 1)
      || !integer(LIGHT.LIGHT_COUNT, 0, LIGHT.LIGHT_CAPACITY)) return 'Invalid light publication header';
    const ids = new Set<number>();
    for (let row = 0; row < LIGHT.LIGHT_CAPACITY; row++) {
      const offset = LIGHT.LIGHT_SAMPLES + row * LIGHT.LIGHT_SAMPLE_FIELDS;
      const id = image[offset + LIGHT.LIGHT_SAMPLE_ID], level = image[offset + LIGHT.LIGHT_SAMPLE_LEVEL];
      if (row >= image[LIGHT.LIGHT_COUNT]) {
        if (id !== 0 || level !== 0) return 'Nonzero unused light publication row';
      } else {
        if (!Number.isInteger(id) || id < 0 || id > 0xffffffff || ids.has(id) || level < 0 || level > 1) return 'Invalid light publication row';
        ids.add(id);
        if (image[LIGHT.LIGHT_SEQUENCE] === Number.MAX_SAFE_INTEGER && level !== 0) return 'Terminal light publication must be off';
      }
    }
    if (image[LIGHT.LIGHT_SEQUENCE] === Number.MAX_SAFE_INTEGER && image[LIGHT.LIGHT_PENDING] !== 0) return 'Terminal light publication cannot be pending';
    return true;
  })));
const observation = { hostEpoch: id, revision, state, lights: LightPublicationSchema, tuner: TunerStateSchema };
export const decodeBootstrap = Schema.decodeUnknownSync(Schema.Struct({ sessionId: id, song, ...observation }));
export const decodePublication = Schema.decodeUnknownSync(Schema.Union([
  Schema.Struct({ type: Schema.Literal('session'), song, ...observation }),
  Schema.Struct({ type: Schema.Literal('state'), ...observation }),
  Schema.Struct({ type: Schema.Literal('event'), event }),
  Schema.Struct({ type: Schema.Literal('gap') }),
]));
export const decodeResult = Schema.decodeUnknownSync(Schema.Union([
  Schema.Struct({ outcome: Schema.Literal('applied'), ...observation }),
  Schema.Struct({ outcome: Schema.Literals(['rejected', 'unknown']), error: Schema.optionalKey(text) }),
]));

export { state as NativeStateSchema, song as SongSchema, event as NativeEventSchema };
