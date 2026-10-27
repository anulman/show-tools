# Sample a display pose

This utility samples an authored eight-quarter-note display loop. The caller supplies continuous quarter-note position. It owns no timer, BPM, transport, audio state, or musical command.

`vp_pose(position, model)` returns held pose 0, 1, or 2. The holds are `[0,2)` pose 0, `[2,5)` pose 1, `[5,6)` pose 2, `[6,7)` pose 1, and `[7,8)` pose 0. Positions wrap in either direction.

`vp_sway(position, model)` returns horizontal upper-body displacement as a fraction of figure height. `vp_breath(position, model)` returns a small positive upper-body expansion in the same units. A renderer keeps the feet anchored and applies the offsets to prepared parts or mesh vertices. Translating the whole figure is not equivalent to part motion.

Model indices 0 through 3 identify Gator treatments. Indices 4 through 7 identify Tapir treatments. Treatment changes do not change pose phase. Tapir has less sway and more breath than Gator. Invalid model indices or nonfinite positions return neutral pose 0 and zero offsets. Validate external observations before calling the utility.

Build the native check from the repository root:

```sh
c++ -std=c++17 -O2 -Wall -Wextra -Werror -I lib/video/include lib/video/src/video_pose.cpp lib/video/tests/video_pose_test.cpp -o /tmp/video-pose-test
/tmp/video-pose-test
```

Build the standalone WASM module with Emscripten on PATH:

```sh
node --import tsx scripts/build-video-motion.ts
node --import tsx --test lib/video/tests/video_pose_wasm.test.ts
```

The standalone module has no host imports. Its application exports are `vp_pose`, `vp_sway`, and `vp_breath`. The WASM output is generated under `ui/video/wasm/` and should not be committed.
