# Video Assistant plan

Planning milestone, October 26, 2026. No feature implementation, dependency installation, Figma mutation, or service startup is included.

Revised October 27 for the operator's shared meter, pedal-tempo, fractional-cue, and logging decisions from Performance Engine review.

## Recommendation

Build a small cast of reusable Old TV characters that performs with the music. Start with A31 Mister Metronome and B14 Reel-to-Reel Cyclops. The pendulum makes beat alignment visible. The tape machine gives capture, commit, and playback a readable stage presence. Add C06 Knob Goblin after the first two assets work.

Use a hybrid of cleaned pose frames and independently movable parts. Store authored motion as keyframes in musical time and evaluate the current pose from Performance Engine time. Render live in a browser. Render offline from the same assets, motion definitions, and recorded performance timeline. Pre-render short effects when their drawing complexity warrants it.

This recommendation comes from visual review of both PDFs and inspection of the current engine bridge. The references contain exploratory pose studies, not a finished animation collection. The first useful demo is two characters performing one short chart section, followed by a seekable replay and a matching video export.

## Scope and evidence

The authoritative scope is `/Users/anulman/dev/show-tools/docs/workstreams.md`, especially Video Assistant and coordination. Read alongside `AGENTS.md`, [architecture.md](../architecture.md), and [development.md](../development.md). The workstream brief postdates the required base checkout and is not present at that base. Do not copy unrelated parent-checkout changes into this branch.

This plan belongs to the isolated managed workspace `/Users/anulman/.codex/worktrees/b0ba/show-tools/`, based on `619df0393c2a4fc357e4a2451b8e14e41d7421d4`. Integration remains the operator's decision.

Throughput checkpoint: one planning pass covering source evidence, rendering alternatives, shared clock requirements, and a committed plan. Prototypes and implementation wait for plan review.

### The PDFs are available and visually reviewed

At the parent's initial check, both files were empty. At this session's recheck on October 26 at 19:02 Toronto time, both contained valid `%PDF-1.4` headers.

| Source | Bytes | Pages in this file | SHA-256 |
| --- | ---: | ---: | --- |
| `/Users/anulman/Dropbox/Old TV Character ideas-1.pdf` | 18,501,385 | 55 | `dd3e61e0a655564d098ecdb0fa14767370df2589fd5472d1cc497f3a68eacbb7` |
| `/Users/anulman/Dropbox/Old TV Character ideas-2.pdf` | 17,636,797 | 54 | `9c4a8116a8d7c0d2e0802ba478619167faf431e4c6e1eecee68298e94897974a` |

Used the PDF skill. Poppler was unavailable, so macOS PDFKit rendered all 109 pages to temporary PNGs. Reviewed six contact sheets covering every page, then full-page renders of the four candidates below. Text extraction corroborated names, poses, and page labels. Character recommendations follow visual evidence, not filenames or extracted descriptions alone.

The collection contains 108 concepts with three poses each. File 1 contains the cover, A01 through A36, and B01 through B18. File 2 continues B19 through B36 and C01 through C36. Its printed page labels continue from 56 through 109. Keep physical PDF page and printed page separate in provenance.

Observed common traits include strong silhouettes, theatrical gestures, musical machinery, dark outlines, and deliberately strange anatomy. Rendering varies across concepts. Some have coarse pixel edges; others use shaded or faceted illustration. Pose size, placement, and apparent pixel scale vary. White or pale panels and cast shadows are visible. None of these observations establishes clean alpha, separated parts, or a consistent sprite grid.

