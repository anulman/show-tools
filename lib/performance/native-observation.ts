import { CONTROL_IDS, INPUT_PRODUCER_KINDS, PHYSICAL_SWITCH_IDS } from './model.js';
import type { PadLight, Phase, PracticeState, PracticeEvent, TempoHitState, VoiceEffectsState, LiveEffectsState, LiveEffectDefinition, CompiledTakeState, IdentifiedInputControl } from './model.js';
import { PF } from './wasm-abi.js';
import type { InputRoutingState } from './input-bindings.js';

const PHASES: readonly Phase[] = ['idle', 'count-in', 'playing', 'ended'];
const STATUSES: readonly PracticeState['channels'][number]['status'][] = ['empty', 'ready', 'armed', 'recording', 'stopping', 'looping'];

export function decodeNativeInputRouting(info: ArrayLike<number>): InputRoutingState {
  const whole = (value: number, maximum: number, minimum = 0) => Number.isSafeInteger(value) && value >= minimum && value <= maximum;
  const generation = info[PF.INPUT_GENERATION], count = info[PF.INPUT_COUNT];
  const sessionHighWatermark = info[PF.INPUT_SESSION_HIGH_WATERMARK], panicMask = info[PF.INPUT_PANIC_MASK];
  if (info.length !== PF.INPUT_INFO_FIELDS || !whole(generation, Number.MAX_SAFE_INTEGER, 1)
    || !whole(count, PF.INPUT_PRODUCERS) || !whole(sessionHighWatermark, Number.MAX_SAFE_INTEGER)
    || !whole(panicMask, 63)) throw new Error('Invalid native input routing header');
  const kinds: readonly InputRoutingState['producers'][number]['kind'][] = ['physical', 'keyboard', 'pointer'];
  const producers: InputRoutingState['producers'][number][] = [];
  let previous = -1;
  for (let index = 0; index < count; index++) {
    const offset = PF.INPUT_RECORDS + index * PF.INPUT_PRODUCER_FIELDS;
    const producer = info[offset + PF.INPUT_SLOT], session = info[offset + PF.INPUT_SESSION];
    const kind = kinds[info[offset + PF.INPUT_KIND]];
    const releasedMask = info[offset + PF.INPUT_RELEASED_MASK], heldMask = info[offset + PF.INPUT_HELD_MASK];
    const lastSequence = info[offset + PF.INPUT_LAST_SEQUENCE];
    const allowed = kind === 'physical' ? 63 : 223;
    if (!whole(producer, PF.INPUT_PRODUCERS - 1) || producer <= previous || !kind || !whole(session, sessionHighWatermark, 1)
      || !whole(releasedMask, allowed) || !whole(heldMask, allowed) || ((releasedMask | heldMask) & ~allowed)
      || (releasedMask & heldMask) || !whole(lastSequence, Number.MAX_SAFE_INTEGER)) throw new Error('Invalid native input producer record');
    previous = producer; producers.push({ producer, session, kind, releasedMask, heldMask, lastSequence });
  }
  for (let index = PF.INPUT_RECORDS + count * PF.INPUT_PRODUCER_FIELDS; index < PF.INPUT_INFO_FIELDS; index++)
    if (info[index] !== 0) throw new Error('Invalid native input routing padding');
  return { bindingGeneration: generation, sessionHighWatermark, panicMask, producers };
}

export function decodeNativeState(data: ArrayLike<number>, channelData: ArrayLike<number>, runId: string, message: (code: number) => string): PracticeState {
    const phase = PHASES[data[PF.PHASE]];
    if (!phase) throw new Error('Invalid native transport phase');
    const channels = CONTROL_IDS.map((id, index) => {
      const info = Array.from({ length: PF.CHANNEL_FIELDS }, (_, field) => channelData[index * PF.CHANNEL_FIELDS + field]);
      const status = STATUSES[info[PF.CHANNEL_STATUS]];
      if (!status) throw new Error('Invalid native channel status');
      const light: PadLight = info[PF.CHANNEL_LIGHT] === PF.RELEASING ? { kind: 'releasing', remainingMs: info[PF.CHANNEL_RELEASE_MS] }
        : { kind: info[PF.CHANNEL_LIGHT] === PF.CUE ? 'cue' : info[PF.CHANNEL_LIGHT] === PF.STEADY ? 'steady' : 'off' };
      return { id, gain: info[PF.CHANNEL_GAIN], muted: info[PF.CHANNEL_MUTED] === 1, looping: info[PF.CHANNEL_LOOPING] === 1, ready: info[PF.CHANNEL_READY] === 1, status, light };
    });
    const active = channels.find(channel => channel.status === 'recording')
      ?? channels.find(channel => channel.status === 'armed') ?? channels.find(channel => channel.status === 'stopping');
    const recording = active && (active.status === 'armed' || active.status === 'recording' || active.status === 'stopping') ? { id: active.id, status: active.status } : null;
    return { phase, bar: data[PF.BAR_NUMBER] < 0 ? null : data[PF.BAR_NUMBER], beat: data[PF.BEAT_NUMBER] < 0 ? null : data[PF.BEAT_NUMBER], countInRemaining: data[PF.COUNT_IN_REMAINING], bpm: data[PF.BPM],
      startBar: data[PF.START_BAR], endBar: data[PF.END_BAR], loop: data[PF.LOOP] === 1, automatic: data[PF.AUTOMATIC] === 1, click: data[PF.CLICK] === 1, selectedChannel: CONTROL_IDS[data[PF.SELECTED_CHANNEL]],
      runId: runId, seq: data[PF.SEQUENCE], channels, looping: channels.filter(channel => channel.looping).map(channel => channel.id), recording, microphone: data[PF.MICROPHONE] === 1, error: data[PF.ERROR] ? message(data[PF.ERROR]) : null };
}

