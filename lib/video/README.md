# Sample a prepared visual score

`video_scene.cpp` samples immutable HOLD rows. Each row contains a counted-beat position, clip index, pose index, and grayscale flag. `vs_validate` checks the numeric table once; `vs_sample` finds the last row at or before the supplied position. A finite negative position holds the first row. Invalid arguments fail without changing output.

The utility owns no timer, tempo, audio, voice activation, or character policy. TypeScript preparation in `street-score.ts` selects clips and accepted pose opportunities from explicit visual state windows. The C++ sampler only evaluates the resulting tables. It compiles natively and to standalone WASM. `street-sampler.ts` packs those tables and exposes the same sampler to the browser and offline exporter.

Prepared staging can add a second HOLD table per actor. It uses the same native numeric contract for effect selector, effect drawing, and body visibility; the off selector remains private to the bridge. The complete sampled actor frame carries both the frozen body pose and nullable colored poof. Both renderers consume that result without calculating effect phase. Legacy scenes decode once to explicit `all-present` staging. The native ABI is unchanged.

Each presence track may register the cloud with a static `offset` in scene pixels and a separate absolute `scale`. Decoding defaults the offset to zero and scale to `null`, meaning the character's scale. These fields affect only the poof; character placement, sprite pixels and native registration remain unchanged. `streetPoofPlacement()` supplies the same resolved cloud geometry to both renderers and the mask admission tool. Coverage and scene-fit checks use that geometry.

Simple, vigorous, special, and ultra clips retain their native grids, quarter-note HOLD keys, action duration, cycle duration, and registration metadata. Prepared drawing pivots use PNG-canvas coordinates and already include any source offset. Renderers apply that pivot once. `presentation.ts` supplies the grayscale conversion shared by Pixi texture preparation and offline composition.

Build and run the native check:

```sh
c++ -std=c++17 -O2 -Wall -Wextra -Werror -I lib/video/include lib/video/src/video_scene.cpp lib/video/tests/video_scene_test.cpp -o /private/tmp/video-scene-test
/private/tmp/video-scene-test
```

Build the standalone WASM module and run the visual policy checks:

```sh
node --import tsx scripts/build-video-motion.ts
npm run test:video
```

Generated WASM lives under `ui/video/wasm/` and stays outside Git. The [Street studio guide](../../ui/video/README.md) documents private cast preparation, deterministic seeking, and movie export.
