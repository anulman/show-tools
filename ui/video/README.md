# Gator and Tapir studio

The studio shows eight models, each with three held poses and restrained upper-body mesh movement. It uses one PixiJS renderer and the shared C++ pose evaluator compiled to WASM. Feet remain anchored while upper vertices sway and breathe.

Build without practice audio or its WASM artifact.

```sh
npm ci
npm run build:video
python3 -m http.server 8087 --bind 127.0.0.1 --directory dist
```

Open `http://127.0.0.1:8087/ui/video/`. All eight loops start together. Pause or scrub the four-second score. Choose a treatment to put both performers on a 4:3 stage. The gallery uses four columns on desktop and two on narrow screens. Fullscreen shows the current output.

The studio preview maps one second to two quarter-note positions. It does not start audio, advance Performance Engine, estimate BPM, or send musical controls. The in-process `window.videoStudio.setPerformanceTime(sample)` boundary accepts validated observations with engineSessionId, runId, epoch, sourceSequence, loopIteration, sourceFrame, sampleRate, quarterPosition, beatUnit, and discontinuity. It draws the supplied position immediately. There is no live PE subscription or network delivery adapter in this milestone.

For deterministic inspection, `renderAt(seconds)` pauses and samples an exact preview time; `snapshot()` returns all eight poses; `capture()` returns the current canvas as a PNG data URL. `setView({kind:'gallery'})` restores the comparison. `setView({kind:'stage',treatment:'tex-avery'})` draws the pair. These controls never replay audio commands.

## Sources and treatments

The source references are A07 Gator Crooner on page 8 and A29 The Tapir Tenor on page 30 of `Old TV Character ideas-1.pdf`. The operator's PDFs remain untouched in Dropbox. Selected page renders are under `assets/video/references/`.

`assets/video/manifest.json` records publication clearance, PDF checksum, source pages, all eight built-in image-generation prompts, input-strip checksums, and production pose paths. The Original treatment is generated cleanup matching the source drawing, not a claim that generation preserved every source pixel. The 8-bit, 16-bit, and Tex Avery treatments are generated interpretations. No third-party character assets are used.

`scripts/prepare-video-assets.ts INPUTS.json` reproduces pose extraction from retained generated strips. Each input has id, character, treatment, path, and prompt. It identifies the three main connected figures, assigns detached accents, and exports isolated poses on a shared baseline without redrawing the artwork. Generated strips remain under `assets/video/source-strips/`.

## Verification

```sh
npm run typecheck
npm run check:layout
npm run test:video
c++ -std=c++17 -Wall -Wextra -Werror -Ilib/video/include lib/video/src/video_pose.cpp lib/video/tests/video_pose_test.cpp -o /tmp/video-pose-tests
/tmp/video-pose-tests
```

Browser verification must observe all eight poses at multiple source positions, backward seek, pause/resume, gallery/stage selection, and narrow layouts. Source-frame export samples the same draw operation. Real CRT signal conversion, overscan, and audiovisual synchronization remain unverified.