export function decodeNativeTempo(info: ArrayLike<number>): TempoHitState {
    return { count: info[PF.TEMPO_COUNT], latest: info[PF.TEMPO_COUNT] ? {
      frame: info[PF.TEMPO_FRAME], beatHint: info[PF.TEMPO_HINT] === 1 ? 1 : null,
      source: info[PF.TEMPO_SOURCE] === 1 ? 'chart' : 'pedal', estimated: info[PF.TEMPO_ESTIMATED] === 1, bpm: info[PF.TEMPO_BPM],
    } : null };
}

export function decodeNativeVoices(voiceInfo: readonly ArrayLike<number>[], effectInfo: readonly (readonly ArrayLike<number>[])[]): readonly VoiceEffectsState[] {
    const activity: readonly VoiceEffectsState['activity'][] = ['standby', 'live', 'tail', 'capture'];
    return Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => {
      const data = Array.from(voiceInfo[profile]);
      const effects = Array.from({ length: data[PF.VOICE_STAGE_COUNT] }, (_, stage): LiveEffectDefinition => {
        const effect = effectInfo[profile][stage];
        if (effect[PF.VOICE_EFFECT_TYPE] === PF.EFFECT_SLAPBACK) return { kind: 'slapback', delayMs: effect[PF.VOICE_EFFECT_PARAMETER_0], feedback: effect[PF.VOICE_EFFECT_PARAMETER_1], wet: effect[PF.VOICE_EFFECT_PARAMETER_2] };
        if (effect[PF.VOICE_EFFECT_TYPE] === PF.EFFECT_CHORUS) return { kind: 'chorus', rateHz: effect[PF.VOICE_EFFECT_PARAMETER_0], depthMs: effect[PF.VOICE_EFFECT_PARAMETER_1], baseDelayMs: effect[PF.VOICE_EFFECT_PARAMETER_2], wet: effect[PF.VOICE_EFFECT_PARAMETER_3] };
        throw new Error('Unknown native voice effect');
      });
      return { profile, effects, prepared: data[PF.VOICE_PREPARED] === 1, revision: data[PF.VOICE_REVISION], activity: activity[data[PF.VOICE_ACTIVITY]] ?? 'standby',
        rotationEligible: data[PF.VOICE_ROTATION_ELIGIBLE] === 1, rotationRemainingBeats: data[PF.VOICE_ROTATION_REMAINING] };
    });
}

export function decodeNativeLiveEffects(data: ArrayLike<number>): LiveEffectsState {
    const stageCount = data[PF.LIVE_STAGE_COUNT];
    return { prepared: data[PF.LIVE_PREPARED] === 1, active: data[PF.LIVE_ACTIVE] === 1,
      revision: data[PF.LIVE_REVISION], stageCount, captureSupported: data[PF.LIVE_CAPTURE_SUPPORTED] === 1 };
}

