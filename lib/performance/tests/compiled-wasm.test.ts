import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compiledCaptureFixture as fixture } from './fixtures/compiled-capture.js';
import { encodeCompiledProgram, compiledProgramBytes } from '../compiled-native.js';
import { NativePerformance } from '../wasm-performance.js';
import { PF } from '../wasm-abi.js';
import { frozenCutoverMusicXml } from '../../../scripts/verify-musicxml-cutover.js';
import { readMusicXmlSong } from '../musicxml-song.js';
import { PF as LIGHT } from '../light-abi.js';

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
function engine(program: readonly number[], rate = 8000, initialVoiceEffects?: Parameters<NativePerformance['prepareVoiceEffects']>[0]) {
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write(_fd: number, _vectors: number, _count: number, written: number) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; }, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); } } });
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) throw new Error('Missing WASM memory');
  memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  const native = new NativePerformance({ api: instance.exports, sampleRate: rate, mode: PF.PRACTICE, compiledProgram: program, clickGain: 0, initialVoiceEffects });
  native.setJiggleThresholds(1, 1);
  return native;
}
function render(native: NativePerformance, frames: number, value: number | ((frame: number) => number) = .25) {
  const begin = native.processedFrames;
  const input = Float32Array.from({ length: frames }, (_, index) => typeof value === 'number' ? value : value(begin + index));
  const mixed = [new Float32Array(frames), new Float32Array(frames)];
  const live = [new Float32Array(frames), new Float32Array(frames)];
  native.process(input, mixed, frames, live);
  return { mixed, live, events: native.events() };
}
function until(native: NativePerformance, bar: number, beat = 1, input = .25, chunk = 64) {
  for (let attempts = 0; attempts * chunk < 640000; attempts++) {
    const state = native.state();
    if (state.bar === bar && state.beat === beat && state.phase === 'playing') return;
    render(native, chunk, input);
  }
  throw new Error(`Did not reach ${bar}:${beat}`);
}

