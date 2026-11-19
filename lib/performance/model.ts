import type { CatalogDocument } from '../voice-catalog/model.js';
import type { SongSource } from './song-source.js';
import type { CompiledSong } from './compiled-song.js';
import type { InputBindings, InputRoutingState } from './input-bindings.js';

export type ChannelId = 'L1' | 'L2' | 'R1' | 'R2';
export type ControlId = ChannelId | 'mushroom' | 'knob' | 'tempo' | 'cueButton' | 'external';
export type Control = { readonly id: ChannelId; readonly edge?: 'release' } | { readonly id: 'mushroom' | 'tempo' } | { readonly id: 'external'; readonly slot: number } | { readonly id: 'knob'; readonly value: number } | { readonly id: 'cueButton'; readonly value: 0 | 1 };
export const CONTROL_IDS: readonly ChannelId[] = ['L1', 'L2', 'R1', 'R2'];
export const PHYSICAL_SWITCH_IDS: readonly ['blue', 'yellow', 'red', 'green', 'pedal', 'mushroom'] = ['blue', 'yellow', 'red', 'green', 'pedal', 'mushroom'];
export type PhysicalSwitchId = typeof PHYSICAL_SWITCH_IDS[number];
export const INPUT_PRODUCER_KINDS: readonly ['physical', 'keyboard', 'pointer'] = ['physical', 'keyboard', 'pointer'];
export const INPUT_PRODUCER_LIMIT = 32;
export const INPUT_LIGHT_ID_BASE = 257;
export const INPUT_PACKET_MAGIC = 0x50464931;
export const INPUT_BINDING_FIELDS = 3;
export function inputBindingRows(bindings: InputBindings): readonly (readonly [number, number, number])[] {
  return bindings.map(binding => {
    const id = PHYSICAL_SWITCH_IDS.indexOf(binding.controlId);
    switch (binding.target.kind) {
      case 'cue-rows': return [id, 0, binding.target.rows.reduce((mask, row) => mask | 1 << CONTROL_IDS.indexOf(row), 0)];
      case 'tempo': return [id, 1, 0];
      case 'panic': return [id, 2, 0];
    }
  });
}
export function physicalControlLightId(id: PhysicalSwitchId): number {
  return INPUT_LIGHT_ID_BASE + PHYSICAL_SWITCH_IDS.indexOf(id);
}
export const CONTROLS: readonly { id: ChannelId; key: string; shortcut: string; color: string }[] = [
  { id: 'L1', key: 'KeyQ', shortcut: 'Q', color: '#8bb7ff' },
  { id: 'R1', key: 'KeyW', shortcut: 'W', color: '#dfbe78' },
  { id: 'L2', key: 'KeyA', shortcut: 'A', color: '#d6b5ff' },
  { id: 'R2', key: 'KeyS', shortcut: 'S', color: '#a8c6ab' },
];

export interface ChartBar {
  bar: number;
  label?: string;
  column: number;
  sectionId: string;
  section: string;
  partial: boolean;
  cues: Record<ChannelId, string>;
}
export interface ChartSection { id: string; label: string; startBar: number; endBar: number }
export interface ChartMetadata { spreadsheetId: string; sheetId: number; columns: number[]; leadInColumn: number }
export interface Chart {
  title: string;
  bpm: number;
  beatsPerBar: number;
  bars: ChartBar[];
  sections: ChartSection[];
  spreadsheetId: string;
  sheetId: number;
  sheetName: string;
  leadInColumn: number;
  leadInCues: Record<ChannelId, string>;
  controlNames: Record<ChannelId, string>;
  annotatedThroughBar: number;
}
export const VOICE_PROFILE_COUNT = 6;
export const DEFAULT_LIVE_PROFILE = 4;
export const ROTATION_LIVE_PROFILE = 5;
export type LiveEffectDefinition =
  | { readonly kind: 'slapback'; readonly delayMs: number; readonly feedback: number; readonly wet: number }
  | { readonly kind: 'chorus'; readonly rateHz: number; readonly depthMs: number; readonly baseDelayMs: number; readonly wet: number };
