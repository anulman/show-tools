# Performance Engine plan

This plan lets a performer compile a mapped Sheets chart into a reviewable song that runs with the same musical behavior in browser WASM and a native host. Maintainers get one versioned semantic format and a repeatable compiler instead of song-specific parsing in UI code.

Status is proposed, October 26, 2026. Implementation waits for operator review. The authoritative scope is `docs/workstreams.md` in the operator checkout, read on this date. This isolated checkout starts at `619df0393c2a4fc357e4a2451b8e14e41d7421d4`. No source, ABI, service, or hardware behavior changes in this milestone.

## Current behavior and missing pieces

The following evidence is from the base commit.

- `lib/performance/chart.ts` finds rows by text labels, reads the title from B1, finds dominant BPM, assumes four beats per bar, and preserves worksheet column numbers. It ignores local BPM and start-time rows. Numbered bars must be consecutive. Only a final `(part)` bar is excluded from the default playable range. A missing lead-in silently falls back to column A.
- `lib/performance/chart-controls.ts` deterministically compiles four pad rows. Unknown syntax becomes an unsupported action that can fail at runtime. Capture hints come from explicit song-script assignments.
- `songs/*.chart.json` store values and row-name-keyed notes. They cannot represent every cell's note and coordinate. DYC's Knob note says `Chorus effect activation; video y-axis`; prose does not specify an executable binding.
- `songs/dance-yrself-clean.ts` retains whole cowbell bars as named variants. Presses in active bars 2 and 3 prepare captures for bars 3 and 4. Arrangement notation selects double takes in bars 8 and 10. The script removes corresponding manual tap cues but preserves explicit stops.
- `lib/performance/model.ts` defines `SongScript`, `Program`, controls, capture hints, events, and variant playback. All three bundled scripts have empty scheduled events and begin without samples. Drunk Girls and I Can Change have blank pad rows.
- `lib/performance/wasm-performance.ts` currently lowers program objects into numeric tables. `pf_configure()` copies those tables atomically while stopped. There is no native compiled-song file loader. The host loader must be built, rather than described as existing.
- `lib/performance/include/performance_engine.h` has ABI version 1, four channels, 4096 bars, 4096 scheduled events, and a 512-event queue. The bridge permits 16 hits per cue and 16 variants per channel. Native practice requires four beats per bar and 40 to 240 BPM. Scheduled program events use whole-beat offsets.
- `lib/performance/src/performance_engine.cpp` owns timing and cue execution. It has bounded command deduplication with 256 entries. Current `PracticeEvent` exposes frame and rate but omits some native clock fields. It lacks a complete observer replay contract.

## Compiler shape and ownership

Use a TypeScript CLI under `scripts/` and pure compilation modules under `lib/performance/`. Keep mappings, frozen source fixtures, and compiled song data under `songs/`. Browser controls and review UI stay under `ui/`. Shared C++ owns execution, timing, sampling, patch processing, and cue decisions.

The proposed pipeline has explicit boundaries.

1. `fetch` validates a Sheets worksheet URL and explicit mappings, reads bounded grid data, and saves a source snapshot. Fetching is separate from compilation.
2. `compile` accepts only the frozen snapshot and mapping file. It validates cells, parses notation, resolves declarative capture and variant rules, and emits canonical semantic JSON with source locations.
3. `inspect` generates a plain text report from that artifact. It shows each active source cell, normalized action, target, timing, capture policy, variant selection, notes, and diagnostics. The report does not reinterpret notation.
4. The browser loader and native loader validate the same semantic artifact. They prepare resources while stopped and lower into engine-owned tables. They fail before replacing a working song if validation or preparation fails.

Proposed commands are examples of the intended interface, not commands available today.

```sh
./show-tools chart fetch --mapping songs/dance-yrself-clean.mapping.json --out /tmp/dyc.source.json
./show-tools chart compile --source /tmp/dyc.source.json --mapping songs/dance-yrself-clean.mapping.json --out /tmp/dyc.performance.json
./show-tools chart inspect /tmp/dyc.performance.json
./show-tools chart verify --song dance-yrself-clean
```

