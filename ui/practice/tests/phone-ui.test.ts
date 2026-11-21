import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import { enablePhoneMotion, type MotionReading, type MotionSurface } from '../phone-motion.js';
import { normalizeTambourineTuning } from '../tambourine-tuning.js';
import { chartBarLabel } from '../../../lib/performance/chart-position.js';
import tribulations from '../../../songs/tribulations.js';

const createTambourineTrace = () => ({ root: new Node(), start() {}, note() {}, record() {} });

class Node {
  children: Node[] = []; textContent = ''; disabled = false; type = ''; className = ''; id = ''; title = ''; hidden = false;
  dataset: Record<string, string> = {}; events = new Map<string, () => void>();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  attributes = new Map<string, string>();
  append(...nodes: Node[]) { this.children.push(...nodes); }
  replaceChildren(...nodes: Node[]) { this.children = nodes; }
  addEventListener(type: string, listener: () => void) { this.events.set(type, listener); }
  querySelector() { return null; }
  remove() {}
}

test('actual shake UI enables input without audio startup and sends scoped typed external hits to the existing session', async () => {
  const source = await sourceForVM(new URL('../app.ts', import.meta.url));
  let listener: ((reading: MotionReading) => void) | undefined, pending = Promise.resolve(); let group: Node | undefined, removed = 0;
  const surface: MotionSurface = { secure: true, available: true, async permission() { return 'granted'; },
    listen(receive) { listener = receive; return () => { removed++; listener = undefined; }; }, hide() { return () => {}; } };
  const commands: unknown[] = [], errors: unknown[] = [];
  const context = { createTambourineTrace, createTambourineTuning: () => ({ root: new Node(), read: () => undefined }), song: tribulations, chartBarLabel, songGeneration: 1, switching: false, starting: false, remote: false, audio: undefined,
    phoneMotionAbort: undefined, phoneAuditionTransition: Promise.resolve(), crypto: { randomUUID: () => 'motion-fixture' }, AbortController, DOMException,
    document: { getElementById: () => null, createElement: () => new Node() },
    elements: { 'live-voices': { insertAdjacentElement(_position: string, element: Node) { group = element; } } },
    enablePhoneMotion: (options: Parameters<typeof enablePhoneMotion>[0]) => enablePhoneMotion({ ...options, surface }),
    isRunning: () => true, showError: (error: unknown) => errors.push(error),
    act(action: () => Promise<void>) { pending = action(); return pending; },
    ensureAudio() { assert.fail('Enabling motion cannot start an engine'); },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function mountPhoneMotion()'), source.indexOf('function browserModeBusy()')), context);
  vm.runInContext('mountPhoneMotion()', context);
  assert(group); const button = group.children[0]; assert(button.textContent.includes('Tambourine'));
  assert.equal(group.children[1]?.textContent, 'Audition Tambourine');
  assert.equal(group.children[4]?.textContent, 'Chart shake plays in bars 137–160');
  assert.equal(group.children.length, 5, 'the four samples share one tuning panel and pair of controls');
  button.events.get('click')?.(); await pending;
  assert(button.textContent.startsWith('Disable shake')); assert.equal(context.audio, undefined);
  vm.runInContext('audio = { control: (control, options) => { captured.push({ control, options }); return Promise.resolve(); } }', Object.assign(context, { captured: commands }));
  listener?.({ x: 0, y: 0, z: 0, time: 100, gravity: false });
  listener?.({ x: 16, y: 0, z: 0, time: 120, gravity: false });
  assert.equal(commands.length, 1); assert.equal(JSON.stringify(commands[0]), JSON.stringify({ control: { id: 'external', slot: 3 }, options: { commandId: 'phone-motion/motion-fixture/1' } }));
  context.songGeneration++;
  listener?.({ x: 0, y: 0, z: 0, time: 250, gravity: false });
  listener?.({ x: 12, y: 0, z: 0, time: 400, gravity: false });
  assert.equal(commands.length, 1); assert.equal(removed, 1); assert.equal(errors.length, 0);
});

for (const { remote, running } of [{ remote: false, running: false }, { remote: false, running: true }, { remote: true, running: true }]) {
  test(`Tambourine audition routes to ${remote ? 'Hardware' : 'Browser'} audio when ${running ? 'playing' : 'stopped'}`, async () => {
    const source = await sourceForVM(new URL('../app.ts', import.meta.url));
    const commands: (number | [number, number])[] = [], errors: unknown[] = [];
    let listener: ((reading: MotionReading) => void) | undefined;
    let hide: (() => void) | undefined;
    let group: Node | undefined;
    let grant: (permission: string) => void = () => assert.fail('permission request not started');
    let pending = Promise.resolve();
    const surface: MotionSurface = {
      secure: true, available: true,
      permission: () => new Promise(resolve => { grant = resolve; }),
      listen(receive) { listener = receive; return () => { listener = undefined; }; },
      hide(receive) { hide = receive; return () => { hide = undefined; }; },
    };
    let holdArm: Promise<void> | undefined;
    let holdStroke: Promise<void> | undefined;
    const audio = {
      async auditionTambourine(velocity: number, slot?: number) {
        commands.push(slot === undefined ? velocity : [velocity, slot]);
        if (velocity === 0) await holdArm;
        if (slot !== undefined) await holdStroke;
      },
      control() { assert.fail('Audition cannot issue a chart hit'); },
    };
    const context = {
      createTambourineTrace, createTambourineTuning: () => ({ root: new Node(), read: () => undefined }),
      song: tribulations, chartBarLabel, songGeneration: 1, switching: false, starting: false, remote, audio: remote || running ? audio : undefined,
      phoneMotionAbort: undefined, phoneAuditionTransition: Promise.resolve(), crypto: { randomUUID: () => 'motion-fixture' }, AbortController, DOMException,
      document: { getElementById: () => null, createElement: () => new Node() },
      elements: { 'live-voices': { insertAdjacentElement(_position: string, element: Node) { group = element; } } },
      enablePhoneMotion: (options: Parameters<typeof enablePhoneMotion>[0]) => {
        assert.equal(options.sensor, 'tambourine');
        return enablePhoneMotion({ ...options, surface });
      },
      isRunning: () => running, showError: (error: unknown) => errors.push(error),
      act(action: () => Promise<void>) { pending = action(); return pending; },
      ensureAudio(_effects: undefined, unlock: boolean) {
        assert.equal(unlock, !remote);
        context.audio = audio;
        return Promise.resolve(audio);
      },
    };
    vm.createContext(context);
    vm.runInContext(source.slice(source.indexOf('function mountPhoneMotion()'), source.indexOf('function browserModeBusy()')), context);
    vm.runInContext('mountPhoneMotion()', context);
    assert(group);
    const button = group.children[1];
    button.events.get('click')?.();
    assert.equal(context.audio, audio, 'browser playback unlock starts in the click');
    assert.deepEqual(commands, []);
    assert.equal(button.textContent, 'Opening Tambourine audition…');
    grant('granted');
    await pending;
    assert.deepEqual(commands, [0]);
    assert.equal(button.textContent, 'End Tambourine audition');
    let releaseStroke: () => void = () => assert.fail('stroke delay not installed');
    holdStroke = new Promise(resolve => { releaseStroke = resolve; });
    const motion = (x: number, time: number) => listener?.({ x, y: 0, z: 0, time, gravity: false });
    motion(0, 100); motion(16, 120);
    await new Promise(resolve => setImmediate(resolve));
    motion(0, 140); motion(16, 160);
    assert.deepEqual(commands, [0, [127, 3]], 'the next shake waits for the command in flight');
    holdStroke = undefined;
    releaseStroke();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(commands, [0, [127, 3], [127, 3]], 'a released stroke queues even within 85 ms');
    hide?.();
    await context.phoneAuditionTransition;
    assert.deepEqual(commands, [0, [127, 3], [127, 3], -1]);
    assert.equal(listener, undefined);
    assert.equal(button.textContent, 'Audition Tambourine');

    let acknowledge: () => void = () => assert.fail('arm delay not installed');
    holdArm = new Promise(resolve => { acknowledge = resolve; });
    button.events.get('click')?.();
    grant('granted');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(commands, [0, [127, 3], [127, 3], -1, 0]);
    hide?.();
    button.events.get('click')?.();
    grant('granted');
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(commands, [0, [127, 3], [127, 3], -1, 0], 'new arm waits for old cleanup');
    holdArm = undefined;
    acknowledge();
    await pending;
    assert.deepEqual(commands, [0, [127, 3], [127, 3], -1, 0, -1, 0]);
    button.events.get('click')?.();
    await context.phoneAuditionTransition;
    assert.deepEqual(commands, [0, [127, 3], [127, 3], -1, 0, -1, 0, -1]);
    assert.deepEqual(errors, []);
  });
}

test('actual source rows display Spit as its independent prepared voice rather than Backup Vocals', async () => {
  const source = await sourceForVM(new URL('../app.ts', import.meta.url));
  const live = new Node(), mounted: { id: string; profile: number; name: string }[] = [];
  const pads = new Map(['L1', 'L2', 'R1', 'R2'].map(id => [id, { button: new Node(), shell: new Node() }]));
  const context = { song: tribulations, pads, remote: false, HTMLElement: Node,
    voiceEffects: { reset() {}, mount(part: { id: string; profile: number; name: string }) { mounted.push(part); } },
    liveVoiceStates: new Map(), voiceAvatars: new Map(), rotationControls: [], auditionButtons: [],
    voiceCatalog: { openProfile() {} }, requiredElement: () => new Node(), document: { createElement: () => new Node() },
    elements: { 'live-voices': live }, mountPhoneMotion() {} };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function mountVoiceRows()'), source.indexOf('function mountPhoneMotion()')), context);
  vm.runInContext('mountVoiceRows()', context);
  const spit = mounted.find(part => part.profile === 5); assert.equal(spit?.id, 'spit'); assert.equal(spit?.name, 'Spit Synth');
  const row = live.children.find(node => node.dataset.voice === 'spit'); assert(row);
  assert.equal(row.children[0].title, 'Prepared sampled voice'); assert.equal(context.rotationControls.length, 0);
});

test('saved tambourine settings recover from damaged data and keep the shake layers ordered', () => {
  assert.equal(normalizeTambourineTuning({ shake: 14.2, hardShake: 8 }).hardShake, 15);
  assert.equal(normalizeTambourineTuning({ angularBrake: Infinity }).angularBrake, 1000);
  assert.equal(normalizeTambourineTuning({ hitsEnabled: false, minimumIntervalMs: '20' }).minimumIntervalMs, 0);
  assert.equal(normalizeTambourineTuning({ hardHitSpeed: 6 }).hardHitSpeed, 1.5);
  const older = normalizeTambourineTuning({ hardShake: 17, minimumIntervalMs: 85 });
  assert.equal(older.hardShake, 17);
  assert.equal(older.minimumIntervalMs, 0);
  assert.equal(older.hitsEnabled, false);
  const optedIn = normalizeTambourineTuning({ hitsEnabled: true, minimumIntervalMs: 85 });
  assert.equal(optedIn.minimumIntervalMs, 85);
  assert.equal(optedIn.hitsEnabled, true);
});
