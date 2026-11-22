import type { CompiledSong } from './compiled-song.js';
import { VOICE_PROFILE_COUNT, type LiveEffectDefinition, type VoiceEffectConfiguration } from './model.js';

export const slapback = (): LiveEffectDefinition => ({ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 });
export const chorus = (): LiveEffectDefinition => ({ kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 });

export function initialVoiceEffects(song?: Pick<CompiledSong, 'parts' | 'sourceProfiles'>): VoiceEffectConfiguration[] {
  const names = new Map([...song?.parts ?? [], ...song?.sourceProfiles ?? []]
    .map(({ name, profile }) => [profile, name.trim().toLowerCase().replace(/\s+/g, ' ')]));
  return Array.from({ length: VOICE_PROFILE_COUNT }, (_, profile) => {
    const name = names.get(profile);
    const effects = name === 'vocals' ? [slapback()] : name === 'backup vocals' ? [slapback(), chorus()] : [];
    return { profile, effects };
  });
}