Do not use browser automation, CDP, an LLM, or live network access during `compile`. An LLM can choose mapping arguments and run these commands. It cannot supply hidden parsing rules.

Use the existing Effect dependency for CLI resource cleanup, network errors, and external schema validation where useful. Read `node_modules/effect/AGENTS.md` before writing Effect code. Keep parsing pure and engine processing synchronous. No new runtime dependency is selected in this plan.

## Sheets input and notes

Use the Sheets API `spreadsheets.get` grid response with explicit ranges and a field mask. Request worksheet properties, grid offsets, merges, and each cell's entered value, effective value, formatted text, and note. Google documents range-limited reads and field masks in [spreadsheets.get](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/get). Its [CellData reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/cells) defines notes and the distinct value fields.

Recommend operator OAuth with the read-only Sheets scope for private charts. A service account is an alternative only when the operator shares the file with it. Public-read access can be supported if the same grid fields are available. Do not fall back to CSV because it loses notes. Credentials stay outside artifacts and command logs. No authentication flow or service starts in this planning milestone.

Validate the spreadsheet ID, numeric worksheet ID, worksheet name, and requested ranges against returned metadata. A link without `gid` needs an explicit worksheet mapping. Conflicting URL and mapping IDs are errors. Do not infer another worksheet from its title. Quote worksheet names in A1 requests and retain original row and column offsets.

Freeze all mapped ranges together where practical. The snapshot records the exact response content used, not a promise of transactional consistency across separate requests. Compile formula cells from captured effective values only when the mapping explicitly permits that policy. Retain formula and displayed text for review. Formula errors fail compilation. Default cue cells require literal strings. Numeric BPM uses a numeric effective value or a locale-independent numeric literal.

Store notes on every captured cell by coordinate, including notes on blank cells. Label notes provide display names only when mapped as such. A note with prose such as the Knob note is retained as metadata and flagged as an unbound control description. Executable note data needs an explicitly selected, versioned grammar. No natural-language inference occurs. Legacy `rowNotes` can migrate to mapped label cells with a diagnostic that exact historical provenance was reconstructed.

## Mapping example

This proposed example uses verified DYC row and cell positions. It shows the contract shape, not a completed schema. Every range is relative to worksheet 101. Full compilation includes the complete chart, not only the filled practice section.

```json
{
	"mappingVersion": 1,
	"songId": "dance-yrself-clean",
	"notationVersion": "legacy-pad-v1",
	"source": {
		"url": "https://docs.google.com/spreadsheets/d/1HZ6FipBtjaqPWAisDmjFY-Vvn_UtUfaH2gsNsY41USg/edit#gid=101",
		"sheetId": 101,
		"sheetName": "01 Dance Yrself Clean",
		"range": "A1:HN24"
	},
	"cells": {
		"title": "B1",
		"bpm": "F2",
		"sections": "B4:HN4",
		"bars": "B5:HN5",
		"leadIn": "B5"
	},
	"meter": { "beatsPerBar": 4, "beatUnit": 4 },
	"controls": [
		{ "id": "L1", "cues": "B20:HN20", "nameNote": "A20" },
		{ "id": "L2", "cues": "B21:HN21", "nameNote": "A21" },
		{ "id": "R1", "cues": "B18:HN18", "nameNote": "A18" },
		{ "id": "R2", "cues": "B19:HN19", "nameNote": "A19" }
	],
	"captures": [
		{ "controlId": "R2", "activeBar": 2, "kind": "whole-bar", "variantId": "cowbell-double" },
		{ "controlId": "R2", "activeBar": 3, "kind": "whole-bar", "variantId": "cowbell-single" }
	],
	"variantRules": [{
		"id": "cowbell-arrangement",
		"cells": "B11:HN11",
		"fromBar": 5,
		"channelId": "R2",
		"selector": "legacy-tap-hit-count",
		"oneHit": "cowbell-single",
		"multipleHits": "cowbell-double",
		"replacePadTapOnly": true
	}],
	"metadataRows": [17, 22, 23, 24],
	"practice": { "startBar": 1, "endBar": 76 },
	"finalPartialBar": "exclude-from-default-range"
}
```

