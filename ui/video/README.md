# Review the Street cast

The Street studio displays Figma-derived character drawings as rigid, held sprites. A prepared visual score supplies every actor, placement, drawing and state change. The C++ sampler evaluates that score through the same WASM module used by the offline exporter.

## Prepare both aspect ratios

Follow the [shared director guide](../../docs/video-directors/README.md#compose-every-scene-in-both-aspect-ratios) for paired compositions, native pixel scale, and provisional review dimensions.

The handoff includes both frame IDs, dimensions, camera cuts, actor placements and fit decisions. For renderer intake, normalize and prepare each layout separately, with its own exported background and prepared scene. Each compiled aspect needs its own exact-cast fit profile and verification. A 16:9 fit approval does not cover changed 4:3 anchors or bounds. The existing commands process one prepared scene per invocation; they do not generate an alternate composition automatically.

Keep the same performance inputs, event times and review cadence across the pair. Record narrative review timing separately from song timing. Existing approved movies keep their current pins until a requested replacement is verified.

## Prepare a score

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

Scene version 2 requires expected SHA-256 hashes for the background and every drawing. Browser loading and movie export verify the bytes before decoding them. Regenerate older prepared scenes through normalization and preparation; version 1 has no unchecked compatibility path.

Motion catalog version 2 requires a separate identity approval for every included family. The approval locks the approved reference edition and Figma node, reference file hash, and complete ordered drawing/layer hashes. A source-RGBA export pass does not establish that a pose stayed on-model. Missing, pending, failed, or stale identity records block normalization. The compact inline certificates work offline without raw audit movies or reports.

Artwork creation, new move-set poses, repainting, and corrections happen before promotion. Deterministic animation and rendering only read frozen assets, select and time poses, compose the scene, and apply requested presentation such as grayscale. They do not generate or redraw artwork, and do not repaint assets for each song.

Serve `dist/` on an isolated port. Make the prepared scene and its referenced assets available to that server, then open `/ui/video/?scene=the-prepared-scene-URL`. Asset URLs in the prepared scene must resolve from the studio page. Missing packages produce an actionable error. The build does not invent a default cast or fall back to earlier artwork.

Pause, restart, scrub, or fullscreen the scene. `window.videoStudio.renderAt(seconds)` pauses and draws an exact preview position. `renderCount(count)` samples counted-beat position directly. `snapshot()` returns the current actor frames; `capture()` returns a canvas PNG. `setPerformanceTime(sample)` validates an injected PE position and samples the authored score there. It does not subscribe to live voice activity.

The preview command authors a short silent policy demonstration at the chart's tempo. Prepare the complete planned song arrangement instead with the current matching source and mapping:

```sh
node --import tsx scripts/prepare-street-song.ts /private/tmp/catalog.json songs/dance-yrself-clean.source.json songs/dance-yrself-clean.mapping.json /private/tmp/street-assets.json /private/tmp/street-song.json
```

The saved catalog supplies the cast. Use the current approved source and matching mapping rather than an older browser inspector snapshot. Preparation visits every bar and voice cell and blocks on source-located diagnostics. DYC contains 218 bars and 872 counts at 98 BPM, giving about 8 minutes 54 seconds without a count-in or added tail. The private `preparationReceipt` inside the scene records source classification, anchors, accent decisions, bindings, and source digests. Scene and receipt replace the output atomically; no sidecar is written. Output paths that alias any input, including filesystem aliases, are rejected. Keep this combined artifact private.

To stage performers with poof entrances and exits, add `--poof-fit PROFILE --asset-root ROOT --fit-sha256 SHA256`. Supply all three flags together. The pinned Figma fit profile identifies the exact character and poof catalogs under the asset root, cloud placement, and each actor's admitted effects. Preparation rejects changed pins, moved body anchors, unsafe asset paths, and source/output aliases. The singer stays present; backup enters on its first eligible section cue and stays until section end; other performers follow planned activity. Overlapping poofs merge at the opaque peak. The embedded receipt records the resolved presence ranges and effect decisions.

Idle characters use simple dances; normal performance uses vigorous dances; `!` selects special; `!!` selects ultra, falling back to special only when ultra assets are absent. A blank selects idle and a dash selects normal performance without inheriting `!` or `!!`. Sampled characters become grayscale. The main singer always stays colored and performs throughout sections starting with a lyric in the leftmost vocals cell. Planned backup activity returns the main singer to simple dance. Backup activity combines its nonblank cells with the compiler's written phrase spans; it does not claim observed knob activation.

Characters keep dancing between labeled hits. Each actor advances sequentially through its source keys, with natural drawing deadlines and written accents on a quarter-count grid. The first change after an anchoring beat waits at least half a counted beat. Later changes may occur a quarter beat apart. Forward subdivision notation `&e3a&` means 1&, 2e, 3, 3a, and 4&. Parenthesized beats establish silent anchors. Renderers hold complete drawings between accepted changes. They apply PNG-canvas pivots once, preserve alpha during grayscale conversion, and use nearest-neighbor scaling.

## Export both versions

Export both prepared versions with the same sampler. Use a new output directory for each aspect:

```sh
node --import tsx scripts/export-street-preview.ts --scene /private/tmp/street-scene-16x9.json --asset-root /private/tmp/street-package --output /private/tmp/street-review-16x9 --fps 30
node --import tsx scripts/export-street-preview.ts --scene /private/tmp/street-scene-4x3.json --asset-root /private/tmp/street-package --output /private/tmp/street-review-4x3 --fps 30
```

The output directory must be new. It receives a PNG sequence, `street-preview.mp4`, `contact-sheet.png`, and a receipt containing timing, sampled frames, asset hashes, and input provenance. Export uses a half-open time interval and includes no audio or review controls.

Verify each actual export against its prepared scene and fit profile. Inspect decoded frames around transitions and at the ending. Keep separate receipts and share links labelled by aspect. The [shared review requirements](../../docs/video-directors/README.md#compose-every-scene-in-both-aspect-ratios) apply to both movies.

## Verify the result

Verify changed behavior:

```sh
npm run typecheck
npm run test:video
node --import tsx --test scripts/tests/export-street-preview.test.ts
npm run build:video
```

Inspect the actual browser scene and decoded movie frames. Automated fixtures establish chart classification, deterministic seeking, and presentation rules. A finished render also requires an on-model artwork review. Export parity alone does not establish character identity. A chart-planned movie does not establish a live PE connection, physical CRT output, or audiovisual synchronization.
