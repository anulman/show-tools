# Video Assistant plan

Planning milestone, October 26, 2026, revised October 27 after the operator's PR #4 review. This plan includes no feature implementation, dependency installation, Figma mutation, service startup, or merge.

## Build a live stage for Gator and Tapir

The operator selected A07 Gator Crooner and A29 The Tapir Tenor from the PDFs' A section. Build a reusable animated collection around those performers. Their poses and performances need not illustrate clock machinery, recording status, or hardware controls literally.

The primary product is a live stage visual instrument. Characters stand on a digital stage in front of a background, primarily displayed on 4:3 CRT televisions. Use PixiJS for the browser scene. Offline output serves demo sharing after the live instrument works; it is not a separate music-video production workflow.

For each character, retain the original treatment and develop 8-bit, 16-bit, and "Tex Avery animation" treatments alongside it. Every treatment uses crisp pose frames with restrained part motion. Keep a common pose vocabulary, registration baseline, and anchors so the treatments can be compared without changing the performance. Preserve the source PDFs intact.

The first useful demo places Gator and Tapir on one 4:3 stage before a background. Each performs a short authored pose sequence driven by supplied Performance Engine time and control data. A comparison view shows both characters' original, 8-bit, 16-bit, and Tex Avery treatments together. Character animation is artistic performance, not a mandatory reflection of sample capture or playback state.

## Scope and evidence

The authoritative starting scope is `/Users/anulman/dev/show-tools/docs/workstreams.md`, followed by the operator's inline review on [PR #4](https://github.com/anulman/show-tools/pull/4). Read alongside `AGENTS.md`, [architecture.md](../architecture.md), and [development.md](../development.md). The workstream brief postdates the required base checkout. Do not copy unrelated main-checkout changes into this branch.

This plan belongs to `/Users/anulman/.codex/worktrees/b0ba/show-tools/` on `review/video-assistant`, based on `619df0393c2a4fc357e4a2451b8e14e41d7421d4`. Integration remains the operator's decision.

Throughput checkpoint: verify the selected source pages, revise the plan against all eight comments, check the document, commit and push the same branch, and reply to each review thread. Implementation remains a later task.

### The selected source pages are visually verified

At the parent's initial check, both PDFs were empty. They became available offline on October 26. Rechecked their SHA-256 hashes on October 27 against the original visual review.

| Source | Bytes | Pages in this file | SHA-256 |
| --- | ---: | ---: | --- |
| `/Users/anulman/Dropbox/Old TV Character ideas-1.pdf` | 18,501,385 | 55 | `dd3e61e0a655564d098ecdb0fa14767370df2589fd5472d1cc497f3a68eacbb7` |
| `/Users/anulman/Dropbox/Old TV Character ideas-2.pdf` | 17,636,797 | 54 | `9c4a8116a8d7c0d2e0802ba478619167faf431e4c6e1eecee68298e94897974a` |

Used the PDF skill. Poppler was unavailable, so macOS PDFKit rendered all 109 pages to temporary PNGs. Reviewed six contact sheets covering every page. For this revision, inspected Gator and Tapir at full-page scale and extracted their page text directly from the PDF. The unchanged hashes confirm those renders still correspond to the source files.

The collection contains 108 concepts with three poses each. File 1 contains the cover, A01 through A36, and B01 through B18. File 2 continues B19 through B36 and C01 through C36. Its printed page labels continue from 56 through 109. Keep physical PDF page and printed page separate in provenance.

| Selected character | Verified source | Observed artwork | Asset development |
| --- | --- | --- | --- |
| A07 Gator Crooner | File 1, physical page 8, printed page 8 | Lanky jade alligator in a burgundy lounge suit with gold details and cream underside. The tail ends in a microphone. Three studies show a suave stance, open-jaw croon, and embarrassed recoil | Register all three poses. Preserve the tail microphone, long silhouette, jaw expression, and suit. Prepare limited jaw, arm, and tail motion where clean separation is practical |
| A29 The Tapir Tenor | File 1, physical page 30, printed page 30 | Rotund charcoal tapir in plum formalwear with cream shirt and copper-colored trumpet-like trunk. Three studies show a grand stance, trunk trumpet, and bashful curtsey | Register all three poses. Preserve the contrasting round silhouette, trunk, formalwear, and expressive hands. Prepare restrained trunk, hand, and body motion |