test('compiled artifact drives effected WASM capture, crb handoff, layer autoplay, fractional stop, and both download stems', async () => {
  const song = await fixture();
  assert(song.executable);
  const native = engine(Array.from(encodeCompiledProgram(song)));
  try {
    native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
    assert.equal(native.liveEffects().captureSupported, true);
    native.setMicrophone(true);
    native.start({ runId: 'joint-fixture', bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
    native.control({ id: 'R1' }, 'arm');
    assert.equal(native.compiledTake(0).frames, 0, 'arming switches the route without capturing early audio');
    until(native, 1);
    native.control({ id: 'R1' }, 'commit-arm');
    until(native, 2);
    assert.equal(native.compiledTake(0).frames, 16000);
    assert.equal(native.compiledTake(0).revision, 1);
    assert.equal(native.compiledTake(0).ready, true);
    assert.equal(native.state().channels.find(channel => channel.id === 'R1')?.status, 'recording');
    native.control({ id: 'R1' }, 'commit');
    until(native, 3);
    assert.equal(native.compiledTake(1).frames, 16000);
    const output = render(native, 128);
    const takeState = native.state().compiledTakes;
    assert(takeState);
    assert.equal(takeState.length, song.takes.length);
    assert.deepEqual(takeState.slice(0, 2).map(take => ({ index: take.index, ready: take.ready, playback: take.playback })),
      [{ index: 0, ready: true, playback: 'playing' }, { index: 1, ready: true, playback: 'playing' }]);
    assert(output.events.every(event => event.state.compiledTakes === undefined), 'historical events cannot inherit current take readback');
    assert(output.mixed[0].every(sample => Math.abs(sample - .625) < 1e-6), 'both processed takes autoplay as layers');
    assert(output.live[0].every(sample => Math.abs(sample - .25) < 1e-6), 'the restored default route warms from its own cold delay; capture history belongs to playback');
    assert.deepEqual(output.mixed[0], output.mixed[1]);
    assert.deepEqual(output.live[0], output.live[1]);
    assert(output.mixed[0].every((sample, index) => Math.abs(sample + output.live[0][index] - .875) < 1e-6), 'download mix contains each route once without a duplicated capture tail');
    const warm = render(native, 800);
    assert(warm.live[0].slice(-128).every(sample => Math.abs(sample - .3125) < 1e-6));
    until(native, 3, 4);
    native.control({ id: 'R1' }, 'fractional-stop');
    const pendingLight = native.state().channels.find(channel => channel.id === 'R1')?.light;
    assert(pendingLight?.kind === 'releasing' && pendingLight.remainingMs > 0);
    const clock = Array.from(native.query('pf_snapshot'));
    const target = Math.round(clock[PF.CLOCK_BEAT_FRAME] + 1000);
    const remaining = target - native.processedFrames;
    const stopped = render(native, remaining + 1);
    assert(Math.abs(stopped.mixed[0][remaining - 1] - .625) < 1e-6);
    assert(Math.abs(stopped.mixed[0][remaining] - .125) < 1e-6);
    const tailLight = native.state().channels.find(channel => channel.id === 'R1')?.light;
    assert(tailLight?.kind === 'releasing' && tailLight.remainingMs > 0, 'audible release retains native light feedback');
    const released = render(native, 800);
    assert.equal(released.mixed[0][799], 0);
    assert.equal(native.state().channels.find(channel => channel.id === 'R1')?.light.kind, 'off');
    assert(stopped.events.some(event => event.type === 'state' && event.frame === target), 'fractional action publishes its effective source frame');
    native.stop();
    const silent = render(native, 1000);
    assert([...silent.live, ...silent.mixed].every(channel => channel.every(sample => sample === 0)));
  } finally { native.dispose(); }
});

test('WASM loop history evolves from original source, never a second effects pass on printed PCM', async () => {
  const song = await fixture();
  const native = engine(Array.from(encodeCompiledProgram(song)));
  try {
    native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
    native.setMicrophone(true);
    native.start({ runId: 'evolving', bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
    native.control({ id: 'R1' });
    until(native, 1, 1, 0);
    const captureStart = native.processedFrames - native.compiledTake(0).frames;
    native.control({ id: 'R1' });
    const commitFrame = captureStart + 16000;
    const output = render(native, commitFrame - native.processedFrames + 32000 + 801, frame => frame === captureStart + 2000 || frame === commitFrame - 1 ? 1 : 0);
    const playbackStart = commitFrame - (native.processedFrames - output.mixed[0].length);
    assert.equal(output.mixed[0][playbackStart + 799], .25, 'first loop continues the actual capture-end history');
    assert.equal(output.live[0][playbackStart + 799], 0, 'the transferred capture history is not emitted again by the new live/capture epoch');
    assert.equal(output.mixed[0][playbackStart + 16000 + 799], .25, 'second loop retains the preceding iteration tail');
    assert.equal(output.mixed[0][playbackStart + 2800], .25);
    assert.equal(output.mixed[0][playbackStart + 3600], 0, 'printed wet PCM is not processed through the stack again');
    assert(output.mixed[0].every(Number.isFinite));
  } finally { native.dispose(); }
});

test('native byte artifact and failed replacement preserve an existing prepared program', async () => {
  const song = await fixture();
  const native = engine(Array.from(encodeCompiledProgram(song)), 48000);
  try {
    const bytes = compiledProgramBytes(song);
    const pointer = native.call('malloc', bytes.byteLength);
    try {
      new Uint8Array(native.memory.buffer, pointer, bytes.length).set(bytes);
      native.call('pf_load_compiled_bytes', native.handle, pointer, bytes.length);
      const state = native.state();
      const immediateLeadIn = Array.from(encodeCompiledProgram(song));
      immediateLeadIn[PF.COMPILED_HEADER_FIELDS + song.takes.length * PF.COMPILED_TAKE_FIELDS + 5] = 0;
      assert.throws(() => native.configureCompiled(immediateLeadIn), /compiled|program/i);
      assert.equal(native.state().endBar, state.endBar);
      new Uint8Array(native.memory.buffer, pointer, 8).fill(0);
      assert.throws(() => native.call('pf_load_compiled_bytes', native.handle, pointer, bytes.length), /compiled|program/i);
      assert.equal(native.state().endBar, state.endBar);
      native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: .2, wet: .25 }]);
      assert.equal(native.liveEffects().captureSupported, true);
      assert.equal(native.memory.buffer.byteLength, 268435456);
    } finally { native.invoke('free', pointer); }
  } finally { native.dispose(); }
});

test('a tempo input before Start cannot replace the configured tempo with an unstarted clock value', async () => {
  const native = engine(Array.from(encodeCompiledProgram(await fixture())));
  try {
    assert.throws(() => native.control({ id: 'tempo' }), /active practice|tempo hit/i);
    assert.equal(native.state().bpm, 120);
    assert.equal(native.tempoHitInfo().count, 0);
  } finally { native.dispose(); }
});

test('stopped identical effect preparation refreshes reusable banks after a venue edit', async () => {
  const native = engine(Array.from(encodeCompiledProgram(await fixture())));
  const first = [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }] satisfies Parameters<NativePerformance['prepareLiveEffects']>[0];
  const second = [{ kind: 'slapback', delayMs: 150, feedback: 0, wet: .5 }] satisfies Parameters<NativePerformance['prepareLiveEffects']>[0];
  function capture(run: number) {
    native.setMicrophone(true);
    native.start({ runId: `recapture-${run}`, bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
    native.control({ id: 'R1' });
    until(native, 1);
    native.control({ id: 'R1' });
    until(native, 2);
    native.control({ id: 'R1' });
    until(native, 3);
    native.stop();
  }
  try {
    native.prepareLiveEffects(first);
    capture(0);
    native.prepareLiveEffects(second);
    assert.equal(native.compiledTake(0).revision, 1, 'the completed old take retains its graph');
    for (let run = 1; run <= 3; run++) {
      native.prepareLiveEffects(second);
      capture(run);
      assert.equal(native.compiledTake(0).revision, 2);
      assert.equal(native.compiledTake(1).revision, 2);
    }
  } finally { native.dispose(); }
});

test('stale venue bank rejects recapture nonfatally during transport until stopped preparation', async () => {
  const native = engine(Array.from(encodeCompiledProgram(await fixture({ inTransportRecapture: true }))));
  const edited = [{ kind: 'slapback', delayMs: 150, feedback: 0, wet: .5 }] satisfies Parameters<NativePerformance['prepareLiveEffects']>[0];
  function startAndCapture(runId: string) {
    native.setMicrophone(true);
    native.start({ runId, bpm: 120, countInBars: 0, startBar: 1, endBar: 4, loop: true });
    until(native, 1, 1, .25, 1);
    native.control({ id: 'R1' });
    until(native, 2, 1, .25, 1);
    native.control({ id: 'R1' });
  }
  try {
    native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
    startAndCapture('old-venue');
    native.stop();
    native.prepareLiveEffects(edited);
    startAndCapture('new-venue');
    until(native, 4, 4);
    const untilWrap = render(native, 4000);
    assert(untilWrap.events.some(event => event.type === 'control' && /No reusable take bank/.test(event.error ?? '')),
      'automatic recapture reports a stale bank without faulting the transport');
    assert.equal(native.state().bar, 1);
    const before = native.compiledTake(0);
    const channels = native.state().channels;
    native.control({ id: 'R1' });
    assert.deepEqual(native.compiledTake(0), before);
    assert.deepEqual(native.state().channels, channels);
    const output = render(native, 128);
    assert.equal(native.state().phase, 'playing');
    assert(output.mixed.every(channel => channel.every(sample => Math.abs(sample - .375) < 1e-6)));
    assert(output.live.every(channel => channel.every(sample => Math.abs(sample - .375) < 1e-6)));
    native.stop();
    native.prepareLiveEffects(edited);
    startAndCapture('refreshed');
    assert.equal(native.compiledTake(0).revision, 2);
  } finally { native.dispose(); }
});

test('independent native voice graphs survive equal-revision compiled loads and preserve untouched revisions', async () => {
  const song = await fixture();
  const program = Array.from(encodeCompiledProgram(song));
  const native = engine(program);
  try {
    const venue = Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [{ kind: 'slapback' as const, delayMs: 100, feedback: 0, wet: profile === 0 ? .5 : .25 }] }));
    const applied = native.prepareVoiceEffects(venue);
    assert(applied.every(profile => profile.revision === 1));
    for (let run = 0; run < 2; run++) {
      native.configureCompiled(program);
      native.setMicrophone(true);
      native.start({ runId: 'profile-load', bpm: 120, countInBars: 1, endBar: 4, loop: false });
      native.control({ id: 'R1' }); until(native, 1); native.control({ id: 'R1' }); until(native, 2);
      assert.equal(native.compiledTake(0).revision, 1);
      assert(render(native, 128).mixed[0].every(value => value === .375), 'pad capture and END playback use its actual .5 wet graph rather than equal-revision default .25');
      native.stop();
    }
    const before = native.voiceEffects();
    const retained = native.compiledTake(0);
    venue[0].effects[0].wet = .75;
    const updated = native.prepareVoiceEffects(venue);
    assert.equal(updated[0].revision, 2);
    assert.deepEqual(updated.slice(1), before.slice(1));
    assert.deepEqual(native.compiledTake(0), retained, 'retained take keeps its recorded stack revision');
    const invalid = venue.map(profile => ({ ...profile, effects: profile.effects.map(effect => ({ ...effect })) }));
    invalid[5].effects[0].delayMs = 999;
    assert.throws(() => native.prepareVoiceEffects(invalid), /Invalid slapback/);
    assert.deepEqual(native.voiceEffects(), updated);
  } finally { native.dispose(); }
});

