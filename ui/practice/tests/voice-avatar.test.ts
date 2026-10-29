import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceAvatar } from '../voice-avatar.js';
import type { Voice } from '../../../lib/voice-catalog/model.js';

const voice: Voice = { id: 'whistle', name: 'My whistle', notes: '', characterId: 'A07', avatarToken: 'blue', effects: [] };
test('selected canonical characters resolve to published artwork and independent frame styling', () => {
  const avatar = voiceAvatar(voice, 'Whistle');
  assert.equal(avatar.characterId, 'A07');
  assert.equal(avatar.path, 'assets/video/poses/gator-original-0.png');
  assert.equal(avatar.token, 'blue');
  assert.equal(voiceAvatar({ ...voice, characterId: 'A29' }, 'Whistle').path, 'assets/video/poses/tapir-original-0.png');
});
test('unassigned and unavailable characters remain explicit without borrowing another character', () => {
  assert.equal(voiceAvatar(undefined, 'Drums & Claps').characterId, null);
  const unavailable = voiceAvatar({ ...voice, characterId: 'future-id' }, 'Drums & Claps');
  assert.equal(unavailable.path, null);
  assert.equal(unavailable.label, 'future-id');
});