`variantRules` is a closed registry of typed deterministic rules, not arbitrary JavaScript. The example preserves the existing DYC rule. A missing or non-tap arrangement cell produces no variant selection. Capture `activeBar` identifies where the press occurs, not the first recorded bar. Mapping validation checks that an assignment refers to an arm or commit-and-arm action.

## Artifact and normalized time

Recommend UTF-8 JSON for the semantic interchange format. JSON is inspectable and usable by both hosts. A binary or generated C++ table format can follow if measured loading costs justify it. Do not serialize WASM pointers, native enum ordinals, or current fixed-width double rows into the public schema.

Define an authoritative `songs/schema/performance-v1.schema.json` and a mapping schema. Derive TypeScript types from the authoritative validation model and check its agreement with JSON Schema. Validate native input independently using shared conformance fixtures. Select a permissive native JSON dependency only after inspecting existing build constraints and licensing.

Separate `schemaVersion`, `notationVersion`, compiler version, and the native `pf_abi_version()`. A schema change is not automatically an ABI change. Unknown major versions, required capabilities, action kinds, and resource references fail loading. A schema-owned metadata object is the only extension area allowed without executable meaning.

Use explicit song, control, channel, variant, patch definition, patch instance, cue, and rule IDs. Compiler-generated cue IDs derive from song ID, logical bar ID, control ID, and action role. Coordinates stay in source references rather than command identity. IDs remain stable across cell-value edits. Bar insertion changes positional bar IDs unless an explicit authored ID mapping supplies stability. Do not claim positional IDs survive arbitrary chart rearrangement.

Use integer ticks at 960 ticks per quarter note. Bars are one-based. Within-bar ticks are zero-based. Lead-in is a distinct position kind. Convert existing zero-based beat offsets exactly into ticks. Sparse search radii use ticks, so 0.2 beat is 192 ticks. Runtime BPM and sample rate determine frames in C++, not in the compiler. Version 1 validates the present four-beat practice limit. It does not silently add meter changes, tempo maps, or fractional scheduled-event support to ABI 1.

The full artifact contains transport defaults, sections and bar-column mapping, controls, resources, scheduled events with a repeat period, press-triggered cue tables, capture policies, automatic variant selections, source cells, and diagnostics. Preserve the current program's four-beat repeat period for scheduled events even though current lists are empty. Do not replace that period with total song length during migration.

The following valid JSON is an illustrative excerpt of one compiled cue. The full artifact includes all bars and channels, the source map, capability requirements, and content digests.

```json
{
	"schemaVersion": 1,
	"notationVersion": "legacy-pad-v1",
	"songId": "dance-yrself-clean",
	"timing": { "ticksPerQuarter": 960, "beatsPerBar": 4, "bpm": 98 },
	"cue": {
		"id": "dance-yrself-clean/bar-2/R2/press",
		"when": { "kind": "press", "controlId": "R2", "activeBar": 2 },
		"action": {
			"kind": "capture-arm",
			"channelId": "R2",
			"timing": { "kind": "next-bar" },
			"capture": { "kind": "whole-bar", "variantId": "cowbell-double" }
		},
		"source": { "sheetId": 101, "a1": "D19", "text": "rb", "mappingPath": "/captures/0" }
	}
}
```

Canonical serialization sorts object keys and explicitly unordered registries, preserves hit and action ordering, normalizes text line endings, rejects nonfinite numbers, and omits timestamps from executable output. SHA-256 digests cover canonical frozen source, mapping, and semantic program separately. A program digest excludes its own digest field. Acquisition timestamps and compiler environment belong in a sidecar manifest. Compiling the same frozen source and mapping must yield identical bytes on repeated runs. Refetching a changing spreadsheet does not promise identical bytes.

## Notation and execution invariants

Document `legacy-pad-v1` from the actual parser before introducing a stricter notation. Keep compatibility changes visible.

