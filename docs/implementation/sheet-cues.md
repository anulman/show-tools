# Sheets cue language

`terse-v2` is the explicit mapping notation version for whitespace-separated actions. Each action is `[press] operation [(source)] [execution]`. Operations are `cr`, `cx`, `r`, `c`, `x`, `p`, `g`, and `h`; compound operations are indivisible. Counts are one-based; `e`, `&`, and `a` are sixteenths. Numeric parentheses before an operation silently establish the press count. Alphabetic parentheses after it identify a source. A leading subdivision uses count one; subsequent subdivisions inherit the last explicit count within the same cell. Each cell resets that anchor.

`(3)&r4 (4)&cr1` presses at 3& and 4&, records on 4, then commits and arms at the following bar's 1. `&cx2` presses at 1& and stores on 2 without launching playback. A numbered execution earlier than its press denotes the next measure; `b` explicitly denotes the next bar. `(4)&cx(lead)b` stores lead next bar. `4er(day)&` and `4ec(day)&` press at 4e and execute at 4&. `x(day)3` has no authored press position and executes on 3. A missing press position means the written bar supplies the cue. Timed presses use the song’s configured acceptance window.

`1p &p 2p &p 3p &p 4p &p` contains eight manual hits. Word playback is finite per hit; guitar playback loops. `3h` sustains one held note until release. `1g` replaces a loop with an ongoing gated instrument mode, permitting repeated press/hold/release until `x` or ordinary `p` exits. A blank cell adds no cue. `4x` or `1x` with no active voice is an intentional dry press. An unnamed `p` on a word pad selects by chart beat parity. Use `pp` below for an ordered pair of word clips. Named sources, immutable takes, and hardware banks are separate concepts.

## Canonical interchange and current execution boundary

`compiled-song.ts` calls `parseSheetCues` at Sheets ingestion. `terse-v2` preserves every valid cell as typed `authoredCues` in the canonical MusicXML performance metadata, including sources, press positions, and execution measure offsets. The reader checks these against the displayed command even in capability-blocked documents. Removing archived Sheets JSON does not lose them. Inspection prints each authored action and timing.

Schema 7 and native packet 7 carry explicit launch policy, playback mode, source name, shared press group, next-measure beat offset, and capture replacement policy. Canonical Performance metadata version 2 migrates version 1 at its boundary. Native packet 6 rows normalize into the same native action representation. Legacy-default DYC still encodes its original packet bytes.

`cx` publishes a complete retained source without launching it. `c` and `cr` retain autoplay. Grid arm, commit, and commit-and-arm run by default at their written boundaries. The mushroom can discard the pending or active recording and queue a restart. Already committed takes stay available. A loop `p` or `x` waits for a press. If the normal window has passed, the next press on that row uses the latest reached playback cue or group in the current pass. It applies any unused loop starts and stops from that group, using the written execution point if it is still ahead. It skips finite hits, held and gated attacks, and any tempo tap from a missed press. A newer playback cue supersedes older ones on that row. `+` shares one press while preserving each action's execution boundary. Commit publication precedes explicit launches, and an explicit guitar `p` replaces the preceding guitar selection. Guitar capture replacement is an explicit source binding and occurs at capture begin. It is independent of looping playback mode.

Mapping source bindings identify named retained sources independently of physical controls. Word `p` uses finite retrigger playback selected by chart count parity. Guitar `p` loops with source-relative phase. `h` and `g` require an explicit prepared sustain slice, including its original effect-state checkpoint. Release stops the held source, and gated mode remains available for another press until `x` or normal `p`. Missing sustain regions or unbound source effect profiles fail visibly. Named takes carry an explicit prepared profile independently of their bank. Different source profiles sharing a bank preserve independent effects, playback and stops; Guitar aliases intentionally share their replacement profile. Non-numeric Pickup columns with cues also fail visibly until their explicit measure durations and display-label timeline are represented.