| Candidate and source location | Observed design | Proposed development |
| --- | --- | --- |
| A31 Mister Metronome. File 1, physical and printed page 32 | Walnut metronome body, long brass pendulum nose, red shoes. Stern tick, dance, and stumble poses | First timing demonstrator. Separate body, pendulum pivot, limbs, and face. Alternate pendulum endpoints on beats and accent the downbeat with a pose change |
| B14 Reel-to-Reel Cyclops. File 1, physical and printed page 51 | Sage tape machine, twin reels, central eye, tape-loop legs. Walking, eye-bright, and tangled poses | First performance-state character. Reel phase follows performance time. Capture and playback select distinct poses. The tangled pose is an authored flourish, not an invented engine error state |
| C06 Knob Goblin. File 2, physical page 24, printed page 79 | Black dial body, cream spider legs, red pointer and joints. Creep, louder twist, and recoil poses | Parameter character. Pointer follows an explicitly bound, acknowledged song parameter. The SpinTrak reports direction and distance, not a global gain value. Gait timing waits for the confirmed song pulse |
| B23 Oscilloscope Jellyfish. File 2, physical page 5, printed page 60 | Midnight-blue scope, cyan screen trace, translucent-looking square tentacles. Wide, contracted, and trailing poses | Later accent character. Pose or tentacle pulse follows beats. The screen is decorative unless a separately specified audio-analysis feed drives it |

A14 Static Queen, B35 Equalizer Skyline, and the faceted C35 Polygon Parade Horse offer later scene or transition ideas. Their styles make useful alternatives to an all-mechanical cast. They are not part of the first asset milestone.

### Current runtime facts

`pf_process()` owns the clock and musical execution. [performance_engine.h](../../lib/performance/include/performance_engine.h) defines immutable event records and snapshots. Its snapshot fields include frame, epoch, clock beat frame, position beat, and dropped-event counters.

[NativePerformance.events()](../../lib/performance/wasm-performance.ts) retains native sequence numbers and publishes source frame and sample rate when present. Beat events are timestamped. Most state and control events currently use an absent timestamp. `decode()` does not expose all native timing fields in public practice state.

[PracticeEvent](../../lib/performance/model.ts) contains run identity, sequence, state, and optional timing and control identity. [PracticeAudio](../../ui/practice/audio.ts) adds chart metadata. The separate [tracker worklet port](../../ui/practice/runtime/beat-worklet.js) exposes a context-frame origin mapping. The practice event envelope does not yet provide a calibrated display-time contract.

The inspected API has no practice seek or pause command, loop-iteration field, historical replay log, program digest, or stable visual cue representation. The queue is bounded at 512 records and can drop events. These are implementation dependencies, not features established by this plan.

## Develop the collection in Figma

Use a Figma Design file as the editable asset workshop. A full application-screen workflow or Code Layer is unnecessary for this asset family. Start with one family, not a complete design system.

The inspected MCP tool descriptions expose `upload_assets`, `generate_image`, `use_figma`, `get_motion_context`, `download_assets`, and `export_video`. No file has been created and no account-specific motion capability has been tested. Tool availability establishes possible operations, not successful exports or usable rigs.

1. Choose an existing destination file or create a Design file through `figma-create-new-file`. Resolve its plan first. Establish a file session. Inspect local assets and variables, then call `get_libraries` before `search_design_system`. Reuse compatible foundations.
2. Place selected page crops beside new work as references. Preserve the PDFs intact. Uploaded raster references remain raster fills. Importing a PDF crop does not separate limbs or recover vectors.
3. Make one model sheet per selected character. Fix silhouette, relative scale, palette, outline treatment, foot baseline, pivot points, and expression vocabulary. For Mister Metronome, compare a crisp sprite treatment with a layered cutout treatment before choosing the production style.
4. Build a small component family. Expose pose and expression variants, swappable props, and the parts needed for motion. Use compatible palette variables and deterministic names. Avoid multiplying pose, facing, prop, and expression into an enormous variant matrix. Review selected instances together at intended output size.
5. Expand only selected assets. Add anticipation, contact, follow-through, idle, entry, and exit poses as needed by the demo. Optional `generate_image` can propose visual variations, but it consumes Figma AI credits and returns raster art. Artist cleanup must preserve identity, anchors, palette, and transparent edges. Do not promise coherent intermediate frames from image generation.
6. Animate independent parts or swap whole poses. When enabled, `figma-use-motion` supports manual keyframe tracks, easing, and timeline duration. These APIs require the account's `metronome` feature flag. If unavailable, retain static components and author the portable keyframes outside Figma. Figma is not being proposed as a skeletal or inverse-kinematics rigging system.
7. Export selected SVG parts where the art is truly vector and transparent PNG poses where it is raster. Record node IDs, revisions, dimensions, pivots, and licenses. `download_assets` supplies temporary URLs and bounded sets of original images and vector assets. Save selected exports promptly.
8. For enabled motion, inspect keyframe data and normalize a supported subset into the repository motion schema. This conversion is proposed work. Do not treat generated CSS as the canonical score. Figma uses seconds, so record the reference tempo when translating authored motion to beats.

