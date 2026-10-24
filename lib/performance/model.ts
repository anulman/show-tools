export type ChannelId = 'L1' | 'L2' | 'R1' | 'R2';
export type ControlId = ChannelId | 'mushroom' | 'knob';
export type Control = { readonly id: Exclude<ControlId, 'knob'> } | { readonly id: 'knob'; readonly value: number };
export const CONTROL_IDS: readonly ChannelId[] = ['L1', 'L2', 'R1', 'R2'];
export const CONTROLS: readonly { id: ChannelId; key: string; shortcut: string; color: string }[] = [
  { id: 'L1', key: 'KeyQ', shortcut: 'Q', color: '#8bb7ff' },
  { id: 'R1', key: 'KeyW', shortcut: 'W', color: '#dfbe78' },
  { id: 'L2', key: 'KeyA', shortcut: 'A', color: '#d6b5ff' },
  { id: 'R2', key: 'KeyS', shortcut: 'S', color: '#a8c6ab' },
];

export interface ChartBar {
  bar: number;
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
export interface ChannelSettings { gain?: number; muted?: boolean }
export type PadLight = { kind: 'off' | 'cue' | 'steady' } | { kind: 'releasing'; remainingMs: number };
export interface ChannelState {
  id: ChannelId; gain: number; muted: boolean; looping: boolean; ready: boolean;
  status: 'empty' | 'ready' | 'armed' | 'recording' | 'stopping' | 'looping';
  light: PadLight;
}
export interface RecordingState { id: ChannelId; status: 'armed' | 'recording' | 'stopping' }
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
export interface PracticeEvent {
  v: 1;
  runId: string;
  seq: number;
  type: 'state' | 'beat' | 'control' | 'fault';
  state: PracticeState;
  frame?: number;
  sampleRate?: number;
  control?: Control;
  commandId?: string;
  applied?: boolean;
  error?: string;
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
}
