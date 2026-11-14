export type TunerScale = 'major' | 'natural-minor' | 'chromatic';
export type TunerNote = {
  readonly midi: number;
  readonly letter: string;
  readonly accidental: number;
  readonly octave: number;
};
export type TunerPitch = {
  readonly frequency: number;
  readonly midi: number;
  readonly cents: number;
  readonly confidence: number;
  readonly rms: number;
  readonly note: TunerNote;
};
export type TunerState = {
  readonly revision: number;
  readonly root: number;
  readonly scale: TunerScale;
  readonly step: number;
  readonly targets: readonly TunerNote[];
  readonly complete: boolean;
  readonly listening: boolean;
  readonly preview: { readonly kind: 'silent' } | { readonly kind: 'note' | 'scale'; readonly step: number };
  readonly pitch: { readonly kind: 'off' | 'microphone' | 'warming' | 'reference' | 'unvoiced' }
    | ({ readonly kind: 'pitched' } & TunerPitch);
};
export type TunerCommand = { readonly expectedRevision: number } & (
  | { readonly kind: 'configure'; readonly root: number; readonly scale: TunerScale }
  | { readonly kind: 'cue' | 'play-scale' | 'silence' | 'confirm' | 'close' }
  | { readonly kind: 'listen'; readonly enabled: boolean }
);
export interface TunerPort {
  prepareBank?(options: TuningBankOptions): Promise<TuningBankState>;
  snapshot(): TunerState;
  subscribe(listener: (state: TunerState) => void): () => void;
  command(command: TunerCommand): Promise<TunerState>;
}

export interface TuningBankOptions {
  readonly profile: number;
  readonly slots: readonly number[];
  readonly clipMs?: number;
  readonly stableMs?: number;
  readonly confidence?: number;
  readonly toleranceCents?: number;
}
export interface TuningBankState {
  readonly count: number; readonly step: number; readonly clipFrames: number; readonly filledFrames: number;
  readonly stableFrames: number; readonly ready: boolean; readonly capturedFrames: readonly number[]; readonly midi: readonly number[];
}