test('real WASM backup graph follows relative rotation and native quarter-count inactivity release with ordered PCM and natural tails', () => {
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_LEGACY_VERSION, 4, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF.COMPILED_ROTATION_MAGIC, 2, .25, 1, 0, 1, 1, 2, 0, 3, 2];
  const native = engine(program);
  try {
    const backupEffects = [
      { kind: 'slapback' as const, delayMs: 40, feedback: 0, wet: .5 },
      { kind: 'chorus' as const, rateHz: 1, depthMs: 0, baseDelayMs: 10, wet: .25 },
    ];
    native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: profile === PF.BACKUP_PROFILE ? backupEffects : [] })));
    const backup = () => {
      const profile = native.voiceEffects().find(voice => voice.profile === PF.BACKUP_PROFILE);
      if (!profile) throw new Error('Missing backup profile');
      return profile;
    };
    assert.deepEqual(backup().effects, backupEffects);
    native.setMicrophone(true); native.start({ runId: 'rotation-graph', bpm: 120, countInBars: 0, endBar: 4, loop: false }); until(native, 1, 1, 0);
    native.control({ id: 'knob', value: -2 }, 'rotation/1');
    assert.equal(backup().activity, 'live');
    const boundary = native.processedFrames + 1000;
    assert(Math.abs(native.processedFrames + backup().rotationRemainingBeats * 4000 - boundary) < 1e-6);
    const first = render(native, 1, 1), response = render(native, 400, 0);
    assert.equal(first.live[0][0], 1);
    const expected = new Float32Array(400); expected[79] = .25; expected[319] = .5; expected[399] = .125;
    assert.deepEqual(response.live[0], expected);
    assert.deepEqual(response.live[0], response.live[1], 'centered mono remains centered through serial Slapback and Chorus');
    render(native, Math.ceil(boundary) - native.processedFrames - 1, 0); assert.equal(backup().activity, 'live');
    render(native, 1, 1); assert.notEqual(backup().activity, 'live');
    const tail = render(native, 401, 0);
    assert.deepEqual(tail.live[0].slice(0, 400), expected);
    assert.equal(tail.live[0][400], 0);
    assert.equal(backup().activity, 'standby');
    until(native, 1, 2, 0); native.events();
    const observedFrame = native.processedFrames;
    native.control({ id: 'knob', value: -3 }, 'rotation/2');
    const observation = native.events().find(event => event.type === 'control');
    assert.equal(observation?.frame, observedFrame); assert.equal(observation?.sampleRate, 8000);
    assert.deepEqual(observation?.control, { id: 'knob', value: -3 }); assert.equal(observation?.applied, true);
    assert.equal(observation?.commandId, 'rotation/2');
    assert.equal(backup().rotationEligible, false); assert.notEqual(backup().activity, 'live');
    until(native, 2, 1, 0); native.control({ id: 'knob', value: 2 }, 'rotation/3'); render(native, 500, 0);
    const before = backup().rotationRemainingBeats;
    native.control({ id: 'knob', value: 2 }, 'rotation/3'); native.control({ id: 'knob', value: 0 }, 'rotation/4');
    assert.equal(backup().rotationRemainingBeats, before, 'replayed producer command and zero delta do not extend the inactivity deadline');
    native.stop();
    assert.equal(backup().rotationRemainingBeats, 0);
    assert(render(native, 512, 1).live.every(channel => channel.every(value => value === 0)));
  } finally { native.dispose(); }
});

