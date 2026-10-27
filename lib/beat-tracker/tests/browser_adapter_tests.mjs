import { NativePerformance } from '../../performance/wasm-performance.ts';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const wasm = fs.readFileSync(new URL('../dist/beat-tracker.wasm', import.meta.url));
const workletCode = fs.readFileSync(new URL('../../../ui/practice/runtime/beat-worklet.js', import.meta.url), 'utf8');
const adapterCode = fs.readFileSync(new URL('../../../ui/practice/runtime/beat-tracker.js', import.meta.url), 'utf8');
globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => wasm });
class Context extends EventTarget {
 constructor() { super(); this.state = 'suspended'; this.sampleRate = 48000; this.audioFrame = 24000; this.audioWorklet = { addModule: async () => {} }; this.destination = {}; }
 get currentTime() { return this.audioFrame / this.sampleRate; }
 async resume() { if (this.state !== 'running') { this.state = 'running'; queueMicrotask(() => this.dispatchEvent(new Event('statechange'))); } }
 async close() { this.state = 'closed'; }
 createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
}
globalThis.AudioContext = Context;
globalThis.AudioWorkletNode = class {
 constructor(context, name, options) {
  this.context = context;
  this.port = { onmessage: null, postMessage: message => queueMicrotask(() => this.processor.receive(message)) };
  let Processor;
  const node = this;
  this.sandbox = { currentFrame: context.audioFrame, sampleRate: context.sampleRate, WebAssembly, NativePerformance, Float32Array, Float64Array, DataView,
   AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => queueMicrotask(() => node.port.onmessage?.({data: message})) }; } },
   registerProcessor: (name, implementation) => { Processor = implementation; } };
  vm.createContext(this.sandbox);
  vm.runInContext(workletCode.replace(/^import .*;\n/gm, '').replace('export class BeatProcessor', 'class BeatProcessor'), this.sandbox);
  this.processor = new Processor(options);
 }
 connect() { queueMicrotask(() => { this.processor.process([[]], [[new Float32Array(128)]]); this.context.audioFrame += 128; }); }
 disconnect() {}
};
const { BeatTracker } = await import('data:text/javascript;base64,' + Buffer.from(adapterCode).toString('base64'));

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const turn = () => new Promise(resolve => setImmediate(resolve));
const promptly = async promise => {
 let timer;
 try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Start did not settle after cancellation')), 100); })]); }
 finally { clearTimeout(timer); }
};
const unhandled = [];
process.on('unhandledRejection', error => unhandled.push(error));
const media = () => {
 const track = { stops: 0, stop() { this.stops++; }, getSettings: () => ({ sampleRate: 48000 }), muted: false };
 return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } };
};
const setup = async () => {
 const context = new Context();
 const tracker = await BeatTracker.create({ audioContext: context, startingBpm: 100, workletUrl: 'test', wasmUrl: 'test' });
 await tracker.setManualBpm(100);
 const resumed = deferred();
 const requested = deferred();
 context.state = 'suspended';
 context.resume = () => resumed.promise;
 Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: constraints => {
  assert.deepEqual(constraints, { audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } }, 'capture uses the browser default without an exact device ID');
  return requested.promise;
 } } } });
 return {tracker, context, resumed, requested};
};

{
 const tracker = await BeatTracker.create({ audioContext: new Context(), workletUrl: 'test', wasmUrl: 'test' });
 assert.equal(tracker.snapshot().clickEnabled, false, 'click defaults off');
 let published;
 const unsubscribe = tracker.subscribe(state => { published = state; });
 assert.equal((await tracker.setClickEnabled(true)).clickEnabled, true, 'click setting resolves after worklet acknowledgment');
 assert.equal(published.clickEnabled, true, 'click setting reaches subscribers');
 await tracker.reset({ startingBpm: 120 });
 assert.equal(tracker.snapshot().clickEnabled, true, 'reset retains the click preference');
 assert.equal((await tracker.setClickEnabled(false)).clickEnabled, false);
 await assert.rejects(tracker.setClickEnabled('true'), /boolean/);
 unsubscribe();
 await tracker.dispose();
 await assert.rejects(tracker.setClickEnabled(true), /not available/);
}

// Keep resume unresolved: cancellation must release capture and settle the start on its own.
for (const action of ['stop', 'dispose', 'fault']) {
 for (const grantedFirst of [true, false]) {
  const {tracker, context, resumed, requested} = await setup();
  const granted = media();
  const capture = tracker.startListening();
  if (grantedFirst) { requested.resolve(granted.stream); await turn(); }
  if (action === 'stop') await tracker.stopListening();
  else if (action === 'dispose') await tracker.dispose();
  else tracker.fault('test processor fault');
  await promptly(capture);
  if (!grantedFirst) { requested.resolve(granted.stream); await turn(); }
  assert.equal(granted.track.stops, 1, `${action} releases permission ${grantedFirst ? 'already' : 'later'} granted`);
  assert.equal(tracker.snapshot().source.kind, 'off');
  assert.equal(context.state, 'suspended', 'borrowed context is not closed or resumed by cancellation');
  resumed.resolve();
  await turn();
  assert.equal(granted.track.stops, 1, 'late resume cannot stop a track twice');
  await tracker.dispose();
 }
}

// Either failure settles promptly and releases tracks without waiting for the other promise.
for (const failure of ['permission', 'resume-before-permission', 'resume-after-permission']) {
 const {tracker, resumed, requested} = await setup();
 const granted = media();
 const capture = tracker.startListening();
 const rejected = assert.rejects(promptly(capture), /denied/);
 if (failure === 'resume-after-permission') { requested.resolve(granted.stream); await turn(); }
 if (failure === 'permission') requested.reject(new Error('permission denied'));
 else resumed.reject(new Error('resume denied'));
 await rejected;
 assert.equal(tracker.snapshot().source.kind, 'off');
 if (failure === 'resume-before-permission') { requested.resolve(granted.stream); await turn(); }
 if (failure !== 'permission') assert.equal(granted.track.stops, 1);
 // A second rejection arriving after failure or cancellation is still observed.
 if (failure === 'permission') resumed.reject(new Error('late resume denied'));
 await turn();
 await tracker.dispose();
}

// Replacing an unfinished request cannot let its late stream overwrite the new microphone.
{
 const {tracker, context, resumed, requested} = await setup();
 const old = media();
 const current = media();
 const first = tracker.startListening();
 await tracker.stopListening();
 await promptly(first);
 context.resume = async () => {};
 navigator.mediaDevices.getUserMedia = async () => current.stream;
 await tracker.startListening();
 requested.resolve(old.stream);
 await turn();
 assert.equal(old.track.stops, 1);
 assert.equal(current.track.stops, 0);
 assert.equal(tracker.snapshot().source.kind, 'microphone');
 assert.equal(tracker.snapshot().mode, 'manual');
 assert.equal(tracker.snapshot().bpm, 100);
 resumed.reject(new Error('superseded resume denied'));
 await turn();
 await tracker.stopListening();
 assert.equal(current.track.stops, 1);
 assert.equal(tracker.snapshot().mode, 'manual');
 assert.equal(tracker.snapshot().bpm, 100);
 await tracker.dispose();
}
await turn();
assert.deepEqual(unhandled, [], 'permission and resume promises have rejection handlers immediately');
console.log('PASS browser adapter with real WASM and mocked browser scheduling: acknowledged click preference and reset persistence, pending-resume Stop/Dispose/fault before and after permission, exact track release, prompt cancellation, both rejection orders, superseded starts, borrowed context ownership, persistent Manual clock');
