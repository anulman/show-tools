import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { FIGMA_CODE_LIMIT, ownedFigmaCallerCode } from '../video-expansion/owned-figma.js';

const fileKey = 'test' + randomUUID().replaceAll('-', '');
const owner = { threadId: 'director-test', token: randomUUID(), pageId: '1:2', batch: "quotes' $() `test`" };
const args = { fileKey, code: "return 'allowed';", description: 'Test only' };
function wrapper(check: () => Promise<unknown>, call: (input: typeof args) => Promise<unknown>) {
  const code = ownedFigmaCallerCode({ fileKey, owner, acquisition: { exit_code: 0 } });
  return runInNewContext(code + '\ncallOwnedFigma;', { tools: { exec_command: check, mcp__codex_apps__figma_use_figma: call } });
}

test('busy, missing and incomplete acquisition cannot generate a callable Figma wrapper', () => {
  for (const acquisition of [{ exit_code: 1 }, {}, { session_id: 7 }, undefined]) {
    assert.throws(() => ownedFigmaCallerCode({ fileKey, owner, acquisition }));
  }
  assert.throws(() => ownedFigmaCallerCode({ fileKey, owner: { threadId: 'test' }, acquisition: { exit_code: 0 } }));
});

test('failed, missing, pending and thrown live checks make zero Figma callbacks', async () => {
  let calls = 0;
  for (const result of [{ exit_code: 1 }, {}, undefined, { session_id: 7 }]) {
    const call = wrapper(async () => result, async () => { calls++; });
    await assert.rejects(call(args), /ownership was not verified/);
  }
  const call = wrapper(async () => { throw Error('check transport failed'); }, async () => { calls++; });
  await assert.rejects(call(args), /transport failed/);
  assert.equal(calls, 0);
});

test('wrong target fails before checking the lease and live-file guard precedes caller code', async () => {
  let checks = 0, calls = 0;
  const call = wrapper(async () => { checks++; return { exit_code: 0 }; }, async input => {
    calls++;
    return runInNewContext(`(async()=>{${input.code}})()`, { figma: { fileKey: 'wrong-live-file' } });
  });
  await assert.rejects(call({ ...args, fileKey: 'wrong-target' }), /wrong file/);
  assert.equal(checks, 0); assert.equal(calls, 0);
  await assert.rejects(call({ ...args, code: "throw Error('caller reached');" }), /wrong live file/);
  assert.equal(calls, 1);
});

test('one wrapper serializes calls and holds after an uncertain tool failure', async () => {
  let finish: (value: unknown) => void = () => {};
  let calls = 0;
  const call = wrapper(async () => ({ exit_code: 0 }), async () => {
    calls++;
    if (calls === 1) return new Promise(resolve => { finish = resolve; });
    throw Error('Figma failed');
  });
  const first = call(args);
  await Promise.resolve(); await Promise.resolve();
  await assert.rejects(call(args), /prior call is active or unresolved/);
  finish('done'); assert.equal(await first, 'done');
  await assert.rejects(call(args), /Figma failed/);
  await assert.rejects(call(args), /prior call is active or unresolved/);
  assert.equal(calls, 2);
});

test('generated live check reads actual exact owner, detects changed metadata and never removes a foreign lease', async () => {
  const lease = `/private/tmp/show-tools-figma-${fileKey}.lease`;
  mkdirSync(lease);
  try {
    writeFileSync(lease + '/owner', JSON.stringify(owner));
    let calls = 0;
    const code = ownedFigmaCallerCode({ fileKey, owner, acquisition: { exit_code: 0 } });
    const call = runInNewContext(code + '\ncallOwnedFigma;', { tools: {
      exec_command: async ({ cmd }: { cmd: string }) => {
        try { execSync(cmd, { stdio: 'pipe' }); return { exit_code: 0 }; }
        catch { return { exit_code: 1 }; }
      },
      mcp__codex_apps__figma_use_figma: async () => { calls++; return 'verified'; },
    } });
    assert.equal(await call(args), 'verified');
    writeFileSync(lease + '/owner', JSON.stringify({ ...owner, batch: 'foreign-batch' }));
    await assert.rejects(call(args), /ownership was not verified/);
    assert.equal(calls, 1);
    assert.equal(JSON.parse(execSync('cat ' + lease + '/owner', { encoding: 'utf8' })).batch, 'foreign-batch');
    rmSync(lease + '/owner');
    await assert.rejects(call(args), /ownership was not verified/);
    assert.equal(calls, 1);
  } finally { rmSync(lease, { recursive: true }); }
});


test('returned error or missing Figma response keeps the batch held for Chief recovery', async () => {
  for (const response of [{ isError: true, content: [] }, undefined]) {
    let calls = 0;
    const call = wrapper(async () => ({ exit_code: 0 }), async () => { calls++; return response; });
    assert.equal(await call(args), response);
    await assert.rejects(call(args), /prior call is active or unresolved/);
    assert.equal(calls, 1);
  }
});


test('payload limit includes the injected guard and rejects oversized code before any tool call', async () => {
  let checks = 0;
  const lengths: number[] = [];
  const call = wrapper(async () => { checks++; return { exit_code: 0 }; }, async input => {
    lengths.push(input.code.length);
    return { content: [] };
  });
  await call({ ...args, code: '' });
  const prefixLength = lengths[0];
  assert(prefixLength > 0);
  await call({ ...args, code: ' '.repeat(FIGMA_CODE_LIMIT - prefixLength) });
  assert.equal(lengths[1], FIGMA_CODE_LIMIT);
  for (const code of [' '.repeat(FIGMA_CODE_LIMIT - prefixLength + 1), ' '.repeat(126786)]) {
    await assert.rejects(call({ ...args, code }), /exceeds connector limit 50000/);
  }
  assert.equal(checks, 2);
  assert.deepEqual(lengths, [prefixLength, FIGMA_CODE_LIMIT]);
  await call(args);
  assert.equal(checks, 3);
});
