# Show tools

Start with [how the practice instrument fits together](docs/architecture.md) for the architecture and its rationale. Use [the development handoff](docs/development.md) to divide filter, UI, and EliteDesk work across sessions.

For optional Sheets following, run `./show-tools sheets` to open the set list, or `./show-tools sheets 1` to open a song chart. The [CLI guide](scripts/open-chart.md) covers browser reuse, `--no-cdp`, `--skip-open`, and local `.envrc` overrides. Practice audio works independently.

Build and open the static practice desk.

```sh
npm install
npm run build
npm start
```

Open <http://127.0.0.1:8082/ui/practice/>. Dance Yrself Clean starts at 98 BPM with a one-bar count-in and a rehearsal range of bars 1 through 76.

Sample slots start empty. Start practice opens the microphone and records the demo output automatically. Press each pad when its active chart column calls for an action. The first R1 capture is armed during the count-in and committed from bar 2. Read the [practice guide](ui/practice/README.md) for the exact sequence and recording steps.

The build requires Node.js and Emscripten's `em++`. It produces static files in `dist/`. `npm start` serves those files with Python's HTTP server. The complete C++ performance engine runs in one WASM module. C++ owns the clock, transport, sequencing, chart actions, capture, sample playback, mixing, and click generation. Browser worklets transfer blocks and controls and publish native state. Audio and controls use the local WASM/worklet bridge. Practice has no relay dependency.

For mobile practice, publish `dist/` on an HTTPS static host and open `/ui/practice/`. The page caches its files for offline use after its first load. Physical-phone behavior remains unverified.

## Project layout

| Path | Contents |
| --- | --- |
| [songs](songs/README.md) | Loadable song scripts, chart snapshots, and control-row actions |
| [ui/practice](ui/practice/README.md) | Practice desk, browser audio adapter, and worklets |
| [ui/practice/sheets-extension](ui/practice/sheets-extension/README.md) | Deterministic local Chrome chart follower |
| [lib/beat-tracker](lib/beat-tracker/README.md) | C++ clock, optional tempo detector, and WASM builds |
| [lib/sampler](lib/sampler/README.md) | Shared C++ PCM capture and playback, native tests, and WASM bridge |
| [lib/sequencer](lib/sequencer/README.md) | Shared C++ patterns, quantized cues, and recording boundaries |
| [lib/performance](lib/performance/README.md) | Complete C++ song execution, block processing, and native build |
| [lib/relay](lib/relay/README.md) | Standalone relay for a future hardware producer |

New scripting uses TypeScript. Effect validates external data and manages the optional relay's startup resources. Audio-thread DSP and beat dispatch stay synchronous. The old demo pages are removed.

## Verification

```sh
npm run typecheck
npm test
npm run check:layout
```

The default practice WASM build excludes aubio. The optional microphone tempo-following build links aubio under GPL-3.0-or-later. Effect 4 is MIT-licensed. MP3 downloads use the MIT-licensed `wasm-media-encoders` wrapper and its LAME WASM encoder under LGPL-2.0-or-later (copyleft). See the [MP3 dependency notice](ui/practice/licenses/README.md). See the [dependency notice](lib/beat-tracker/README.md#dependency-notice).
