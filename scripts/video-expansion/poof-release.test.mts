import assert from 'node:assert/strict';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import sharp from 'sharp';
import { buildPoofRelease, POOF_CATALOG_PATH, PoofCatalog, poofSha256, readPoofRelease } from './poof-release.mjs';

const checkout = fileURLToPath(new URL('../../', import.meta.url));
async function fixture() {
  const root = await mkdtemp('/private/tmp/poof-release-test-'), sourceRoot = join(root, 'source'), outputRoot = join(root, 'release');
  const bytes = await readFile(join(checkout, POOF_CATALOG_PATH));
  const catalog = Schema.decodeUnknownSync(PoofCatalog)(JSON.parse(bytes.toString()));
  await mkdir(dirname(join(sourceRoot, POOF_CATALOG_PATH)), { recursive: true });
  await writeFile(join(sourceRoot, POOF_CATALOG_PATH), bytes);
  for (const candidate of catalog.candidates) for (const drawing of candidate.drawings) {
    const path = join(sourceRoot, drawing.native.path);
    await mkdir(dirname(path), { recursive: true });
    await copyFile(join(checkout, drawing.native.path), path);
  }
  return { root, sourceRoot, outputRoot, catalog, async change(transform: (catalog: PoofCatalog) => unknown) {
    await writeFile(join(sourceRoot, POOF_CATALOG_PATH), JSON.stringify(transform(catalog)) + '\n');
  } };
}
async function discard(root: string) {
  await chmod(root, 0o755);
  for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isDirectory()) await discard(join(root, entry.name));
  await rm(root, { recursive: true, force: true });
}
async function filePaths(root: string, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await filePaths(root, path)); else paths.push(path);
  }
  return paths.sort();
}
function firstDrawing(catalog: PoofCatalog, transform: (drawing: PoofCatalog['candidates'][number]['drawings'][number]) => unknown) {
  return { ...catalog, candidates: catalog.candidates.map((candidate, index) => index ? candidate : { ...candidate, drawings: candidate.drawings.map((drawing, i) => i ? drawing : transform(drawing)) }) };
}

test('actual approved18 form an exact self-contained readonly release with no process-history reads', async () => {
  const f = await fixture();
  try {
    const expectedCatalog = await readFile(join(f.sourceRoot, POOF_CATALOG_PATH));
    const result = await buildPoofRelease(f);
    assert.equal(result.drawings, 18); assert.equal(result.files, 19);
    assert.equal(result.catalogSha256, poofSha256(expectedCatalog));
    assert.deepEqual(await filePaths(f.outputRoot), [POOF_CATALOG_PATH, ...f.catalog.candidates.flatMap(c => c.drawings.map(d => d.native.path))].sort());
    assert.deepEqual(await readFile(join(f.outputRoot, POOF_CATALOG_PATH)), expectedCatalog);
    assert.equal((await lstat(f.outputRoot)).mode & 0o777, 0o555);
    assert.equal((await lstat(join(f.outputRoot, 'assets/video/motion/poof'))).mode & 0o777, 0o555);
    assert.equal((await lstat(join(f.outputRoot, POOF_CATALOG_PATH))).mode & 0o777, 0o444);
    await rm(f.sourceRoot, { recursive: true });
    const frozen = await readPoofRelease({ releaseRoot: f.outputRoot, catalogSha256: result.catalogSha256 });
    assert.deepEqual(frozen.catalog.candidates.map(c => c.id), f.catalog.candidates.map(c => c.id));
    assert.equal(frozen.catalog.operatorApproval.quote, f.catalog.operatorApproval.quote);
  } finally { await discard(f.root); }
});

test('changed valid PNG bytes fail before creating an output', async () => {
  const f = await fixture();
  try {
    const [first, second] = f.catalog.candidates[0].drawings;
    await copyFile(join(f.sourceRoot, second.native.path), join(f.sourceRoot, first.native.path));
    await assert.rejects(buildPoofRelease(f), /PNG file hash mismatch/);
    await assert.rejects(lstat(f.outputRoot), /ENOENT/);
  } finally { await discard(f.root); }
});

