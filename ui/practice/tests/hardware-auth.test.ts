import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHardwareAuth, HardwareKeyRejectedError } from '../hardware-auth.js';
import { RemoteDesk } from '../remote-session.js';

const endpoint = 'https://desk.example/api/session';
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); } };
}

test('a successful key reconnects after reload without prompting and stays scoped to the endpoint', async () => {
  const saved = storage(), calls: string[] = [];
  const connect = async (key: string) => { calls.push(key); return 'connected'; };
  const first = createHardwareAuth({ endpoint, storage: saved });
  assert.equal(await first.connect(connect, () => ' synthetic-key '), 'connected');
  assert.equal(first.remembered(), true);
  const reload = createHardwareAuth({ endpoint, storage: saved });
  await reload.connect(connect, () => { throw new Error('Prompted after reload'); });
  assert.deepEqual(calls, ['synthetic-key', 'synthetic-key']);
  for (const other of ['https://other.example/api/session', 'https://desk.example/other/session', 'https://desk.example:8443/api/session']) {
    const auth = createHardwareAuth({ endpoint: other, storage: saved });
    assert.equal(auth.hasKey(), false);
    assert.equal(auth.remembered(), false);
  }
});

test('a rejected saved key is removed and gets one replacement prompt; another rejection stops', async () => {
  const saved = storage();
  await createHardwareAuth({ endpoint, storage: saved }).connect(async () => true, () => 'old-key');
  const auth = createHardwareAuth({ endpoint, storage: saved });
  let attempts = 0, prompts = 0;
  await assert.rejects(auth.connect(async () => { attempts++; throw new HardwareKeyRejectedError(); }, reason => {
    prompts++; assert.equal(reason, 'rejected'); return 'rejected-replacement';
  }), HardwareKeyRejectedError);
  assert.equal(attempts, 2); assert.equal(prompts, 1);
  assert.equal(auth.hasKey(), false); assert.equal(saved.values.size, 0);
  await auth.connect(async key => { assert.equal(key, 'accepted-new-key'); return true; }, () => 'accepted-new-key');
  assert.deepEqual([...saved.values.values()], ['accepted-new-key']);
});

test('network failures preserve the remembered key and do not prompt or overwrite it', async () => {
  const saved = storage();
  await createHardwareAuth({ endpoint, storage: saved }).connect(async () => true, () => 'accepted-key');
  const auth = createHardwareAuth({ endpoint, storage: saved });
  await assert.rejects(auth.connect(async () => { throw new Error('Network unavailable'); }, () => {
    throw new Error('Unexpected prompt');
  }), /Network unavailable/);
  assert.deepEqual([...saved.values.values()], ['accepted-key']);
});

test('new keys are saved only after successful authentication and cancellation never connects', async () => {
  const saved = storage(), auth = createHardwareAuth({ endpoint, storage: saved });
  await assert.rejects(auth.connect(async () => { throw new HardwareKeyRejectedError(); }, () => 'invalid-key'), HardwareKeyRejectedError);
  assert.equal(saved.values.size, 0);
  for (const value of [null, '', ' ', 'key\nwith-lines', 'unicode-☃']) {
    await assert.rejects(auth.connect(async () => { throw new Error('Unexpected connection'); }, () => value), /key is required/);
  }
  assert.equal(saved.values.size, 0);
});

test('forget clears only browser credentials and re-entry does not reuse the old key', async () => {
  const saved = storage(), auth = createHardwareAuth({ endpoint, storage: saved });
  const live = { playing: true };
  await auth.connect(async () => live, () => 'old-key');
  assert.equal(auth.forget(), true);
  assert.equal(saved.values.size, 0); assert.equal(auth.hasKey(), false);
  assert.equal(live.playing, true);
  await auth.connect(async key => { assert.equal(key, 'replacement'); return live; }, () => 'replacement');
  assert.deepEqual([...saved.values.values()], ['replacement']);
});

test('unavailable or denied storage keeps the current page usable without claiming persistence', async () => {
  for (const failed of ['read', 'write', 'remove']) {
    const saved = storage();
    const denied = { getItem(key: string) { if (failed === 'read') throw new Error('Denied'); return saved.getItem(key); },
      setItem(key: string, value: string) { if (failed === 'write') throw new Error('Denied'); saved.setItem(key, value); },
      removeItem(key: string) { if (failed === 'remove') throw new Error('Denied'); saved.removeItem(key); } };
    const auth = createHardwareAuth({ endpoint, storage: denied });
    await auth.connect(async () => true, () => 'page-key');
    if (failed !== 'remove') assert.equal(auth.remembered(), false);
    await auth.connect(async key => { assert.equal(key, 'page-key'); return true; }, () => { throw new Error('Unexpected prompt'); });
    auth.forget(); assert.equal(auth.hasKey(), false);
  }
});

test('RemoteDesk identifies only HTTP authentication failures as rejected keys', async () => {
  const previous = globalThis.fetch;
  try {
    for (const status of [401, 403]) {
      globalThis.fetch = async () => new Response(null, { status });
      await assert.rejects(RemoteDesk.connect('synthetic-key'), HardwareKeyRejectedError);
    }
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(RemoteDesk.connect('synthetic-key'), error => error instanceof Error && !(error instanceof HardwareKeyRejectedError));
  } finally { globalThis.fetch = previous; }
});