| Source | Compiled meaning |
| --- | --- |
| Blank | No action. |
| `r`, `c`, `cr`, `x`, `p` | Arm, commit, commit-and-arm, stop, or play immediately. |
| The same action with suffix `b` | Resolve at the next bar in C++. During lead-in, an armed capture targets the first song bar. |
| `1` through `4` with `e`, `&`, `a` | Ordered manual-hit cue with sixteenth positions. One press plays one hit. |
| `&a]` | Ordered positions at ticks 3360 and 3600 within the bar. |
| Unknown syntax | A source-located error. No executable artifact is written. |

The legacy parser removes brackets, apostrophes, and whitespace for tap parsing. A closing bracket initializes the beat to 4. It permits duplicate or nonchronological hits. Compatibility fixtures preserve accepted meaning and add warnings for ambiguous bracket use. A future strict grammar needs a new notation version, not a silent parser cleanup.

Preserve these observable behaviors in C++ conformance tests.

- Commit begins loop playback at its boundary. Commit-and-arm starts replacement capture while the committed take plays.
- Blank cues never stop or start a loop. A future column never runs early because the UI displays it.
- Sparse extraction uses hinted positions and radius. Missing loop hits stay silent. Missing manual hits report an error. Manual-hit order resets each bar.
- A manual hit temporarily suppresses its running loop and resumes the loop at the next bar. Tap positions identify the retained pattern, not autonomous trigger times.
- DYC retains the complete bars 3 and 4. Its arrangement switches variants only for an already-running loop. Explicit stops suppress playback.
- Loop wrapping, partial-bar defaults, count-in, Stop, Panic, microphone requirements, unity gain, and mute phase preservation remain unchanged.
- Preserve source-column mapping for Sheets observation without making Sheets delivery a clock source.

Validate limits before output and again before engine load. Diagnose mismatched range lengths, missing label notes, duplicate mappings and IDs, missing bar numbers, orphan capture hints, unknown variants, unresolved control bindings, invalid tempo, and unsupported engine capabilities. Diagnostics carry severity, stable code, worksheet ID, A1 coordinate, source text, mapping path, and a specific repair suggestion. Errors produce a nonzero exit and leave prior output intact. Warnings appear in JSON and the review report. Unmapped nonempty control rows are visible as warnings, never silently executed.

## Patch and control cues

Filters owns DSP and proposes one prepared slapback slot per sample channel. The shared semantic contract uses stable patch definition and instance IDs and an explicit target such as `{ "kind": "sample-channel", "channelId": "R1" }`. Operations are attach, detach, set bypass, and set parameters. Commands describe desired state rather than toggles. A mapped cell can bind a press to one of these operations or define an automatic cue. Trigger kind and timing are explicit.

Filters proposes delay 40 to 250 ms with default 100, feedback 0 to 0.7 with default 0, wet 0 to 1 with default 0.25, and unity dry gain. These are proposed validated patch-definition constraints, not generic compiler constants. Parameter names, units, and ranges come from the agreed versioned patch definition.

The latest routing proposal is sample voices summed per channel, then patch, then channel gain and mute, then master gain and sample mix. Raw capture, click, and the recording-only live voice are excluded. Detach and bypass preserve natural tails. Global Stop and Panic clear history. Channel stop drains tails. Mute silences tails while delay time advances. Start restores song defaults. Loop wrap retains patch state. This supersedes Filters' earlier post-gain sketch. These lifecycle defaults need rendered-PCM fixtures before implementation is accepted. Live-voice processing remains an operator routing decision.

Prepare patch resources while stopped. Validate every reference and required capability before swapping a song. Compilation can produce a structurally valid patch cue for a future capability, but loading it into ABI 1 must fail. Unknown operations never degrade to no action. No dynamic graph editor is required for the first patch.

## Commands, clock, and observer contract

These are proposed semantic host fields. Several require coordinated additions to current native event records. They are not claims about the existing ABI.