Canonical external sample windows permit finite prepared samples with up to 32 simultaneous tails. Preparation copies validated PCM while stopped. Ordered `noteBanks` hold explicit sample slots and chart onsets; a manual hit chooses the next unplayed eligible note within its configured tolerance, skips missed notes, and never autoplays. Canonical assets carry portable WAV bytes, SHA-256 and license provenance. Normal browser and native package preparation verify and load them while stopped. The input-only phone adapter requests motion permission from an explicit Enable shake action and forwards manual hits over the existing control route. It starts no engine or microphone. Native windows ignore out-of-range motion and permit overlapping finite tails. Physical sensor thresholds and musical suitability still require operator audition.

The legacy `dyc-v1` ingestion path explicitly migrates `clb`, `1p*`, and numeric capture cutoffs before the same parser. Cutoffs retain `silence-to-bar-end`; terse numeric suffixes preserve the full source through their actual endpoint. Existing canonical documents remain typed data and are never recompiled from archived JSON. The legacy version remains accepted for existing songs; this milestone does not rewrite their canonical files or the live chart.

## Verification

`npm run verify:formal:cues` checks the actual parser across its bounded domain and exercises source mutations. The MusicXML verifier checks its own domain and mutations. `terse-wasm.test.ts` executes the shared C++ through real WASM and checks stored silence, finite/parity retriggers, prepared hold/gate release, grouped replacement and missed groups, source phase, external overlap, and ordered manual note hits.

The capture proof explicitly models launch policy. Its conditional successful-autoplay property remains intact, and a separate store-only property forbids publication from creating playback. The current main bound explores 11,894 distinct states with three take identities, two banks per take and three beginnings. Six model mutants and seven actual-source mutants exercise the protected policies. See the source-pinned capture receipt and exclusions in `verification/capture/RESULTS.md`.

Signed rotation velocity is measured in native frame time relative to the baseline captured at button-down. Prepared held/gated playback clamps pitch change to three semitones in either direction and resets on release. Initial defaults are 24 rotation units per second per semitone and a 100 ms stale-velocity window, configurable while stopped. Hardware bindings and physical tuning remain unverified.

## Release-to-record word pairs

Use this pattern on one cue row with two named one-shot sources:

| Written count | Cue | Input |
| --- | --- | --- |
| 4 | `4ru(drunk)` | Press and hold before count 4. Release as you start singing “Drunk.” |
| 1 | `1cx(drunk)+1ru(girls)` | Press to cut “Drunk” and arm “Girls.” Hold until you are ready to sing, then release. |
| 2 | `2cx(girls)` | Press to cut “Girls.” |

The capture begins on each release and ends on the next press. You can arm the first clip from one count before its guide until half a count after. An unfinished sequence expires two counts after the final guide or at the end of the selected range. Expiry, Stop, Panic, input retirement, and microphone loss discard the unfinished clip and retain any already-stored clip.

Write `4pp(drunk+girls)` on the first count of a playback pair. A tap near the first guide plays “Drunk,” and a tap near the second plays “Girls,” at the input time. If you miss a guide, the other word still belongs to its written count. The second guide count wraps to 1 in the next measure. For a 2/3 pair, write `2pp(drunk+girls)` in that measure. If both pairs start in one measure, write `2pp(drunk+girls) 4pp(drunk+girls)`. Each guide accepts one tap from a quarter count early to a quarter count late. The clips can overlap. A standalone timed one-shot of a word captured this way has the same quarter-count tolerance. Leave the second guide clear of a separate playback cue.

The Drunk Girls worksheet has separate recordings of “Drunk” for Girls and Boys. Use these names and cells.

| Cell | Displayed bar | Cue |
| --- | --- | --- |
| P24 | 4 | `4ru(drunk-g)` |
| Q24 | 5 | `1cx(drunk-g)+1ru(girls) 2cx(girls)` |
| X22 | 12 | `4ru(drunk-b)` |
| Y22 | 13 | `1cx(drunk-b)+1ru(boys) 2cx(boys)` |

