import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeMp3, isTakePCM } from '../mp3-encoder.ts';

test('WASM export produces MPEG Layer III stereo frames at 192 kb/s', async () => {
  const sampleRate = 44100;
  const left = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 0.25);
  const right = Float32Array.from({ length: sampleRate }, (_, i) => Math.sin(i * 2 * Math.PI * 880 / sampleRate) * 0.25);
  const blob = await encodeMp3({ sampleRate, channels: [left, right] });
  assert.equal(blob.type, 'audio/mpeg');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let frames = 0;
  for (let offset = 0; offset + 4 <= bytes.length;) {
    assert.equal(bytes[offset], 0xff);
    assert.equal(bytes[offset + 1] & 0xfe, 0xfa, 'MPEG1 Layer III header');
    assert.equal(bytes[offset + 2] >> 4, 11, '192 kb/s');
    assert.equal((bytes[offset + 2] >> 2) & 3, 0, '44.1 kHz');
    assert.notEqual(bytes[offset + 3] >> 6, 3, 'stereo channel mode');
    offset += Math.floor(144 * 192000 / sampleRate) + ((bytes[offset + 2] >> 1) & 1);
    frames++;
  }
  assert(frames >= 38 && frames <= 42, 'about one second including encoder padding');
});

test('worker boundary rejects malformed channel data', () => {
  assert(isTakePCM({ sampleRate: 48000, channels: [new Float32Array(10)] }));
  for (const value of [null, {}, { sampleRate: NaN, channels: [] },
    { sampleRate: 44100, channels: [new Float32Array(0)] },
    { sampleRate: 44100, channels: [new Float32Array(10), new Float32Array(9)] },
    { sampleRate: 44100, channels: [[1, 2]] }]) assert(!isTakePCM(value));
});