test('WASM rejects old grid packets instead of reinterpreting their duration field', () => {
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_LEGACY_VERSION, 4, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF.COMPILED_ROTATION_MAGIC, 1, .25, 1, 0, 4, 0];
  const native = engine(program);
  try {
    const before = native.state();
    for (const version of [3, 4, 5]) assert.throws(() => native.configureCompiled(program.map((field, index) => index === 1 ? version : field)), /compiled/i);
    assert.equal(native.state().phase, before.phase);
    assert.equal(native.state().startBar, before.startBar);
    assert.throws(() => new NativePerformance({
      api: { ...native.api, pf_abi_version: () => 5 }, sampleRate: 8000,
    }), /ABI mismatch/, 'the browser bridge rejects an old binary before creating another engine');
  } finally { native.dispose(); }
});

for (const rate of [44100, 48000]) for (const beats of [4, 6]) {
  test(`WASM full inactivity uses processed frames and fresh movement at the deadline (${rate} Hz, ${beats} counts)`, () => {
    const program = [PF.COMPILED_MAGIC, PF.COMPILED_LEGACY_VERSION, beats, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
      PF.COMPILED_ROTATION_MAGIC, 1, .25, 1, 0, 4, 0];
    const native = engine(program, rate);
    try {
      native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })));
      native.setMicrophone(true); native.start({ runId: `inactivity-${rate}-${beats}`, bpm: 120, countInBars: 0, endBar: 4, loop: false });
      const advanceTo = (frame: number) => render(native, frame - native.processedFrames, 0);
      advanceTo(Math.ceil(rate / 2) + 8);
      const anchor = native.query('pf_snapshot')[PF.CLOCK_BEAT_FRAME], framesPerBeat = rate / 2;
      const backup = () => native.voiceEffects()[PF.BACKUP_PROFILE];
      advanceTo(Math.ceil(anchor + .1 * framesPerBeat));
      native.control({ id: 'knob', value: 4 }, 'first');
      let deadline = native.processedFrames + backup().rotationRemainingBeats * framesPerBeat;
      assert(Math.abs(deadline - (native.processedFrames + .25 * framesPerBeat)) < 1e-6);
      advanceTo(Math.ceil(anchor + .2 * framesPerBeat));
      native.control({ id: 'knob', value: -2 }, 'second');
      const extended = native.processedFrames + backup().rotationRemainingBeats * framesPerBeat;
      assert(extended > deadline, 'continued motion extends to a full quarter-count after the latest report');
      deadline = extended;
      const boundary = Math.ceil(deadline);
      advanceTo(boundary - 1); assert.equal(backup().activity, 'live');
      advanceTo(boundary); assert.notEqual(backup().activity, 'live');
      native.control({ id: 'knob', value: -2 }, 'second');
      native.control({ id: 'knob', value: 0 }, 'zero');
      assert.notEqual(backup().activity, 'live', 'duplicate and zero cannot rearm expired rotation');
      native.control({ id: 'knob', value: -3 }, 'at-boundary');
      assert.equal(backup().activity, 'live');
      assert(Math.abs(native.processedFrames + backup().rotationRemainingBeats * framesPerBeat
        - (native.processedFrames + .25 * framesPerBeat)) < 1e-6, 'fresh movement starts a full inactivity duration');
      native.stop(); assert.equal(backup().rotationRemainingBeats, 0);
    } finally { native.dispose(); }
  });

  test(`WASM inactivity deadline follows a native tempo hit (${rate} Hz, ${beats} counts)`, () => {
    const program = [PF.COMPILED_MAGIC, PF.COMPILED_LEGACY_VERSION, beats, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
      PF.COMPILED_ROTATION_MAGIC, 1, .25, 1, 0, 4, 0];
    const native = engine(program, rate);
    try {
      native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })));
      native.setMicrophone(true); native.start({ runId: `inactivity-${rate}-${beats}`, bpm: 120, countInBars: 0, endBar: 4, loop: false });
      native.control({ id: 'tempo' }, 'tempo-first');
      const advanceTo = (frame: number) => render(native, frame - native.processedFrames, 0);
      advanceTo(Math.round(rate * .525)); native.control({ id: 'knob', value: 1 }, 'motion');
      advanceTo(Math.round(rate * .55));
      const backup = () => native.voiceEffects()[PF.BACKUP_PROFILE];
      const remaining = backup().rotationRemainingBeats;
      native.control({ id: 'tempo' }, 'tempo-second');
      assert(Math.abs(backup().rotationRemainingBeats - remaining) < 1e-9);
      const bpm = native.state().bpm;
      assert(bpm < 120 && bpm > 100);
      const deadline = Math.ceil(native.processedFrames + remaining * rate * 60 / bpm);
      advanceTo(Math.ceil(rate * .625)); assert.equal(backup().activity, 'live', 'old wall-clock deadline cannot stop the new tempo early');
      advanceTo(deadline - 1); assert.equal(backup().activity, 'live');
      advanceTo(deadline); assert.notEqual(backup().activity, 'live');
    } finally { native.dispose(); }
  });
}

