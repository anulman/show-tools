import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync } from 'node:fs';
import { access, chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { migrateCatalog, readMigratedCatalog } from '../migrations.js';
import { NativeCatalogAuthority } from '../native-store.js';
import { VoiceCatalogSqlite } from '../sqlite.js';
import type { CatalogBody } from '../authority-model.js';

const require = createRequire(import.meta.url);
const sql = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const identity = { catalogId: 'fixture-catalog', generationId: 'fixture-generation' };
const permissionChecks = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;
function body(name = 'Cowbell'): CatalogBody {
  return { voices: [
    { id: 'bell', name, notes: 'Preserve the quiet first hit.\n🔔', characterId: 'unknown-character', avatarToken: 'amber', effects: [
      { kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 },
      { kind: 'slapback', delayMs: 140, feedback: .2, wet: .4 },
    ] },
    { id: 'drums', name: 'Drums', notes: '', characterId: null, avatarToken: 'neutral', effects: [] },
  ], bindings: [
    { spreadsheetId: 'sheet-one', sheetId: 101, labelCell: 'A11', sourceLabel: 'AF - Cowbell', voiceId: 'bell',
      cueRow: { labelCell: 'A19', sourceLabel: 'R2' } },
    { spreadsheetId: 'sheet-two', sheetId: 101, labelCell: 'A11', sourceLabel: 'AF - Cowbell elsewhere', voiceId: 'bell', cueRow: null },
  ] };
}

async function fixture(run: (files: { directory: string; filename: string; legacy: Uint8Array }) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-native-'));
  const filename = join(directory, 'catalog #?.sqlite');
  const catalog = VoiceCatalogSqlite.create(sql);
  let legacy: Uint8Array;
  try { catalog.replace({ ...body(), version: 2, revision: 0 }, 0); legacy = catalog.exportBytes(); }
  finally { catalog.close(); }
  try {
    await writeFile(filename, migrateCatalog(sql, legacy, identity));
    await run({ directory, filename, legacy });
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test('native authority opens only explicit existing canonical files without creating or migrating inputs', async () => {
  await fixture(async ({ directory, legacy }) => {
    assert.throws(() => NativeCatalogAuthority.open('relative.sqlite'), /absolute/);
    const missing = join(directory, 'missing.sqlite');
    assert.throws(() => NativeCatalogAuthority.open(missing));
    await assert.rejects(access(missing));
    for (const [name, bytes] of [['legacy.sqlite', legacy], ['corrupt.sqlite', new Uint8Array([4, 8, 15, 16])]] satisfies [string, Uint8Array][]) {
      const filename = join(directory, name);
      await writeFile(filename, bytes);
      assert.throws(() => NativeCatalogAuthority.open(filename));
      assert.deepEqual(new Uint8Array(await readFile(filename)), bytes);
    }
  });
});

test('actual NUL paths cannot select a valid prefix file or create a snapshot', async () => {
  await fixture(async ({ directory, filename }) => {
    const before = new Uint8Array(await readFile(filename));
    assert.throws(() => {
      const unexpected = NativeCatalogAuthority.open(filename + '\u0000unexpected');
      unexpected.close();
    }, /NUL/);
    const authority = NativeCatalogAuthority.open(filename);
    try {
      await assert.rejects(authority.snapshot(join(directory, 'backup.sqlite') + '\u0000unexpected'), /NUL/);
      await assert.rejects(access(join(directory, 'backup.sqlite')));
      assert(!(await readdir(directory)).some(name => name.startsWith('.catalog-snapshot-')));
      assert.deepEqual(new Uint8Array(await readFile(filename)), before);
    } finally { authority.close(); }
  });
});

test('literal percent-00 remains a valid filename rather than an embedded NUL', async () => {
  await fixture(async ({ directory, filename }) => {
    const literal = join(directory, 'literal%00.sqlite');
    await writeFile(literal, await readFile(filename));
    const authority = NativeCatalogAuthority.open(literal);
    try {
      assert.deepEqual((await authority.read()).body, body());
      const destination = join(directory, 'backup%00.sqlite');
      const { snapshot: copied, filename: copiedFilename } = await authority.snapshot(destination);
      assert.deepEqual(copied.body, body());
      assert.deepEqual(await readMigratedCatalog(sql, new Uint8Array(await readFile(copiedFilename))), copied);
    } finally { authority.close(); }
  });
});

test('existing catalog paths resolve symlinks before parent segments', { skip: process.platform === 'win32' }, async () => {
  await fixture(async ({ directory, filename }) => {
    const root = join(directory, 'root'), target = join(directory, 'target'), nested = join(target, 'sub');
    await mkdir(root); await mkdir(nested, { recursive: true });
    const unrelatedPath = join(root, 'catalog.sqlite'), actualPath = join(target, 'catalog.sqlite');
    const bytes = await readFile(filename);
    await writeFile(unrelatedPath, bytes); await writeFile(actualPath, bytes);
    const targetAuthority = NativeCatalogAuthority.open(actualPath);
    try { await targetAuthority.replace((await targetAuthority.read()).stamp, body('Actual target')); }
    finally { targetAuthority.close(); }
    await symlink(nested, join(root, 'link'));
    const selected = NativeCatalogAuthority.open(root + '/link/../catalog.sqlite');
    try {
      const before = await selected.read();
      assert.deepEqual(before.body, body('Actual target'));
      await selected.replace(before.stamp, body('Changed actual target'));
    } finally { selected.close(); }
    const actual = NativeCatalogAuthority.open(actualPath), unrelated = NativeCatalogAuthority.open(unrelatedPath);
    try {
      assert.deepEqual((await actual.read()).body, body('Changed actual target'));
      assert.deepEqual((await unrelated.read()).body, body());
      assert.deepEqual(await readFile(unrelatedPath), bytes);
    } finally { actual.close(); unrelated.close(); }
  });
});

test('a snapshot uses the physical parent of a symlink-and-parent path', {
  skip: permissionChecks ? false : 'Requires POSIX permissions for a non-root user',
}, async () => {
  await fixture(async ({ directory, filename }) => {
    const root = join(directory, 'root'), target = join(directory, 'target'), nested = join(target, 'sub');
    await mkdir(root); await mkdir(nested, { recursive: true });
    await symlink(nested, join(root, 'link'));
    const authority = NativeCatalogAuthority.open(filename);
    await chmod(root, 0o500);
    try {
      const { snapshot: copied, filename: copiedFilename } = await authority.snapshot(root + '/link/../backup.sqlite');
      assert.deepEqual(copied.body, body());
      assert.deepEqual(await readMigratedCatalog(sql, new Uint8Array(await readFile(copiedFilename))), copied);
      await assert.rejects(access(join(root, 'backup.sqlite')));
    } finally { await chmod(root, 0o700); authority.close(); }
  });
});

test('snapshot rejects directory-like final path segments before any publication', async () => {
  await fixture(async ({ directory, filename }) => {
    const authority = NativeCatalogAuthority.open(filename);
    try {
      for (const destination of [directory + '/', directory + '/.', directory + '/..'])
        await assert.rejects(authority.snapshot(destination), /directory name/);
      assert(!(await readdir(directory)).some(name => name.startsWith('.catalog-snapshot-')));
    } finally { authority.close(); }
  });
});

test('native read and committed replacement preserve complete records and survive reopening', async () => {
  await fixture(async ({ filename }) => {
    const authority = NativeCatalogAuthority.open(filename);
    try {
      const initial = await authority.read();
      assert.deepEqual(initial.body, body());
      assert.deepEqual(initial.stamp, { ...identity, revision: 1 });
      const saved = await authority.replace(initial.stamp, body('Changed bell'));
      assert.equal(saved.kind, 'current');
      if (saved.kind !== 'current') throw new Error('Expected committed catalog');
      assert.deepEqual(saved.snapshot.body, body('Changed bell'));
      assert.equal(saved.snapshot.stamp.revision, 2);
    } finally { authority.close(); }
    const reopened = NativeCatalogAuthority.open(filename);
    try {
      const actual = await reopened.read();
      assert.deepEqual(actual.body, body('Changed bell'));
      assert.equal(actual.stamp.revision, 2);
      assert.deepEqual(await readMigratedCatalog(sql, new Uint8Array(await readFile(filename))), actual);
    } finally { reopened.close(); }
  });
});

test('independent native connections reject a stale overwrite while unchanged content converges without a revision', async () => {
  await fixture(async ({ filename }) => {
    const first = NativeCatalogAuthority.open(filename), second = NativeCatalogAuthority.open(filename);
    try {
      const base = await first.read();
      const saved = await first.replace(base.stamp, body('First editor'));
      assert.equal(saved.kind, 'current');
      const stale = await second.replace(base.stamp, body('Second editor'));
      assert.equal(stale.kind, 'conflict');
      if (stale.kind !== 'conflict') throw new Error('Expected stale-write conflict');
      assert.deepEqual(stale.current.body, body('First editor'));
      assert.equal(stale.current.stamp.revision, 2);
      const repeated = await second.replace(base.stamp, body('First editor'));
      assert.equal(repeated.kind, 'current');
      if (repeated.kind !== 'current') throw new Error('Expected matching current content');
      assert.equal(repeated.snapshot.stamp.revision, 2);
      assert.deepEqual(await first.read(), repeated.snapshot);
    } finally { first.close(); second.close(); }
  });
});

test('foreign authority or restore generation conflicts before an equal-body no-op', async () => {
  await fixture(async ({ filename }) => {
    const authority = NativeCatalogAuthority.open(filename);
    try {
      const before = await authority.read();
      for (const base of [{ ...before.stamp, generationId: 'older-generation' }, { ...before.stamp, catalogId: 'other-catalog' }]) {
        const result = await authority.replace(base, before.body);
        assert.equal(result.kind, 'conflict');
        assert.deepEqual(await authority.read(), before);
      }
    } finally { authority.close(); }
  });
});

test('invalid writes and exhausted revision leave the native catalog unchanged', async () => {
  await fixture(async ({ filename }) => {
    const editor = new DatabaseSync(filename);
    try { editor.prepare('UPDATE catalog_metadata SET revision = ?').run(Number.MAX_SAFE_INTEGER); }
    finally { editor.close(); }
    const authority = NativeCatalogAuthority.open(filename);
    try {
      const before = await authority.read();
      await assert.rejects(authority.replace(before.stamp, body('Must not commit')), /exhausted/);
      await assert.rejects(authority.replace(before.stamp, { ...body(), bindings: [{ ...body().bindings[0], voiceId: 'missing' }] }));
      await assert.rejects(authority.replace({ ...before.stamp, revision: -1 }, body()));
      assert.deepEqual(await authority.read(), before);
      const unchanged = await authority.replace(before.stamp, before.body);
      assert.equal(unchanged.kind, 'current');
    } finally { authority.close(); }
  });
});

test('an actual SQLite write lock propagates without changing catalog records or revision', async () => {
  await fixture(async ({ filename }) => {
    const authority = NativeCatalogAuthority.open(filename), blocker = new DatabaseSync(filename);
    try {
      const before = await authority.read();
      blocker.exec('BEGIN IMMEDIATE');
      try { await assert.rejects(authority.replace(before.stamp, body('Blocked edit')), /locked/); }
      finally { blocker.exec('ROLLBACK'); }
      assert.deepEqual(await authority.read(), before);
    } finally { authority.close(); blocker.close(); }
  });
});

test('returned snapshots retain the exact accepted transaction across overlapping digest completion', async () => {
  await fixture(async ({ filename }) => {
    const authority = NativeCatalogAuthority.open(filename);
    try {
      const base = await authority.read();
      const first = authority.replace(base.stamp, body('First accepted'));
      const secondBase = { ...base.stamp, revision: 2 };
      const second = authority.replace(secondBase, body('Second accepted'));
      const [earlier, later] = await Promise.all([first, second]);
      assert.equal(earlier.kind, 'current'); assert.equal(later.kind, 'current');
      if (earlier.kind !== 'current' || later.kind !== 'current') throw new Error('Expected both serial commits');
      assert.deepEqual(earlier.snapshot.body, body('First accepted'));
      assert.equal(earlier.snapshot.stamp.revision, 2);
      assert.deepEqual(later.snapshot.body, body('Second accepted'));
      assert.equal(later.snapshot.stamp.revision, 3);
    } finally { authority.close(); }
  });
});

test('a native consistent snapshot reopens in a fresh process and remains separate from later source edits', async () => {
  await fixture(async ({ filename, directory }) => {
    const authority = NativeCatalogAuthority.open(filename);
    try {
      const destination = join(directory, 'backup #?.sqlite');
      const pending = authority.snapshot(destination);
      const initial = await authority.read();
      await authority.replace(initial.stamp, body('Live change after snapshot'));
      const { snapshot: copied, filename: copiedFilename } = await pending;
      assert.deepEqual(copied.body, body());
      assert.equal(copied.stamp.revision, 1);
      const check = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { DatabaseSync } from 'node:sqlite';
        const database = new DatabaseSync(process.argv[1], { readOnly: true });
        try {
          console.log(JSON.stringify({ integrity: database.prepare('PRAGMA integrity_check').get(), metadata: database.prepare('SELECT revision, catalog_id, generation_id FROM catalog_metadata').get(), voice: database.prepare('SELECT name, character_id FROM voices WHERE id = ?').get('bell') }));
        } finally { database.close(); }
      `, copiedFilename], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stderr);
      assert.deepEqual(JSON.parse(check.stdout), { integrity: { integrity_check: 'ok' }, metadata: { revision: 1,
        catalog_id: identity.catalogId, generation_id: identity.generationId }, voice: { name: 'Cowbell', character_id: 'unknown-character' } });
      assert.deepEqual(await readMigratedCatalog(sql, new Uint8Array(await readFile(copiedFilename))), copied);
      assert.deepEqual((await authority.read()).body, body('Live change after snapshot'));
      assert(!(await readdir(directory)).some(name => name.startsWith('.catalog-snapshot-')));
    } finally { authority.close(); }
  });
});

test('snapshot publication never overwrites an existing destination, including an empty file', async () => {
  await fixture(async ({ filename, directory }) => {
    const authority = NativeCatalogAuthority.open(filename);
    try {
      const before = await authority.read();
      await assert.rejects(authority.snapshot('relative.sqlite'), /absolute/);
      for (const bytes of [new Uint8Array(), new Uint8Array([1, 2, 3])]) {
        const destination = join(directory, 'occupied.sqlite');
        await writeFile(destination, bytes);
        await assert.rejects(authority.snapshot(destination));
        assert.deepEqual(new Uint8Array(await readFile(destination)), bytes);
        assert.deepEqual(await authority.read(), before);
      }
      assert(!(await readdir(directory)).some(name => name.startsWith('.catalog-snapshot-')));
    } finally { authority.close(); }
  });
});

test('a post-publication sync failure retains the completed snapshot without claiming success', {
  skip: permissionChecks ? false : 'Requires POSIX permissions for a non-root user',
}, async () => {
  await fixture(async ({ directory, filename }) => {
    const output = join(directory, 'output');
    await mkdir(output, { mode: 0o700 });
    const authority = NativeCatalogAuthority.open(filename), destination = join(output, 'backup.sqlite');
    try {
      const before = await authority.read();
      const pending = authority.snapshot(destination);
      chmodSync(output, 0o300);
      try { await assert.rejects(pending, /EACCES/); }
      finally { chmodSync(output, 0o700); }
      assert.deepEqual(await readMigratedCatalog(sql, new Uint8Array(await readFile(join(destination, 'catalog.sqlite')))), before);
      assert(!(await readdir(output)).some(name => name.startsWith('.catalog-snapshot-')));
      assert.deepEqual(await authority.read(), before);
    } finally { chmodSync(output, 0o700); authority.close(); }
  });
});


test('snapshot refuses an orphan SQLite journal namespace and preserves its bytes', async () => {
  await fixture(async ({ filename, directory }) => {
    const destination = join(directory, 'orphan-backup');
    await mkdir(destination);
    const writerPath = join(directory, 'writer.sqlite');
    await writeFile(writerPath, await readFile(filename));
    const writer = new DatabaseSync(writerPath);
    const journals = new Map<string, Buffer>();
    try {
      writer.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE catalog_metadata SET revision=7');
      for (const suffix of ['-wal', '-shm']) {
        const bytes = await readFile(writerPath + suffix);
        journals.set('catalog.sqlite' + suffix, bytes);
        await writeFile(join(destination, 'catalog.sqlite' + suffix), bytes);
      }
    } finally { writer.close(); }
    const rollbackJournal = Buffer.from('unrelated rollback journal');
    journals.set('catalog.sqlite-journal', rollbackJournal);
    await writeFile(join(destination, 'catalog.sqlite-journal'), rollbackJournal);
    const authority = NativeCatalogAuthority.open(filename);
    try {
      const before = await authority.read();
      await assert.rejects(authority.snapshot(destination), { code: 'EEXIST' });
      assert.deepEqual((await readdir(destination)).sort(), [...journals.keys()].sort());
      for (const [name, bytes] of journals) assert.deepEqual(await readFile(join(destination, name)), bytes);
      assert.deepEqual(await authority.read(), before);
      const backup = await authority.snapshot(join(directory, 'fresh-backup'));
      const reopened = NativeCatalogAuthority.open(backup.filename);
      try { assert.deepEqual(await reopened.read(), before); }
      finally { reopened.close(); }
    } finally { authority.close(); }
  });
});

test('snapshot refuses empty directories and live or dangling destination symlinks', async () => {
  await fixture(async ({ filename, directory }) => {
    const empty = join(directory, 'empty');
    await mkdir(empty);
    const destinations = [empty];
    if (process.platform !== 'win32') {
      for (const [name, target] of [['link', empty], ['dangling', join(directory, 'absent')]]) {
        const path = join(directory, name);
        await symlink(target, path);
        destinations.push(path);
      }
    }
    const authority = NativeCatalogAuthority.open(filename);
    try {
      for (const path of destinations) await assert.rejects(authority.snapshot(path), { code: 'EEXIST' });
      assert.deepEqual(await readdir(empty), []);
      await assert.rejects(access(join(directory, 'absent')));
    } finally { authority.close(); }
  });
});

test('competing processes publish exactly one complete snapshot into a new directory', async () => {
  await fixture(async ({ filename, directory }) => {
    const destination = join(directory, 'contested');
    const moduleUrl = new URL('../native-store.ts', import.meta.url).href;
    const code = `
      import { NativeCatalogAuthority } from ${JSON.stringify(moduleUrl)};
      const authority = NativeCatalogAuthority.open(process.argv[1]);
      try {
        const backup = await authority.snapshot(process.argv[2]);
        process.stdout.write(JSON.stringify({kind:'published', ...backup}));
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        process.stdout.write(JSON.stringify({kind:'occupied'}));
      } finally { authority.close(); }
    `;
    const run = () => new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code, filename, destination]);
      let output = '', errors = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { errors += chunk; });
      child.on('error', reject);
      child.on('close', status => status === 0 ? resolve(output) : reject(new Error(errors)));
    });
    const outcomes = (await Promise.all([run(), run()])).map(output => JSON.parse(output));
    assert.deepEqual(outcomes.map(outcome => outcome.kind).sort(), ['occupied', 'published']);
    const authority = NativeCatalogAuthority.open(filename);
    const backup = NativeCatalogAuthority.open(join(destination, 'catalog.sqlite'));
    try { assert.deepEqual(await backup.read(), await authority.read()); }
    finally { backup.close(); authority.close(); }
    assert.deepEqual(await readdir(destination), ['catalog.sqlite']);
  });
});

test('failed validation removes only its new unpublished snapshot namespace', async () => {
  await fixture(async ({ filename, directory }) => {
    const authority = NativeCatalogAuthority.open(filename);
    const writer = new DatabaseSync(filename);
    try {
      writer.exec('PRAGMA ignore_check_constraints=ON; UPDATE catalog_metadata SET revision=-1');
      const destination = join(directory, 'invalid-copy');
      await assert.rejects(authority.snapshot(destination));
      await assert.rejects(access(destination));
      assert.equal(writer.prepare('SELECT revision FROM catalog_metadata').get()?.revision, -1);
    } finally { writer.close(); authority.close(); }
  });
});
