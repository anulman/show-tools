# Practice desk implementation notes

## Ownership

- `songs/` owns loadable scripts, chart snapshots, compiled control-row actions, and default rehearsal ranges.
- `ui/practice/` owns the static browser UI and local audio adapter.
- The worklet owns musical timing, queued actions, capture boundaries, loop playback, and channel mixing.
- `lib/` owns low-level audio code, shared performance models, and the standalone future hardware relay.

The old demo pages are removed. New scripting uses TypeScript. Effect validates external chart and protocol data and scopes the future relay's resources. Effect runtime work stays outside the audio render loop.

## Current behavior

Sample slots start empty. A pad press resolves the active chart column's action for that channel. The capture control formerly attached to a foot input was removed. Keyboard positions now match the responsive grid, with Q/W above A/S.

The sheet legend supplies `r`, `c`, `cr`, `x`, and `p`. A `b` suffix queues the action for the next bar. Lead-in actions are available during count-in. Blank cells are no action and never imply a loop exit. Commit starts a loop, and commit-and-arm uses a prepared replacement buffer while the prior take plays.

A cue without an action letter is performed with manual taps. `&a]` requests two presses at 4& and 4a. One press creates one hit. Without a press, normal loop playback continues. Manual hits temporarily replace an existing loop until the next bar.

Per-channel gain and mute apply during rendering, so a muted loop retains its phase. Stop and mushroom cancel queued actions, commit active captures, and silence output.

The practice website has no relay dependency and can be published on an HTTPS static host. Desktop chart selection is separate. The extension uses direct local tab events, and the optional CDP helper can drive a chart page without entering the audio timing path.

## Throughput checkpoint

- Grounding established the existing audio APIs, the actual chart legend, explicit columns, and audio-thread ownership.
- Separate owners implemented the UI correction, chart-action backend, replacement-capture buffers, and desktop chart helper.
- One worklet owns transport and sample state. UI and desktop integrations observe snapshots or submit controls.
- Checks cover rendered PCM, capture commit and rearm, explicit loop stops, blank-cell behavior, manual taps, panic cancellation, and keyboard layout.

## Verification and remaining checks

Run `npm run build`, `npm run typecheck`, `npm test`, and `npm run check:layout` from the repository root. The default tests exclude the optional GPL tempo-following checks.

Earlier desktop checks covered count-in, mobile-width layout, output recording and download, offline reload, and real Sheets range-link selection. The latest chart-action changes require their own final browser pass. Complete CDP helper and installed-extension results must be reported separately from audio checks. Physical-phone behavior remains unverified.

The manual WASM build excludes aubio while preserving microphone capture. The optional original tempo follower remains GPL-3.0-or-later. Hardware drivers and a native hardware sampler/sequencer producer are future work.

No commits or PR were created. Staged and unstaged work preceded this task, and the existing index is preserved.