| Contract | Required meaning |
| --- | --- |
| Program identity | Stable `songId` plus exact `programDigest`. Resource references resolve before load. |
| Command identity | `producerId`, `commandId`, `producerSequence`, target engine session and run, expected program digest, typed action, explicit target, and timing policy. |
| Application result | Accepted, applied, duplicate, stale, late, or rejected with reason. Accepted into a host queue does not mean applied to audio. Applied results carry effective engine frame, epoch, command ID, and state revision. |
| Time | Engine session ID, run ID, epoch, monotonically increasing source sequence, processed audio frame and sample rate, beat ID, normalized musical position, BPM, phase, loop iteration, and tempo revision with effective source frame. |
| Cues | Stable authored cue ID and occurrence identity containing run, loop iteration, source sequence, and effective frame. Repeated occurrences retain the authored cue ID. |
| Feedback | Immutable channel and patch state, light kind, release start/end engine frames, state revision, queue drop count, and a complete resynchronization snapshot at frame S with the last included sequence and active visual cue state. |
| Discontinuities | Explicit start, stop, restart, loop, seek, clock reset, program change, and sample-rate change reasons where supported. Unsupported seeks fail explicitly. |

The host authenticates and validates external input, orders accepted commands, and queues them to one engine owner. Preserve producer order. Do not claim a total causal order between different producers until the host assigns one. Reconnection starts with a snapshot and identity check. Do not replay stale presses into a new run. Native deduplication is bounded today. Retry guarantees must name that bound and retention policy rather than claim permanent exactly-once delivery.

Single ownership does not prove realtime safety. The current `press()` calls `st_prepare()` for arm and commit-and-arm. `st_prepare()` calls `allocate_sample()`, which allocates sample storage. Do not drain arbitrary `pf_control()` commands inside a device callback. Before live hosting, audit every command path and design bounded capture preparation outside processing, with prepared-resource ownership transferred to the engine owner. Do not concurrently mutate a live engine from a preparation worker. First prove the service adapter with an offline block pump. The allocation audit and any prepare/apply API split are coordinated contract work, not work delegated to hardware wiring.

Immediate UI actions apply at the next processing opportunity. Musical beat and bar targets are resolved by C++. A requested past frame needs an explicit reject or apply-immediately policy, recorded in the result. Safety actions such as Panic should remain usable even when a client's song digest is stale. Precise stop and reset priority is part of the contract review.

Peripherals can normalize physical input and project lights in portable C++. Device IO, debounce measurement, and presentation scheduling remain host work. Preserve native `off`, `cue`, `steady`, and `releasing` meanings. Provide phase and release deadlines so adapters do not restart pulses on each packet. Current browser cue pulses use a fixed CSS period. A shared beat-relative projection is a proposed behavior change, not established parity.

Peripherals requests one debounced press until release. Release clears the physical latch and never means stop-loop. Coalesce knob values only between discrete commands, preserving selection order. Reconnection reconciles a snapshot and requires release before another press. Offline presses are not replayed. On lease expiry the disconnected light adapter goes dark without stopping engine audio. WASM does not operate GPIO directly.

Video consumes engine time. It needs a calibrated mapping from engine frame to monotonic presentation time, with anchor age and declared uncertainty for remote hosts. A wall-clock estimate never feeds musical scheduling. Repeated loops need iteration identity. Late observer cues seek to current visual state or follow a declared drop policy. They do not rewind audio. Offline export consumes a recorded event log with resolved manual-control and cue application times, ordered same-frame priorities, and tempo segments. Define continuous beat conversion per segment, including effective frames for mid-beat tempo changes. Extrapolate only within a known segment, and reset interpolation after discontinuities or a snapshot gap. Beat-only messages are insufficient for smooth seeking and replay.

Version the host envelope independently of the song schema and binary ABI. Browser local commands continue through `PracticeAudio` and the worklet bridge without a relay. A future native service implements the same semantics over its transport. Define that adapter rather than implying the current relay is a production native host.

## Delivery and verification

The first useful demo compiles the frozen DYC chart and mapping offline, prints a cell-by-cell review, loads it through the browser adapter, and reproduces captures and variant changes. A native conformance runner loads the same artifact and renders equivalent PCM. Live Sheets authentication is a separate check. Hardware and real microphone claims remain separate from synthetic fixtures.

