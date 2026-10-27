# Performance Engine plan

Compile the current Dance Yrself Clean worksheet into a human-verifiable performance program. The browser and CLI share deterministic fetch, compile, and inspect operations. Shared C++ executes the result in WASM and on EliteDesk. An LLM may supply mappings and invoke the compiler. Parsing never depends on an LLM.

Revised October 27, 2026 after the 19 inline comments in [PR #1](https://github.com/anulman/show-tools/pull/1), cross-workstream routing decisions in [PR #2](https://github.com/anulman/show-tools/pull/2), and the operator's [PR #3 review](https://github.com/anulman/show-tools/pull/3). This is a plan revision only. No runtime implementation, service startup, ABI change, or merge is authorized. Work stays on `review/performance-engine` in its existing isolated worktree. Missing relevant facts block the affected work until the operator answers. Do not turn open questions into guessed defaults.

## Scope and source authority

DYC is the only song in this delivery. Drunk Girls and I Can Change are deferred. Drop backward compatibility with the old snapshot grammar and executable song overrides. Keep source provenance, not obsolete parser behavior.

The current [DYC worksheet 101](https://docs.google.com/spreadsheets/d/1HZ6FipBtjaqPWAisDmjFY-Vvn_UtUfaH2gsNsY41USg/edit#gid=101) was fetched publicly on October 27 as CSV and XLSX. CSV addresses the numeric worksheet ID directly. XLSX supplies the matching named worksheet's cell notes. These are separate fetches, not a transactional snapshot. XLSX internal sheet ID 6 is not Google worksheet ID 101.

Observed source evidence is recorded here so the review does not depend on temporary downloads.

- Worksheet name is `01 Dance Yrself Clean`. The CSV contains 55 rows and 222 columns. F2 is 98. B3 says `4 beats / bar*`, but its note says detected grouping is not a confirmed time signature.
- Rows 4 and 5 contain sections and bar labels. C5 is bar 1. B5 is now blank, with a note describing an incomplete detected lead-in. HL5 is `218 (part)` and HM5/HN5 are `Tail`. Missing labels are not permission to invent musical lengths.
- Rows 8 through 13 describe voice parts. Row 17 is Knob. Rows 18 through 21 map R1, R2, L1, and L2. Their A-column notes name Drums & Claps, Cowbell, Whistle, and Bing Bong.
- The legend in A44:A55 defines arm, commit, commit-and-arm, explicit stop, play, next-bar suffixes, beat numbers, and apostrophes for sampled playback. It says blank cells do not imply stops and sample endings need explicit exits.
- A17 describes chorus effect activation and video y-axis. J19 and L19 say `If missed play &]'`. These notes are authored requests requiring explicit binding or clarification. They are not evidence of implemented effect, fallback, or video capabilities.
- Source CSV SHA-256 is `0d376fb71341336079d712d23b7e85c0488d8b5cf0ce304b15ec1f4dbffbb1f1`. XLSX SHA-256 is `8625699398fa69b60910c0ac33db5cf53e0f70380ca267d388a5a5887b75a54f`.

The existing code is evidence of implementation limits, not the new notation specification. `chart.ts` assumes four beats and label lookup. `chart-controls.ts` lacks the current grammar. `wasm-performance.ts` lowers objects to numeric tables and `pf_configure()` copies them while stopped. A native song file loader does not exist. ABI 1 supports only four-beat practice and whole-beat scheduled events. These restrictions must change to meet this plan, rather than constrain the authored schema.

## One compiler for browser and CLI

Keep pure parsing, normalization, schema validation, and inspection under `lib/performance/`. TypeScript adapters under `scripts/` provide the CLI. The browser editor and inspector stay under `ui/practice/`. Keep mappings, approved fixtures, and compiled artifacts under `songs/`. DSP, transport, capture, command resolution, and the authoritative clock remain in C++.

Expose the same operations to both hosts.

1. Fetch a public worksheet or import CSV with an explicit source identity. Preserve values, original cell coordinates, and available notes. Freeze this input before compilation.
2. Compile the frozen input plus a versioned mapping into semantic JSON and diagnostics. Compilation is pure and has no network dependency.
3. Inspect the compiled artifact through a generated text report or browser view. Show original text beside normalized cue, applicability, action target, execution time, capture policy, layer or variant identity, and owner dependencies.
4. Prepare and load a validated program while stopped. A failed preparation leaves the previously loaded song usable.

Proposed CLI examples are not available commands yet.

```sh
./show-tools chart fetch --url URL --mapping songs/dance-yrself-clean.mapping.json --out /tmp/dyc.source.json
./show-tools chart compile --source /tmp/dyc.source.json --mapping songs/dance-yrself-clean.mapping.json --out /tmp/dyc.performance.json
./show-tools chart inspect /tmp/dyc.performance.json
```

Ship a default chart-shape profile with mapped label cells and row roles. Validate expected labels and range shape before applying it. Allow explicit overrides for moved rows and changed cells. Never silently choose a similarly named voice or worksheet. The browser can refresh, compile, and inspect edits on demand without a rebuild. It stages a new revision while audio runs, then offers Stop and load. It never replaces an active program mid-run.

Browser public-fetch CORS support must be tested on the deployed origin. If a public export cannot be fetched there, show the error and offer local CSV import. Do not promise direct browser fetch from a successful CLI download. No CDP or Sheets-following helper is involved.

Use the existing Effect dependency for external validation, cancellation, and host cleanup where useful. Read its installed `AGENTS.md` before implementation. The compiler core remains pure and audio processing remains synchronous. Prefer permissive dependencies and review native JSON parser licensing before selection.

## Public access, CSV, and notes

Assume public-readable charts. Use an already configured OAuth credential when available. Without OAuth, try public fetch. Authentication or missing notes must not silently produce a different song. If access fails, return an actionable error. OAuth setup and service-account provisioning are outside this delivery.

Support public CSV export and local CSV import as values-only sources. Decode quoted commas, multiline cells, and UTF-8 correctly. Keep explicit row and column offsets. CSV does not preserve notes. Mark note coverage as unavailable and require an explicit note sidecar or mapping for any executable instruction that depends on a note. A missing required note binding blocks an executable artifact, while the inspector can still show a draft.

Use a note-bearing public acquisition path where available, such as an XLSX export adapter. Validate its named worksheet against the gid-specific CSV and source mapping. Do not confuse XLSX sheet ordinals with Google worksheet IDs. A Sheets API adapter may request bounded grid data when credentials are available. Google's [grid read reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get) and [cell data reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells) define values and notes separately.

Freeze entered values, effective values, display text, and notes when the source supplies them. CSV carries only exported values. Record those capability differences. Formula cells use captured effective values only under an explicit policy. No local formula evaluation occurs. Formula errors fail compilation. Notes on blank cells retain their coordinates. Credentials and acquisition timestamps never enter executable output.

## Meter, measures, and the pedal clock

Annotate a dominant time signature with numerator and denominator. Support at least 4/4 and 6/8. The operator's [6/8 correction](https://github.com/anulman/show-tools/pull/3#discussion_r4385809988) supersedes earlier 6/4 wording. Do not infer a confirmed time signature from DYC's detected-grouping note. The DYC mapping requires an explicit authored meter assertion, reported in the inspector.

Represent every measure's actual length in quarter-note ticks. A normal 4/4 bar has 3840 ticks and a 6/8 bar has 2880 at 960 ticks per quarter. A short measure has an explicit shorter length. Do not assume that every section contains a fixed number of bars. Sections of one or two bars are valid. Meter denominator, numbered cue beat unit, and pedal BPM beat unit are distinct fields. In 6/8, whether cues count six eighths or two dotted quarters, and which unit BPM measures, requires an operator answer. Tick storage supports either. Interpretation and pedal conversion remain blocked without that answer.

The review also says `1-bar or 2-bar measures`. That could mean one- or two-beat short measures, or sections of one or two full bars. The schema supports both independent section spans and explicit measure lengths, but their intended DYC assignments remain an open question. Incomplete lead-in, bar 218, and tail columns require authored treatment. Detected recording timestamps do not establish their performance lengths.

Support cue and capture boundaries at quarter, half, and three-quarter beats, with immediate peripheral effects at the next processable sample frame. Store cue applicability separately from execution time. A cue shown at beat 4 may execute at 4e or the next bar. C++ resolves musical positions to frames and splits audio blocks at those boundaries. Remove fixed four-beat and integer-event assumptions in a coordinated ABI milestone.

Chart F2 supplies an initial reference BPM. Local BPM and detected start-time rows are inspection metadata only. They never change the performance clock. Runtime BPM changes come from pedal controls. Peripherals defines pedal normalization and debounce. The engine applies accepted changes and publishes their effective audio frame, tempo revision, and continuous beat anchor. Video and light adapters consume that clock history. A chart refresh cannot change an active run's BPM.

## Current grammar and unresolved notation

Use a new `dyc-v1` grammar with no legacy compatibility layer. Separate performance notation rows from control rows and descriptive rows. Unprimed performance notation denotes live delivery, and an apostrophe denotes sampled playback. This distinction does not turn every arrangement mark into an automatic command. Trigger type must be explicit.

The table distinguishes operator-defined meanings from meanings still requiring a decision.

| Source or example | Required interpretation or open issue |
| --- | --- |
| `r`, `c`, `cr`, `x`, `p` | Arm, commit now, commit-and-arm, stop, play. The current legend supplies these operations. |
| `rb`, `cb`, `crb`, `xb`, `pb` | Resolve the corresponding action at the next bar. Boundary calculation uses actual measure lengths. |
| `(4)&`, `(4)&a`, `4` | Cowbell positions 4&, 4& plus 4a, and beat 4. Parenthesized 4 supplies the subdivision anchor, not an extra beat-4 hit. J11 and L11 contain `(4)&a`, K11 and M11 contain `(4)&`, and N11 contains `4`. |
| `4xe`, `4xb`, `4x` | Cue availability is at beat 4. Stop executes at 4e, next bar, or immediately respectively. AD18 contains `4xe`; the other two are operator-provided grammar examples. Press tolerance and behavior after the target still need agreement. |
| `c`, `cl`, `cb` | Commit now, commit the last bar, or commit at the next bar. `cl` requires retained prior-bar audio. It is not an alias for next-bar commit. |
| `r`, `clr`, `clr`, `cl` in L19:O19 | Current cowbell capture sequence. Proposed `clr` composes commit-last-bar with arming the next take. Exact capture restart boundary and variant bindings remain open. |
| `rb`, `crb`, `cb` across successive captures | Support distinct retained takes and layered matching parts. Do not collapse every commit into replacement or hardcode the former bars-3/4 cowbell exception. |
| `2c3` at J21 | Multiple beat references around commit. Whether 2 is the cue beat and 3 the commit boundary needs confirmation. Preserve text and report ambiguity. |
| `1p*` at AE18 and AU18 | Beat-qualified play with a star. The star's meaning is not specified by the legend. Do not discard it. |
| `4xe]`, `4x[e`, bracketed spans, and apostrophes | Preserve token positions and span boundaries. Distinguish phrase spans from action suffixes. Exact unusual bracket placement at HL18 needs confirmation. |
| Knob `[4d-`, `d`, `-1d]`, `-3d] [4d-` | Observed span grammar for a requested effect or video control. The letter `d`, dial direction/range, span behavior, and routing need an explicit binding. |
| `If missed play &]'` at J19 and L19 | Conditional fallback request. Define what counts as missed, its hit target, and press window before compiling it into executable logic. |
| `!`, lyrics, continuation marks | Preserve as display or typed arrangement metadata according to row role. Never guess sample or effect commands from free text. |

Whitespace around a complete token can normalize. Preserve internal syntax, brackets, primes, and stars until grammar validation assigns meaning. Unknown or ambiguous executable syntax produces a source-located diagnostic. Draft inspection remains available, but compilation cannot emit an executable program with guessed actions.

## Capture, layers, variants, and uncued presses

Retain commit-and-autoplay and replacement capture as supported operations, while adding explicit retention and layering policies. Distinguish logical voice, immutable take, layer group, and selectable variant. R1/R2/L1/L2 are current button aliases, never logical voice or sample identities. Stable input identity is independent of display labels, which may become Red/Blue/Yellow/Green and remain consistent across songs. A versioned input binding maps each button to cue context and a logical voice such as `cowbell`. A new capture does not erase an earlier take unless an explicit replacement policy selects it.

Matching marked voice parts across capture spans can form a layer group. Compare parsed, normalized phrase identity from the corresponding voice row, not the sample's waveform or an LLM judgment. The mapping records phrase span, equality rule, layer membership, playback gain, and replace versus retain policy. Explicitly different cowbell patterns such as `(4)&a`, `(4)&`, and `4` retain separate selectable variants. Exact same-mark matching across continuation spans, layer balance, and replacement defaults remain decisions to settle against DYC examples before execution fixtures are approved.

For `cl`, recommend bounded rolling history of the already-processed live result so the preceding complete measure remains available at its original engine boundaries. Retain logical voice, route, and graph revision provenance. Capacity must cover supported meter and capture windows at minimum tempo. Preparation happens outside processing. If the requested voice was not processed through its required route during that prior measure, report unavailable history. Do not silently process raw history later and call it the cached live result. Agree how prior voice routing is prepared before implementing retrospective capture. Decide whether repeated commit-last operations retain distinct takes or intentionally reuse one take by authored identity.

Keep sparse extraction available with explicit position and radius hints. The schema can also request full-measure retention. Choose per-voice capture policy from authored mappings rather than preserving the old cowbell override automatically. Capture windows, layer selection, and retained variants all belong to C++ execution.

When a voice has a recording and no sufficiently nearby authored action applies, a peripheral press toggles playback immediately. The engine checks the cue window first, then the toggle fallback. Blank cells do not automatically stop a sample. No recording produces a defined unavailable result. The operator has not specified the nearby window, whether it looks ahead and behind, or tie priority. Keep these questions open. Once chosen, publish the same resolved applicability and chosen action to browser and peripherals. Do not add a second UI timing heuristic.

## Mapping and compiled artifact

Recommend UTF-8 JSON with independent mapping, notation, semantic schema, and binary ABI versions. Use one authoritative validation model, generated TypeScript types where possible, and native conformance fixtures. Do not serialize pointers or native enum ordinals. Reject unknown required capabilities and invalid resource references before load.

The example is a proposed input shape using current source coordinates. `requires-resolution` explicitly prevents the draft from being loaded as an executable song.

```json
{
	"mappingVersion": 1,
	"notationVersion": "dyc-v1",
	"songId": "dance-yrself-clean",
	"profile": "show-tools-chart-v1",
	"source": { "spreadsheetId": "1HZ6FipBtjaqPWAisDmjFY-Vvn_UtUfaH2gsNsY41USg", "sheetId": 101, "sheetName": "01 Dance Yrself Clean", "range": "A1:HN55" },
	"cells": { "title": "B1", "initialBpm": "F2", "meterEvidence": "B3", "sections": "B4:HN4", "bars": "B5:HN5" },
	"dominantMeter": { "numerator": 4, "denominator": 4, "source": "mapping-assertion" },
	"controlRows": { "R1": 18, "R2": 19, "L1": 20, "L2": 21 },
	"voiceRows": { "drums-claps": 10, "cowbell": 11, "bing-bong": 12, "whistle": 13 },
	"inputBindings": { "R1": "drums-claps", "R2": "cowbell", "L1": "whistle", "L2": "bing-bong" },
	"noteBindings": { "A17": "requires-resolution", "J19": "requires-resolution", "L19": "requires-resolution" },
	"partialColumns": { "B": "requires-resolution", "HL": "requires-resolution", "HM": "requires-resolution", "HN": "requires-resolution" }
}
```

The following compiled-cue excerpt separates cue availability and execution. The action requires a qualifying press. It is not an autonomous stop. Beat 4 begins at tick 2880 and 4e at tick 3120 in the asserted 4/4 measure. AD5 is bar 28.

```json
{
	"schemaVersion": 1,
	"songId": "dance-yrself-clean",
	"ticksPerQuarter": 960,
	"cue": {
		"id": "dance-yrself-clean/bar-28/R1/stop",
		"trigger": { "kind": "press", "controlId": "R1", "bar": 28, "cueTick": 2880, "windowPolicyId": "requires-resolution" },
		"action": { "kind": "sample-stop", "voiceId": "drums-claps", "execution": { "kind": "bar-tick", "bar": 28, "tick": 3120 } },
		"source": { "sheetId": 101, "a1": "AD18", "text": "4xe" }
	}
}
```

A complete artifact includes measure lengths, section spans, source columns, cue tables, voice/take/layer/variant resources, effects, input bindings, required capabilities, and diagnostics. It declares automatic versus press-triggered actions explicitly. Schedule fractional ticks in C++, never through JavaScript timers.

Use stable song and authored resource IDs. Generated cue IDs derive from song, logical measure, control, and action role. Positional IDs need explicit authored overrides to survive inserted bars. Keep source coordinates as provenance, not command identity.

Canonical serialization sorts object keys and unordered registries, preserves action and hit order, normalizes line endings, and rejects nonfinite numbers. Hash frozen source, mapping, and normalized program separately. A program digest excludes its own digest field. Acquisition times and debug environment go in a sidecar. Same frozen input and mapping produce byte-identical output. A fresh live fetch may differ.

Diagnostics carry severity, stable code, worksheet ID, A1 coordinate, source text, mapping path, owning workstream, and suggested repair. Separate malformed notation, unresolved authoring decisions, and known but unavailable capabilities. The inspector lists TODO requests with an owner. An engine cannot load unresolved or unsupported required behavior. Errors leave the previous output and loaded song intact.

## Structured notes explained

Structured notes are optional machine-readable instructions stored in a cell note alongside human prose. They let a performer specify a voice, capture policy, or effect binding next to the cue without adding visible chart columns. They are not natural-language parsing. The same instruction can live in a mapping sidecar when notes are unavailable through CSV.

Propose a clearly delimited JSON block prefixed by `show-tools:v1`. For example, a note can contain the following block followed by descriptive text outside the block.

```json
{
	"kind": "voice-effect",
	"voiceId": "cowbell",
	"effectDefinitionId": "echo",
	"instanceId": "cowbell-echo",
	"parameters": { "delayMs": 100, "feedback": 0 }
}
```

Only explicitly mapped notes with the version marker are parsed. Validate units, parameter ranges, target IDs, and capabilities. Preserve prose verbatim. The existing A17/J19/L19 prose does not already satisfy this format. Report a conflict if a note and sidecar bind the same instruction differently. Never silently choose one. The first schema milestone must choose exact delimiters and demonstrate note extraction, CSV sidecar equivalence, and source-located errors. Operator interest is confirmed; syntax and which current prose requests become structured blocks remain review items.

## Effects and owner dependencies

Replace the former single-slot sample-only proposal with ordered effect stacks per logical voice. The contract supports chorus, echo, guitar-like and synth-like transforms through versioned effect definitions, typed parameters, ordered instances, resource requirements, and required capabilities. Slapback is the first DSP demonstration, not the shape of the general song or command schema. Unsupported effect types remain owned TODOs and fail executable loading.

Support voice defaults and overrides for each effect/voice pair. Tune per-effect venue parameters in the web UI. No dedicated parameter-tuning peripherals are planned. Authored knob performance cues such as chorus activation are distinct from venue tuning. Validate UI parameter changes against the selected effect definition, prepare allocating changes outside processing, and report their effective engine revision/frame. Show desired and applied values. Keep venue overrides separate from immutable compiled song defaults.

Start with LIVE voice processing. The mono microphone feeds the selected logical voice's stack, producing audible live output and the processed result cached for sampled playback. Mono dry input reaches both L and R. Preserve stereo created by an effect rather than downmixing it. Entering capture switches from the default live stack to the voice's stack. Leaving restores the default stack at an engine-owned boundary.

Cache the processed PCM together with voice/route/graph revision and capture timing. Sample playback uses that cached result without applying the baked capture stack a second time. Graph provenance is metadata, not a command to rerun the stack. Any intentionally additional playback processing must be explicit. Later venue parameter changes affect subsequent live processing and new captures; they cannot undo an effect already baked into a stored take. The UI needs a clear recapture indication for that case. Agree cached-tail boundaries and continuity at commit/loop boundaries with Filters. Do not infer that all effect tails fit inside the captured measure.

Processed live voice and cached sample playback feed the intended room, monitor, and download mixes once each. Remove the old parallel dry microphone recording contribution for this route. Enable audible live monitoring only when input/output devices differ, or when the matching device is a USB audio interface, as specified in the operator's [monitoring comment](https://github.com/anulman/show-tools/pull/2#discussion_r4385119436). This condition concerns live monitoring, not whether processed voice enters a download. A browser may not expose enough device-type information to prove USB eligibility. Keep that uncertainty explicit and require a verified route configuration rather than infer eligibility from a friendly label. Exact verification UI and multi-output device mapping remain host design work.

Filters owns DSP, prepared stack resources, output taps, and tail handling. The operator confirmed the first slapback defaults of 100 ms, zero feedback for one repeat, wet 0.25, natural tails on detach/bypass, Stop/Panic clearing history, and Start restoring defaults. Represent defaults in the effect definition and song configuration rather than hardcode them into the compiler. General effect lifecycle support must declare tail/resource behavior for each effect. Verify sample stereo, click isolation, monitoring conditions, and no duplicate dry or wet contribution with rendered PCM.

Known requests are tracked as dependencies, not advertised as current features.

| Request | Owner and required agreement |
| --- | --- |
| General ordered effects, voice defaults, effect/voice overrides, live-first capture of processed results | Filters defines DSP resources, lifecycle, and output taps. Performance Engine defines separate button/voice/resource IDs, preparation, graph provenance, and cue results. Cached playback must not rerun baked effects. |
| Per-effect venue tuning | Performance web UI edits validated effect parameters and shows engine-applied values. No dedicated tuning peripherals. |
| Live monitoring eligibility and mono input to L/R | Host verifies differing devices or a shared USB interface. Filters provides processed mix taps without duplicate dry voice. Preserve effect-generated stereo. |
| Knob chorus activation and `d` spans | Filters and peripherals define the operation, units, and physical normalization. Video defines y-axis mapping. Authoring semantics remain open. |
| Pedal-driven tempo | Peripherals supplies normalized input. Performance Engine resolves clock changes and publishes applied-frame tempo history. |
| Variable meter, short measures, fractional boundaries, retrospective commit, layers and variants | Performance Engine owns portable C++ execution and coordinated ABI changes. |
| Conditional missed-cue fallback | Performance Engine and peripherals need operator timing-window and fallback semantics. |
| Light baseline, temporary cue expiry, recording pulse | Peripherals projects engine state. Performance Engine publishes baseline and authoritative timing. |
| Visual replay and seek | Video consumes resolved events and tempo/measure history. It does not reissue audio actions. |

## Runtime identity, time, and logging

Make loaded programs immutable throughout a run. Stage refreshes separately and activate only while stopped. Song digest cannot go stale inside that run. Keep it on load/session manifests for reproducibility, not on every pad command. Reconnect performs a session/run handshake and snapshot before new input. Old queued input is discarded by session identity. No digest-specific Panic exception is needed.

Commands carry producer ID, command ID, producer order, session/run identity, typed target, action, and timing. One engine owner applies ordered controls. Distinguish accepted, applied, duplicate, late, and rejected results. Report application frame and revision. Retry guarantees are bounded by the actual dedup retention policy. Never replay offline presses after reconnection.

The operator inventory specifies I-PAC Ultimate I/O with a directly connected SpinTrak and says all components have arrived. No additional Arduino or controller is assumed. Button inputs are expected as keyboard-style controls. Normalize knob input as direction and distance, then apply the current song's explicit binding. A knob is not a fixed channel-gain control or an absolute-value slider. Exact key assignments, raw knob reports, units, bounds, and controller programming remain facts for the peripherals owner to establish. Do not invent a USB protocol. Coalescing relative knob motion must preserve net distance and discrete-event order after those facts are known; keeping only the last relative update loses motion.

Keep source button ID and resolved logical voice/resource/cue IDs separate. A program binding revision records that resolution. Button light feedback addresses the physical button and its current binding revision, then projects the resolved voice state. Rebinding a button cannot rename or overwrite a voice resource, transfer a cached take, or display stale feedback for the prior binding. Verify explicit rebinding in the simulated adapter.

Current `pf_control()` can call `press()`, then allocating `st_prepare()`. Do not drain arbitrary controls inside a device callback. Audit every command path, define bounded preallocated capture/history/stack resources, and transfer prepared ownership without concurrent mutation of the live engine. Prove an offline block-pump adapter before live device hosting.

Observer state includes engine session, epoch, run, source sequence, frame/rate, continuous quarter-note position, current measure and tick, actual measure boundaries, loop iteration, phase, pedal-tempo revision, cue occurrence, and relevant voice/effect state. Effective-frame tempo anchors support mid-beat changes. Same-frame ordering must be deterministic. Snapshot recovery specifies frame S and last included sequence. Expose drops and explicit discontinuities. Video calibrates presentation anchors with age and uncertainty outside the callback. Network arrival time never advances music.

Required control/state delivery is separate from diagnostic logging. Engine-wide profiles are DEBUG for debug runs, INFO for practice, and WARN for performance. This applies to compiler hosts, adapters, DSP control, observers, and services. Never format logs, allocate log payloads, write files, or send network messages in the audio callback. Use bounded counters and copied records drained outside processing. Debug provenance, PCM artifacts, and verbose traces require debug mode. Full replay capture is an explicit bounded recording feature, not an automatic live log. State needed by lights or Video is not removed by the WARN log threshold.

## Light behavior

Temporary cue or scheduled-hit illumination expires back to the currently bound voice's semantic baseline. Recompute the baseline at expiry, not from the state that existed when the override began. Playing is solid on. Inactive is solid off. Pending actions and recording must use distinct pulse and blink patterns. The operator has not assigned which state pulses and which blinks. Do not retain the earlier guessed recording-pulse assignment or the old native steady recording light as the target behavior.

An applied single-use sample trigger needs a rapid attack, brief hold, and decay on its button LED. Browser pads share the LED's semantic lit/pulse/blink/trigger logic. They can smooth raw values for their own output. Publish state and timing at the corresponding peripheral's actual cadence. Do not invent a common fixed rate, rely on the UI animation timer for music, or restart an envelope on repeated state packets.

Expose baseline state separately from temporary overrides and engine-frame start/deadline. Beat anchors and revisions support consumer interpolation. Pulse/blink assignment, periods, duty cycle, attack/hold/decay durations, priority among simultaneous states, device output protocol, and device cadence are blocking operator/device facts. Peripherals owns those questions and verified controller IO. PE owns the shared semantics and browser projection once answers exist. A lost connection timeout is separate from scheduled-hit expiry and its device behavior must also be agreed. Disconnect handling never stops engine audio, and stale adapters recover from a snapshot.

## Delivery and verification

The first reviewable artifact is a current-DYC draft inspection with every nonempty control token and relevant note classified as executable, ambiguous, or an owned TODO. It must show what blocks execution. The first playable demo follows only after those authoring decisions and required engine capabilities are implemented.

Each implementation milestone ends in verification and a commit.

1. Freeze the approved current DYC source with notes and mappings. Inventory every distinct control token and relevant arrangement pattern. Record unresolved grammar and cross-owner requests. Verify worksheet identity and current coordinates. No other-song migration.
2. Define `dyc-v1`, semantic/mapping schemas, structured notes, and the default chart-shape profile. Settle cue windows, commit-last boundaries, layer rules, incomplete columns, and typed TODO bindings before declaring a complete executable song.
3. Build shared fetch/import/compile/inspect modules and CLI/browser adapters. Test public access without OAuth, configured OAuth use, denied access, CSV with explicit note sidecars, note-bearing import, browser CORS fallback, cancellation, and staging while running. Repeated frozen compilation must be byte-identical.
4. After the timing and authoring blockers below are answered, implement variable measure lengths, fractional cue/capture boundaries, pedal tempo, bounded retrospective capture, layers/variants, and cue-aware toggle resolution in C++. Coordinate ABI and bridge changes before editing shared files. Test 4/4, 6/8, short measures, one/two-bar sections, approved cue/BPM beat units, 0.25/0.5/0.75 offsets, late presses, and immediate actions. Use synthetic PCM and exact frame assertions in native and WASM runners.
5. Implement artifact loading and immutable run lifecycle in both hosts. Reject unresolved capabilities or failed preparation without replacing the loaded song. Verify staged refresh cannot mutate running program/BPM, reconnect discards stale input, bounded deduplication, allocation-free approved callback paths, and dropped-event recovery.
6. Integrate Filters' general effect definitions and voice stacks, beginning with audible live mono-to-L/R processing. Only then verify cached processed sampling and playback without rerunning the captured graph. Test web venue tuning and desired/applied revisions, route provenance for retrospective capture, separate button-to-voice bindings and stable display labels, song-specific relative knob bindings, eligible monitoring routes, downloads, tails/Stop/Panic/Start defaults, input ordering, approved light priorities and envelopes, browser/LED semantic parity, device-cadence updates with consumer smoothing, tempo anchors, and engine-wide log profiles. Light/knob integration remains blocked on the missing device/operator facts. No synthetic result establishes physical device safety or real microphone quality.
7. Exercise browser fetch, review, and stopped load at mobile and desktop widths. Check keyboard/touch controls, Escape-to-Panic, focus, repeated Start, Stop during setup, cue feedback, export progress, and completed downloads. Update architecture, development, song, and practice-contract guides. Delete superseded DYC transformations rather than retain compatibility layers.

Run relevant typecheck, tests, layout checks, WASM build, and native CMake conformance tests for implementation changes. For this docs-only revision, verify JSON examples, current source coordinates and note inventory, coverage of all 19 review comments, and absence of contradictory old constraints. No live services are needed.

After milestone 3, inspect the repeatable workflow before expanding notation. One source-cell edit must produce a deterministic source-located semantic diff and an engine-testable expectation. Keep human authoring decisions distinct from parser bugs and missing runtime capabilities.

## Remaining decisions and review disposition

The operator has settled DYC-only scope, no backward compatibility, browser operations, public fetch with optional OAuth, CSV support, broader meter/fractional timing, pedal-owned BPM changes, general voice effect stacks, live-first processing with cached processed results, separate button and voice identities, web venue tuning, conditional live monitoring, mono input to L/R, log profiles, and current-baseline light restoration. Those are requirements, not questions carried forward from the old plan.

The following missing facts block affected implementation. Ask the operator rather than infer answers. Unaffected planning can continue. The parent coordinator and peripherals owner consolidate device/light questions, while PE owns chart and timing questions.

| Missing fact and operator question | Work blocked until answered |
| --- | --- |
| In 6/8, do numbered cues count six eighth notes or two dotted quarters, and which note unit does pedal BPM measure? | 6/8 cue interpretation, tempo conversion, and related observer/light timing. |
| Which columns are short measures and what are their lengths? What do the incomplete lead-in and tail columns mean for performance? | Measure map and capture/loop boundaries. |
| What is the nearby cue window, tie priority, and late-press behavior? What exactly do `clr`, `2c3`, `1p*`, unusual brackets, and missed-cue notes require? | Executable DYC control grammar and toggle fallback. |
| Which matching spans layer, retain, or replace, and with what balance? What does knob `d` request in this song? Which structured-note syntax is approved? | Layer/variant selection and song input/effect bindings. |
| Which state pulses versus blinks? What periods, duty cycle, trigger attack/hold/decay, overlap priority, and disconnect behavior are desired? | Shared LED/browser light projection. |
| What key mapping and knob report units does the actual controller emit, and what LED output protocol/cadence does it support? | Device normalization, relative-motion batching, and cadence-specific consumers. Peripherals establishes observable device facts and asks for missing configuration. |

Prior-voice processing for retrospective history, cached-tail representation, post-capture tuning UX, and host verification of monitoring eligibility need technical design evidence. Natural stop tails and processed capture storage are settled requirements, not questions to reopen. Unanswered review threads remain open rather than marked resolved.

Performance Engine owns semantic song/command/time contracts and coordinates ABI changes. Filters owns effect resources and DSP. Peripherals owns physical adapters and light projection. Video owns presentation consumers. Owner requests were exchanged directly during this revision. Their responses inform the plan, but do not constitute implemented capabilities or operator decisions on the remaining ambiguities.

The revision is verified as documentation against current public CSV/XLSX and latest PR comments. Compiler/browser behavior, C++ additions, actual effect routing, native hosting, pedal input, and physical lights remain unimplemented and unverified. No automatic merge or operator-checkout integration occurs.