test('historical DYC missing Bing Bong finish preserves its partial-bar capture and later playback', async () => {
  const { song: compiled } = await readMusicXmlSong(await frozenCutoverMusicXml());
  const song = { compiled, chart: compiled.chart };
  assert(song.compiled?.executable);
  const program = Array.from(encodeCompiledProgram(song.compiled));
  for (const rate of [44100, 48000]) {
    const dry = Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] }));
    const manual = engine(program, rate, dry);
    const automatic = engine(program, rate, dry);
    const framesPerCount = rate * 60 / song.chart.bpm;
    const plan = song.compiled.cues.filter(cue => cue.bar <= 13).map(cue => ({
      frame: cue.bar === 0 ? 1 : Math.ceil((5 + (cue.bar - 1) * 4 + (cue.cueBeat ?? 0)) * framesPerCount) + 1,
      cue,
    }));
    let next = 0;
    try {
      for (const native of [manual, automatic]) {
        native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })));
        native.setMicrophone(true);
        native.start({ runId: 'dyc-endpoint', bpm: song.chart.bpm, countInBars: 1, startBar: 1, endBar: 14, loop: false });
      }
      const end = Math.ceil(58 * framesPerCount);
      for (let frame = 0; frame < end;) {
        while (next < plan.length && plan[next].frame === frame) {
          const { cue } = plan[next++];
          manual.control({ id: cue.buttonId });
          if (cue.source.a1 !== 'J21') automatic.control({ id: cue.buttonId });
        }
        const count = Math.min(128, end - frame, next < plan.length ? plan[next].frame - frame : 128);
        const source = (position: number) => Math.sin(position * .017) * .2;
        const written = render(manual, count, source);
        const missed = render(automatic, count, source);
        assert.deepEqual(missed.mixed, written.mixed, `${rate} Hz sample output preserves both layers after missed J21`);
        assert.deepEqual(missed.live, written.live, `${rate} Hz live routing preserves the written END handoff`);
        assert(!missed.events.some(event => event.type === 'fault'), 'missing a finish never faults the transport');
        frame += count;
      }
      const bingIndex = song.compiled.takes.findIndex(take => take.voiceId === 'bing-bong' && take.begin.bar === 7);
      assert(bingIndex >= 0);
      const bing = automatic.compiledTake(bingIndex);
      assert.equal(bing.ready, true);
      assert(Math.abs(bing.frames - 6 * framesPerCount) <= 1, 'source capture ends at bar 8 beat 3');
      assert.equal(bing.period, Math.ceil(8 * framesPerCount), 'two silent-source counts complete the original two-bar phrase');
      assert.equal(automatic.state().phase, 'playing', 'the original bar 10 beat 3 failure point is safely passed');
      assert.equal(automatic.state().error, null);
      assert.equal(automatic.state().recording, null, 'all authorized cowbell bars also finish before later playback');
    } finally { manual.dispose(); automatic.dispose(); }
  }
});

test('historical DYC short practice loops discard unfinished source spans instead of overflowing across wraps', async () => {
  const { song: compiled } = await readMusicXmlSong(await frozenCutoverMusicXml());
  const song = { compiled, chart: compiled.chart };
  assert(song.compiled?.executable);
  for (const endBar of [1, 7]) {
    const rate = 8000;
    const native = engine(Array.from(encodeCompiledProgram(song.compiled)), rate);
    const framesPerCount = rate * 60 / song.chart.bpm;
    const cells = endBar === 1 ? ['B18'] : ['B18', 'D18', 'F18', 'F21', 'H21'];
    const plan = song.compiled.cues.filter(cue => cells.includes(cue.source.a1)).map(cue => ({
      frame: cue.bar === 0 ? 1 : Math.ceil((5 + (cue.bar - 1) * 4 + (cue.cueBeat ?? 0)) * framesPerCount) + 1,
      cue,
    }));
    let next = 0;
    try {
      native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })));
      native.setMicrophone(true);
      native.start({ runId: `short-loop-${endBar}`, bpm: song.chart.bpm, countInBars: 1, startBar: 1, endBar, loop: true });
      for (let frame = 0; frame < rate * 35;) {
        while (next < plan.length && plan[next].frame === frame) native.control({ id: plan[next++].cue.buttonId });
        const count = Math.min(128, next < plan.length ? plan[next].frame - frame : 128);
        const block = render(native, count);
        assert(!block.events.some(event => event.type === 'fault'), 'crossing a selected loop boundary cannot orphan capture');
        frame += count;
      }
      assert.equal(native.state().phase, 'playing');
      assert.equal(native.state().error, null);
      const unfinished = song.compiled.takes.findIndex(take => endBar === 1
        ? take.voiceId === 'drums-claps' && take.begin.bar === 1
        : take.voiceId === 'bing-bong' && take.begin.bar === 7);
      assert(unfinished >= 0);
      assert.equal(native.compiledTake(unfinished).ready, false, 'incomplete prefix never becomes a published take');
      if (endBar === 7) {
        const earlier = song.compiled.takes.findIndex(take => take.voiceId === 'bing-bong' && take.begin.bar === 5);
        assert(earlier >= 0);
        assert(native.compiledTake(earlier).ready, 'earlier complete Bing Bong layer survives the truncated replacement');
      }
    } finally { native.dispose(); }
  }
});


