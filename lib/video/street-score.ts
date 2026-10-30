import { Schema } from 'effect';

const finite = Schema.Number.check(Schema.isFinite());
const nonnegative = finite.check(Schema.isGreaterThanOrEqualTo(0));
const positive = finite.check(Schema.isGreaterThan(0));
const integer = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Point = Schema.Struct({ x: finite, y: finite });
const Tier = Schema.Literals(['simple', 'vigorous', 'special', 'ultra']);
const Drawing = Schema.Struct({ path: Schema.NonEmptyString, pivot: Point });
const Clip = Schema.Struct({
  id: Schema.NonEmptyString, tier: Tier, cycleQuarters: positive, actionQuarters: Schema.NullOr(positive),
  nativeGrid: Schema.Struct({ width: positive, height: positive }),
  sourceOffset: Point,
  keys: Schema.Array(Schema.Struct({ atQuarter: nonnegative, pose: integer })),
  drawings: Schema.Array(Drawing),
});
const Actor = Schema.Struct({
  characterId: Schema.NonEmptyString,
  role: Schema.Literals(['main-vocals', 'backup-vocals', 'instrument']),
  placement: Schema.Struct({ x: finite, y: finite, scale: positive, depth: finite }),
  clips: Schema.Array(Clip),
});
const Key = Schema.Struct({ at: nonnegative, clip: integer, pose: integer, grayscale: Schema.Boolean });
export const StreetScene = Schema.Struct({
  version: Schema.Literal(1), kind: Schema.Literal('authored-street-preview'),
  width: positive, height: positive, background: Schema.NonEmptyString,
  previewCountsPerSecond: positive, durationCounts: positive,
  countedBeatUnit: Schema.Literals([4, 8]),
  actors: Schema.Array(Actor),
  tracks: Schema.Array(Schema.Struct({ actor: integer, keys: Schema.Array(Key) })),
  provenance: Schema.Struct({ source: Schema.NonEmptyString, assetsDigest: Schema.NonEmptyString, scoreDigest: Schema.NonEmptyString }),
});
export type PreparedStreetScene = typeof StreetScene.Type;
export type StreetActor = typeof Actor.Type;
export type StreetClip = typeof Clip.Type;
export type ActorFrame = { readonly actor: number; readonly clip: number; readonly pose: number; readonly grayscale: boolean };
const decodeScene = Schema.decodeUnknownSync(StreetScene);

/** Drawing pivots are in PNG canvas coordinates, already including sourceOffset.
 * nativeGrid/sourceOffset remain provenance; neither renderer adds that offset again. */
export function parseStreetScene(input: unknown): PreparedStreetScene {
  const scene = decodeScene(input);
  if (!scene.actors.length || scene.tracks.length !== scene.actors.length) throw new Error('Street scene needs one track per actor');
  if (new Set(scene.actors.map(actor => actor.characterId)).size !== scene.actors.length) throw new Error('Duplicate Street character');
  const seen = new Set<number>();
  for (const [index, actor] of scene.actors.entries()) {
    for (const tier of ['simple', 'vigorous', 'special']) if (!actor.clips.some(clip => clip.tier === tier)) throw new Error(`${actor.characterId} has no ${tier} clip`);
    if (new Set(actor.clips.map(clip => clip.id)).size !== actor.clips.length) throw new Error('Duplicate clip identity');
    for (const clip of actor.clips) {
      if (!clip.drawings.length || !clip.keys.length || clip.keys[0].atQuarter !== 0) throw new Error(`${clip.id} needs drawings and a key at zero`);
      for (const [i, key] of clip.keys.entries()) {
        if (key.pose >= clip.drawings.length || key.atQuarter > clip.cycleQuarters || (i > 0 && key.atQuarter <= clip.keys[i - 1].atQuarter)) throw new Error(`Invalid HOLD keys for ${clip.id}`);
      }
    }
    const track = scene.tracks.find(track => track.actor === index);
    if (!track || seen.has(track.actor) || !track.keys.length || track.keys[0].at !== 0) throw new Error('Every actor needs unique HOLD keys starting at zero');
    seen.add(track.actor);
    for (const [i, key] of track.keys.entries()) {
      const clip = actor.clips[key.clip];
      if (!clip || key.pose >= clip.drawings.length || (i > 0 && key.at <= track.keys[i - 1].at)) throw new Error('Invalid actor key');
      if (actor.role === 'main-vocals' && key.grayscale) throw new Error('Main singer must remain in color');
    }
  }
  return scene;
}

