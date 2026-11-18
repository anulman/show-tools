import { connect, type Socket } from 'node:net';
import { PF } from '../performance/wasm-abi.js';
import { encodeFrame, FrameDecoder, type Frame } from './framing.js';

const HELLO = 1;
const READY = 2;
const COMMAND = 3;
const RESULT = 4;
const MAX_PENDING = 256;

export class HostDisconnected extends Error {
	constructor(detail?: string) { super(detail ? `Native observer readback failed: ${detail.slice(0, 512)}` : 'Native observer socket closed'); }
}

export class HostUnavailable extends Error {
	constructor(readonly code: 'ENOENT' | 'ECONNREFUSED') { super(`Host is not listening (${code})`); }
}

export class HostConnection {
	private readonly socket: Socket;
	private readonly decoder = new FrameDecoder();
	private identity: Buffer | undefined;
	private ready = false;
	private sequence = 0;
	private connected = false;
	private unavailable: HostUnavailable | undefined;
	private readbackFailure: HostDisconnected | undefined;
	private readonly pending = new Map<number, { resolve: (payload: Buffer) => void; reject: (error: Error) => void }>();
	get processEpoch() { return this.identity?.subarray(0, 16).toString('hex') ?? ''; }

	constructor(path: string, private readonly observe: (frame: Frame) => void, private readonly disconnected: (reason: HostUnavailable | HostDisconnected) => void = () => {}) {
		this.socket = connect(path);
		this.socket.once('connect', () => { this.connected = true; });
		this.socket.on('data', (chunk) => {
			try { for (const frame of this.decoder.push(Buffer.from(chunk))) this.receive(frame); }
			catch (error) {
				this.readbackFailure = new HostDisconnected(error instanceof Error ? error.message : 'Unknown observer error');
				this.socket.destroy();
			}
		});
		this.socket.on('error', error => {
			if (!this.connected && 'code' in error && (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')) this.unavailable = new HostUnavailable(error.code);
		});
		this.socket.on('close', () => {
			this.ready = false;
			for (const command of this.pending.values()) command.reject(new HostDisconnected());
			this.pending.clear();
			this.disconnected(this.unavailable ?? this.readbackFailure ?? new HostDisconnected());
			this.identity = undefined;
		});
	}

	private receive(frame: Frame) {
		if (frame.tag === HELLO) {
			if (frame.sequence !== 0 || frame.payload.length !== 40 || this.identity) throw new Error('Invalid host hello');
			if (frame.payload.readUInt32LE(32) !== PF.ABI_VERSION || frame.payload.readUInt32LE(36) !== PF.COMPILED_VERSION) throw new Error('Incompatible host ABI');
			this.identity = Buffer.from(frame.payload.subarray(0, 32));
			this.socket.write(encodeFrame({ tag: READY, sequence: 0, payload: Buffer.alloc(0) }));
		} else if (frame.tag === RESULT) {
			const command = this.pending.get(frame.sequence);
			if (!command) throw new Error('Unexpected host result');
			this.pending.delete(frame.sequence);
			command.resolve(frame.payload);
		} else {
			if (!this.identity || frame.sequence !== 0) throw new Error('Invalid host publication');
			this.observe(frame);
			if (frame.tag === 5) this.ready = true;
		}
	}

	command(operation: Buffer, stop = false): Promise<Buffer> {
		if (!this.ready || !this.identity) return Promise.reject(new HostDisconnected());
		if (this.pending.size >= MAX_PENDING + (stop ? 1 : 0)) return Promise.reject(new Error('Host command capacity reached'));
		if (this.sequence === 0xffffffff) return Promise.reject(new Error('Host sequence exhausted'));
		const sequence = ++this.sequence;
		const payload = Buffer.concat([this.identity, operation]);
		return new Promise((resolve, reject) => {
			this.pending.set(sequence, { resolve, reject });
			this.socket.write(encodeFrame({ tag: COMMAND, sequence, payload }));
		});
	}

	close() { this.socket.destroy(); }
}
