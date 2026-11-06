import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { encodeFrame, FrameDecoder } from '../framing.js';
import { HostConnection, HostDisconnected } from '../host-connection.js';

test('correlates host results and marks disconnected commands unknown', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'show-host-'));
	const path = join(directory, 'socket');
	const server = createServer();
	server.listen(path);
	await once(server, 'listening');
	let markReady!: () => void;
	const ready = new Promise<void>((resolve) => { markReady = resolve; });
	const connection = new HostConnection(path, (frame) => { if (frame.tag === 5) markReady(); });
	const [socket] = await once(server, 'connection');
	try {
		const hello = Buffer.alloc(40, 7);
		hello.writeUInt32LE(7, 32);
		hello.writeUInt32LE(5, 36);
		socket.write(encodeFrame({ tag: 1, sequence: 0, payload: hello }));
		const decoder = new FrameDecoder();
		const [readyBytes] = await once(socket, 'data');
		assert.equal(decoder.push(readyBytes)[0].tag, 2);
		socket.write(encodeFrame({ tag: 5, sequence: 0, payload: Buffer.alloc(0) }));
		await ready;
		const first = connection.command(Buffer.from([3, 0]));
		const [bytes] = await once(socket, 'data');
		const [frame] = decoder.push(bytes);
		assert.equal(frame.sequence, 1);
		assert.deepEqual(frame.payload.subarray(0, 32), hello.subarray(0, 32));
		socket.write(encodeFrame({ tag: 4, sequence: frame.sequence, payload: Buffer.from([1]) }));
		assert.deepEqual(await first, Buffer.from([1]));
		const pending = connection.command(Buffer.from([3, 0]));
		socket.destroy();
		await assert.rejects(pending, HostDisconnected);
		await assert.rejects(connection.command(Buffer.from([3, 0])), HostDisconnected);
	} finally {
		connection.close();
		socket.destroy();
		server.close();
		await rm(directory, { recursive: true, force: true });
	}
});
