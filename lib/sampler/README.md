# PCM sampler

The [practice desk](../../ui/practice/README.md) uses these engines inside its shared audio worklet. There is one browser audio session.

- `SampleEngine` mixes PCM voices, looping takes, extracted hit slices, channel gain, and mute.
- `SampleRecorder` captures mono microphone input, commits takes, and retains sparse patterns for later manual taps. Sparse hints provide expected frame positions and a search radius. Detected tails use the pre-hit noise floor.
- `AudioEndpoint` sends acknowledged commands over a MessagePort.
- `Sampler` attaches to an existing endpoint to decode and load audio files. Disposing it does not close its borrowed endpoint or AudioContext.

`ui/practice/audio.ts` owns microphone acquisition and recording output. `ui/practice/practice-worklet.ts` owns chart actions and musical timing. Samples begin empty and are recorded during practice. Commits start loops at the capture boundary.

Loop playback keeps the source speed. It does not stretch after a tempo change. Sparse captures render only extracted clips at the expected beat positions. Competing sources or a sudden noise change can still confuse detection.

Run `npm test` from the repository root after `npm run build`. Core PCM tests live under `lib/sampler/tests/`; practice integration tests render the real WASM clock.
