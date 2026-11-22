import registry from '../../assets/video/characters.json';
import type { Voice } from '../../lib/voice-catalog/model.js';

export function voiceAvatar(voice: Voice | undefined, name: string) {
  const character = registry.characters.find(character => character.id === voice?.characterId);
  return {
    characterId: voice?.characterId ?? null,
    label: character?.label ?? voice?.characterId ?? name,
    token: voice?.avatarToken ?? 'neutral',
    path: character && 'publishedAvatarPath' in character ? character.publishedAvatarPath : null,
    initials: name.split(/\s+/).slice(0, 2).map(word => word[0] ?? '').join('').toUpperCase(),
  };
}

/** Preserve the same node between native snapshots so pad gestures keep their target. */
export function renderVoiceAvatar(root: HTMLElement, voice: Voice | undefined, name: string, assetBase?: URL) {
  const avatar = voiceAvatar(voice, name);
  const key = JSON.stringify(avatar);
  if (root.dataset.avatar === key) return;
  root.dataset.avatar = key;
  root.hidden = avatar.characterId === null;
  root.classList.add('vl-avatar'); root.dataset.token = avatar.token;
  root.replaceChildren();
  if (!avatar.characterId) { root.removeAttribute('aria-label'); return; }
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', `${avatar.label}, character for ${name}`);
  if (avatar.path) {
    const image = document.createElement('img');
    image.src = new URL('./' + avatar.path, assetBase ?? document.baseURI).href;
    image.alt = '';
    image.addEventListener('error', () => { root.textContent = avatar.initials; }, { once: true });
    root.append(image);
  } else root.textContent = avatar.initials;
}
