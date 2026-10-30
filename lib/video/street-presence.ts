import { parseStreetScene, type PreparedStreetScene, type StreetPoofEffect, type StreetScoreInput, type StreetStaging } from './street-score.js';
import type { StreetFitProfile } from './street-fit.js';

export interface StreetPresenceAssets {
  readonly effects: readonly StreetPoofEffect[];
  readonly fitProfile: StreetFitProfile;
  readonly poofCatalogSha256: string;
  readonly fitProfileSha256: string;
}
type Range = { start: number; end: number };
type Edge = { at: number; visible: boolean };
type Poof = { effect: number; pose: number } | null;

function mergeRanges(ranges: readonly Range[]): Range[] {
  const merged: Range[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && previous.end >= range.start) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function variantHash(identity: string): number {
  let hash = 2166136261;
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

export function prepareStreetPresence({ scene, windows, sections, assets }: {
  scene: PreparedStreetScene;
  windows: StreetScoreInput['windows'];
  sections: readonly Range[];
  assets: StreetPresenceAssets;
}) {
  const quarter = scene.countedBeatUnit / 4;
  const decisions: Array<{ characterId: string; effectId: string; firstFlip: number; lastFlip: number;
    start: number; end: number; flips: readonly Edge[] }> = [];
  const presenceRanges: Array<{ characterId: string; ranges: readonly Range[] }> = [];
  const tracks = scene.actors.map((actor, actorIndex) => {
    const fit = assets.fitProfile.actors.find(fit => fit.code === actor.characterId);
    const activity = windows.find(track => track.actor === actorIndex);
    if (!fit || !activity) throw new Error(`Missing presence input for ${actor.characterId}`);
    const authoredRanges = actor.role === 'main-vocals' ? [{ start: 0, end: scene.durationCounts }]
      : actor.role === 'backup-vocals' ? sections.flatMap(section => {
        const first = activity.states.find(state => state.active && state.start < section.end && state.end > section.start);
        return first ? [{ start: Math.max(section.start, first.start), end: section.end }] : [];
      }) : activity.states.filter(state => state.active).map(state => ({ start: state.start, end: state.end }));
    const ranges = mergeRanges(authoredRanges);
    presenceRanges.push({ characterId: actor.characterId, ranges });
    const edges = actor.role === 'main-vocals' ? [] : (actor.role === 'backup-vocals' ? authoredRanges : ranges).flatMap(range => [
      { at: range.start, visible: true }, { at: range.end, visible: false },
    ]);
    const clusters: Edge[][] = [];
    for (const edge of edges) {
      const previous = clusters.at(-1);
      if (previous && edge.at - .5 * quarter < previous[previous.length - 1].at + quarter) previous.push(edge);
      else clusters.push([edge]);
    }
    const admitted = [...fit.allowedEffectIds].sort();
    if (!admitted.length) throw new Error(`${actor.characterId}: no admitted poof effect`);
    const stamps = new Map<number, Poof>();
    for (const cluster of clusters) {
      const first = cluster[0], last = cluster[cluster.length - 1];
      const id = admitted[variantHash(`${actor.characterId}:${first.at}:${Number(first.visible)}:${scene.countedBeatUnit}`) % admitted.length];
      const effect = assets.effects.findIndex(effect => effect.id === id);
      if (effect < 0) throw new Error(`Missing admitted effect ${id}`);
      const sequence: Array<[number, number | null]> = [
        [first.at - .5 * quarter, 0], [first.at - .25 * quarter, 1], [first.at, 2],
        [last.at + .25 * quarter, 3], [last.at + .5 * quarter, 4], [last.at + .75 * quarter, 5], [last.at + quarter, null],
      ];
      for (const [at, pose] of sequence) stamps.set(at, pose === null ? null : { effect, pose });
      decisions.push({ characterId: actor.characterId, effectId: id, firstFlip: first.at, lastFlip: last.at,
        start: first.at - .5 * quarter, end: last.at + quarter, flips: cluster });
    }
    const cloud = [...stamps].sort(([a], [b]) => a - b);
    const times = [...new Set([0, ...edges.map(edge => edge.at), ...stamps.keys()])]
      .filter(at => at >= 0 && at < scene.durationCounts).sort((a, b) => a - b);
    let edgeIndex = 0, cloudIndex = 0, visible = actor.role === 'main-vocals', poof: Poof = null;
    const keys: Array<{ at: number; visible: boolean; poof: Poof }> = [];
    for (const at of times) {
      while (edgeIndex < edges.length && edges[edgeIndex].at <= at) visible = edges[edgeIndex++].visible;
      while (cloudIndex < cloud.length && cloud[cloudIndex][0] <= at) poof = cloud[cloudIndex++][1];
      const previous = keys.at(-1);
      if (!previous || previous.visible !== visible || previous.poof?.effect !== poof?.effect || previous.poof?.pose !== poof?.pose) keys.push({ at, visible, poof });
    }
    return { actor: actorIndex, initiallyPresent: actor.role === 'main-vocals', offset: fit.offset, scale: fit.scale, keys };
  });
  const staging: StreetStaging = { kind: 'poof', effects: assets.effects, tracks };
  return { scene: parseStreetScene({ ...scene, staging }), decisions, presenceRanges };
}
