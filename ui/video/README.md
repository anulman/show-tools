# Review the Street cast

The Street studio displays Figma-derived character drawings as rigid, held sprites. A prepared visual score supplies every actor, placement, drawing and state change. The C++ sampler evaluates that score through the same WASM module used by the offline exporter.

Build without practice audio:

```sh
npm run build:video
```

Normalize the Video Agent's verified motion index and Street layout. The package root supplies the referenced assets and a copy of the exported background:

```sh
node --import tsx scripts/normalize-street-assets.ts /private/tmp/street-package assets/video/motion/dyc/catalog.json /private/tmp/street-layout.json street-background.png /private/tmp/street-assets.json
```

The command checks export receipts, file hashes, native dimensions, background identity, and the authored pivot anchors. It rejects unverified families. Prepare a private scene with the saved catalog, frozen worksheet, current song mapping, and that asset package:

```sh
node --import tsx scripts/prepare-street-preview.ts /private/tmp/catalog.json /private/tmp/source.json /private/tmp/mapping.json /private/tmp/street-assets.json /private/tmp/street-scene.json
```

The preparation command resolves the cast through `discoverSheetVoices` and `resolveVoice`. It rejects missing assignments and mismatched asset casts. Keep its inputs, prepared scene, and binding receipt outside Git. The supplied asset package records character geometry and Figma-derived drawings; it does not replace saved voice bindings.

Serve `dist/` on an isolated port. Make the prepared scene and its referenced assets available to that server, then open `/ui/video/?scene=the-prepared-scene-URL`. Asset URLs in the prepared scene must resolve from the studio page. Missing packages produce an actionable error. The build does not invent a default cast or fall back to earlier artwork.

Pause, restart, scrub, or fullscreen the scene. `window.videoStudio.renderAt(seconds)` pauses and draws an exact preview position. `renderCount(count)` samples counted-beat position directly. `snapshot()` returns the current actor frames; `capture()` returns a canvas PNG. `setPerformanceTime(sample)` validates an injected PE position and samples the authored score there. It does not subscribe to live voice activity.

The preparation command authors a silent policy demonstration. Idle characters use simple dances; normal performance uses vigorous dances; `!` selects special; `!!` selects ultra, falling back to special only when ultra assets are absent. Sampled characters become grayscale. The main singer always stays colored and returns to simple dance during actual backup activity. The main-vocals chart rule enables it throughout a section starting with a lyric in the leftmost vocals cell. Complete chart activity conversion remains separate from this explicit demonstration.

Pose opportunities are supplied on a quarter-count grid. The first change after a downbeat waits at least half a counted beat. Later changes may occur a quarter beat apart. Renderers hold complete drawings between accepted changes. They apply PNG-canvas pivots once, preserve alpha during grayscale conversion, and use nearest-neighbor scaling.

Export a clean movie with the same sampler:

```sh
node --import tsx scripts/export-street-preview.ts --scene /private/tmp/street-scene.json --asset-root /private/tmp/street-package --output /private/tmp/street-review --fps 30
```

The output directory must be new. It receives a PNG sequence, `street-preview.mp4`, `contact-sheet.png`, and a receipt containing timing, sampled frames, asset hashes, and input provenance. Export uses a half-open time interval and includes no audio or review controls.

Verify changed behavior:

```sh
npm run typecheck
npm run test:video
node --import tsx --test scripts/tests/export-street-preview.test.ts
npm run build:video
```

Inspect the actual browser scene and decoded movie frames. Automated fixtures establish deterministic seeking and presentation rules; they do not establish a live PE connection, full-song notation interpretation, physical CRT output, or audiovisual synchronization.