test('native RGBA and canonical source-export RGBA hashes are independent required checks', async () => {
  for (const field of ['native', 'figma']) {
    const f = await fixture();
    try {
      await f.change(c => firstDrawing(c, d => field === 'native' ? { ...d, native: { ...d.native, rgbaSha256: '0'.repeat(64) } } : { ...d, figma: { ...d.figma, exportRgbaSha256: '0'.repeat(64) } }));
      await assert.rejects(buildPoofRelease(f), /RGBA hash mismatch/);
    } finally { await discard(f.root); }
  }
});

test('missing approval, concept status, failed style or temporal review, and a selected-only policy cannot publish', async () => {
  const changes: ((catalog: PoofCatalog) => unknown)[] = [
    c => ({ ...c, operatorApproval: undefined }), c => ({ ...c, operatorApproval: { ...c.operatorApproval, quote: '' } }),
    c => ({ ...c, status: 'three-concept-options' }), c => ({ ...c, selectedCandidate: 'soft' }),
    c => ({ ...c, selectionPolicy: 'single-selection' }),
    c => ({ ...c, candidates: c.candidates.map((candidate, i) => i ? candidate : { ...candidate, status: 'concept' }) }),
    ...['styleVerdict', 'temporalVerdict', 'sourceRgba'].map(field => (c: PoofCatalog) => ({ ...c, candidates: c.candidates.map((candidate, i) => i ? candidate : { ...candidate, review: { ...candidate.review, [field]: 'needs-review' } }) })),
    c => ({ ...c, candidates: c.candidates.map((candidate, i) => i ? candidate : { ...candidate, preview: { review: { ...candidate.preview.review, bodyIntegrityVerdict: 'fail' } } }) }),
  ];
  for (const change of changes) {
    const f = await fixture();
    try { await f.change(change); await assert.rejects(buildPoofRelease(f)); await assert.rejects(lstat(f.outputRoot), /ENOENT/); }
    finally { await discard(f.root); }
  }
});

test('pinned offline reader rejects changed approval even when its replacement is syntactically valid', async () => {
  const f = await fixture();
  try {
    const result = await buildPoofRelease(f), catalogPath = join(f.outputRoot, POOF_CATALOG_PATH);
    await chmod(catalogPath, 0o644);
    await writeFile(catalogPath, JSON.stringify({ ...f.catalog, operatorApproval: { ...f.catalog.operatorApproval, quote: 'Different approval after promotion' } }));
    await assert.rejects(readPoofRelease({ releaseRoot: f.outputRoot, catalogSha256: result.catalogSha256 }), /Pinned poof catalog hash mismatch/);
  } finally { await discard(f.root); }
});

test('wrong grid, anchor, timing, drawing coverage and missing clear endpoint cannot publish', async () => {
  const changes = [
    { nativeGrid: { width: 64, height: 128 } }, { anchor: { x: 63, y: 106 } },
    { characterSwitchAtBeat: .75 }, { actionBeats: 2 }, { interpolation: 'linear' },
  ];
  for (const patch of changes) {
    const f = await fixture();
    try { await f.change(c => ({ ...c, candidates: c.candidates.map((candidate, i) => i ? candidate : { ...candidate, ...patch }) })); await assert.rejects(buildPoofRelease(f)); }
    finally { await discard(f.root); }
  }
  const f = await fixture();
  try {
    await f.change(c => ({ ...c, candidates: c.candidates.map((candidate, i) => i ? candidate : { ...candidate, keyframes: candidate.keyframes.slice(0, -1) }) }));
    await assert.rejects(buildPoofRelease(f), /explicit clear endpoint/);
  } finally { await discard(f.root); }
  for (const change of [
    (c: PoofCatalog) => ({ ...c, candidates: c.candidates.slice(0, -1) }),
    (c: PoofCatalog) => ({ ...c, candidates: c.candidates.map((candidate, i) => i ? candidate : { ...candidate, drawings: candidate.drawings.slice(0, -1) }) }),
  ]) {
    const incomplete = await fixture();
    try { await incomplete.change(change); await assert.rejects(buildPoofRelease(incomplete), /all three approved|six drawings/); }
    finally { await discard(incomplete.root); }
  }
});

