import { Effect, Schema } from 'effect';
import { StreetAsset } from './street-assets.js';

const finite = Schema.Number.check(Schema.isFinite());
const nonnegative = finite.check(Schema.isGreaterThanOrEqualTo(0));
const positive = finite.check(Schema.isGreaterThan(0));
const integer = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Point = Schema.Struct({ x: finite, y: finite });
const Tier = Schema.Literals(['simple', 'vigorous', 'special', 'ultra']);
const Drawing = Schema.Struct({ ...StreetAsset.fields, pivot: Point });
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
const PoofSelection = Schema.NullOr(Schema.Struct({ effect: integer, pose: integer }));
const PresenceKey = Schema.Struct({ at: nonnegative, visible: Schema.Boolean, poof: PoofSelection });
export const PoofEffect = Schema.Struct({
  id: Schema.NonEmptyString,
  nativeGrid: Schema.Struct({ width: Schema.Literal(128), height: Schema.Literal(128) }),
  pivot: Schema.Struct({ x: Schema.Literal(64), y: Schema.Literal(106) }),
  drawings: Schema.Array(StreetAsset),
});
const Staging = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('all-present') }),
  Schema.Struct({ kind: Schema.Literal('poof'), effects: Schema.Array(PoofEffect),
    tracks: Schema.Array(Schema.Struct({ actor: integer,
      offset: Point.pipe(Schema.withDecodingDefaultKey(Effect.succeed({ x: 0, y: 0 }))),
      keys: Schema.Array(PresenceKey) })) }),
]);
const allPresent = { kind: 'all-present' } satisfies typeof Staging.Type;
export const StreetScene = Schema.Struct({
  version: Schema.Literal(2), kind: Schema.Literal('authored-street-preview'),
  width: positive, height: positive, background: StreetAsset,
  previewCountsPerSecond: positive, durationCounts: positive,
  countedBeatUnit: Schema.Literals([4, 8]),
  actors: Schema.Array(Actor),
  tracks: Schema.Array(Schema.Struct({ actor: integer, keys: Schema.Array(Key) })),
  staging: Staging.pipe(Schema.withDecodingDefaultKey(Effect.succeed(allPresent))),
  provenance: Schema.Struct({ source: Schema.NonEmptyString, assetsDigest: Schema.NonEmptyString, scoreDigest: Schema.NonEmptyString }),
});
export type PreparedStreetScene = typeof StreetScene.Type;
export type StreetActor = typeof Actor.Type;
export type StreetClip = typeof Clip.Type;
export type StreetPoofEffect = typeof PoofEffect.Type;
export type StreetStaging = typeof Staging.Type;
export type ActorFrame = { readonly actor: number; readonly clip: number; readonly pose: number; readonly grayscale: boolean;
  readonly visible: boolean; readonly poof: typeof PoofSelection.Type };
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
  if (scene.staging.kind === 'poof') {
    const { effects, tracks } = scene.staging;
    if (!effects.length || new Set(effects.map(effect => effect.id)).size !== effects.length) throw new Error('Unique poof effects required');
    for (const effect of effects) if (effect.drawings.length !== 6) throw new Error('Poofs require six approved drawings');
    if (tracks.length !== scene.actors.length || new Set(tracks.map(track => track.actor)).size !== tracks.length) throw new Error('One presence track per actor required');
    for (const track of tracks) {
      if (track.actor >= scene.actors.length || !track.keys.length || track.keys[0].at !== 0) throw new Error('Presence tracks must start at zero for a known actor');
      for (const [i, key] of track.keys.entries()) {
        if (key.at >= scene.durationCounts || (i > 0 && key.at <= track.keys[i - 1].at)) throw new Error('Presence keys must increase inside the scene');
        if (key.poof && !effects[key.poof.effect]?.drawings[key.poof.pose]) throw new Error('Unknown poof drawing');
      }
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
  windows: Schema.Array(Schema.Struct({ actor: integer, states: Schema.Array(Window), accents: Schema.Array(nonnegative), downbeats: Schema.Array(nonnegative) })),
});
export type StreetWindow = typeof Window.Type;
export type StreetScoreInput = typeof ScoreInput.Type;

function tick(count: number): number {
  const value = count * 4;
  if (!Number.isSafeInteger(value)) throw new Error('Pose positions must use integer quarter-count ticks');
  return value;
}

/** Action-only repetition requires matching closing pixels and registration. */
export function streetClipPlayback(clip: StreetClip) {
  const action = clip.actionQuarters;
  const closure = action === null ? undefined : clip.keys.find(key => key.atQuarter === action);
  const entry = clip.drawings[clip.keys[0].pose];
  const closing = closure === undefined ? undefined : clip.drawings[closure.pose];
  const closed = closing !== undefined && closing.sha256 === entry.sha256
    && closing.pivot.x === entry.pivot.x && closing.pivot.y === entry.pivot.y;
  const duration = (clip.tier === 'special' || clip.tier === 'ultra') && action !== null && closed ? action : clip.cycleQuarters;
  return { durationQuarters: duration, actionClosureVerified: closed, keys: clip.keys.filter(key => key.atQuarter < duration) };
}