export interface VoiceEffectConfiguration { readonly profile: number; readonly effects: readonly LiveEffectDefinition[] }
export interface VoiceEffectsState extends VoiceEffectConfiguration {
  readonly prepared: boolean;
  readonly revision: number;
  readonly activity: 'standby' | 'live' | 'tail' | 'capture';
  readonly rotationEligible: boolean;
  readonly rotationRemainingBeats: number;
}
export interface LiveEffectsState {
  prepared: boolean;
  active: boolean;
  revision: number;
  stageCount: number;
  captureSupported: boolean;
}
export interface TempoHitObservation { beatHint: 1 | null; source: 'pedal' | 'chart'; estimated: boolean }
export interface TempoHitState { count: number; latest: (TempoHitObservation & { frame: number; bpm: number }) | null }
export interface ChannelSettings { gain?: number; muted?: boolean }
export type PadLight = { kind: 'off' | 'cue' | 'steady' } | { kind: 'releasing'; remainingMs: number };
export interface ChannelState {
  id: ChannelId; gain: number; muted: boolean; looping: boolean; ready: boolean;
  status: 'empty' | 'ready' | 'armed' | 'recording' | 'stopping' | 'looping';
  light: PadLight;
}
export interface RecordingState { id: ChannelId; status: 'armed' | 'recording' | 'stopping' }
export interface CompiledTakeState {
  index: number;
  ready: boolean;
  frames: number;
  period: number;
  playback: 'idle' | 'playing' | 'releasing';
  sourceEndFrames: number | null;
  selectionIndex: number | null;
}
export type Phase = 'idle' | 'count-in' | 'playing' | 'ended';
export interface TransportState {
  phase: Phase;
  bar: number | null;
  beat: number | null;
  countInRemaining: number;
  bpm: number;
  startBar: number;
  endBar: number;
  loop: boolean;
  automatic: boolean;
  click: boolean;
  selectedChannel: ChannelId;
  runId: string;
  seq: number;
}
export interface PracticeState extends TransportState {
  channels: ChannelState[];
  looping: ChannelId[];
  recording: RecordingState | null;
  microphone: boolean;
  error: string | null;
  lifecycle?: string;
  chart?: ChartMetadata;
  liveEffects?: LiveEffectsState;
  voiceEffects?: readonly VoiceEffectsState[];
  tempoHits?: TempoHitState;
  compiledTakes?: readonly CompiledTakeState[];
  inputRouting?: InputRoutingState;
}
export interface StartOptions {
  bpm?: number;
  countInBars?: number;
  startBar?: number;
  endBar?: number;
  loop?: boolean;
  automatic?: boolean;
  runId?: string;
}
export interface BeatTiming {
  clockEpoch: number;
  clockRevision: number;
  nextBeat: { id: number; frame: number } | null;
}
export type IdentifiedInputControl = ControlId | PhysicalSwitchId;
export interface IdentifiedPerformanceInput {
  producer: number;
  session: number;
  bindingGeneration: number;
  sequence: number;
  kind: typeof INPUT_PRODUCER_KINDS[number];
  inputIndex: number;
  controlId: IdentifiedInputControl;
  edge: 'press' | 'release' | 'rotate';
  value: number;
}
export interface PracticeEvent {
  v: 1;
  runId: string;
  seq: number;
  type: 'state' | 'beat' | 'beat-prediction' | 'control' | 'fault' | 'tempo-hit' | 'identified-input' | 'cue';
  state: PracticeState;
  frame?: number;
  sampleRate?: number;
  control?: Control;
  commandId?: string;
  applied?: boolean;
  physicalPanic?: true;
  error?: string;
  tempoHit?: TempoHitObservation;
  cueIndex?: number;
  cueRow?: ChannelId;
  cueFrame?: number;
  timing?: BeatTiming;
  identifiedInput?: IdentifiedPerformanceInput;
}
export interface ControlMessage { commandId: string; control: Control }
export interface ProgramEvent { atBeat: number; sampleId: ChannelId; gain?: number }
export type CueAction = { kind: 'none' } | { kind: 'unsupported'; notation: string }
  | { kind: 'tap'; notation: string; beats: number[] }
  | { kind: 'arm' | 'commit-arm'; timing: 'now' | 'bar'; capture?: CaptureHint }
  | { kind: 'commit' | 'stop' | 'play'; timing: 'now' | 'bar' };
export interface ChartControls { leadIn: Record<ChannelId, CueAction>; bars: Record<ChannelId, CueAction>[] }
export type CaptureHint = { kind: 'sparse'; beats: number[]; radiusBeats: number }
  | { kind: 'bar'; variantKey: string };
export interface BarPlaybackCue { bar: number; channelId: ChannelId; variantKey: string }
export interface Program {
  lengthBeats: number;
  events: ProgramEvent[];
  controls?: ChartControls;
  barPlayback?: BarPlaybackCue[];
}
export interface SongScript {
  id: string;
  chart: Chart;
  program: Program;
  practice: { startBar: number; endBar: number };
  description: string;
  compiled?: CompiledSong;
  source?: SongSource;
  voiceMetadata?: CatalogDocument;
}
