# Practice desk rehab

The performer sees transport first, two chart-derived vocal rows, and the four pads in Q/W above A/S order. Ordered effect summaries stay inside each voice footer. Their disclosure reveals stopped venue settings. Recording, download, Panic, monitoring confirmation, optional Sheets following, and the collapsed chart inspector remain accessible below the instrument.

## Verification target

The complete desk must render without clipping at 1440 and 390 CSS pixels. Every named AF voice must come from source-backed compiled metadata. Tuning one voice must change its actual native prepared graph without changing another voice or its compatible capture banks. Applied summaries must come from native readback. A retained take continues using its recorded graph after venue edits.

The existing DYC A execution, processed recording buses, mandatory lead-in click, default song-click-off state, monitor confirmation, and recorder/export lifecycle must continue to pass. New native and actual worklet checks must prove marked rotation gating, both signed directions, zero and duplicate handling, half-count-beat inactivity, tempo changes, chart-window exit, natural tails, and Stop/Panic. Browser screenshots are separate from fixture PCM and physical microphone evidence.

## Chosen design

Two standalone treatments used the six AF identities and four pads. Candidate A displayed parameters inline. Candidate B displayed ordered summaries with expandable per-stage settings. The independent design judge preferred B because its mobile layout keeps the pad faces visible without exposing every parameter simultaneously. The implementation takes B and adds A's larger pad action area. Final screenshot review removed the redundant count-in hint and live-role subtitles and kept revision numbers in native diagnostics rather than operator labels. Volume and effects remain outside the pad button, so native keyboard activation does not nest interactive controls.

The prototypes and actual Safari responsive screenshots are retained under `/private/tmp/rehab-candidate-a/`, `/private/tmp/rehab-candidate-b/`, and `/private/tmp/rehab-evidence/`. These are comparison artifacts, not working instrument evidence. Final screenshots must use the integrated app.

## Domain and ownership

Four pad inputs remain separate from six DSP profiles. Existing compiled take and cue indices still address four capture voices. Source-backed part metadata links these voices to their AF arrangement rows and adds explicit default-live and rotation-live profiles. Imported compiled artifacts carry the same identities. Legacy songs do not acquire invented DYC vocal rows.

The performer edits one ordered stack in a voice footer. The host submits one complete stopped venue configuration and reads the actual applied definitions back. Native preparation validates and builds replacements before committing. Revisions belong to profiles, so changing a voice does not invalidate another voice's spare bank. Captured takes retain their original graph and revision.

Main vocals use the default Slapback route. The backup graph is serial Slapback followed by Chorus. This order applies Chorus to both voice and Slapback repeats without adding a second dry host path. Chorus parameter defaults are editable engineering defaults, not measured operator preferences. Filters owns the snapshot-capable effect implementation under `lib/patches/`. Performance Engine owns tagged ABI definitions, six-profile preparation, original-source capture, live routing, native cue eligibility, and inactivity.

The marked knob row compiles into source-located half-open intervals. A nonzero accepted rotation starts or refreshes backup processing only inside an eligible interval. Its signed value remains observable for Video, while audio activation uses presence. The native deadline is half a chart-count beat after the last accepted rotation, limited by the marked interval's end. Tempo changes preserve that musical deadline. In 6/8 one count is an eighth note. Leaving a window stops feeding new source and preserves natural DSP tails. Stop, Panic, end, and microphone loss clear activation. Capture retains its own rack and source even if monitoring changes.

TypeScript renders native observations and forwards controls. It does not schedule musical expiration or infer switching from lyric cells. Browser-default microphone/output selection stays outside the app. No hardware mapping, Sheets process, or Chrome/CDP lifecycle change is part of this work.

## Execution and review

Ground source identity and DSP ownership before implementation. Build two layout studies and compare them in the browser. Implement and verify the Chorus module, compiler metadata and windows, native profiles and routing, then the practice UI. Finish with fresh native/WASM and actual A execution, focused keyboard/lifecycle tests, full tests, build/typecheck/asset-hash checks, and desktop/mobile app screenshots. The coordinator reviews screenshots, behavior, and the PR and owns merging. The author does not merge.

## Final review evidence

The implementation source at `62eaad2cdc5cd4860123562f7dc40563f3f44e2e` passes all 297 follower-enabled tests. Native Release and sanitizer suites pass 5/5 each, compiled WASM tests pass 8/8, and peripheral integration passes 9/9. Actual DYC A passes native and WASM at 44.1 and 48 kHz with all 29 pad cues, 30 signed or zero rotation observations, 20 backup activations, nine ready takes, and two native tempo hits. The retained report is `/private/tmp/rehab-final-native-wasm-A.log`; its source-linked artifacts are `/var/folders/gr/rxxj7y9j4bs54nht4mpqsh7h0000gn/T/show-tools-dyc-MfCOpj`.

Actual Safari production screenshots are `/private/tmp/rehab-evidence/final-app-1440-applied.png`, `final-app-390-applied.png`, and `final-app-390-backup-expanded.png`. They show native applied graph order and independently tuned Drums & Claps at 125 ms while the other voices remain at 100 ms. Applying settings leaves transport ready and does not open the microphone. Focused effect disclosure Space behavior remains local to the disclosure.

The separate `/private/tmp/rehab-browser-fixture/` verification host bundles the actual app renderer and real native WASM with synthetic PCM. It opens no audio devices. The yellow banner identifies mocked recording and unavailable export and Sheets. Its `final-native-*-1440.png` screenshots and `final-native-states.txt` under the evidence directory show native cue, armed, recording, looping, and queued-stop/release presentation. They are not physical microphone, room, callback-performance, or MP3-download evidence. Native PCM tests establish the half-count grace and tails independently of paused screenshot scenarios.

The final test and build logs have unique retained names `/private/tmp/rehab-final-297-tests.log` and `/private/tmp/rehab-final-ui-build.log`. The decision-trail audit found no unsupported native or A-run PASS claim. Its bounded findings about stale design copy, final screenshots, and rotating log filenames are corrected here. The audit used the shared conversation and saved evidence; no separate transcript path or different-model-family runtime was available. The coordinator independently reviews the exact PR head and screenshots and owns merging.
