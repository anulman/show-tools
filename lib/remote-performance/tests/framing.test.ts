import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeFrame, FrameDecoder, MAX_PAYLOAD } from '../framing.js';

test('decodes fragmented and adjacent host frames', () => {
	const first = encodeFrame({ tag: 2, sequence: 19, payload: Buffer.from('abc') });
	const second = encodeFrame({ tag: 4, sequence: 0, payload: Buffer.alloc(0) });
	assert.equal(first.toString('hex'), '53485431010002000300000013000000616263');
	const decoder = new FrameDecoder();
	assert.deepEqual(decoder.push(first.subarray(0, 9)), []);
	assert.deepEqual(decoder.push(Buffer.concat([first.subarray(9), second])), [
		{ tag: 2, sequence: 19, payload: Buffer.from('abc') },
		{ tag: 4, sequence: 0, payload: Buffer.alloc(0) },
	]);
});

test('rejects invalid headers and oversized payloads', () => {
	const header = encodeFrame({ tag: 1, sequence: 0, payload: Buffer.alloc(0) });
	header.writeUInt32LE(MAX_PAYLOAD + 1, 8);
	assert.throws(() => new FrameDecoder().push(header), /large/);
	header.writeUInt32LE(0, 0);
	assert.throws(() => new FrameDecoder().push(header), /header/);
});