for (const rate of [44100, 48000]) test(`WASM cue button edges and engine light publications (${rate} Hz)`, async () => {
  const song = await fixture();
  const native = engine(Array.from(encodeCompiledProgram(song)), rate);
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.start({ runId: 'one-button', bpm: 120, countInBars: 1, endBar: 4, loop: false });
    const brightness = () => native.lightOutput()[LIGHT.LIGHT_SAMPLES + LIGHT.LIGHT_SAMPLE_LEVEL];
    native.control({ id: 'cueButton', value: 1 }, 'down-arm');
    assert.equal(brightness(), 1);
    native.control({ id: 'cueButton', value: 0 }, 'up-arm');
    until(native, 1, 1, .25, 64);
    assert(native.state().channels.some(channel => channel.status === 'recording'));
    const image = native.lightOutput(); assert.deepEqual(native.lightOutput(), image);
    render(native, Math.round(rate / 8)); assert(brightness() > .34 && brightness() < .36);
    native.control({ id: 'cueButton', value: 1 }, 'down-commit-arm');
    native.control({ id: 'cueButton', value: 1 }, 'repeat');
    assert.equal(brightness(), 1);
    native.control({ id: 'cueButton', value: 0 }, 'up-commit-arm');
    render(native, Math.round(rate / 8)); assert(brightness() < .01, 'queued commit-arm does not hide actual ongoing recording from LED');
    until(native, 2, 1, .25, 64);
    assert.equal(native.compiledTake(0).ready, true);
    render(native, Math.round(rate / 8)); assert(brightness() > .34 && brightness() < .36, 'recording pulse overrides playing');
    native.control({ id: 'cueButton', value: 1 }, 'down-commit');
    native.control({ id: 'cueButton', value: 0 }, 'up-commit');
    until(native, 3, 1, .25, 64); assert.equal(brightness(), .7);
    const clock = Array.from(native.query('pf_snapshot'));
    const publication = native.lightOutput();
    assert.equal(publication[LIGHT.LIGHT_FRAME], clock[PF.FRAME]);
    assert.equal(publication[LIGHT.LIGHT_RUNNING], 1);
    until(native, 4, 1, .25, 64);
    native.control({ id: 'cueButton', value: 1 }, 'down-play');
    const accepted = native.events().findLast(event => event.control?.id === 'cueButton');
    assert.deepEqual(accepted?.control, { id: 'cueButton', value: 1 });
    native.control({ id: 'mushroom' }, 'panic'); assert.equal(brightness(), 0);
    native.control({ id: 'cueButton', value: 0 }, 'disconnect-release'); assert.equal(brightness(), 0);
    assert.throws(() => native.control({ id: 'cueButton', value: 1 }, 'disconnect-release'), /already used/i);
  } finally { native.dispose(); }
});

for (const rate of [44100, 48000]) for (const beats of [4, 6]) {
  test(`WASM jiggle ignores isolated tiny movement and confirms small reversal (${rate} Hz, ${beats} counts)`, () => {
    const program = [PF.COMPILED_MAGIC, PF.COMPILED_LEGACY_VERSION, beats, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
      PF.COMPILED_ROTATION_MAGIC, 1, .25, 1, 0, 4, 0];
    const native = engine(program, rate);
    try {
      native.setJiggleThresholds(4, 2);
      for (const [travel, reversal] of [[0, 1], [4, 5], [1.5, 1], [32768, 2]])
        assert.throws(() => native.setJiggleThresholds(travel, reversal), /integer travel/i);
      native.setMicrophone(true); native.start({ runId: 'filtered-jiggle', bpm: 120, countInBars: 0, endBar: 4, loop: false });
      until(native, 1, 1, 0, 64);
      assert.throws(() => native.setJiggleThresholds(1, 1), /stop transport/i);
      const origin = native.processedFrames, framesPerCount = rate / 2;
      const backup = () => native.voiceEffects()[PF.BACKUP_PROFILE];
      const move = (value: number, count: number, id = `motion-${count}`) => {
        render(native, origin + Math.round(count * framesPerCount) - native.processedFrames, 0);
        native.control({ id: 'knob', value }, id);
      };
      for (const count of [.01, .14, .27, .4]) {
        move(1, count); assert.equal(backup().rotationRemainingBeats, 0, 'long sparse trickle expires in bounded buckets');
      }
      move(4, .5, 'significant'); assert(Math.abs(backup().rotationRemainingBeats - .25) < 1e-9);
      move(1, .6); assert(backup().rotationRemainingBeats < .151, 'tiny forward movement does not refresh');
      move(-1, .62); assert(backup().rotationRemainingBeats < .131, 'one tiny reversal does not refresh');
      assert.deepEqual(native.events().findLast(event => event.control?.id === 'knob')?.control, { id: 'knob', value: -1 }, 'ignored movement remains a signed source observation');
      move(1, .63); move(-1, .65);
      assert(Math.abs(backup().rotationRemainingBeats - .25) < 1e-9, 'two reverse counts confirm small reversal');
      move(0, .8); const remaining = backup().rotationRemainingBeats;
      native.control({ id: 'knob', value: 4 }, 'significant');
      assert.equal(backup().rotationRemainingBeats, remaining, 'replayed raw command cannot accumulate new travel');
      move(0, .901); assert.equal(backup().rotationRemainingBeats, 0);
      native.stop(); assert.equal(backup().rotationRemainingBeats, 0);
    } finally { native.dispose(); }
  });
}

