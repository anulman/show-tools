import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Schema } from 'effect';
import { motionReadScript, nativeFromCanonical, verifyTiming } from './canonical-export.mjs';
import { digest, verifyPublished } from './published.mjs';

const approved = await verifyPublished('assets/video/published/C06-default/promotion.json');
const scene = { fixture: 'held pose timing' };
const publication = { ...approved, reexport: { ...approved.reexport, sceneSha256: digest(Buffer.from(JSON.stringify(scene))) } };
function timeline() {
  return {
    rootNodeId: publication.canonical.timelineRootId,
    duration: publication.reexport.durationSeconds,
    scene,
    tracks: publication.drawings.map(drawing => ({
      componentId: drawing.nodeId,
      track: { keyframes: Array.from({ length: 65 }, (_, sample) => {
        const time = sample / 8, beat = sample === 64 ? 0 : time * 2 % publication.cycleBeats;
        const key = [...publication.keyframes].reverse().find(key => key.atBeat <= beat);
        return { timelinePosition: time, easing: { type: 'HOLD' }, value: { value: key?.pose === drawing.index ? 1 : 0 } };
      }) },
    })),
  };
}

test('canonical HOLD timing is checked at every declared change and closure', () => {
  assert.equal(verifyTiming(publication, timeline()), 65);
  const wrong = timeline(); wrong.tracks[0].track.keyframes[0].value.value = 0;
  assert.throws(() => verifyTiming(publication, wrong), /HOLD timing failed/);
  const fade = timeline(); fade.tracks[1].track.keyframes[0].value.value = .5;
  assert.throws(() => verifyTiming(publication, fade));
});

test('a short unintended blink between review samples cannot pass', () => {
  const wrong = timeline();
  wrong.tracks[0].track.keyframes.splice(1, 0,
    { timelinePosition: .01, easing: { type: 'HOLD' }, value: { value: 0 } },
    { timelinePosition: .0100005, easing: { type: 'HOLD' }, value: { value: 1 } });
  assert.throws(() => verifyTiming(publication, wrong), /HOLD timing failed/);
});
test('an occupied native cell must be fully covered while a transparent tail may be clipped', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canonical-coverage-'));
  try {
    const path = join(root, 'pose.svg');
    const input = { ...publication, nativeGrid: { width: 2, height: 1 }, nativeToFigma: [[4, 0, 0], [0, 4, 0]] };
    await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="4"><path fill="red" d="M0 0h4v4H0z"/><path fill="lime" d="M4 0h4v4H4z"/></svg>');
    await assert.rejects(nativeFromCanonical(path, input), /Occupied native pixel cell is clipped/);
    await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="4"><path fill="red" d="M0 0h4v4H0z"/></svg>');
    assert.deepEqual([...await nativeFromCanonical(path, input)], [255, 0, 0, 255, 0, 0, 0, 0]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('canonical pixel sampling preserves scale, registration and transparent background', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canonical-pixel-'));
  try {
    const path = join(root, 'pose.svg');
    await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="6"><path fill="#ff0000" d="M0 2h2v2H0z"/></svg>');
    const input = { ...publication, nativeGrid: { width: 2, height: 2 }, nativeToFigma: [[2, 0, 0], [0, 2, 2]] };
    const pixels = await nativeFromCanonical(path, input);
    assert.deepEqual([...pixels], [255, 0, 0, 255, ...Array<number>(12).fill(0)]);
    await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="6"><path fill="#f5f5f5" d="M0 0h4v6H0z"/><path fill="#ff0000" d="M0 2h2v2H0z"/></svg>');
    await assert.rejects(nativeFromCanonical(path, input), /registration margins/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('changes away from a scaled native cell centre cannot hide during recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'canonical-cell-'));
  try {
    const path = join(root, 'pose.svg');
    await writeFile(path, '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="6"><path fill="#ff0000" d="M0 2h2v2H0z"/><rect x="0" y="2" width="1" height="1" fill="#00ff00"/></svg>');
    const input = { ...publication, nativeGrid: { width: 2, height: 2 }, nativeToFigma: [[2, 0, 0], [0, 2, 2]] };
    await assert.rejects(nativeFromCanonical(path, input), /inside native pixel cells/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

class FixtureNode {
  parent: FixtureNode | null = null;
  children: FixtureNode[] = [];
  x = 0; y = 0; width = 640; height = 800;
  visible = true; opacity = 1; clipsContent = true;
  relativeTransform = [[1, 0, 0], [0, 1, 0]];
  boundVariables = {};
  fills: unknown[] = [];
  animationStyles: unknown[] = [];
  manualKeyframeTracks: Record<string, unknown> = {};
  overrides: { id: string; overriddenFields: string[] }[] = [];
  componentId: string | null = null;
  componentProperties = {};
  scaleFactor = 1;
  timelines = [{ duration: 8 }];
  constructor(readonly id: string, readonly type: string) {}
  async getMainComponentAsync() { return this.componentId ? { id: this.componentId } : null; }
}

test('the generated Figma read binds visible instances, ancestors, overrides and other animation', async () => {
  const page = new FixtureNode('54:1383', 'PAGE');
  const root = new FixtureNode(publication.canonical.timelineRootId, 'FRAME'); root.parent = page;
  root.boundVariables = { fills: [{ type: 'VARIABLE_ALIAS', id: 'VariableID:1:1' }] };
  let boundValue = '#000000';
  const stage = new FixtureNode('300:1', 'FRAME'); stage.parent = root; root.children = [stage];
  const poses = timeline().tracks.map((track, index) => {
    const instance = new FixtureNode(`300:${index + 2}`, 'INSTANCE');
    instance.parent = stage; instance.componentId = track.componentId;
    instance.manualKeyframeTracks = { OPACITY: track.track };
    return instance;
  });
  stage.children = poses;
  const evaluate = new Function('figma', `return (async()=>{${motionReadScript(publication)}})()`);
  const figma = { getNodeByIdAsync: async (id: string) => id === page.id ? page : root, setCurrentPageAsync: async () => {}, variables: { getVariableByIdAsync: async () => ({ resolveForConsumer: () => ({ resolvedType: 'COLOR', value: boundValue }) }) } };
  const run = async (): Promise<unknown> => evaluate(figma);
  const before = await run();
  const captured = Schema.decodeUnknownSync(Schema.Struct({ scene: Schema.Unknown }))(before);
  const pinned = { ...publication, reexport: { ...publication.reexport, sceneSha256: digest(Buffer.from(JSON.stringify(captured.scene))) } };
  assert.equal(verifyTiming(pinned, before), 65);
  const edits = [
    () => { poses[0].x = 999999; },
    () => { poses[0].visible = false; },
    () => { poses[0].width = 1; },
    () => { stage.visible = false; },
    () => { stage.clipsContent = false; },
    () => { poses[0].fills = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]; },
    () => { stage.manualKeyframeTracks = { TRANSLATION_X: { keyframes: [] } }; },
    () => { poses[0].animationStyles = [{ id: 'unexpected' }]; },
    () => { boundValue = '#ffffff'; },
  ];
  for (const edit of edits) {
    edit();
    const after = await run();
    assert.throws(() => verifyTiming(pinned, after), /visible scene contract changed/);
    poses[0].x = 0; poses[0].visible = true; poses[0].width = 640; poses[0].fills = []; poses[0].animationStyles = [];
    stage.visible = true; stage.clipsContent = true; stage.manualKeyframeTracks = {};
    boundValue = '#000000';
  }
  poses[0].overrides = [{ id: poses[0].id, overriddenFields: ['fills'] }];
  await assert.rejects(run(), /visual override/);
});
