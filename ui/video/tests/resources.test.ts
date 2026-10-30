import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BufferImageSource, Container, Sprite, Texture, WebGLRenderer, type RenderOptions } from 'pixi.js';
import { parseStreetScene, type ActorFrame } from '../../../lib/video/street-score.js';
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
function poofScene() {
  return parseStreetScene({ ...scene(), staging: { kind: 'poof', effects: [{ id: 'fixture-poof',
    nativeGrid: { width: 128, height: 128 }, pivot: { x: 64, y: 106 },
    drawings: Array.from({ length: 6 }, (_, index) => ({ path: `/poof-${index}.png`, sha256 })),
  }], tracks: [{ actor: 0, keys: [{ at: 0, visible: false, poof: { effect: 0, pose: 2 } }] }] } });
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

class CapturedPresentation extends WebGLRenderer {
  stage: Container | undefined;
  override async init(..._options: Parameters<WebGLRenderer['init']>): Promise<void> {
    Object.defineProperty(this, 'canvas', { value: { remove() {}, setAttribute() {} } });
  }
  override render(options: Container | RenderOptions): void {
    this.stage = options instanceof Container ? options : options.container;
  }
}

test('Pixi presentation keeps world poof offsets separate from bodies through reverse seeks and grayscale changes', async () => {
  const app = new CapturedPresentation(), resources = fixture(app);
  const body: ActorFrame = { actor: 0, clip: 0, pose: 0, grayscale: false, visible: true, poof: null };
  const sampler = { sample(count: number): ActorFrame[] {
    return count === 0 ? [body] : [{ ...body, grayscale: count >= 2, visible: count >= 2, poof: { effect: 0, pose: 1 } }];
  }, dispose() {} };
  const initial = poofScene();
  assert(initial.staging.kind === 'poof');
  const prepared = parseStreetScene({ ...initial,
    actors: initial.actors.map(actor => ({ ...actor, placement: { ...actor.placement, scale: 2 } })),
    staging: { ...initial.staging, tracks: initial.staging.tracks.map(track => ({ ...track, offset: { x: 6, y: 4 } })) },
  });
  const studio = await createStreetStudio({ append() {} }, prepared, sampler, resources.platform);
  try {
    studio.draw(0);
    assert(app.stage);
    const actors = app.stage.children[1], figure = actors.children[0];
    assert(figure instanceof Container);
    const sprite = figure.children[0], cloud = figure.children[1];
    assert(sprite instanceof Sprite); assert(cloud instanceof Sprite);
    assert.deepEqual([figure.position.x, figure.position.y, figure.scale.x], [0, 0, 2]);
    assert.deepEqual([sprite.position.x, sprite.position.y], [0, 0]);
    assert.deepEqual([cloud.position.x, cloud.position.y], [3, 2]);
    assert.equal(sprite.visible, true); assert.equal(cloud.visible, false);
    studio.draw(1);
    assert.equal(sprite.visible, false); assert.equal(cloud.visible, true);
    assert.deepEqual([cloud.pivot.x, cloud.pivot.y], [64, 106]);
    const colorCloud = cloud.texture, colorBody = sprite.texture;
    studio.draw(2);
    assert.equal(sprite.visible, true); assert.equal(cloud.visible, true);
    assert.equal(cloud.texture, colorCloud);
    assert.notEqual(sprite.texture, colorBody);
    studio.draw(0);
    assert.equal(sprite.visible, true); assert.equal(cloud.visible, false);
    assert.equal(sprite.texture, colorBody);
    assert.deepEqual([sprite.position.x, sprite.position.y], [0, 0]);
    assert.deepEqual([cloud.position.x, cloud.position.y], [3, 2]);
  } finally { studio.dispose(); }
});

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

test('poof preload failure rejects changed bytes and releases earlier effect textures', async () => {
  const app = new FailedInitialization();
  const resources = fixture(app, async input => new Response(String(input) === '/poof-5.png' ? 'changed effect' : bytes));
  await assert.rejects(createStreetStudio({ append() { assert.fail('Effect failure must not attach a canvas'); } }, poofScene(), resources.sampler, resources.platform), /Asset hash mismatch/);
  assert.equal(app.initCalls, 0);
  assert.equal(app.destroyCalls, 1);
  assert.equal(resources.samplerDisposals(), 1);
  assert.equal(resources.created.length, 12);
  assert(resources.created.every(({ texture, source }) => texture.destroyed && source.destroyed));
});

test('renderer initialization failure releases unused and displayed-candidate poof textures', async () => {
  const app = new FailedInitialization();
  const resources = fixture(app);
  await assert.rejects(createStreetStudio({ append() { assert.fail('Failed initialization must not attach a canvas'); } }, poofScene(), resources.sampler, resources.platform), /Renderer initialization failed/);
  assert.equal(resources.created.length, 18);
  assert.equal(resources.samplerDisposals(), 1);
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