for (const rate of [44100, 48000]) for (const beats of [4, 6]) {
  test(`WASM physical cue warnings use authored counts and accepted state (${rate} Hz, ${beats} counts)`, () => {
    const program = [PF.COMPILED_MAGIC, PF.COMPILED_LEGACY_VERSION, beats, 3, 120, 3, 25, 25, 0, 2, 0, 0, 0, 1, 2, 3,
      0, 0, 1, -1, PF.STOP, 1, 0, -1, -1, -1, 0,
      0, 0, 2, 0, PF.STOP, 0, 0, -1, -1, -1, 0];
    const native = engine(program, rate);
    const brightness = () => native.lightOutput()[LIGHT.LIGHT_SAMPLES + LIGHT.LIGHT_SAMPLE_LEVEL];
    try {
      native.start({ runId: 'cue-warning', bpm: 120, countInBars: 1, endBar: 3, loop: false });
      until(native, 1);
      assert(brightness() > .699, 'full-bar cue starts pulsing within its authored bar');
      native.control({ id: 'cueButton', value: 1 }); assert.equal(brightness(), 1);
      native.control({ id: 'cueButton', value: 0 }); assert.equal(brightness(), 0, 'accepted queued cue clears warning');
      until(native, 1, beats - 2);
      const clock = native.query('pf_snapshot');
      const boundary = clock[PF.CLOCK_BEAT_FRAME] + rate / 2;
      render(native, Math.round(boundary - native.processedFrames) - 1);
      assert.equal(brightness(), 0, 'timed cue is dark before its two-count lead');
      render(native, 2); assert(brightness() > .699, 'timed warning starts two chart counts before cue');
      render(native, rate / 8); assert(brightness() > .34 && brightness() < .36, 'warning uses native beat phase');
      until(native, 2); render(native, 1);
      assert.equal(brightness(), 0, 'unpressed timed warning ends at the authored cue');
      native.stop(); assert.equal(brightness(), 0);
    } finally { native.dispose(); }
  });
}

for (const rate of [44100, 48000]) for (const beats of [4, 6]) {
  test(`WASM jiggle reconnect preserves accumulated movement and native time (${rate} Hz, ${beats} counts)`, () => {
    const program = [PF.COMPILED_MAGIC, PF.COMPILED_LEGACY_VERSION, beats, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
      PF.COMPILED_ROTATION_MAGIC, 1, .25, 1, 0, 4, 0];
    const native = engine(program, rate);
    const backup = () => native.voiceEffects()[PF.BACKUP_PROFILE];
    try {
      native.setJiggleThresholds(4, 2); native.setMicrophone(true);
      native.start({ runId: 'jiggle-reconnect', bpm: 120, countInBars: 0, endBar: 4, loop: false });
      until(native, 1, 1, 0, 64);
      native.control({ id: 'knob', value: 2 }); assert.equal(backup().rotationRemainingBeats, 0);
      const before = Array.from(native.query('pf_snapshot'));
      native.setJiggleThresholds(4, 2);
      assert.deepEqual(Array.from(native.query('pf_snapshot')), before, 'same-value reconnect preserves native clock');
      for (const [travel, reversal] of [[0, 1], [4, 5], [3.5, 2], [32768, 2], [4, NaN], [Infinity, 2]])
        assert.throws(() => native.setJiggleThresholds(travel, reversal), /integer travel/i);
      assert.throws(() => native.setJiggleThresholds(4, 1), /stop transport/i);
      native.setJiggleThresholds(4, 2);
      assert.deepEqual(Array.from(native.query('pf_snapshot')), before, 'rejected changes do not alter transport');
      native.control({ id: 'knob', value: 2 }); assert.equal(backup().rotationRemainingBeats, .25, 'partial travel survives reconnect');
      render(native, Math.round(rate / 40), 0);
      const remaining = backup().rotationRemainingBeats, clock = Array.from(native.query('pf_snapshot'));
      native.setJiggleThresholds(4, 2);
      assert.equal(backup().rotationRemainingBeats, remaining, 'reconnect does not refresh active inactivity deadline');
      assert.deepEqual(Array.from(native.query('pf_snapshot')), clock);
      native.control({ id: 'knob', value: -1 }); native.setJiggleThresholds(4, 2);
      native.control({ id: 'knob', value: -1 });
      assert.equal(backup().rotationRemainingBeats, .25, 'partial reversal survives reconnect');
    } finally { native.dispose(); }
  });
}

test('a timed note takes precedence over a missed stop on the same pad', () => {
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 3, 120, 3, 25, 25, 0, 1, 0, 0, 0, 1, 2, 3,
    0, 0, 1, 0, PF.STOP, 0, 0, -1, -1, -1, 0, 0, 0, 0, -1, 0,
    PF.COMPILED_NOTES_MAGIC, 1, 0, 0, 2, 0, 25];
  const native = engine(program);
  try {
    native.prepareExternalSample(0, new Float32Array(64).fill(.25));
    for (const startBar of [1, 2]) {
      native.start({ runId: 'note-after-stop-' + startBar, bpm: 120, countInBars: 0, startBar, endBar: 3 });
      until(native, 2, 1, 0);
      native.control({ id: 'L1' });
      assert(render(native, 64, 0).mixed[0].every(value => value === .25));
      native.stop();
    }
  } finally { native.dispose(); }
});