Implementation follows independently verifiable milestones, each committed after its checks.

1. Capture baseline artifacts and fixtures. Freeze current three-song parse results, native event traces, capture lengths, and DYC rendered PCM. Include sparse capture and manual-hit fixtures because current songs do not exercise every engine feature.
2. Define mapping, semantic schemas, and notation reference. Add schema examples and invalid cases. Prove the mapping example resolves D19 to active bar 2 and preserves DYC's whole-bar policy.
3. Build the pure offline compiler and inspector. Compare all three migrated programs with the baseline. Recompile twice and compare bytes. Test notes on empty cells, skipped columns, partial bars, malformed syntax, limits, IDs, formulas, locale, and unsupported capability failures.
4. Add the read-only Sheets acquisition command. Test a recorded grid response with offsets and notes. Verify an authorized private read separately. Never require Chrome or the chart-follow helper.
5. Add validated artifact loading for WASM and native. Reuse engine configuration semantics, prepare outside processing, and prove invalid loads leave the previous song usable. Compare native and WASM event traces and rendered PCM for identical input and sample rate.
6. Replace executable per-song transformations with declarative mappings and compiled data. Keep the registry lazy. Migrate all callers and delete obsolete compilation paths once parity passes. Update song, architecture, development, and practice-contract docs with the new ownership and commands.
7. Agree and extend command/time/patch contracts with the other workstreams. Audit allocating control paths and establish prepared-resource ownership before any realtime native service demo. Only then change shared headers, regenerate ABI bindings, bump ABI version when required, and land producer/consumer changes together. Verify retries, ordering, queue gaps, late events, loop identity, observer resync, patch PCM, and absence of allocation in approved callback command paths.
8. Exercise mobile and desktop practice controls using the artifact. Check Q/W over A/S, focused inputs, Escape-to-Panic, touch, repeated Start, Stop during setup, song switching, cue lights, export progress, and completed downloads. A real microphone and phone test remains distinct from synthetic browser checks.

Run `npm run typecheck`, `npm test`, and `npm run check:layout` for affected implementation milestones. Run the full WASM build for engine or generated changes, plus the native CMake tests. Use `npm run build:ui` for browser-only changes after WASM exists. Do not start services without operator instruction.

Throughput checkpoint follows milestone 3. Inspect the repeatable compile/inspect/verify workflow before adding another notation feature. One fixture change must produce a source-located semantic diff and a testable engine expectation. If each song still needs custom TypeScript, revise the mapping model before scaling migration.

## Coordination and decisions

Performance Engine owns the song schema, semantic command/time contract, and coordinated ABI changes. Filters owns DSP and patch resource requirements. Peripherals owns device adapters and physical behavior. Video owns assets and presentation consumers. Shared changes to headers, bridges, `model.ts`, `audio.ts`, and `app.ts` need a named owner and agreed contract before edits.

Requirements were exchanged directly with Filters, EliteDesk/peripherals, and Video Assistant on October 26. All three accepted the proposed semantic contract and supplied refinements included above. Agreement on final field layouts, same-frame priorities, resource lifetimes, and restart semantics is still pending. No automatic integration into the operator checkout occurs.

Recommended defaults and operator decisions are limited to product choices.

- Use explicit mapping files as the authoring contract and keep free-text notes descriptive. Does the operator also want a structured executable note grammar in the first release?
- Use read-only operator OAuth for private Sheets. Is service-account access preferred for unattended chart refreshes?
- First patch targets sample playback channels. Should slapback also process live voice in downloads or speakers? This changes routing and monitoring behavior.
- Preserve current fixed-tempo four-beat performance behavior in v1. Are local BPM rows and meter changes required for the first real compiled song, or can they remain metadata with diagnostics?

This planning milestone is verified by source inspection, mapping-coordinate checks, valid JSON examples, and diff review. Compiler determinism, native file loading, live OAuth, patch sound, remote presentation accuracy, physical controls, and phone behavior remain unimplemented and unverified.