test('fully hash-reconciled alpha and missing-peak corruption still fail native pixel checks', async () => {
  for (const corruption of ['partial-alpha', 'missing-peak']) {
    const f = await fixture();
    try {
      const candidate = f.catalog.candidates[0], drawing = candidate.drawings[corruption === 'partial-alpha' ? 0 : 2];
      const { data } = await sharp(join(f.sourceRoot, drawing.native.path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (corruption === 'partial-alpha') {
        const occupied = data.findIndex((value, index) => index % 4 === 3 && value === 255);
        assert(occupied > 0); data[occupied] = 128;
      } else data[(18 * 128 + 24) * 4 + 3] = 0;
      const bytes = await sharp(data, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer();
      await writeFile(join(f.sourceRoot, drawing.native.path), bytes);
      await f.change(c => ({ ...c, candidates: c.candidates.map((item, i) => i ? item : { ...item, drawings: item.drawings.map(d => d.index !== drawing.index ? d : { ...d, native: { ...d.native, sha256: poofSha256(bytes), rgbaSha256: poofSha256(data) }, figma: { ...d.figma, exportRgbaSha256: poofSha256(data) } }) }) }));
      await assert.rejects(buildPoofRelease(f), corruption === 'partial-alpha' ? /nonbinary alpha/ : /peak no longer covers/);
    } finally { await discard(f.root); }
  }
});

test('relative escapes and symlink artifacts are rejected despite matching target bytes', async () => {
  for (const kind of ['escape', 'file-symlink', 'directory-symlink', 'root-symlink']) {
    const f = await fixture();
    try {
      const drawing = f.catalog.candidates[0].drawings[0], path = join(f.sourceRoot, drawing.native.path);
      if (kind === 'escape') await f.change(c => firstDrawing(c, d => ({ ...d, native: { ...d.native, path: '../outside.png' } })));
      if (kind === 'file-symlink') {
        const outside = join(f.root, 'outside.png'); await copyFile(path, outside); await unlink(path); await symlink(outside, path);
      }
      if (kind === 'directory-symlink') {
        const original = dirname(path), outside = join(f.root, 'outside'); await mkdir(outside);
        for (const d of f.catalog.candidates[0].drawings) await copyFile(join(f.sourceRoot, d.native.path), join(outside, `frame-${d.index}.png`));
        await rm(original, { recursive: true }); await symlink(outside, original);
      }
      if (kind === 'root-symlink') {
        const alias = join(f.root, 'alias'); await symlink(f.sourceRoot, alias);
        await assert.rejects(buildPoofRelease({ ...f, sourceRoot: alias }), /without symlinks/); continue;
      }
      await assert.rejects(buildPoofRelease(f), /Unsafe poof artifact path|symlink rejected/);
    } finally { await discard(f.root); }
  }
});

test('pre-existing file, empty directory, and populated directory outputs remain untouched', async () => {
  for (const kind of ['file', 'empty-directory', 'populated-directory']) {
    const f = await fixture();
    try {
      if (kind === 'file') await writeFile(f.outputRoot, 'previous-output'); else await mkdir(f.outputRoot);
      if (kind === 'populated-directory') await writeFile(join(f.outputRoot, 'sentinel'), 'previous-output');
      const before = await lstat(f.outputRoot);
      await assert.rejects(buildPoofRelease(f), /Refusing existing poof output/);
      assert.equal((await lstat(f.outputRoot)).ino, before.ino);
      if (kind === 'file') assert.equal(await readFile(f.outputRoot, 'utf8'), 'previous-output');
      if (kind === 'populated-directory') assert.equal(await readFile(join(f.outputRoot, 'sentinel'), 'utf8'), 'previous-output');
      if (kind === 'empty-directory') assert.deepEqual(await readdir(f.outputRoot), []);
    } finally { await discard(f.root); }
  }
});

test('racing publishers have one complete winner and never replace its package', async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([buildPoofRelease(f), buildPoofRelease(f)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const winner = results.find(result => result.status === 'fulfilled'); assert(winner?.status === 'fulfilled');
    const frozen = await readPoofRelease({ releaseRoot: f.outputRoot, catalogSha256: winner.value.catalogSha256 });
    assert.equal(frozen.catalog.candidates.length, 3);
    assert.equal((await filePaths(f.outputRoot)).length, 19);
    assert.deepEqual((await readdir(f.root)).sort(), ['release', 'source']);
  } finally { await discard(f.root); }
});
