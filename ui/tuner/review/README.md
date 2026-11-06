# Review the tuner scene

The fixture consumes synthetic `TunerState` observations. It starts no audio and never confirms exercise progress. Production targets, spelling and pitch come from the shared native tuner. The panel owns telemetry, asset loading, sizing and cleanup.

Build the complete practice UI first, then add the fixture to that same `dist/` before importing it with the [managed preview runner](../../../docs/ui-manager.md):

```sh
npm run build
node --import tsx scripts/build-tuner-scene-review.ts
./show-tools ui preview --session tuner
```

Use the printed origin and snapshot ID to open `/__build/<snapshot-id>/tuner-scene/`. The standalone `--out-dir` artifact is not a complete managed practice build and cannot replace the full `dist/`. Select each synthetic observation and both aspects. `window.tunerSceneReview.render(name, aspect, timeSeconds)` seeks directly without retained animation state. `capture()` returns the native canvas PNG. The supplied time is explicit presentation time; this static scene does not invent a musical clock or decorative motion.

The painter uses native canvases of 320×180 and 240×180. At integer scale 4 these produce the provisional 1280×720 and 960×720 review frames. The dial geometry and source-ball scale stay identical across the pair. Native notch and label radii are 57 and 72 pixels. Targets span 225° through 495°, from 7:30 to 4:30 clockwise. Three decorative one-pixel dots divide each target interval, with one dot a quarter interval beyond each endpoint. Their muted color stays constant across pitch and exercise states. Eight targets produce 23 dots; thirteen targets produce 38. Smaller views use whole integer scale factors and center the canvas. Keep `image-rendering: pixelated` and avoid CSS stretching. Final delivery and CRT resolution remain unconfirmed.

Check idle, low/middle/high hits, unvoiced, out-of-scale, below/above-range, reference playback, off and chromatic states. A matched native MIDI note lights its own notch and a dimmer lower trail. Other states clear both. Reference playback and confirmed exercise steps do not light the live ring. The lower and upper tonic remain separate targets.

Verify actual browser captures at both aspects, including labels, transparent ball edges and native integer pixels. The ball export must have transparent corners. A Figma component's default white fill can survive a visually correct vector composition and box the sprite in the browser. The build gate and source test reject that failure.

Run the focused checks:

```sh
node --import tsx --test ui/tuner/tests/*.test.ts
npm run typecheck
```

`scene.ts` accepts an already decoded `BallAsset`. It owns no URLs, audio, subscription, timer, animation loop or resize observer. The product panel supplies the asset verified against `assets/video/tuner/manifest.json`; its build owns the offline URL. The isolated fixture copies its own verified bytes into `ui/tuner/assets/` under the build directory. It resolves that path relative to the review document, preserving any managed release prefix. Synthetic review does not establish microphone accuracy, shared-audio lifecycle behavior or physical CRT output.