const Window = Schema.Struct({
  start: nonnegative, end: positive, active: Schema.Boolean,
  emphasis: Schema.Literals(['normal', 'special', 'ultra']),
  source: Schema.Literals(['live', 'sampled']),
  specialIndex: integer, ultraIndex: integer,
});
const ScoreInput = Schema.Struct({
  scene: StreetScene,
  windows: Schema.Array(Schema.Struct({ actor: integer, states: Schema.Array(Window) })),
  opportunities: Schema.Array(nonnegative),
  downbeats: Schema.Array(nonnegative),
});
export type StreetWindow = typeof Window.Type;
export type StreetScoreInput = typeof ScoreInput.Type;

function lastAt<T>(items: readonly T[], position: number, at: (value: T) => number): T | undefined {
  let result: T | undefined;
  for (const item of items) { if (at(item) > position) break; result = item; }
  return result;
}

export function compileStreetScore(input: unknown): PreparedStreetScene {
  const { scene, windows, opportunities, downbeats } = Schema.decodeUnknownSync(ScoreInput)(input);
  if (!opportunities.length || opportunities[0] !== 0 || !downbeats.length || downbeats[0] !== 0) throw new Error('Explicit pose opportunities and downbeat must begin at zero');
  for (let i = 1; i < downbeats.length; i++) if (downbeats[i] - downbeats[i - 1] < .5) throw new Error('Downbeats cannot overlap the initial half-count hold');
  for (const list of [opportunities, downbeats]) for (const [i, value] of list.entries()) {
    if (value * 4 !== Math.floor(value * 4) || (i > 0 && value <= list[i - 1])) throw new Error('Pose positions must increase on the quarter-count grid');
  }
  if (windows.length !== scene.actors.length || new Set(windows.map(item => item.actor)).size !== windows.length) throw new Error('One explicit state track required per actor');
  for (let actor = 0; actor < scene.actors.length; actor++) {
    const states = windows.find(item => item.actor === actor)?.states;
    if (!states?.length || states[0].start !== 0 || states[states.length - 1].end !== scene.durationCounts) throw new Error('State windows must cover the complete preview');
    for (const [i, state] of states.entries()) if (state.end <= state.start || (i > 0 && states[i - 1].end !== state.start)) throw new Error('State windows must be contiguous');
  }
  const gates: number[] = [];
  let previousAnchor = -1, previousGate = -Infinity;
  for (const opportunity of opportunities) {
    const anchor = lastAt(downbeats, opportunity, value => value);
    if (anchor === undefined) throw new Error('Missing downbeat');
    const first = anchor !== previousAnchor;
    if (opportunity === anchor || (opportunity - anchor >= .5 && opportunity - previousGate >= (first ? .5 : .25))) {
      gates.push(opportunity); previousAnchor = anchor; previousGate = opportunity;
    }
  }
  const stateAt = (actor: number, count: number) => windows.find(item => item.actor === actor)?.states.find(state => state.start <= count && count < state.end);
  const tracks = scene.actors.map((actor, actorIndex) => {
    const boundaries = windows.flatMap(item => item.states.map(state => state.start));
    const times = [...new Set([...gates, ...boundaries])].filter(at => at < scene.durationCounts).sort((a, b) => a - b);
    let clipIndex = 0, pose = 0, origin = 0;
    const keys: Array<typeof Key.Type> = [];
    for (const at of times) {
      const state = stateAt(actorIndex, at);
      if (!state) throw new Error('Missing actor state');
      const backupActive = scene.actors.some((other, i) => other.role === 'backup-vocals' && stateAt(i, at)?.active);
      const active = state.active && !(actor.role === 'main-vocals' && backupActive);
      const tier = !active ? 'simple' : state.emphasis === 'normal' ? 'vigorous' : state.emphasis;
      if (gates.includes(at)) {
        let choices = actor.clips.flatMap((clip, index) => clip.tier === tier ? [index] : []);
        if (tier === 'ultra' && !choices.length) choices = actor.clips.flatMap((clip, index) => clip.tier === 'special' ? [index] : []);
        const selected = choices[tier === 'ultra' && actor.clips.some(clip => clip.tier === 'ultra') ? state.ultraIndex : tier === 'special' || tier === 'ultra' ? state.specialIndex : 0];
        if (selected === undefined) throw new Error(`${actor.characterId}: missing requested ${tier} move`);
        if (!keys.length || selected !== clipIndex) { clipIndex = selected; origin = at; }
        const clip = actor.clips[clipIndex];
        const quarter = ((at - origin) * 4 / scene.countedBeatUnit) % clip.cycleQuarters;
        const key = lastAt(clip.keys, quarter, item => item.atQuarter);
        if (!key) throw new Error('Missing source HOLD key');
        pose = key.pose;
      }
      keys.push({ at, clip: clipIndex, pose, grayscale: actor.role !== 'main-vocals' && state.source === 'sampled' });
    }
    return { actor: actorIndex, keys };
  });
  return parseStreetScene({ ...scene, tracks });
}