test('Dance Yrself Clean resumes with completed samples and recovers earlier loops on a press', async () => {
  const { song } = await readMusicXmlSong(await readFile(new URL('../../../songs/dance-yrself-clean.musicxml', import.meta.url), 'utf8'));
  const native = engine(Array.from(encodeCompiledProgram(song)));
  const ready = () => song.takes.filter((_, index) => native.compiledTake(index).ready).map(take => take.voiceId);
  try {
    native.prepareLiveEffects([]);
    native.setMicrophone(true);
    native.start({ runId: 'missing-dyc-sample', bpm: 240, countInBars: 0, startBar: 69, endBar: 86 });
    until(native, 69);
    assert.throws(() => native.control({ id: 'R1' }), /Capture or load a sample/);
    native.stop();

    native.start({ runId: 'dyc-capture', bpm: 240, countInBars: 1, startBar: 1, endBar: 86 });
    until(native, 45, 1, .25, 256);
    until(native, 85, 2, .25, 256);
    native.stop();
    assert.deepEqual(ready(), ['whistle', 'bing-bong', 'drums-claps', 'cowbell', 'cowbell']);

    native.start({ runId: 'verse-b1', bpm: 240, countInBars: 0, startBar: 85, endBar: 93 });
    assert.deepEqual(ready(), ['whistle', 'bing-bong', 'drums-claps', 'cowbell', 'cowbell']);
    native.stop();

    native.start({ runId: 'chorus-a-redux', bpm: 240, countInBars: 0, startBar: 69, endBar: 86 });
    assert.deepEqual(ready(), ['whistle', 'bing-bong', 'drums-claps', 'cowbell']);
    assert.equal(native.compiledTake(4).frames, 0);
    until(native, 69, 1, 0);
    assert(render(native, 64, 0).mixed[0].every(value => value === 0));
    for (const id of ['L1', 'L2', 'R1', 'R2'] as const) native.control({ id });
    assert.deepEqual(native.state().compiledTakes?.map(take => take.playback), ['playing', 'playing', 'playing', 'playing', 'idle']);
    assert(render(native, 64, 0).mixed[0].some(value => Math.abs(value) > .1));
  } finally { native.dispose(); }
});

test('Drunk Girls keeps the word and guitar recordings and recaptures the reachable lead and day lines', async () => {
  const { song } = await readMusicXmlSong(await readFile(new URL('../../../songs/drunk-girls.musicxml', import.meta.url), 'utf8'));
  const native = engine(Array.from(encodeCompiledProgram(song)));
  const ready = () => song.takes.filter((_, index) => native.compiledTake(index).ready).map(take => take.sourceName);
  const raw = (frame: number) => .25 * Math.sin(2 * Math.PI * 220 * frame / 8000);
  function wordPair(id: 'L1' | 'R2', bar: number) {
    until(native, bar, 4, .25, 32);
    native.control({ id });
    render(native, 64, raw);
    native.releaseChannel(id);
    until(native, bar + 1, 1, .25, 32);
    native.control({ id });
    render(native, 64, raw);
    native.releaseChannel(id);
    render(native, 1000, raw);
    native.control({ id });
    native.releaseChannel(id);
  }
  try {
    native.prepareLiveEffects([]);
    native.setMicrophone(true);
    native.start({ runId: 'dg-capture', bpm: 240, countInBars: 0, startBar: 1, endBar: 124 });
    wordPair('R2', 13);
    wordPair('L1', 21);
    until(native, 75, 1, .25, 256);
    until(native, 121, 1, .25, 256);
    native.stop();
    assert.deepEqual(ready(), ['lead', 'day', 'd1', 'g', 'd2', 'b', 'guitar']);

    native.start({ runId: 'verse-words', bpm: 240, countInBars: 0, startBar: 74, endBar: 86 });
    until(native, 74);
    assert.deepEqual(ready(), ['lead', 'day', 'd1', 'g', 'd2', 'b', 'guitar']);
    native.control({ id: 'R2' });
    native.releaseChannel('R2');
    assert.equal(native.state().compiledTakes?.[3].playback, 'playing', 'the retained Girls word answers its later cue');
    assert(render(native, 64, 0).mixed[0].some(value => Math.abs(value) > .1));
    native.control({ id: 'L2' });
    assert.equal(native.state().compiledTakes?.[6].playback, 'playing', 'the guitar plays from the reached loop cue');
    until(native, 77, 4);
    native.control({ id: 'L1' });
    native.releaseChannel('L1');
    assert.equal(native.state().compiledTakes?.[4].playback, 'playing', 'the retained Drunk/Boys pair survives the restart');
    native.stop();

    native.start({ runId: 'chorus-2', bpm: 240, countInBars: 1, startBar: 98, endBar: 124 });
    assert.deepEqual(ready(), ['d1', 'g', 'd2', 'b', 'guitar']);
    until(native, 98, 1, .125);
    assert(native.compiledTake(0).frames > 0, 'lead pickup re-arms on the last count-in beat');
    until(native, 102, 2, .125);
    assert(native.compiledTake(0).ready);
    until(native, 121, 1, .125, 256);
    native.stop();
    assert.deepEqual(ready(), ['lead', 'day', 'd1', 'g', 'd2', 'b', 'guitar']);

    native.start({ runId: 'chorus-redux', bpm: 240, countInBars: 1, startBar: 114, endBar: 124 });
    assert.deepEqual(ready(), ['lead', 'd1', 'g', 'd2', 'b', 'guitar']);
    until(native, 114);
    native.control({ id: 'R1' });
    assert.equal(native.state().compiledTakes?.[0].playback, 'playing', 'lead is reusable after its last recording opportunity');
  } finally { native.dispose(); }
});