/** Finite visual authoring only. Runtime sampling remains a stateless native HOLD table. */
export function prepareStreetScore(input: unknown) {
  const accentDecisions: Array<{ actor: number; at: number; kind: 'entry' | 'advance' | 'held'; holdUntil: number }> = [];
  const { scene, windows } = Schema.decodeUnknownSync(ScoreInput)(input);
  parseStreetScene({ ...scene, tracks: scene.actors.map((_, actor) => ({ actor, keys: [{ at: 0, clip: 0, pose: 0, grayscale: false }] })) });
  const end = tick(scene.durationCounts);
  if (windows.length !== scene.actors.length || new Set(windows.map(item => item.actor)).size !== windows.length) throw new Error('One explicit state track required per actor');
  for (let actor = 0; actor < scene.actors.length; actor++) {
    const track = windows.find(item => item.actor === actor);
    if (!track) throw new Error('Missing actor track');
    const states = track.states;
    if (!states?.length || states[0].start !== 0 || states[states.length - 1].end !== scene.durationCounts) throw new Error('State windows must cover the complete preview');
    for (const [i, state] of states.entries()) {
      tick(state.start); tick(state.end);
      if (state.end <= state.start || (i > 0 && states[i - 1].end !== state.start)) throw new Error('State windows must be contiguous');
    }
    for (const list of [track.accents, track.downbeats]) for (const [i, value] of list.entries()) {
      tick(value);
      if (value >= scene.durationCounts || (i > 0 && value <= list[i - 1])) throw new Error('Actor accents must increase inside the score');
    }
  }
  const stateAt = (actor: number, at: number) => windows.find(item => item.actor === actor)?.states.find(state => tick(state.start) <= at && at < tick(state.end));
  const tracks = scene.actors.map((actor, actorIndex) => {
    const authored = windows.find(item => item.actor === actorIndex);
    if (!authored) throw new Error('Missing actor track');
    const accents = new Set(authored.accents.map(tick)), anchors = new Set(authored.downbeats.map(tick));
    const events = new Set([...accents, ...anchors, ...authored.states.map(state => tick(state.start))]);
    if (actor.role === 'main-vocals') for (const other of windows) if (scene.actors[other.actor].role === 'backup-vocals') for (const state of other.states) events.add(tick(state.start));
    const times = [...events].sort((a, b) => a - b);
    let eventIndex = 0, clipIndex = -1, sourceKey = 0, natural = Infinity, allowed = 0;
    const keys: Array<typeof Key.Type> = [];
    for (let at = 0; at < end;) {
      const state = stateAt(actorIndex, at);
      if (!state) throw new Error('Missing actor state');
      const backup = scene.actors.some((other, i) => other.role === 'backup-vocals' && stateAt(i, at)?.active);
      const active = state.active && !(actor.role === 'main-vocals' && backup);
      const tier = !active ? 'simple' : state.emphasis === 'normal' ? 'vigorous' : state.emphasis;
      let choices = actor.clips.flatMap((clip, index) => clip.tier === tier ? [index] : []);
      const hasUltra = tier === 'ultra' && choices.length > 0;
      if (tier === 'ultra' && !hasUltra) choices = actor.clips.flatMap((clip, index) => clip.tier === 'special' ? [index] : []);
      const selected = choices[hasUltra ? state.ultraIndex : tier === 'special' || tier === 'ultra' ? state.specialIndex : 0];
      if (selected === undefined) throw new Error(`${actor.characterId}: missing requested ${tier} move`);
      const changed = selected !== clipIndex;
      if (changed) { clipIndex = selected; sourceKey = 0; allowed = at + 2; }
      const playback = streetClipPlayback(actor.clips[clipIndex]);
      const sourceKeys = playback.keys;
      const advanced = !changed && at >= allowed && (accents.has(at) || natural === at);
      if (advanced) { sourceKey = (sourceKey + 1) % sourceKeys.length; allowed = at + 1; }
      if (anchors.has(at)) allowed = Math.max(allowed, at + 2);
      if (accents.has(at)) accentDecisions.push({ actor: actorIndex, at: at / 4, kind: changed ? 'entry' : advanced ? 'advance' : 'held', holdUntil: allowed / 4 });
      if (changed || advanced) {
        const current = sourceKeys[sourceKey], next = sourceKeys[sourceKey + 1];
        const duration = (next?.atQuarter ?? playback.durationQuarters) - current.atQuarter;
        natural = Math.max(allowed, at + tick(duration * scene.countedBeatUnit / 4));
      } else if (natural < allowed) natural = allowed;
      const frame = { at: at / 4, clip: clipIndex, pose: sourceKeys[sourceKey].pose, grayscale: actor.role !== 'main-vocals' && state.source === 'sampled' };
      const previous = keys.at(-1);
      if (!previous || previous.clip !== frame.clip || previous.pose !== frame.pose || previous.grayscale !== frame.grayscale) keys.push(frame);
      while (eventIndex < times.length && times[eventIndex] <= at) eventIndex++;
      const next = Math.min(times[eventIndex] ?? Infinity, natural);
      if (next <= at) throw new Error('Non-advancing Street source cursor');
      at = next;
    }
    return { actor: actorIndex, keys };
  });
  return { scene: parseStreetScene({ ...scene, tracks }), accentDecisions };
}

export function compileStreetScore(input: unknown): PreparedStreetScene {
  return prepareStreetScore(input).scene;
}