For later playback, pair `drunk-g+girls` on R2 and `drunk-b+boys` on L1. The nine pickup measures offset the engine's chronological bar numbers. Preserve standalone held or gated cues outside the ordered pairs.

## Pre-song note capture

A note bank may declare an explicit `capture` profile and ordered sample slots separately from its chart melody. The Tuning panel offers Record selected scale only for that supplied source order and a supporting session. It configures the chosen scale, prepares the ordered slots, and enables the existing shared Listen flow. Stable singing at the current target prepares a rolling clip. Confirm or meaningful rightward knob travel locks that clip and advances the existing target. Tiny raw motion does not lock each note. The initial configurable settings are a 250 ms clip, 150 ms stable pitch, confidence 0.9 and tolerance 35 cents.

Start clears Tuner listening and reference playback while retaining completed notes. Stop and microphone loss discard the unfinished capture window; microphone restoration needs explicit Listen. Replacing the song frees its note bank. Duplicate capture slots and slots reserved by external instruments are rejected. ICC has no authored source-note order yet; fixture order does not supply a song's pitches or replace future standard-score ingestion.

Drunk Girls pickup timing is operator-confirmed (2026-11-14) and implemented: `Pickup0` through `Pickup8` are full four-count bars. `Pickup0` through `Pickup7` form the eight-bar source loop. Playback restarts at `Pickup8`; numbered bar 1 begins one full bar later while the loop continues until an explicit stop. Native chronological measures remain separate from displayed labels. The guitar source starts at Pickup0's 3& and retains its original phase within the declared 32-count period. Native periodic analysis prepares suitable hold and gate windows from captured source without replacing the original recording; unsuitable source remains unavailable for held playback. Actual source quality still needs audition. Complete room input and original effects tails remain retained.

Confirmed full pickup measures use `mapping.prelude` entries with explicit labels and count lengths. Internal measures remain chronological; `ChartBar.label` preserves the displayed pickup or numbered bar. The current profile accepts full measures only and rejects unknown or shortened pickup durations. Drunk Girls contains nine full pickups followed by numbered 1–128. Its initial guitar capture starts at Pickup 0:3&, ends at Pickup 8:1, and has an explicitly declared 32-count loop period; the remaining 2.5 counts are virtual source silence. Playback therefore reaches the source attack again at Pickup 8:3& and continues through numbered 1. `terminalStops` retains the authored Tail `x` as an end marker using the existing transport stop, without adding a Tail duration.

A source may declare `sustain: { kind: 'periodic' }` instead of manual sustain cuts. Native preparation examines fixed 80 ms capture windows, downsampled to roughly 8 kHz, using at most 256 comparisons per candidate lag and a 50–1200 Hz search. It rejects silence, constant levels and windows with normalized periodic error at or above 0.15. The strongest accepted periodic window is trimmed to complete cycles and retains its prepared effect-rack checkpoint. It leaves the parent recording intact. Memory and rack snapshots are allocated during program preparation; capture analysis uses bounded loops and no allocations. Packet validation permits one automatic analysis view per take. These engineering defaults provide live preparation before the first h/g; sonic suitability of a particular sung word or guitar sound still needs audition. If no window qualifies, h/g returns `PF_NO_SAMPLE` rather than substituting live microphone or an arbitrary beat.

Rebuild Drunk Girls from an authorized frozen source with `node --import tsx scripts/prepare-drunk-girls.ts SOURCE.json OUTPUT.musicxml`. Inspect the promoted artifact with `./show-tools chart inspect songs/drunk-girls.musicxml`. `node --import tsx scripts/verify-drunk-girls-performance.ts` executes the complete canonical chart in native C++ and WASM at 8/48 kHz with deterministic test input, explicit button-down/up events and test-only effect racks. Its receipt compares take metadata and aggregate stem measurements, not raw PCM byte equality or the sound of an actual performance.
