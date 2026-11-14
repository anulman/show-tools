import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { sourceForVM } from '../../../scripts/source-for-vm.js';
import { enablePhoneMotion, type MotionReading, type MotionSurface } from '../phone-motion.js';
import tribulations from '../../../songs/tribulations.js';

class Node {
  children: Node[] = []; textContent = ''; disabled = false; type = ''; className = ''; id = ''; title = ''; hidden = false;
  dataset: Record<string, string> = {}; events = new Map<string, () => void>();
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
  const context = { song: tribulations, songGeneration: 1, switching: false, audio: undefined,
    phoneMotionAbort: undefined, crypto: { randomUUID: () => 'motion-fixture' }, AbortController,
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
  assert(group); const button = group.children[0]; assert(button.textContent.includes('tambourine'));
  button.events.get('click')?.(); await pending;
  assert(button.textContent.startsWith('Disable shake')); assert.equal(context.audio, undefined);
  vm.runInContext('audio = { control: (control, options) => { captured.push({ control, options }); return Promise.resolve(); } }', Object.assign(context, { captured: commands }));
  listener?.({ x: 12, y: 0, z: 0, time: 100, gravity: false });
  assert.equal(commands.length, 1); assert.equal(JSON.stringify(commands[0]), JSON.stringify({ control: { id: 'external', slot: 0 }, options: { commandId: 'phone-motion/motion-fixture/1' } }));
  context.songGeneration++;
  listener?.({ x: 0, y: 0, z: 0, time: 250, gravity: false });
  listener?.({ x: 12, y: 0, z: 0, time: 400, gravity: false });
  assert.equal(commands.length, 1); assert.equal(removed, 1); assert.equal(errors.length, 0);
});

test('actual source rows display Spit as its independent prepared voice rather than Backup Vocals', async () => {
  const source = await sourceForVM(new URL('../app.ts', import.meta.url));
  const live = new Node(), mounted: { id: string; profile: number; name: string }[] = [];
  const pads = new Map(['L1', 'L2', 'R1', 'R2'].map(id => [id, { button: new Node(), shell: new Node() }]));
  const context = { song: tribulations, pads, remote: false, HTMLElement: Node,
    voiceEffects: { reset() {}, mount(part: { id: string; profile: number; name: string }) { mounted.push(part); } },
    liveVoiceStates: new Map(), voiceAvatars: new Map(), rotationControls: [],
    voiceCatalog: { openProfile() {} }, requiredElement: () => new Node(), document: { createElement: () => new Node() },
    elements: { 'live-voices': live }, mountPhoneMotion() {} };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('function mountVoiceRows()'), source.indexOf('function mountPhoneMotion()')), context);
  vm.runInContext('mountVoiceRows()', context);
  const spit = mounted.find(part => part.profile === 5); assert.equal(spit?.id, 'spit'); assert.equal(spit?.name, 'Spit Synth');
  const row = live.children.find(node => node.dataset.voice === 'spit'); assert(row);
  assert.equal(row.children[0].title, 'Prepared sampled voice'); assert.equal(context.rotationControls.length, 0);
});