The pages have pale presentation panels and visible differences in pose placement. The drawings are exploratory studies, not production sprite sheets. Clean transparency, separate parts, consistent pixel grids, and interchangeable pivots still require asset preparation. No rig or clean alpha is established by the PDF review.

### Produce four treatments of each character

| Treatment | Planned result | Review evidence |
| --- | --- | --- |
| Original | Faithful production poses derived from the selected source artwork | Match silhouette, palette, costume, expressions, and props to the verified pages |
| 8-bit | A deliberately simplified pixel treatment with crisp pose changes and restrained part motion | Review pixel grid, reduced detail, silhouette, palette, and registration alongside the original |
| 16-bit | A richer pixel treatment of the same performer and poses | Review added shading and detail without changing identity, stage scale, or pose meaning |
| Tex Avery animation | An expressive cartoon treatment of the same performer, using readable exaggeration and crisp pose frames | Review expression, anticipation, accents, and restrained part motion without turning every pose into continuous deformation |

Show the eight character-treatment combinations together in a compact comparison board. Keep original source art beside the derived work. These labels specify artistic treatments, not verified emulation of a console or an assumed raster resolution. Exact pixel grids and palette limits need selection for the pixel-treatment pass; that question does not block original-pose preparation or the stage layout.

## Develop the collection in Figma

Use a Figma Design file as the editable asset workshop. Start with the Gator and Tapir family. A full application-screen workflow or Code Layer is unnecessary.

The inspected MCP descriptions expose `upload_assets`, `generate_image`, `use_figma`, `get_motion_context`, `download_assets`, and `export_video`. No file has been created and no account-specific motion capability has been tested. Available tools establish possible operations, not completed asset work.

1. Select an existing destination file or create a Design file through `figma-create-new-file`. Resolve its plan first and establish a file session. Inspect compatible local assets and variables, then call `get_libraries` before `search_design_system`.
2. Place the two selected page crops beside the production work. Preserve the PDFs intact. A raster upload remains a raster reference; it does not separate limbs or recover vectors.
3. Prepare original-treatment model sheets for both characters. Fix relative stage scale, foot baseline, pose bounds, pivots, and anchors. Clean the three source poses before adding motion.
4. Expand those same poses into the 8-bit, 16-bit, and Tex Avery treatments. Show all treatments alongside each other. Add anticipation, accent, recovery, or idle poses only where the chosen short performance needs them. Do not turn this pass into an expansion of the cast.
5. Build a small component family with character, treatment, pose, and independent part identities. Reuse palette variables where compatible. Split nested part properties rather than building an unmanageable variant matrix. Keep deterministic names and returned node IDs for exports.
6. Optional `generate_image` can propose treatment studies and missing poses. It consumes Figma AI credits and returns raster art. Review and clean identity, edges, palette, baseline, and part registration. Do not assume coherent intermediate frames from generation.
7. Author crisp pose holds and restrained part keyframes. When enabled, `figma-use-motion` supports manual tracks, easing, and timeline duration. It requires the account's `metronome` feature flag. If unavailable, static component work can continue and portable keyframes can be authored outside Figma. A missing motion entitlement does not block the asset library.
8. Export transparent PNG poses or atlases and actual vector parts as SVG where appropriate. Record node IDs, source revisions, dimensions, baseline, pivots, and hashes. Normalize supported keyframes into the repository's motion package. That converter is proposed work. Figma seconds must be translated with an explicit reference tempo when a motion is authored in beats.

Figma's inspected `export_video` produces MP4 only from a top-level timeline frame through an asynchronous job with temporary downloads. Use it for asset-motion review and inspect selected exported frames. It does not advertise GIF, animated SVG, transparent video, or a reusable runtime animation package. Resting screenshots verify appearance, not motion. Download selected assets promptly rather than depending on expiring URLs.

Follow `figma-use`, `figma-generate-library`, `figma-use-motion`, and `figma-create-new-file` during their applicable implementation steps. This milestone creates no Figma file or paid generation.

## Render a 4:3 stage with PixiJS

