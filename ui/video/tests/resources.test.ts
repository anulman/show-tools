import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BufferImageSource, Container, Texture, WebGLRenderer } from 'pixi.js';
import { parseStreetScene } from '../../../lib/video/street-score.js';
import { fetchStreetAsset } from '../../../lib/video/street-assets.js';
import { createStreetStudio, type StreetPlatform } from '../renderer.js';
import { StreetResources } from '../resources.js';

const bytes = new TextEncoder().encode('verified fixture bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
function scene() {
  return parseStreetScene({ version: 2, kind: 'authored-street-preview', width: 8, height: 8,
    background: { path: '/background.png', sha256 }, previewCountsPerSecond: 2, durationCounts: 4, countedBeatUnit: 4,
    actors: [{ characterId: 'fixture', role: 'instrument', placement: { x: 0, y: 0, scale: 1, depth: 0 },
      clips: ['simple', 'vigorous', 'special'].map(tier => ({ id: tier, tier, cycleQuarters: 2, actionQuarters: null,
        nativeGrid: { width: 1, height: 1 }, sourceOffset: { x: 0, y: 0 }, keys: [{ atQuarter: 0, pose: 0 }],
        drawings: ['/pose-0.png', '/unused-pose.png'].map(path => ({ path, sha256, pivot: { x: 0, y: 0 } })),
      })),
    }], tracks: [{ actor: 0, keys: [{ at: 0, clip: 0, pose: 0, grayscale: false }] }],
    provenance: { source: 'synthetic', assetsDigest: 'fixture', scoreDigest: 'fixture' },
  });
}
function fixture(renderer: WebGLRenderer, fetcher: typeof fetch = async () => new Response(bytes)) {
  let samplerDisposals = 0;
  const created: Array<{ texture: Texture; source: BufferImageSource }> = [];
  const platform: StreetPlatform = {
    renderer: () => renderer, fetch: fetcher,
    decode: async (_bytes, resources) => {
      const texture = () => {
        const source = new BufferImageSource({ resource: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1 });
        const result = new Texture({ source });
        created.push({ texture: result, source });
        resources.defer(() => result.destroy(true));
        return result;
      };
      return { color: texture(), gray: texture() };
    },
  };
  const sampler = { sample: () => [], dispose: () => { samplerDisposals++; } };
  return { platform, sampler, created, samplerDisposals: () => samplerDisposals };
}

class FailedInitialization extends WebGLRenderer {
  initCalls = 0;
  destroyCalls = 0;
  allocated = false;
  override async init(..._options: Parameters<WebGLRenderer['init']>): Promise<void> {
    this.initCalls++; this.allocated = true;
    throw new Error('Renderer initialization failed after allocation');
  }
  override destroy(...options: Parameters<WebGLRenderer['destroy']>): void {
    this.destroyCalls++; this.allocated = false;
    super.destroy(...options);
  }
}

test('renderer initialization failure releases partial renderer, sampler and all preloaded texture sources', async () => {
  const app = new FailedInitialization();
  const resources = fixture(app);
  await assert.rejects(createStreetStudio({ append() { assert.fail('Failed initialization must not attach a canvas'); } }, scene(), resources.sampler, resources.platform), /Renderer initialization failed/);
  assert.equal(app.initCalls, 1);
  assert.equal(app.destroyCalls, 1);
  assert.equal(app.allocated, false);
  assert.equal(resources.samplerDisposals(), 1);
  assert.equal(resources.created.length, 6);
  for (const { texture, source } of resources.created) {
    assert.equal(texture.destroyed, true); assert.equal(source.destroyed, true);
  }
});

test('later asset load failure releases already loaded and never displayed textures', async () => {
  const app = new FailedInitialization();
  const resources = fixture(app, async input => String(input) === '/unused-pose.png' ? new Response(null, { status: 404 }) : new Response(bytes));
  await assert.rejects(createStreetStudio({ append() { assert.fail('Asset failure must not attach a canvas'); } }, scene(), resources.sampler, resources.platform), /Cannot load Street asset/);
  assert.equal(app.initCalls, 0);
  assert.equal(app.destroyCalls, 1);
  assert.equal(resources.samplerDisposals(), 1);
  assert.equal(resources.created.length, 4);
  assert(resources.created.every(({ texture, source }) => texture.destroyed && source.destroyed));
});

test('browser fetch checks exact bytes before decoding and rejects absent scene hashes', async () => {
  const asset = { path: '/pose.png', sha256 };
  assert.deepEqual(await fetchStreetAsset(asset, async () => new Response(bytes)), bytes);
  await assert.rejects(fetchStreetAsset(asset, async () => new Response('tampered bytes')), /Asset hash mismatch/);
  const prepared = scene();
  assert.throws(() => parseStreetScene({ ...prepared, background: { path: '/background.png' } }));
  assert.throws(() => parseStreetScene({ ...prepared, version: 1 }));
  const app = new FailedInitialization();
  const resources = fixture(app, async () => new Response('tampered'));
  await assert.rejects(createStreetStudio({ append() {} }, prepared, resources.sampler, resources.platform), /Asset hash mismatch/);
  assert.equal(resources.created.length, 0);
  assert.equal(app.destroyCalls, 1);
  assert.equal(resources.samplerDisposals(), 1);
});

test('resource disposal is idempotent and runs every release even if one fails', () => {
  const owner = new StreetResources();
  const stage = new Container();
  owner.defer(() => stage.destroy({ children: true }));
  const released: number[] = [];
  owner.defer(() => released.push(1));
  owner.defer(() => { released.push(2); throw new Error('One release failed'); });
  owner.defer(() => released.push(3));
  assert.throws(() => owner.dispose(), AggregateError);
  owner.dispose();
  assert.deepEqual(released, [3, 2, 1]);
  assert.equal(stage.destroyed, true);
});