Figma's inspected `export_video` tool produces MP4 only. It exports a top-level timeline frame, uses an asynchronous job, and has temporary downloads. It does not advertise GIF, animated SVG, transparent video, or a reusable runtime animation package. Use it for motion-review previews, then sample start, accent, and settle frames. A Figma screenshot shows resting appearance and cannot verify animation.

The relevant skills are `figma-use`, `figma-generate-library`, `figma-use-motion`, and `figma-create-new-file`. Follow their scoped construction and validation rules during implementation. This planning milestone creates no file, asset, or paid generation.

## Compare the animation paths

| Option | Fits this material | Costs and limits | Recommendation |
| --- | --- | --- | --- |
| SVG or Canvas 2D with explicit pose evaluation | Small cast, layered parts, fixed pose atlas, transparent composition | We own scene composition, scrubbing, and export capture. Canvas APIs do not supply a musical clock | Start here for the two-character demo |
| PixiJS scene graph | Larger cast, sprite atlases, layered parts, many simultaneous effects | Adds a renderer dependency. Disable autonomous animation advancement and render the evaluated scene. Measure target devices before choosing it for scale | Candidate if the simple renderer becomes limiting. [MIT license](https://raw.githubusercontent.com/pixijs/pixijs/dev/LICENSE) |
| Remotion for offline composition | Frame-indexed rendering, React composition, video assembly, preview tooling | Adds React and a rendering toolchain to a currently non-React UI. Its license has eligibility conditions. Its Player must not become the live musical clock | Optional export adapter after one shared scene evaluator exists |
| Pre-rendered clips | Complex transformations, smoke, static, perspective changes, or hand-drawn flourishes | Baked timing, decode and seek latency, storage, alpha compatibility, and visible seams. Repeated seeking is a poor live beat renderer | Short effects or a fixed arrangement, with keyframe assets for interactive material |
| Hybrid pose frames, keyframes, and short clips | Expressive pose changes plus phase-accurate mechanical motion | Requires explicit clip boundaries and asset preparation | Recommended overall approach |

Prefer permissive code dependencies. PixiJS is MIT. Browser SVG and Canvas avoid another animation-library dependency. [Remotion's current license](https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md) offers free use to eligible individuals, small for-profit organizations up to three employees, nonprofits, and evaluation. Other organizations require a Company License. Recheck the exact package version and intended use before adoption. Treat Remotion as source-available with conditions, not MIT.

[FFmpeg's license depends on build options](https://www.ffmpeg.org/legal.html). Its base is LGPL-2.1-or-later, with optional GPL components. Using an executable for export does not make the dependency permissive. Record the actual build, codecs, notices, and redistribution policy before bundling anything. No FFmpeg or Remotion code belongs on the audio callback.

Figma is an external commercial authoring service. AI generation has credit costs. Asset rights and font rights remain distinct from renderer licenses. The PDFs describe original concepts, but that text alone does not establish authorship or distribution rights. Record operator-supplied provenance before publishing derived assets.

## Consume Performance Engine time

Performance Engine owns semantic commands, compiled-song schema, and performance and WASM contracts. Coordination occurred with its workstream on October 26. The following requirements agree with its proposal. They remain proposed until a coordinated implementation milestone lands. Video edits no shared header or bridge independently.

The operator's [meter correction](https://github.com/anulman/show-tools/pull/3#discussion_r4385809988) requires 6/8, replacing the earlier 6/4 requirement. Support a dominant song meter of at least 4/4 or 6/8, with explicit lengths for occasional short measures. This does not require a general map of localized meter changes. [Local chart BPM is metadata and never changes clock BPM](https://github.com/anulman/show-tools/pull/1#discussion_r4384945413). During performance, tempo changes come from the BPM pedal and take effect through Performance Engine. Video consumes the engine's resolved tempo changes and source frames. Neither a chart row nor a Figma reference tempo starts another clock.

Keep meter denominator, quarter-note tick position, and pedal beat unit distinct. The operator confirmed that 6/8 chart counts and pedal taps both count 1, 2, 3, 4, 5, 6 as six eighth-note pulses. With Performance Engine's 960 ticks per quarter note, each numbered beat is 480 ticks and a full 6/8 measure is 2880 ticks. Quarter-, half-, and three-quarter-beat offsets in that meter are 120, 240, and 360 ticks. Video consumes the engine's resolved frames and eighth-note position, without substituting a dotted-quarter pulse.

Pedal tapping may begin on any numbered beat. Tap onset does not establish beat 1 or reset, infer, or realign bar phase, beat number, epoch, or loop iteration. An applied tempo anchor preserves continuous position. Pendulum phase and downbeat accents follow Performance Engine's existing authoritative position through tempo changes. The beat-unit question is settled. Pedal estimation, missed-tap handling, smoothing, pulse shape, retrigger, and release behavior remain unconfirmed. Do not invent them.

For the current DYC mapping, F2 supplies the initial reference BPM. Local BPM and detected start-time rows remain inspection metadata. Video seeking follows resolved performance frames and measure ticks, rather than detected chart start times.

| Contract area | Video requirement |
| --- | --- |
| Identity | `engineSessionId`, `epoch`, `runId`, `programDigest`, and increasing `sourceSequence`. Logical voice, resource, cue, and effect-instance IDs remain stable across the compiled artifact. Input button IDs are separate identities |
| Source time | Authoritative `frame` and `sampleRate` on snapshots, resolved cues, applied controls, and transport changes. Preserve integer frame meaning across serialization |
| Musical position | Tick or continuous beat with an explicit unit, bar, meter numerator and denominator, actual measure length, transport phase, engine BPM with its pedal beat unit, and `loopIteration`. Include tempo revision and effective-frame anchors for pedal-driven tempo changes. Chart-local BPM stays metadata |
| Action timing | Distinguish command acceptance from actual action. Support quarter-, half-, and three-quarter-beat cue offsets as well as immediate peripheral actions. Animate capture, commit, or an effect at its engine-resolved frame without imposing another beat boundary. Preserve same-frame source ordering |
| Recovery | A snapshot at frame S with the last included sequence, drop count, active visual cue state or sufficient checkpoint data, and discontinuity reason |
| Presentation | Observer-side mapping between source frames and output presentation time. Include calibration age and uncertainty. Network receipt time is not source time |
| Replay | Ordered resolved cue and control records, initial checkpoint, program and asset digests, pedal-driven tempo history, measure lengths, loop history, and discontinuities. Chart-local BPM cannot reconstruct performed tempo |

Commands follow the Performance Engine proposal for producer identity, command identity, producer sequence, run, semantic target, and timing. The loaded program remains immutable throughout a run. Stage chart and visual-program refreshes separately and activate only while stopped. Record the program digest in load/session manifests and replay provenance, without requiring it on every pad command. Reconnect requires a session/run handshake and snapshot before new input. Discard input from the old session. Video can observe acknowledged controls. It must not deduplicate audio commands independently or claim exactly-once delivery beyond the engine's bounded guarantees.

The engine resolves chart cues and manual actions. A portable visual evaluator consumes their copied records and produces poses. It never advances transport, triggers samples, or reimplements chart notation. A browser animation callback samples the current performance position and draws the pose.

[R1, R2, L1, and L2 identify physical buttons, not logical voices](https://github.com/anulman/show-tools/pull/2#discussion_r4385154502). Bind characters and animation parameters to resolved semantic voice, resource, cue, or effect-instance IDs. Retain the originating button as input provenance when useful. A button assignment can change without changing the identity of an ongoing voice or its animation. Do not infer an animation target from a button ID or from the current legacy channel naming.

Filters owns a general effect stack, including chorus, echo, and guitar or synth transforms, with live processing and cached results for sample playback. Video observes the resolved effect instance, target, parameter values, and resource state. An animation must not imply that a live effect is processing when playback uses a cached result. Keep visual effects such as static or flashes distinct from audio effect instances. The portable video evaluator does not duplicate audio processing or manage its cache.

Peripherals' confirmed hardware is the I-PAC Ultimate I/O with SpinTrak. SpinTrak direction and distance require a declared song-specific mapping before they control a visual or musical parameter. Do not map rotation globally to gain or invent a range or scaling rule. Effect feedback identifies the logical voice, stack, capture revision, and effective frame. Venue parameter tuning stays in the web UI.

Browser pads and physical button LEDs must consume the same semantic blink, pulse, and trigger-envelope patterns. If video displays those performance indicators, reuse that contract rather than authoring a competing envelope. Pulse period, shape, retrigger, release, and phase behavior remain unconfirmed. Keep dependent character accents and indicator rendering blocked until the operator confirms timing with Performance Engine and peripherals. This shared contract does not make every character movement an LED pattern.

Performance Engine's live worksheet inspection reports the A17 `chorus/video-y` note and knob tokens `[4d-`, `d`, `-1d]`, and `-3d] [4d-`. Their `d` binding, direction, range, span behavior, and effect or video routing remain undefined. Keep these as source-anchored typed TODOs shared by Filters, Video, and peripherals. Do not infer that `d` means delay or a specific animation parameter. An unresolved required binding blocks an executable load. It can appear in an explicitly incomplete inspection preview. A later binding must name the target, units, range, and timing before video consumes its engine-resolved values.

For local WASM, relate engine frame zero to AudioContext frame time through the bridge. Calibrate that time to output presentation time using browser timing facilities where available. Account for output latency and configurable display offset. A background-tab pause must not advance animation by callback count. On resume, obtain fresh state and evaluate the current pose.

For a native host, one thread owns the engine. Copy timing and cue records into a bounded queue, then publish outside the audio callback. A remote display needs a calibrated source-frame mapping, not BPM extrapolation from packet arrivals. If calibration expires, freeze or fade to a neutral scene with a visible operator status until resync. Keep that status off audience output. The acceptable stale interval and measured synchronization error are acceptance criteria to establish on actual hardware.

### Specify boundary behavior before implementation

- Represent clips as half-open intervals. At a shared endpoint, the incoming clip owns the pose. Define ties through stable layer priority and engine source ordering.
- Store beat-relative keyframes for rhythmic motion. Evaluate beats using the engine's effective tempo segments from pedal actions. A mid-beat tempo change preserves position and changes the following rate. Do not calculate an entire performance from the latest BPM or chart-local BPM metadata.
- Use the compiled measure boundaries for bar-relative poses and downbeat accents. A 6/8 measure has six eighth-note units. An explicitly short measure ends at its declared length. Do not derive bars by dividing the beat count by four, treat 6/8 as six quarter notes, or stretch a short measure to the dominant meter.
- Preserve quarter-, half-, and three-quarter-beat cue positions in the engine's tick representation until frame resolution. Immediate peripheral effects begin at the reported applied frame. Video presentation samples that result at the next available display frame, without claiming sample-exact screen output or adding musical quantization.
- Permit second-relative tracks for effects that need fixed physical duration. Each track declares its time domain. Do not silently stretch every effect with tempo.
- Include loop iteration in trigger identity. Clock frames continue monotonically while song position wraps. State which clips restart and which continue across the loop. Test the last frame and the first frame of the next iteration.
- Reject stale runs and epochs. Detect sequence gaps and recover from a snapshot. A late persistent cue evaluates at its current age. An expired one-shot is skipped rather than played late. A missed cue that changes state requires checkpoint recovery.
- Visual seeking reconstructs state from a checkpoint and subsequent records without issuing audio controls. Live audio seeking remains Performance Engine work. A deterministic scene has no unseeded randomness or accumulated animation deltas.
- Freezing the final pose on Stop and blacking out on Panic are proposals requiring operator choice. Do not implement either as an assumed default. Confirm song-end and restart appearance with the same decision. Existing audio behavior remains authoritative.

## Put assets, browser code, and portable evaluation in their owners

Proposed directories do not exist at the base commit.

| Location | Proposed responsibility |
| --- | --- |
| `assets/video/sources/` | Intact originals when the asset policy permits repository storage. Otherwise immutable external source references and checksums |
| `assets/video/manifest.json` | Asset ID, source path, physical and printed page, crop, author, rights, tool and prompt provenance, Figma file and node revision, export hash, dimensions, alpha, pivot, and baseline |
| `assets/video/characters/<id>/` | Selected SVG parts or PNG atlas, frame rectangles, pose names, pivot and anchor metadata, bounded review stills |
| `assets/video/motions/` | Versioned declarative keyframes, time domain, easing, loop behavior, sprite holds, and stable asset references |
| `ui/video/` | Library browser, motion preview, output surface, replay scrubber, browser renderer, and export adapter. Keep the practice desk supported |
| `lib/video/` | Portable C++ cue reduction and pose interpolation when implemented, built for native and WASM. No device IO or browser rendering ownership |
| `songs/` and the compiled artifact | Song-specific visual cue assignments, with Performance Engine ownership of schema and execution timing |

Keep the C++ evaluator small and synchronous. Inputs are prepared motion data, resolved cues, and a requested frame or musical position. Output is an immutable pose buffer with transforms, visibility, and selected sprite frames. A UI or offline adapter draws those results. Prepare data outside real-time processing. Video evaluation should run outside the audio callback and must never stall audio.

Use TypeScript for new tooling and browser bridges. Effect can manage asset loading, export jobs, cancellation, and input validation where useful. Read `node_modules/effect/AGENTS.md` before writing Effect code. No Effect runtime belongs in beat dispatch or pose interpolation.

Keep PDF originals intact. Do not commit these temporary renders, full contact sheets, bulk frame sequences, or generated videos in this milestone. The proposed asset policy keeps manifests, selected small source assets, and approved exports in Git. Confirm that policy and decide on Git LFS or external storage before committing assets, the approximately 36 MB source PDFs, or a growing video collection. Export jobs should use pinned local assets, not expiring Figma URLs.

### Keep runtime logging appropriate to the mode

The [operator's logging policy](https://github.com/anulman/show-tools/pull/1#discussion_r4384901380) applies across Performance Engine integrations, including video. Debug runs may emit rich DEBUG artifacts such as pose traces, clock-calibration samples, and sampled frames. Practice filters below INFO. Live performance filters below WARN. Configure the level at the session boundary and apply it to browser, native, and export adapters.

Do not generate per-frame traces, rich diagnostic artifacts, or debug serialization in ordinary practice or live performance. Logging and artifact writes stay outside the audio callback. Required cue and snapshot delivery is protocol state, not a log stream, and remains available at every level. Keep audience output free of diagnostic overlays.

Replay capture is an explicit workflow with a bounded, minimal dataset for reconstruction, separate from diagnostic verbosity. It must not require DEBUG mode or enable rich debugging artifacts implicitly. If the resolved timeline was not captured, label an export as an authored preview rather than a faithful performance replay.

## Produce replay, keyframes, and video from one timeline

A keyframe package is the reusable output. It contains a schema version, asset digests, coordinate system, pivots, tracks, easing, time domains, and loop rules. A resolved performance timeline is a separate artifact. It supplies actual applied frames for manual actions, tempo changes, and chart cues. Neither artifact can be replaced by an MP4.

For offline frame n at rational FPS P/Q, evaluate source time at `startFrame + n * sampleRate * Q / P`. Preserve the rational value until the documented sampling rule. Select the most recent discrete event at or before that time and interpolate continuous tracks. Never add a rounded samples-per-video-frame value repeatedly. At 48 kHz and 30 FPS, frame n samples `startFrame + 1600*n`.

Replay uses the recorded take's resolved timeline. A chart-only export is an authored preview and cannot reproduce unrecorded manual choices. Store an explicit mapping between exported PCM frame zero and performance frame zero. Current demo recording starts on a delivered playing-state message and exports MP3, so it is not an established sample-exact audiovisual master. A synchronized recording path requires coordinated PCM and timing capture before claiming exact mux alignment.

| Output | Intended use | Verification |
| --- | --- | --- |
| SVG parts, PNG poses or atlas, and keyframe JSON | Reusable live assets and native or WASM evaluation | Baseline, pivots, alpha edges, sprite bounds, schema, hashes, and attribution |
| Opaque MP4 | Shareable full composition and Figma motion preview | Actual target-device decode, dimensions, duration, first and last frames, and audio offset |
| PNG sequence with alpha | Deterministic compositing master and renderer comparison | Decode selected frames over light, dark, and checkerboard backgrounds |
| WebM with VP8 or VP9 alpha | Optional browser overlay | Actual browser alpha support, seek behavior, and loop seam |
| ProRes 4444 MOV | Optional editing master with alpha | Actual editor import and alpha verification. Large output stays outside normal Git |

[Remotion documents alpha output](https://www.remotion.dev/docs/transparent-videos) through PNG frames with VP8 or VP9 and `yuva420p`, or ProRes 4444 with an alpha-capable pixel format. Those are proposed export targets, not tested guarantees here. The [frame-based API](https://www.remotion.dev/docs/use-current-frame) can drive an offline adapter, but it must sample this performance timeline. Keep Remotion optional until license fit and the initial export comparison are settled.

## Deliver in verifiable phases

| Phase | Deliverable | Evidence required before its commit |
| --- | --- | --- |
| 0. Planning | This plan and coordinated timing requirements | Actual PDF review, source pointers, license sources, diff check, and isolated commit |
| 1. Asset proof | Mister Metronome and Reel-to-Reel Cyclops, neutral and accent poses, one short loop each | Normal-size Figma instance review, part and pivot inventory, transparent-edge checks, no unintended background, rights record |
| 2. Portable motion | C++ cue reducer and keyframe evaluator with native and WASM builds | Use the confirmed eighth-note beat unit in 6/8 and confirm shared envelope timing before dependent rendering. Equal pose outputs for identical inputs, direct seek matching sequential evaluation, deterministic loop, pedal-tempo, fractional-cue, 4/4, 6/8, and short-measure fixtures |
| 3. First useful live demo | Two characters perform a short chart section. Metronome follows beats. Tape character changes at actual capture, commit, and playback boundaries | Local WASM practice works without relay or Sheets. Pedal tempo change, fractional and immediate cues, late message, tab stall, Stop, Panic, restart, and two loop passes work. Audio continues through slow drawing. INFO practice and WARN live produce no rich debug artifacts |
| 4. Replay and export | Scrub the recorded timeline and export one short opaque video plus an alpha PNG sequence | Live and offline poses match at the same source frames, fractional-FPS arithmetic, final-frame duration, decode and alpha checks, explicit audio origin |
| 5. Collection and remote display | Knob Goblin, additional chosen assets, and native-host observer adapter | License and storage review, simulated gaps and reconnects, then separate real EliteDesk and display-latency checks |

The phase order reduces asset risk before expanding the cast. It also leaves one reusable evaluator for maintainers. No feature code is authorized by this planning milestone alone.

Fixture tests must cover beat crossings at several sample rates, 30 and 60 FPS, rational FPS such as 30000/1001, mid-beat pedal-tempo changes, multiple same-frame cues, loop endpoints, seeking backward, snapshot watermarks, gaps, duplicates, stale epochs, and bounded queues. Include 4/4 and 6/8 songs with short measures, quarter-, half-, and three-quarter-beat cues, and immediate peripheral effects. In 6/8, assert 480 ticks per numbered beat and 2880 per full measure. Begin pedal taps on each of beats 1 through 6 and verify that neither engine position nor pendulum/downbeat phase resets to beat 1. Changing chart-local BPM metadata must leave evaluated timing unchanged. Replaying each frame sequentially and requesting frames out of order must produce the same pose, including after a pedal-tempo change or a short measure.

Verify DEBUG diagnostics only in debug runs, INFO filtering in practice, and WARN filtering in live performance. A disabled diagnostic must not construct its rich payload or write an artifact. Protocol delivery and explicitly requested replay capture must still work at WARN without enabling DEBUG traces.

Verify that a staged chart refresh cannot change an active run's tempo, cue program, or visual-program selection. Reconnect must reject queued input from the old session. The undefined DYC `d` bindings must remain visible with source locations and owners in inspection output and must prevent a required executable load.

Verify that reassigning a physical button does not retarget an ongoing voice's animation. Two logical voices triggered through one button must retain distinct resource and animation identities. Effect feedback must distinguish live processing from playback of a cached result without requiring video to inspect or process audio.

After envelope timing and song-specific knob bindings are confirmed, compare browser-pad and LED envelope values at identical source frames. Check that SpinTrak direction and distance affect only the declared target and preserve capture-revision identity. A missing binding must remain a diagnostic, never a fallback to gain or a guessed visual parameter.

Inspect rendered images at chosen checkpoints. Pixel-perfect GPU output across platforms is not assumed. Compare deterministic pose data exactly and use a documented image tolerance where antialiasing differs. Verify transparent borders and foot registration through every selected pose.

Future implementation runs the applicable `npm run typecheck`, `npm test`, `npm run check:layout`, browser build, native CMake, and WASM checks. A new `ui/video/` entry needs build and layout integration. Update architecture and development guides with the implementation that establishes these boundaries. The current plan changes no runtime boundary.

Real microphone capture, display latency, projector behavior, phone performance, and hardware controls need separate checks. Fixture success cannot establish those properties. Do not report an audiovisual latency number before measuring the audio output and visible output together.

## Decisions for the operator

1. Is this first a stage visual instrument, an offline music-video assistant, or both with stage visuals first? This plan recommends stage visuals first and offline export from the same scene.
2. Does the initial cast fit? Recommend Mister Metronome and Reel-to-Reel Cyclops, then Knob Goblin. An operator may prefer a theatrical performer such as Disco Moth over the mechanical theme.
3. Should production preserve crisp sprite edges or develop layered illustrated cutouts? Recommend crisp pose frames with restrained part motion, while keeping the original concept sheets untouched.
4. Where will the visuals appear, and must output be transparent? Recommend an opaque 16:9 stage composition plus reusable transparent asset exports until display and editor requirements are known.
5. Are the concept art and any generation inputs owned or cleared for derived assets and publication? Which Figma destination and asset-storage policy should hold the collection? These facts determine provenance and export setup.
6. What period, shape, phase, retrigger, and release behavior should the shared blink/pulse/trigger envelopes use? Which song-specific parameters should knob direction and distance control? Confirm Stop, Panic, song-end, and restart appearance before implementation. The 6/8 eighth-note beat unit is confirmed and no longer blocks timing conversion.

Product choices and missing authoring facts remain open. Block dependent decisions and ask the operator when required facts are missing. Do not replace them with invented answers or defaults. Continue independent work within confirmed scope. Use prototypes for observable technical questions after their inputs are established.

## Planning verification and limits

Verified the managed worktree base, clean initial state, PDF headers, sizes, SHA-256 hashes, page counts, all-page contact sheets, and full-page candidate renders. Read current architecture and development guidance and inspected engine event creation, snapshot decoding, and tracker frame mapping. A separate read-only clock review corroborated the gaps. Performance Engine confirmed the proposed identity, ordering, time, and recovery contract and retained ownership of its implementation.

Read Figma skill guidance and relevant tool descriptions. Reviewed primary PixiJS, Remotion, and FFmpeg license and export documentation on October 26, 2026. No package version was installed or selected. Figma motion entitlement, export fidelity, rendering throughput, and target-device synchronization remain untested.

The October 27 revision follows the coordinator's report of the completed Performance Engine review and directly retrieved operator comments on pedal tempo and logging. Shared contract implementation remains with Performance Engine. No runtime capability is established by these plan changes.

The planning diff contains only this document. No application tests or builds are needed for the document-only milestone. Verify relative source links and `git diff --check` before committing. Do not merge this worktree into the operator's checkout automatically.
