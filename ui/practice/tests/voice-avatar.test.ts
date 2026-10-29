import test from 'node:test';
import assert from 'node:assert/strict';
import registry from '../../../assets/video/characters.json';
import { voiceAvatar } from '../voice-avatar.js';
import type { Voice } from '../../../lib/voice-catalog/model.js';

const voice: Voice = { id: 'whistle', name: 'My whistle', notes: '', characterId: 'A07', avatarToken: 'blue', effects: [] };
test('selected canonical characters resolve to published artwork and independent frame styling', () => {
  const avatar = voiceAvatar(voice, 'Whistle');
  assert.equal(avatar.characterId, 'A07');
  assert.equal(avatar.path, 'assets/video/avatars/A07.png');
  assert.equal(avatar.token, 'blue');
  assert.equal(voiceAvatar({ ...voice, characterId: 'A29' }, 'Whistle').path, 'assets/video/avatars/A29.png');
});
test('unassigned and unavailable characters remain explicit without borrowing another character', () => {
  assert.equal(voiceAvatar(undefined, 'Drums & Claps').characterId, null);
  const unavailable = voiceAvatar({ ...voice, characterId: 'future-id' }, 'Drums & Claps');
  assert.equal(unavailable.path, null);
  assert.equal(unavailable.label, 'future-id');
});

test('every selectable canonical character resolves its own static avatar without a voice reassignment', () => {
  assert.equal(registry.characters.length, 51);
  const paths = new Set<string>();
  for (const character of registry.characters) {
    const presentation = voiceAvatar({ ...voice, characterId: character.id }, 'Whistle');
    assert.equal(presentation.path, `assets/video/avatars/${character.id}.png`);
    assert.equal(presentation.characterId, character.id);
    assert.equal(presentation.token, 'blue');
    paths.add(character.publishedAvatarPath);
  }
  assert.equal(paths.size, 51);
  assert.equal(voice.characterId, 'A07', 'resolving artwork cannot change the saved voice');
});
