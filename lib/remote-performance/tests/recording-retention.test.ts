import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { RecordingArchive } from '../recording-archive.js';

const day = 24 * 60 * 60 * 1000;
const maxSpace = async () => 2n ** 50n;
const reserve = 64 * 1024 * 1024;

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'retention-')));
  const pcm = Buffer.alloc(48);
  pcm.write('RIFF', 0);
  pcm.writeUInt32LE(40, 4);
  pcm.write('WAVEfmt ', 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(2, 22);
  pcm.writeUInt32LE(8000, 24);
  pcm.writeUInt32LE(32000, 28);
  pcm.writeUInt16LE(4, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write('data', 36);
  pcm.writeUInt32LE(4, 40);
  async function take(id: string, confirmedAt?: number) {
    const directory = join(root, id);
    await mkdir(directory, { mode: 0o700 });
    await writeFile(join(directory, 'recording.wav'), pcm, { mode: 0o600 });
    if (confirmedAt !== undefined) {
      const receipt = join(directory, 'saved');
      await writeFile(receipt, '', { mode: 0o600 });
      const time = new Date(confirmedAt);
      await utimes(receipt, time, time);
    }
    return directory;
  }
  return { root, take, async remaining() { return (await readdir(root)).sort(); } };
}

test('retention uses the original Mac acknowledgement timestamp and protects pending and unfamiliar files', async () => {
  const f = await fixture();
  const now = 2_000_000_000_000;
  try {
    const old = await f.take('take-OLD000', now - 7 * day);
    await f.take('take-NEW000', now - 7 * day + 1000);
    await f.take('take-PND000');
    const unknown = await f.take('take-EXTRA0', now - 8 * day);
    await writeFile(join(unknown, 'unknown'), 'do not remove');
    const corrupt = await f.take('take-BAD000', now - 8 * day);
    await writeFile(join(corrupt, 'recording.wav'), Buffer.alloc(48));

    const archive = new RecordingArchive(f.root, reserve);
    assert.equal(await archive.acknowledge('take-OLD000'), true);
    const receipt = await lstat(join(old, 'saved'));
    assert.equal(receipt.mtimeMs, now - 7 * day, 'duplicate acknowledgement cannot renew retention');

    const restarted = new RecordingArchive(f.root, reserve);
    await restarted.maintain(now, maxSpace);
    assert.deepEqual(await f.remaining(), ['take-BAD000', 'take-EXTRA0', 'take-NEW000', 'take-PND000']);
    assert.deepEqual((await restarted.pending()).pending.map(take => take.id), ['take-PND000']);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('pressure rechecks actual headroom, reclaims oldest confirmations first, and serializes acknowledgement', async () => {
  const f = await fixture();
  const now = 2_000_000_000_000;
  try {
    await f.take('take-FIRST0', now - 3 * day);
    await f.take('take-SECOND', now - 2 * day);
    await f.take('take-THIRD0', now - day);
    await f.take('take-PND000');
    await f.take('take-RACE00');
    let queries = 0;
    const archive = new RecordingArchive(f.root, reserve);
    const maintenance = archive.maintain(now, async () => ++queries <= 2 ? 0n : await maxSpace());
    const ack = archive.acknowledge('take-RACE00');
    await maintenance;
    assert.equal(await ack, true);
    assert.equal(queries, 3);
    assert.deepEqual(await f.remaining(), ['take-PND000', 'take-RACE00', 'take-THIRD0']);

    await new RecordingArchive(f.root, reserve).maintain(now, async () => 0n);
    assert.deepEqual(await f.remaining(), ['take-PND000'], 'unconfirmed WAV survives even when reserve remains unmet');
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test('profiles without a reserve retain their current archive behavior', async () => {
  const f = await fixture();
  const now = 2_000_000_000_000;
  try {
    await f.take('take-OLD000', now - 8 * day);
    await new RecordingArchive(f.root).maintain(now, async () => 0n);
    assert.deepEqual(await f.remaining(), ['take-OLD000']);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
