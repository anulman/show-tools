import type { PracticeState, SongScript } from '../performance/model.js';
import { encodeCommand } from './commands.js';
import { HostConnection } from './host-connection.js';
import { decodeEvent, decodeSnapshot } from './observation.js';
import type { Instrument, Observation, Outcome } from './gateway.js';

export class NativeInstrument implements Instrument {
	private connection: HostConnection | null = null;
	private current: { revision: bigint; song: SongScript; state: PracticeState } | null = null;
	private readonly listeners = new Set<(observation: Observation) => void>();
	private readonly waiters = new Set<() => void>();
	private closed = false;

	constructor(private readonly path: string) { this.connect(); }
	private connect() {
		if (this.closed) return;
		const connection = new HostConnection(this.path, (frame) => {
			if (frame.tag === 5) {
				const next = decodeSnapshot(frame.payload, connection.processEpoch);
				if (!next) { this.current = null; this.notify(); return; }
				if (this.current && next.revision <= this.current.revision) return;
				const changed = !this.current || JSON.stringify(this.current.song) !== JSON.stringify(next.song);
				this.current = next;
				this.publish(changed
					? { type: 'session', song: next.song, state: next.state, revision: next.revision.toString(), hostEpoch: connection.processEpoch }
					: { type: 'state', state: next.state, revision: next.revision.toString(), hostEpoch: connection.processEpoch });
				this.notify();
			} else if (frame.tag === 6) {
				this.publish({ type: 'event', event: decodeEvent(frame.payload, connection.processEpoch), hostEpoch: connection.processEpoch });
			} else if (frame.tag === 7) {
				if (frame.payload.length !== 8) throw new Error('Invalid host gap');
				this.publish({ type: 'gap', dropped: frame.payload.readBigUInt64LE().toString(), hostEpoch: connection.processEpoch });
			} else throw new Error('Unknown host publication');
		}, () => {
			if (this.connection !== connection) return;
			this.current = null;
			this.publish({ type: 'gap', hostEpoch: connection.processEpoch });
			this.notify();
			if (!this.closed) setTimeout(() => this.connect(), 1000).unref();
		});
		this.connection = connection;
	}
	private notify() { for (const waiter of this.waiters) waiter(); }
	private publish(value: Observation) { for (const listener of this.listeners) listener(value); }
	snapshot(): Observation | null {
		return this.current && { type: 'session', song: this.current.song, state: this.current.state, revision: this.current.revision.toString(), hostEpoch: this.connection?.processEpoch };
	}
	subscribe(listener: (value: Observation) => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
	async command(input: unknown): Promise<Outcome> {
		const current = this.current;
		const connection = this.connection;
		if (!current || !connection) return { outcome: 'rejected', error: 'Host unavailable' };
		let operation: Buffer;
		try { operation = encodeCommand(input, current.state); }
		catch (error) { return { outcome: 'rejected', error: error instanceof Error ? error.message : 'Invalid command' }; }
		const result = await connection.command(operation, operation.readUInt16LE() === 2);
		if (result.length !== 16) throw new Error('Invalid host result');
		const status = result.readUInt32LE(0);
		const code = result.readInt32LE(4);
		const revision = result.readBigUInt64LE(8);
		if (status > 3) throw new Error('Invalid host result status');
		if (status !== 0) return { outcome: 'rejected', error: status === 3 ? 'Host is busy' : `Native command rejected (${code})` };
		const readback = await this.waitForRevision(connection, revision);
		return { outcome: 'applied', state: readback.state, revision: readback.revision.toString(), hostEpoch: connection.processEpoch };
	}
	private waitForRevision(connection: HostConnection, revision: bigint) {
		return new Promise<NonNullable<NativeInstrument['current']>>((resolve, reject) => {
			const timer = setTimeout(() => finish(new Error('Host readback timed out')), 5000);
			const check = () => {
				if (this.connection !== connection || !this.current) return finish(new Error('Host disconnected'));
				if (this.current.revision >= revision) finish(null, this.current);
			};
			const finish = (error: Error | null, value?: NonNullable<NativeInstrument['current']>) => {
				clearTimeout(timer); this.waiters.delete(check);
				if (error) reject(error); else resolve(value!);
			};
			this.waiters.add(check); check();
		});
	}
	close() { this.closed = true; this.connection?.close(); this.current = null; this.notify(); }
}