const virtualInputControls: readonly IdentifiedInputControl[] = [...CONTROL_IDS, 'mushroom', 'knob', 'tempo', 'cueButton'];
const identifiedInputEdges = ['press', 'release', 'rotate'] as const;
export function decodeNativeEvent(event: Float64Array, runId: string, message: (code: number) => string): PracticeEvent {
      const type = event[PF.EVENT_TYPE] === PF.BEAT ? 'beat' : event[PF.EVENT_TYPE] === PF.CONTROL ? 'control' : event[PF.EVENT_TYPE] === PF.FAULT ? 'fault' : event[PF.EVENT_TYPE] === PF.TEMPO_HIT ? 'tempo-hit'
        : event[PF.EVENT_TYPE] === PF.BEAT_PREDICTION ? 'beat-prediction' : event[PF.EVENT_TYPE] === PF.IDENTIFIED_INPUT ? 'identified-input'
        : event[PF.EVENT_TYPE] === PF.CUE_ENTER ? 'cue' : 'state';
      const state = decodeNativeState(event.subarray(PF.EVENT_STATE, PF.EVENT_CHANNELS), event.subarray(PF.EVENT_CHANNELS, PF.EVENT_CUE), runId, message);
      const result: PracticeEvent = { v: 1, runId: runId, seq: event[PF.EVENT_SEQUENCE], type, state };
      if (event[PF.EVENT_FRAME] >= 0) { result.frame = event[PF.EVENT_FRAME]; result.sampleRate = event[PF.EVENT_RATE]; }
      if (event[PF.EVENT_ERROR]) result.error = message(event[PF.EVENT_ERROR]);
      if (type === 'control') {
        const id = event[PF.EVENT_CONTROL];
        result.control = id === 4 ? { id: 'mushroom' } : id === 5 ? { id: 'knob', value: event[PF.EVENT_VALUE] } : id === 6 ? { id: 'tempo' } : id === 7 ? { id: 'cueButton', value: event[PF.EVENT_VALUE] === 1 ? 1 : 0 } : id >= 16 && id < 80 ? { id: 'external', slot: id - 16 } : id >= 8 && id < 12 ? { id: CONTROL_IDS[id - 8], edge: 'release' } : { id: CONTROL_IDS[id] };
        result.applied = event[PF.EVENT_APPLIED] === 1;
        if (id === 4 && result.applied && event[PF.EVENT_VALUE] === 1) result.physicalPanic = true;
      }
      if (type === 'tempo-hit') result.tempoHit = { beatHint: event[PF.EVENT_VALUE] === 1 ? 1 : null,
        source: event[PF.EVENT_CONTROL] === 1 ? 'chart' : 'pedal', estimated: event[PF.EVENT_APPLIED] === 1 };
      if (type === 'beat' || type === 'beat-prediction') {
        const frame = event[PF.EVENT_NEXT_BEAT_FRAME], id = event[PF.EVENT_NEXT_BEAT_ID];
        result.timing = { clockEpoch: event[PF.EVENT_CLOCK_EPOCH], clockRevision: event[PF.EVENT_CLOCK_REVISION],
          nextBeat: id < 0 ? null : { id, frame } };
      }
      if (type === 'identified-input') {
        const kind = INPUT_PRODUCER_KINDS[event[PF.EVENT_INPUT_KIND]];
        const edge = identifiedInputEdges[event[PF.EVENT_INPUT_EDGE] - 1];
        const inputIndex = event[PF.EVENT_CONTROL];
        const controlId = kind === 'physical'
          ? inputIndex === 6 || inputIndex === 7 ? 'knob' : PHYSICAL_SWITCH_IDS[inputIndex]
          : virtualInputControls[inputIndex];
        if (!kind || !edge || !controlId) throw new Error('Invalid native identified input');
        result.identifiedInput = { producer: event[PF.EVENT_INPUT_SLOT], session: event[PF.EVENT_INPUT_SESSION],
          bindingGeneration: event[PF.EVENT_INPUT_GENERATION], sequence: event[PF.EVENT_INPUT_SEQUENCE],
          kind, inputIndex, controlId, edge, value: event[PF.EVENT_VALUE] };
      }
      if (type === 'cue') {
        const row = CONTROL_IDS[event[PF.EVENT_CONTROL]];
        if (!row) throw new Error('Invalid native cue row');
        result.cueRow = row;
        result.cueFrame = event[PF.EVENT_VALUE];
      }
      if (event[PF.EVENT_CUE] >= 0) result.cueIndex = event[PF.EVENT_CUE];
      return result;
}

export function decodeNativeTake(info: ArrayLike<number>, index: number): CompiledTakeState {
  const playback = (['idle', 'playing', 'releasing'] as const)[info[PF.TAKE_PLAYBACK_STATE]];
  if (!playback) throw new Error('Invalid native take playback state');
  return { index, ready: info[PF.TAKE_READY] === 1, frames: info[PF.TAKE_LENGTH], period: info[PF.TAKE_PERIOD], playback,
    selectionIndex: info[PF.TAKE_SELECTION] < 0 ? null : info[PF.TAKE_SELECTION],
      sourceEndFrames: info[PF.TAKE_SOURCE_END] < 0 ? null : info[PF.TAKE_SOURCE_END] };
}
