export const MAGIC = 0x31544853;
export const VERSION = 1;
export const MAX_PAYLOAD = 8 * 1024 * 1024;
const HEADER = 16;

export interface Frame {
	tag: number;
	sequence: number;
	payload: Buffer;
}

export function encodeFrame(frame: Frame): Buffer {
	if (frame.payload.length > MAX_PAYLOAD) throw new Error('Frame is too large');
	const output = Buffer.allocUnsafe(HEADER + frame.payload.length);
	output.writeUInt32LE(MAGIC, 0);
	output.writeUInt16LE(VERSION, 4);
	output.writeUInt16LE(frame.tag, 6);
	output.writeUInt32LE(frame.payload.length, 8);
	output.writeUInt32LE(frame.sequence, 12);
	frame.payload.copy(output, HEADER);
	return output;
}

export class FrameDecoder {
	private pending = Buffer.alloc(0);

	push(chunk: Buffer): Frame[] {
		this.pending = Buffer.concat([this.pending, chunk]);
		const frames: Frame[] = [];
		while (this.pending.length >= HEADER) {
			if (this.pending.readUInt32LE(0) !== MAGIC || this.pending.readUInt16LE(4) !== VERSION) {
				throw new Error('Invalid host protocol header');
			}
			const length = this.pending.readUInt32LE(8);
			if (length > MAX_PAYLOAD) throw new Error('Frame is too large');
			if (this.pending.length < HEADER + length) break;
			frames.push({
				tag: this.pending.readUInt16LE(6),
				sequence: this.pending.readUInt32LE(12),
				payload: Buffer.from(this.pending.subarray(HEADER, HEADER + length)),
			});
			this.pending = this.pending.subarray(HEADER + length);
		}
		return frames;
	}
}
