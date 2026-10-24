import { CONTROL_IDS } from '../../lib/performance/model.js';
import type { ChannelId, Control, PracticeEvent, Program, ProgramEvent, StartOptions, TransportState } from '../../lib/performance/model.js';

type EngineOptions = { bpm?: number; beatsPerBar?: number; barCount?: number; endBar?: number; runId?: string; program?: Program };
export type EventDetails = { frame?: number; sampleRate?: number; error?: string; control?: Control; commandId?: string; applied?: boolean };
export type EventType = 'state' | 'beat' | 'control' | 'fault';
export type BeatResult = { stopped: true; fault?: string } | { stopped?: false; fault?: never; triggers: ProgramEvent[]; downbeat: boolean };

export class PracticeEngine {
  readonly barCount: number;
  readonly beatsPerBar: number;
  readonly programLength: number;
  readonly programEvents = new Map<number, ProgramEvent[]>();
  bpm: number;
  startBar = 1;
  endBar: number;
  loop = true;
  automatic = false;
  click = false;
  selectedChannel: ChannelId = 'R1';
  phase: 'idle' | 'count-in' | 'playing' | 'ended' = 'idle';
  runId: string;
  seq = 0;
  bar: number | null = null;
  beat: number | null = null;
  countInRemaining = 0;
  countInBeats = 0;
  countInElapsed = 0;
  positionBeat = -1;
  lastBeatId: number | null = null;
  epoch: number | null = null;

  constructor({ bpm = 120, beatsPerBar = 4, barCount = 1, endBar = barCount, runId = 'unstarted',
    program = { lengthBeats: 4, events: [] } }: EngineOptions = {}) {
    if (beatsPerBar !== 4) throw new Error('Practice currently supports four beats per bar');
    if (!Number.isSafeInteger(barCount) || barCount < 1) throw new Error('A positive bar count is required');
    if (!Number.isSafeInteger(program.lengthBeats) || program.lengthBeats < 1) throw new Error('Program length must be a positive beat count');
    this.programLength = program.lengthBeats;
    for (const event of program.events) {
      if (!Number.isSafeInteger(event.atBeat) || event.atBeat < 0 || event.atBeat >= program.lengthBeats || !CONTROL_IDS.includes(event.sampleId)
        || (event.gain !== undefined && (!Number.isFinite(event.gain) || event.gain < 0))) throw new Error('Invalid program event');
      const events = this.programEvents.get(event.atBeat) || [];
      events.push({ ...event });
      this.programEvents.set(event.atBeat, events);
    }
    this.barCount = barCount;
    this.beatsPerBar = beatsPerBar;
    this.bpm = bpm;
    this.startBar = 1;
    this.endBar = Math.min(endBar, barCount);
    this.loop = true;
    this.automatic = false;
    this.click = false;
    this.selectedChannel = 'R1';
    this.phase = 'idle';
    this.runId = runId;
    this.seq = 0;
    this.bar = null;
    this.beat = null;
    this.countInRemaining = 0;
    this.lastBeatId = null;
    this.epoch = null;
  }

  start({ runId, bpm = this.bpm, countInBars = 1, startBar = 1,
    endBar = this.endBar, loop = true, automatic = false }: StartOptions & { runId: string }) {
    if (this.phase === 'playing' || this.phase === 'count-in') throw new Error('Stop before starting another run');
    if (typeof runId !== 'string' || !runId.trim()) throw new Error('A run ID is required');
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('Tempo must be between 40 and 240 BPM');
    if (!Number.isSafeInteger(countInBars) || countInBars < 0 || countInBars > 4) throw new Error('Count-in must be zero to four bars');
    if (!Number.isSafeInteger(startBar) || !Number.isSafeInteger(endBar) || startBar < 1 || endBar < startBar || endBar > this.barCount) {
      throw new Error('Choose a valid bar range');
    }
    if (typeof loop !== 'boolean' || typeof automatic !== 'boolean') throw new Error('Loop and automatic must be boolean');
    Object.assign(this, { runId, bpm, startBar, endBar, loop, automatic, seq: 0,
      countInBeats: countInBars * this.beatsPerBar, countInElapsed: 0,
      countInRemaining: countInBars * this.beatsPerBar, positionBeat: -1,
      phase: countInBars ? 'count-in' : 'playing', bar: null, beat: null,
      lastBeatId: null, epoch: null });
  }

  stop() {
    this.phase = 'idle';
    this.countInRemaining = 0;
  }

  selectChannel(id: ChannelId) {
    if (!CONTROL_IDS.includes(id)) throw new Error('Unknown channel');
    this.selectedChannel = id;
  }

  setAutomatic(value: boolean) {
    if (typeof value !== 'boolean') throw new Error('Automatic must be boolean');
    this.automatic = value;
  }

  setClick(value: boolean) {
    if (typeof value !== 'boolean') throw new Error('Click must be boolean');
    this.click = value;
  }

  onBeat(id: number, epoch: number): BeatResult | null {
    if (this.phase !== 'playing' && this.phase !== 'count-in') return null;
    if (this.lastBeatId !== null && epoch !== this.epoch) {
      this.stop();
      return { stopped: true, fault: 'The audio clock restarted. Start a fresh run.' };
    }
    if (this.lastBeatId !== null && id <= this.lastBeatId) return null;
    if (this.lastBeatId !== null && id !== this.lastBeatId + 1) {
      this.stop();
      return { stopped: true, fault: 'The audio clock missed a beat. Start a fresh run.' };
    }
    this.lastBeatId = id;
    this.epoch = epoch;
    if (this.phase === 'count-in' && this.countInElapsed < this.countInBeats) {
      this.bar = null;
      this.beat = this.countInElapsed % this.beatsPerBar + 1;
      this.countInRemaining = this.countInBeats - this.countInElapsed++;
      return { triggers: [], downbeat: this.beat === 1 };
    }
    this.phase = 'playing';
    this.countInRemaining = 0;
    const length = (this.endBar - this.startBar + 1) * this.beatsPerBar;
    this.positionBeat++;
    if (this.positionBeat === length) {
      if (this.loop) this.positionBeat = 0;
      else {
        this.phase = 'ended';
        return { stopped: true };
      }
    }
    this.bar = this.startBar + Math.floor(this.positionBeat / this.beatsPerBar);
    this.beat = this.positionBeat % this.beatsPerBar + 1;
    const absoluteBeat = (this.bar - 1) * this.beatsPerBar + this.beat - 1;
    const triggers = this.automatic ? this.programEvents.get(absoluteBeat % this.programLength) || [] : [];
    return { triggers, downbeat: this.beat === 1 };
  }

  snapshot(): TransportState {
    return { phase: this.phase, bar: this.bar, beat: this.beat, countInRemaining: this.countInRemaining,
      bpm: this.bpm, startBar: this.startBar, endBar: this.endBar, loop: this.loop,
      automatic: this.automatic, click: this.click, selectedChannel: this.selectedChannel,
      runId: this.runId, seq: this.seq };
  }

  event(type: EventType, details: EventDetails = {}): Omit<PracticeEvent, 'state'> & { state: TransportState } {
    this.seq++;
    return { v: 1, runId: this.runId, seq: this.seq, type, ...details, state: this.snapshot() };
  }
}
