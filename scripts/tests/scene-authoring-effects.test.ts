import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  beamMaskAt,
  beamRgbaAt,
  chorusDefaults,
  chorusState,
  createBeamGeometry,
  tintSurfaceRgba,
  type BeamGeometry,
  type ChorusWindow,
} from '../video-expansion/scene-effects/fx.js';

const window: ChorusWindow = {
  startSeconds: 10,
  expansionFinishSeconds: 12,
  endSeconds: 15,
  source: 'explicit-authoring-window',
};

function close(actual: number, expected: number): void {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} differs from ${expected}`);
}

test('the tail starts at the supplied window end and clears after 100ms', () => {
  const atEnd = chorusState(15, [window]);
  assert.equal(atEnd.visible, true);
  close(atEnd.opacity, 1);
  close(atEnd.spread01, 0);
  close(chorusState(15.05, [window]).opacity, .5);
  assert.equal(chorusState(15.099, [window]).visible, true);
  assert.deepEqual(chorusState(15.1, [window]), {
    visible: false, opacity: 0, spread01: 0, windowIndex: null, source: null,
  });
});

test('faster width changes start later and retain both supplied finish times', () => {
  const earlier = { ...chorusDefaults, expandSeconds: 1, contractSeconds: 1 };
  close(chorusState(11.5, [window], earlier).spread01, .5);
  close(chorusState(11.5, [window]).spread01, 0);
  close(chorusState(11.95, [window]).spread01, .5);
  for (const config of [earlier, chorusDefaults]) {
    close(chorusState(12, [window], config).spread01, 1);
    close(chorusState(15, [window], config).spread01, 0);
  }
  close(chorusState(14.5, [window], earlier).spread01, .5);
  close(chorusState(14.5, [window]).spread01, 1);
  close(chorusState(14.95, [window]).spread01, .5);
});

test('fade-in changes opacity without altering window provenance or adding activity', () => {
  assert.equal(chorusState(9.999, [window]).visible, false);
  assert.equal(chorusState(10, [window]).visible, false);
  const halfway = chorusState(10.05, [window]);
  assert.equal(halfway.visible, true);
  close(halfway.opacity, .5);
  assert.equal(halfway.source, window.source);
  assert.equal(halfway.windowIndex, 0);
  close(chorusState(10.1, [window]).opacity, 1);
  assert.equal(chorusState(16, []).visible, false);
});

test('invalid time, duration and a selected window that cannot fit its transitions fail', () => {
  assert.throws(() => chorusState(NaN, [window]), /Invalid chorus/);
  assert.throws(() => chorusState(12, [window], { ...chorusDefaults, fadeOutSeconds: 0 }), /Invalid chorus/);
  assert.throws(() => chorusState(12, [window], { ...chorusDefaults, expandSeconds: 3 }), /cannot fit/);
});

const source = new Uint8Array([
  192, 33, 55, 0, 180, 70, 41, 97,
  255, 242, 180, 255, 32, 44, 65, 255,
]);

test('surface tint preserves every alpha and transparent RGB cell without mutating the source', () => {
  const before = new Uint8Array(source);
  const tinted = tintSurfaceRgba(source, 2, 2, .37);
  assert.equal(tinted.length, source.length);
  assert.deepEqual(source, before);
  assert.deepEqual(tinted.slice(0, 4), source.slice(0, 4));
  for (let i = 3; i < source.length; i += 4) assert.equal(tinted[i], source[i]);
  assert.notDeepEqual(tinted.slice(4, 7), source.slice(4, 7));
  assert.notDeepEqual(tinted.slice(8, 11), source.slice(8, 11));
});

test('zero surface amount restores exact bytes and a partial amount stays between its endpoints', () => {
  assert.deepEqual(tintSurfaceRgba(source, 2, 2, .37, 0), source);
  const full = tintSurfaceRgba(source, 2, 2, .37);
  const half = tintSurfaceRgba(source, 2, 2, .37, .5);
  for (let i = 0; i < source.length; i++) {
    assert.ok(half[i] >= Math.min(source[i], full[i]));
    assert.ok(half[i] <= Math.max(source[i], full[i]));
  }
});

test('surface dimensions, pixel coverage and nonfinite phase fail before rendering', () => {
  assert.throws(() => tintSurfaceRgba(source, 3, 2, 0), /Invalid surface/);
  assert.throws(() => tintSurfaceRgba(source, 0, 2, 0), /Invalid surface/);
  assert.throws(() => tintSurfaceRgba(source, 2, 2, Infinity), /Invalid surface/);
});

const scenes = [
  { name: 'wide', width: 1280, height: 720, moonPoint: { x: 1048, y: 148 } },
  { name: 'classic', width: 960, height: 720, moonPoint: { x: 760, y: 148 } },
];

function sampleAtAngle(geometry: BeamGeometry, alpha: Uint8Array, angle: number, radius: number): number {
  const x = Math.floor((geometry.pivot.x + Math.cos(angle) * radius) / geometry.cellSize);
  const y = Math.floor((geometry.pivot.y + Math.sin(angle) * radius) / geometry.cellSize);
  assert.ok(x >= 0 && x < geometry.gridWidth && y >= 0 && y < geometry.gridHeight);
  return alpha[y * geometry.gridWidth + x];
}

for (const scene of scenes) {
  test(`${scene.name} beam starts as a narrow slice and grows monotonically to complete coverage`, () => {
    const geometry = createBeamGeometry(scene);
    assert.deepEqual(geometry.moonPoint, scene.moonPoint);
    assert.deepEqual(geometry.pivot, scene.moonPoint);
    let previous = beamMaskAt(geometry, 0).alpha;
    const occupied = previous.filter(value => value === 255).length;
    assert.ok(occupied > 0 && occupied < previous.length / 20);
    for (let step = 1; step <= 64; step++) {
      const current = beamMaskAt(geometry, step / 64).alpha;
      for (let i = 0; i < current.length; i++) {
        assert.ok(current[i] === 0 || current[i] === 255);
        assert.ok(current[i] >= previous[i], `cell ${i} disappeared at step ${step}`);
      }
      previous = current;
    }
    assert.ok(previous.every(value => value === 255));
    assert.deepEqual(beamMaskAt(geometry, -1), beamMaskAt(geometry, 0));
    assert.deepEqual(beamMaskAt(geometry, 2), beamMaskAt(geometry, 1));
  });

  test(`${scene.name} beam admits equal angular offsets on both sides of the moon-to-exit axis`, () => {
    const geometry = createBeamGeometry(scene);
    const radius = 80;
    for (const progress of [.2, .25, .3]) {
      const alpha = beamMaskAt(geometry, progress).alpha;
      const sweep = geometry.initialHalfAngleRadians + geometry.maxSweepRadians * progress;
      for (const side of [-1, 1]) {
        assert.equal(sampleAtAngle(geometry, alpha, geometry.axisRadians + side * sweep * .5, radius), 255);
        assert.equal(sampleAtAngle(geometry, alpha, geometry.axisRadians + side * (sweep + .08), radius), 0);
      }
    }
  });

  test(`${scene.name} beam apex stays at the moon while the far endpoint widens`, () => {
    const geometry = createBeamGeometry(scene);
    assert.deepEqual(geometry.pivot, scene.moonPoint);
    const initial = beamMaskAt(geometry, 0);
    assert.equal(sampleAtAngle(geometry, initial.alpha, geometry.axisRadians, 80), 255);
    assert.equal(sampleAtAngle(geometry, initial.alpha, geometry.axisRadians + .15, 80), 0);
    assert.equal(sampleAtAngle(geometry, initial.alpha, geometry.axisRadians - .15, 80), 0);
    const halfway = beamMaskAt(geometry, .5);
    for (const sign of [-1, 1]) {
      assert.equal(sampleAtAngle(geometry, halfway.alpha, geometry.axisRadians + sign * 1.4, 80), 255);
      assert.equal(sampleAtAngle(geometry, halfway.alpha, geometry.axisRadians + sign * 1.8, 80), 0);
    }
    const last = beamMaskAt(geometry, 1);
    assert.equal(sampleAtAngle(geometry, last.alpha, geometry.axisRadians + Math.PI, 80), 255);
  });

  test(`${scene.name} full takeover has a downward gradient with complete opaque coverage`, () => {
    const geometry = createBeamGeometry(scene);
    const result = beamRgbaAt(geometry, 1, .2);
    for (let y = 0; y < result.height; y++) {
      const first = result.rgba.slice(y * result.width * 4, y * result.width * 4 + 3);
      for (let x = 0; x < result.width; x++) {
        const index = (y * result.width + x) * 4;
        assert.deepEqual(result.rgba.slice(index, index + 3), first);
        assert.equal(result.rgba[index + 3], 255);
      }
    }
    assert.notDeepEqual(result.rgba.slice(0, 3), result.rgba.slice(-4, -1));
  });
}

test('invalid grid, source point, pivot and nonfinite progress fail', () => {
  const scene = scenes[0];
  assert.throws(() => createBeamGeometry({ ...scene, width: 1279 }), /Invalid beam canvas/);
  assert.throws(() => createBeamGeometry({ ...scene, cellSize: 0 }), /Invalid beam canvas/);
  assert.throws(() => createBeamGeometry({ ...scene, moonPoint: { x: 1280, y: 0 } }), /Moon point/);
  assert.throws(() => createBeamGeometry({ ...scene, offscreenExitPoint: { x: 0, y: 0 } }), /exit must be offscreen below-left/);
  assert.throws(() => beamMaskAt(createBeamGeometry(scene), NaN), /Invalid beam progress/);
});