PixiJS is the selected live renderer. Use its scene graph for the background, stage, foreground performers, pose sprites, and separately movable parts. Evaluate pose state from supplied performance time before drawing. Autonomous animation advancement must not become a musical clock.

Compose for a 4:3 audience viewport, with characters on the stage in front of the background. Transparent character assets remain reusable over different backgrounds. The completed stage composition can be opaque. Keep library controls and comparison boards outside the audience output. There is no 16:9 default.

Use crisp pose frames in every treatment. Keep registration stable through pose swaps and restrained part interpolation. The pixel treatments need controlled scaling and edge sampling; choose their source grids before their production pass. Check whether pixel edges and silhouettes survive the eventual CRT path rather than assuming a browser screenshot proves television output.

The physical CRT signal chain, input resolution, refresh cadence, overscan, and number of outputs remain unknown. Those facts affect the device-output adapter and final safe-area check. They do not block the 4:3 scene, comparison board, asset library, or fixture-driven browser demo. Do not assume a connector or an encoder.

| Option | Role in this plan | Tradeoff |
| --- | --- | --- |
| PixiJS | Selected live scene renderer | Supports the sprite-and-part collection with a renderer dependency. Keep time evaluation explicit. [MIT license](https://raw.githubusercontent.com/pixijs/pixijs/dev/LICENSE) |
| SVG or Canvas 2D alone | Comparison alternative, not the selected primary renderer | Fewer dependencies but requires more scene and asset-management code for this collection |
| Remotion | Optional later adapter for sharing a demo | Adds React and an export toolchain. Its eligibility-based license needs review before adoption. It is not required for live readiness |
| Pre-rendered clips | Optional short visual accents | Fixed timing, decode and seek latency, storage, alpha compatibility, and loop seams make them a poor primary interactive performer |
| Pose frames plus runtime keyframes | Selected asset approach inside PixiJS | Preserves expressive drawings and reuses parts without requiring every movement to be a video clip |

Prefer permissive code dependencies. [Remotion's license](https://raw.githubusercontent.com/remotion-dev/remotion/main/LICENSE.md) offers free use to eligible individuals, small for-profit organizations up to three employees, nonprofits, and evaluation. Others require a Company License. It is not MIT. Recheck the exact version and use if the demo-sharing workflow needs it.

[FFmpeg's license depends on build options](https://www.ffmpeg.org/legal.html). Its base is LGPL-2.1-or-later, with optional GPL components. Record the actual build, codecs, notices, and redistribution policy before bundling an export tool. Figma is a commercial authoring service, and AI generation has credit costs. No encoder or authoring service belongs on the audio callback.

The [operator cleared all assets for publication](https://github.com/anulman/show-tools/pull/4#discussion_r4386243860). Record that clearance in provenance. Do not keep rights confirmation as an open question. Retain source, authoring-tool, prompt, font, and dependency records for reproducibility and attribution.

## Consume Performance Engine data at the video boundary

Performance Engine owns musical execution, semantic controls, timing, and the compiled-song and WASM contracts. Video accepts its authoritative time and resolved control data. It owns the asset library, stage composition, artistic motions, and mappings from supplied semantic controls to visual parameters. It does not prescribe unrelated song behavior or implement a second clock.

Existing [performance_engine.h](../../lib/performance/include/performance_engine.h) snapshots include frame, epoch, clock beat frame, position beat, and dropped-event counts. [NativePerformance.events()](../../lib/performance/wasm-performance.ts) retains sequence numbers and optional frame and sample-rate fields. Beat events are timestamped; most other current events have no public timestamp. `decode()` omits some native timing fields from [PracticeEvent and PracticeState](../../lib/performance/model.ts). [PracticeAudio](../../ui/practice/audio.ts) adds chart metadata, and the [tracker port](../../ui/practice/runtime/beat-worklet.js) supplies a separate context-frame mapping. The public practice API has no complete replay or visual seek facility today.

Coordinate only the data video needs. The following remains a proposed bridge contract until Performance Engine implements it.

| Data | Video use |
| --- | --- |
| Session, epoch, run, source sequence, and program/resource identity | Reject stale observations and identify the source of poses and controls |
| Authoritative frame and sample rate | Evaluate the pose at a source time and calibrate display presentation |
| Musical position with explicit beat unit, actual measure length, loop iteration, and effective tempo anchors | Follow rhythmic motion across tempo changes and short measures |
| Stable semantic control, cue, logical voice/resource, and effect-instance identities with resolved values and effective frames | Route supplied events to declared visual bindings without inferring a voice from a button ID |
| Snapshot watermark, active state, discontinuity reason, and drop information | Recover after gaps or reconnects without replaying audio commands |

In 6/8, the operator confirmed chart counts and pedal taps of 1, 2, 3, 4, 5, 6 as eighth-note pulses. At PE's 960 ticks per quarter note, each numbered beat is 480 ticks and a full measure is 2880 ticks. Quarter-, half-, and three-quarter-beat offsets are 120, 240, and 360 ticks. Use PE's resolved frames. Chart-local BPM and detected start-time rows are metadata, not a source of animation time.

Pedal tapping may begin on any beat. Video follows PE's existing position without inferring or resetting a downbeat, bar phase, beat number, epoch, or loop iteration from tap onset. Tempo estimation and pedal handling remain PE's responsibility. They are not asset-library configuration questions.

R1, R2, L1, and L2 are input button IDs, not logical voices. Bind supplied controls through their semantic target. A visual knob binding can target any declared scene or character parameter. Do not assume rotation means gain, delay, or a fixed character response. Video does not need to implement physical knob IO to consume those controls.

The DYC `chorus/video-y` and `d` spans remain song-specific integration work with PE and Filters. Do not invent their routing, range, or span behavior. A missing binding blocks that scene-control assignment only. It does not block cleaning Gator and Tapir, developing the four treatments, composing the 4:3 stage, or previewing a declared animation with fixture time and controls. Validation of a complete song belongs to PE.

Browser-pad and physical LED blink/pulse envelopes belong to PE and peripherals. They impose no waveform, output-cadence, retrigger, or readiness requirement on the video library. Character motion and scene behavior do not have to reproduce those envelopes. If an optional performance-indicator overlay is requested later, that narrow integration can consume its approved semantics.

For local WASM, use the bridge's engine-frame to AudioContext mapping and calibrate output presentation where the browser supports it. A draw callback samples performance time; callback count does not advance a song. On a resumed tab, obtain fresh state and evaluate the current pose. For a native host, publish copied observations outside the audio callback. Video rendering, logging, asset loading, and export must never stall audio.

### Evaluate motion without inventing song policies

- Store rhythmic keyframes in explicitly defined musical units and evaluate them from PE tempo anchors. Keep second-relative motions explicit where an artistic accent needs fixed duration.
- Use PE's actual measure and loop positions. Preserve fractional cue times until source-frame resolution. An immediate control is observed at its effective frame and drawn at the next available display frame; the screen is not sample-exact.
- Give motion clips explicit boundaries and source ordering for ties. A pose evaluated at a given source time must be independent of the number of prior draw calls.
- For gaps, stale runs, and discontinuities, recover from supplied snapshots. Reconstruct visual state without issuing audio controls or changing the loaded song.
- Visual seeking is useful for asset preview and debugging. It does not require live audio seeking or a full offline editor.
- Stop, Panic, song-end, retrigger, and reconnect appearance belong to the scene bindings. Define a behavior when authoring a scene that needs it. Missing choices block those bindings, not the library or unrelated motions. No freeze, blackout, or release pattern is silently selected.

## Keep each artifact in its owner

The following are proposed locations, not directories created by this milestone.

| Location | Responsibility |
| --- | --- |
| `assets/video/sources/` | Intact source references and checksums, with originals stored according to the chosen repository policy |
| `assets/video/manifest.json` | Character, treatment, source PDF/page/crop, publication clearance, tools and prompts, Figma revision, export hashes, dimensions, alpha, pivots, and baseline |
| `assets/video/characters/<id>/<treatment>/` | Selected pose images or atlas, actual vector parts, frame bounds, anchors, and small review stills |
| `assets/video/motions/` | Versioned declarative pose holds and keyframes, explicit time units, interpolation, and resource references |
| `ui/video/` | PixiJS renderer, asset browser, eight-combination comparison view, stage preview, audience output, and later demo-sharing adapter |
| `lib/video/` | Reusable synchronous C++ pose evaluation intended for native and browser WASM use. Rendering remains in the browser adapter |
| Song/scene configuration at the agreed PE boundary | Explicit assignments from supplied time and semantic controls to visual parameters. No hardware semantics inferred from button names |

The portable evaluator takes prepared motion data, resolved controls, and a requested source position. It returns pose data such as transform, visibility, and selected frame. Keep it outside the audio callback. TypeScript owns browser adaptation and authoring/export tools. Effect may help asynchronous loading, cancellation, and external-input validation; read `node_modules/effect/AGENTS.md` before writing Effect code.

Preserve originals. Keep temporary PDF renders, contact sheets, bulk frame sequences, and generated demo videos out of ordinary commits. The proposed Git policy stores manifests, selected production assets, and approved small exports. Choose Git LFS or external storage before adding the approximately 36 MB PDFs or bulk generated output. That storage decision affects bulk import, not source-page analysis or plan review.

### Keep runtime diagnostics appropriate to the mode

Apply the [operator's logging policy](https://github.com/anulman/show-tools/pull/1#discussion_r4384901380) at the video integration boundary. Rich DEBUG pose traces, calibration samples, and sampled-frame diagnostics are for debug runs. Practice filters below INFO; live performance filters below WARN. Disabled diagnostics must not construct rich payloads or write artifacts.

Required time, control, and snapshot delivery remains available at every logging level. Keep diagnostic overlays off the audience output. A requested demo capture stores the minimal required source timeline and scene/resource identities without enabling DEBUG traces.

## Share demos after the live instrument works

Reuse the live scene, assets, and motion evaluation to share a demo. A recorded source timeline can reproduce a take; fixture time can produce an explicitly authored preview. Avoid a separate edit suite, primary offline workflow, or mandatory export dependency for live readiness.

Keep transparent PNG poses and atlases as the reusable foreground assets. Share the composed 4:3 stage as an opaque MP4 when the demo-sharing adapter is implemented. A PNG sequence can provide reference frames for verification. Transparent WebM or ProRes masters are optional follow-up formats only if a concrete demo-sharing need requires them.

For offline frame n at rational FPS P/Q, evaluate source time at `startFrame + n * sampleRate * Q / P` without repeatedly adding rounded frame intervals. Use the same pose evaluation as the live scene. Store an explicit audio-to-performance origin if the demo includes audio. Current practice recording starts on a delivered playing-state message and exports MP3, so exact audiovisual master alignment is not established.

[Remotion documents transparent export](https://www.remotion.dev/docs/transparent-videos) and a [frame-based composition API](https://www.remotion.dev/docs/use-current-frame). Those are comparison capabilities, not new requirements. Decide whether a Remotion adapter earns its extra toolchain only when implementing the limited demo-sharing workflow. No export output has been produced or validated in this milestone.

## Deliver in verifiable phases

| Phase | Deliverable | Evidence before its commit |
| --- | --- | --- |
| 0. Plan review | This revised plan and eight inline replies | Exact Gator/Tapir source pages, complete comment coverage, relative links, whitespace, and plan-only diff |
| 1. Original poses and treatment board | Gator and Tapir original poses plus 8-bit, 16-bit, and Tex Avery versions alongside them | Eight character-treatment combinations; source fidelity, crisp edges, stable scale, anchors, and pose registration |
| 2. Portable motion and PixiJS stage | Crisp pose holds and restrained part motion on a 4:3 stage before a background | Native/WASM pose agreement, direct-seek equivalence, fixture-driven PixiJS scene, alpha edges, and no autonomous musical clock |
| 3. First live demo | Gator and Tapir perform from PE time/control data; artist can compare treatments in the library | Tempo changes, fractional and immediate controls, short measures, loop boundaries, gaps, tab stalls, and audio continuity; no dependency on LED decisions |
| 4. CRT output verification | The same stage on the operator's actual television path | Confirm signal chain first; verify aspect ratio, safe area, legibility, edge treatment, and measured sync on real output |
| 5. Demo sharing | One short 4:3 export of the stage | Decoded first/last frames, matching poses at source times, correct duration, explicit audio origin, and no requirement for an offline editing suite |

Fixture checks cover sample rates, rational display/export FPS, out-of-order seeking, tempo anchors, same-frame controls, duplicates, stale runs, snapshot gaps, and loop transitions. In 6/8, assert 480 ticks per numbered beat and 2880 per full measure. Pedal taps beginning on any beat must not cause an invented visual downbeat. Changing chart-local BPM metadata must not change animation time.

Compare pose data exactly and rendered images with a documented tolerance for platform antialiasing. Inspect all treatments at intended display scale, on the 4:3 background, and over light/dark alpha-check backgrounds. Confirm part motion does not break outlines or foot registration. Pixel grids, background artwork, and real CRT output require their own targeted review.

Run applicable typecheck, tests, layout checks, browser build, native CMake, and WASM checks when implementation changes those layers. Integrate `ui/video/` with the build and update architecture/development guides when the boundaries actually land. This document-only milestone needs document and scope checks, not application builds. Fixture output cannot establish physical television behavior or measured audiovisual latency.

## Ask only for facts needed by the next video step

Confirmed decisions are Gator and Tapir, live-stage priority, PixiJS, original plus 8-bit/16-bit/Tex Avery treatments, crisp poses with restrained part motion, characters before a background, primarily 4:3 CRT output, and publication clearance. Do not reopen these as questions.

The following missing facts affect only the named work.

- Figma destination and plan. Needed before creating or importing into a file. PDF analysis and asset specifications can proceed.
- Pixel grids and palette limits for the two pixel treatments, plus the stage/background art direction. Resolve in the treatment and composition review before the corresponding production pass. Do not invent a console resolution or background design.
- CRT signal chain, target input resolution/cadence, overscan, and output count. Needed for the real-device adapter and final display verification, not for the generic 4:3 library.
- Bulk asset storage policy. Needed before importing originals or generated bulk output into Git.
- A scene's specific control-to-visual mappings and lifecycle appearance, when that scene is authored. Accept PE data; do not require unrelated song, pedal-estimator, LED, or peripheral-policy decisions to build the library.

Block dependent work when a required fact is missing and ask a concise scoped question. Continue independent work within confirmed scope. No implementation is authorized by completing this review.

## Review coverage and verification limits

| Operator comment | Changed section |
| --- | --- |
| [4386073580](https://github.com/anulman/show-tools/pull/4#discussion_r4386073580), start with Gator and Tapir | Build a live stage; selected source pages; phases |
| [4386136571](https://github.com/anulman/show-tools/pull/4#discussion_r4386136571), PixiJS | Render a 4:3 stage with PixiJS; ownership; phases |
| [4386228864](https://github.com/anulman/show-tools/pull/4#discussion_r4386228864), live stage first | Build a live stage; share demos; phases |
| [4386230386](https://github.com/anulman/show-tools/pull/4#discussion_r4386230386), A-section cast | Selected source pages and full-page verification |
| [4386236854](https://github.com/anulman/show-tools/pull/4#discussion_r4386236854), four treatments | Produce four treatments; Figma; comparison board; verification |
| [4386242270](https://github.com/anulman/show-tools/pull/4#discussion_r4386242270), stage before background and CRTs | Render a 4:3 stage; CRT phase; targeted device questions |
| [4386243860](https://github.com/anulman/show-tools/pull/4#discussion_r4386243860), publication clearance | License/provenance paragraph; manifest; confirmed decisions |
| [4386247382](https://github.com/anulman/show-tools/pull/4#discussion_r4386247382), irrelevant envelope question | Consume PE data; motion boundaries; scoped missing facts; removed LED gates |

Fetched the full paginated inline-comment list and submitted reviews on October 27. Rechecked the original PDF hashes and the exact Gator/Tapir pages visually and through PDFKit text. Read the updated repository conventions and coordinated the generic time/control boundary with PE. Existing timing observations describe the base code; proposed adapters, Figma exports, PixiJS output, and CRT behavior remain unimplemented.

The earlier license/tool review used primary PixiJS, Remotion, and FFmpeg sources and the applicable Figma skills. No dependency version, account motion entitlement, physical output path, throughput, or export fidelity has been established. Keep those limits distinct from the operator's confirmed artistic direction and publication clearance.
