import type { CompiledSong } from './compiled-song.js';
import { VOICE_PROFILE_COUNT, type LiveEffectDefinition, type VoiceEffectConfiguration } from './model.js';

export const slapback = (): LiveEffectDefinition => ({ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 });
export const chorus = (): LiveEffectDefinition => ({ kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 });

type VocalParts = Pick<CompiledSong, 'parts' | 'sourceProfiles'>;
const vocalName = /^(backup )?(?:vocals|vox)(?: [1-9]\d*)?(?: \([^()]+\))?$/;

function vocalNames(song?: VocalParts) {
  return new Map([...song?.parts ?? [], ...song?.sourceProfiles ?? []]
    .map(({ name, profile }) => [profile, name.trim().toLowerCase().replace(/\s+/g, ' ')]));
}

export function backupVocalProfiles(song?: VocalParts): ReadonlySet<number> {
  return new Set([...vocalNames(song)].filter(([, name]) => vocalName.exec(name)?.[1]).map(([profile]) => profile));
}

export function fullyWetEffects(effects: readonly LiveEffectDefinition[]): readonly LiveEffectDefinition[] {
  return effects.every(effect => effect.wet === 1) ? effects : effects.map(effect => ({ ...effect, wet: 1 }));
}

export function applyBackupVocalWetMix(configurations: readonly VoiceEffectConfiguration[], profiles: ReadonlySet<number>): VoiceEffectConfiguration[] {
  return configurations.map(configuration => {
    const effects = profiles.has(configuration.profile) ? fullyWetEffects(configuration.effects) : configuration.effects;
    return effects === configuration.effects ? configuration : { ...configuration, effects };
  });
}

export function initialVoiceEffects(song?: VocalParts): VoiceEffectConfiguration[] {
  const names = vocalNames(song);
  return Array.from({ length: VOICE_PROFILE_COUNT }, (_, profile) => {
    const name = names.get(profile) ?? '';
    const label = vocalName.exec(name);
    const effects = label?.[1] ? fullyWetEffects([slapback(), chorus()]) : label ? [slapback()] : [];
    return { profile, effects };
  });
}
