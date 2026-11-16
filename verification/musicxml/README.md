# Verify canonical MusicXML meaning

The operator needs song edits to change the intended performance while preserving everything that was not edited. This verifier checks that contract through the real TypeScript ingestion, reader, writer, and compiler. It is exhaustive over the finite grammar below. It is not a proof for arbitrary MusicXML.

Run from the repository root after installing the locked dependencies:

```sh
npm ci --ignore-scripts
node --import tsx verification/musicxml/verify.ts
node_modules/.bin/tsc --project verification/musicxml/tsconfig.json --noEmit
```

The command exits unsuccessfully on a property failure, incomplete enumeration, surviving source mutant, or covered-source drift. It prints one JSON result. Redirect that output to a fresh temporary file if a receipt is needed. No browser, microphone, device, Sheets connection, or service is opened.

## Finite domain

`domain.ts` enumerates the complete Cartesian product, without random sampling or filtering failures out. Every generated document must be executable and have no compiler diagnostics.

| Dimension | Values |
| --- | --- |
| Meter | 4/4, 6/8. BPM is 98 per chart count. |
| Bar count | 1, 2, or 3. |
| Reference row per bar | Blank, `1`, or `(4)&a'`. Each bar varies independently. |
| Text | Plain text, or escaped XML characters, Unicode, carriage return, and newline. |
| Live vocal row | Absent or present, with the declared default-live role. |
| R1 command in bar 1 | `x` or `2x&`, with matching typed stop execution. |
| Saved voices | Absent, one Slapback/A07 voice, or one Chorus/A02 voice. The voice has qualified sheet and cue bindings. |
| Optional archives | Neither, source only, mapping only, or both. |

The executable format requires four pad parts. They remain fixed structural rows. A varying reference-instrument row is always present; the optional live row makes five or six total score parts. Other pad arrangements and controls are blank. There are no capture or playback commands in this grammar. Numeric values, sections, part identities, effect parameters, and source coordinates outside this table are fixed by `domain.ts`.

There are `3 + 3² + 3³ = 39` reference-row words. The score product has `39 × 2 × 2 × 2 × 2 = 624` distinct inputs. Three voice states and four archive states produce exactly **7,488 distinct canonical cases**. The verifier checks uniqueness and this independently computed cardinality, then requires every case to complete its properties.

## Properties

1. Every generated input compiles as executable, without diagnostics. Meter, chart counts, measure count, all score parts, explicit reference subdivisions, sampled marks, and stop-action boundaries match the generated input.
2. Removing either optional import archive preserves the complete normalized program, report, and saved voices. A retained archive remains exactly the supplied source or mapping.
3. Read/write/read preserves the normalized program, report, and voices. Repeated writes of the same input produce identical XML bytes.
4. The compiler entry point returns the exact program returned by the reader.
5. Editing a displayed command to contradict the typed action is rejected for every canonical case.
6. Each voice state has a distinct semantic digest for every score input. Changing `x` to `2x&` also changes semantic identity.
7. In every 6/8 case, an eighth-note tempo mark of 98 and an equivalent quarter-note mark of 49 produce identical meaning. The chart and BPM still count six eighth notes per bar.

`check.ts` calls the production `importSheetMusicXml`, `readMusicXmlSong`, `writeMusicXmlSong`, and `compileMusicXmlSong`. The expected reference hits and stop boundaries are explicit constants from the generated grammar. The verifier does not implement a competing XML parser.

## Check that verification can fail

`verify.ts` first runs the full pristine domain. It then copies the real `lib/` implementation and this verifier into a temporary directory and changes the actual `musicxml-song.ts` source in that copy:

- Removing the displayed-command/typed-action equality check must fail `DISPLAY_ACTION_AGREEMENT`.
- Omitting saved voices from `semanticDigest` must fail `VOICE_SEMANTIC_IDENTITY`.

Each witness passes before its mutation, fails for the named property after mutation, and passes after restoring the original source. A caught mutant must exit with code 1, emit an exact structured `FAIL-witness-property` result from its named `AssertionError`, and produce no stderr. A process crash, parse error, or unrelated failure does not count as a caught mutant. Every witness starts in a fresh Node process, so a module cache cannot hide the source change. The temporary copy is removed and all covered production hashes are checked again. Production source is never mutated.

`coverage.json` binds the covered files and package lock to the reviewed source commit. The runner rejects drift rather than silently claiming that a model of old code verifies new code. The project skill explains how to reconcile intended changes.

## Verified milestones

At source commit `99c840928bf4beaccfe79905545823efad83fcd2` on Node 25.6.0, the complete command passed all 7,488 canonical cases, 624 voice-identity groups, 312 action-identity pairs, and 3,744 equivalent 6/8 tempo cases. Both real-source mutants failed their named properties and both restored witnesses passed. The case fingerprint was `55b7e6ad8beff1de84a787a72d85ee02133f06c91a09df891e64410ece299ce4`. The scoped TypeScript check and 24 existing MusicXML regression tests also passed. These are observed results for the recorded source, not permission to skip a future rerun.

At source commit `09e5ecfbed4d37bd3ea595dc5c35ea9339ed15f0` on Node 25.6.0, maintenance passed the same complete domain: 7,488 canonical cases, 624 voice-identity groups, 312 action-identity pairs, and 3,744 equivalent tempo cases. Both actual-source mutants failed with the required structured property result, and each pristine and restored witness passed. Production hashes remained unchanged. The current fingerprint is `f2d4e6cbbd1e772ed53efb433af054fee36e76d39ee498a47d0dd3dfaa3cbe1b`. The scoped TypeScript check, skill validator, 23 tests across `musicxml-song.test.ts` and `sheet-musicxml.test.ts`, and four `jiggle-migration.test.ts` regressions passed.

## Source review after the profile migration

The maintenance review compared every file in `coverage.json` between `99c840928bf4beaccfe79905545823efad83fcd2` and `09e5ecfbed4d37bd3ea595dc5c35ea9339ed15f0`. Only `compiled-song.ts` and `musicxml-song.ts` changed. Their only intervening change commit was `5ddf7c68c6e25cf2fd0432d20fa3e650094eaef0`, "Connect I-PAC practice controls and import reusable DYC bar views (#113)". The other nine covered files, including the package lock, are byte-identical. Release packaging changes in #118 do not touch these files.

| Covered change | Classification and mapping |
| --- | --- |
| Mapping and compiled schemas advance from 5 to 6. The canonical profile advances from v2 to v3, including the profile value hashed by `semanticDigest`. | Intentional format change. The commit's migration entries, `docs/architecture.md`, and `jiggle-migration.test.ts` establish that the normal reader accepts the current profile and legacy documents require explicit migration. The fixture now supplies `mappingVersion: 6`. All seven semantic properties and every grammar bound stay unchanged. The changed profile changes the case fingerprint. |
| `validRotationGrid` becomes `validInactivityBeats`. `RotationSchema` is exported. Rotation metadata, validation, compilation, and inspection use `inactivityBeats`. | Intentional promise change for rotation. The commit and the inactivity authoring test in `compiled-song.test.ts` confirm the new meaning. No effect on this grammar, which has no rotation rule or rotation-live part. The finite check does not establish either release policy. |
| `sourceBar` becomes optional in reuse metadata. Selection windows gain `slice`, with source-window validation and capture-graph support for the final captured bar. | Intentional new grammar. `capture-slices.test.ts` and `docs/architecture.md` describe immutable parents and per-bar views. No effect on this domain, which has no takes, selections, or reuse instructions. |
| `parsedCue` recognizes `clb`. Capture compilation produces whole-bar selections and records their phrases. Variant reuse resolves source slices. Variant rules prefer sequential matching slices and remember the prior view. Inspection prints source slices. | Intentional new capture and playback behavior. The same commit, architecture guide, and capture-slice test provide the evidence. These branches are unreachable for the stop-only finite grammar. They require separate coverage before any exhaustive claim about them. |
| `migrateMusicXmlSongV2` and `canonicalize` are added, with legacy schemas, metadata replacement, and parsed-node XML rewriting. New imports support these functions. | New authoring migration outside this verifier's entry points. The normal read and write properties continue to use current-profile documents. The four `jiggle-migration.test.ts` regressions pass separately. They do not extend the finite proof to migration inputs. |

The original command failed with `SOURCE_DRIFT`. Bypassing the hash gate exposed an obsolete fixture on the first generated input: the schema expected mapping version 6. Both failures were verification drift. No product bug was found in this review or the finite-domain run. No semantic property was weakened, and no input was removed.

Whole-file hashes force review when any branch changes. They do not imply exhaustive verification of every function in those files. In particular, rotation inactivity, `clb`, capture slices, source-bar reuse, sequential continuation, and v2 migration remain outside the finite grammar.

## Shared-tuner source review

Outcome: in sync at `9b51479061fa48fbfffb8271541c1cf475a7e101`. All eleven covered files, including the package lock, are byte-identical to source sync `09e5ecf`. Reviewed the intervening covered-file history and confirmed there are no changed MusicXML entry points or writers. Runtime tuner scale selection, previews, observations, and confirmation are not stored song semantics and add no branch to this finite grammar.

The unchanged checker passes all 7,488 canonical cases, 624 voice groups, 312 action pairs, and 3,744 equivalent tempo cases with the same `f2d4e6cbbd1e772ed53efb433af054fee36e76d39ee498a47d0dd3dfaa3cbe1b` fingerprint. Both actual-source mutants fail their intended structured properties and both restored witnesses pass. No model, grammar, property, bound, or production file changed. Advancing only the source sync records this reviewed source equivalence; it does not broaden the existing capture, reuse, migration, or tuner exclusions.

## Scope limits

This proves these executable assertions for the finite Cartesian domain under the current Node, locked dependency, filesystem, and SHA-256 assumptions. It does not establish arbitrary XML correctness, every supported notation or voice graph, XML-library internals, hash collision impossibility, native packet encoding, capture/playback/DSP correctness, atomic publication, browser authoring IO, or full set-list equivalence. It does not replace the existing MusicXML and DYC regression suites.

A failure in current code is a finding. Preserve the case identifier and counterexample. Do not weaken a property or discard generated cases merely to pass. If intent changes, review the property and grammar explicitly and rerun both positive and deliberate-negative checks.

## Terse cue source-sync review

At `4117254`, compiler schemas admit `terse-v2` and optional typed `authoredCues`; the reader/writer preserve those cells and reject display/intent disagreements even in capability-blocked documents. Existing `dyc-v1` special spellings explicitly migrate at ingestion through the shared parser, preserving numeric cutoff tails. The original 624 score inputs and 7,488 canonical cases are unchanged; neither their expectations nor the two mutation witnesses are weakened. `verification/cues` separately checks new syntax. No C++ source or capture-model transition changed, and the original MusicXML domain does not establish cx/g/h runtime behavior.

## Native terse schema seven source review

The compiled format now uses schema seven. Canonical performance metadata uses version two within the existing MusicXML profile. The reader explicitly migrates version-one metadata and compiled schema-six inputs by supplying the old autoplay, looping, ungrouped, nonreplacement policy. Current metadata keeps source identities, playback modes, grouped press identities, source windows, external sample windows, and manual note order without requiring archived Sheets inputs.

The stop-only Cartesian grammar remains unchanged. Its 7,488 cases still check display agreement, archive independence, semantic voice identity, and equivalent tempo spelling. The new case fingerprint reflects the versioned metadata. Both actual-source mutations remain assertion-specific. These results do not prove capture policy, grouped scheduling, held or gated playback, note-bank hit selection, or external-sample DSP. The executable terse fixture and its canonical roundtrip tests cover the new metadata separately. Native and WASM execution have separate witnesses.

The legacy cutover verifier asserts that every schema-seven policy still has its historical default before removing those additive fields from its historical comparison. It then checks the unchanged native digest `237b834c47ede65e4488e25c268a7202c4da1845388ff5cfa63fa9e94e51c7a8` and all nine musician-sheet pages. Compatible `dyc-v1` songs retain packet six and its eleven-field cue rows. New instructions use packet seven and sixteen-field cue rows.

Capture sources with an independently named, unprepared effect profile remain blocked. Held and gated sources require a prepared sustain window or an explicit periodic-analysis policy whose native preparation accepts the captured source. Undeclared pickup or tail cues produce a source-cell diagnostic instead of disappearing from executable instructions.

## Explicit source profile ownership

Optional source profiles and per-take profile IDs now preserve prepared effect ownership separately from the four input banks. A named source can reuse a canonical live part with the same identity/profile, or declare an independent source label and unused prepared profile. Conflicting ownership and forged take/profile assignments fail validation. Source-profile metadata survives archive-free canonical roundtrip, and catalog discovery resolves the same source label to that profile. Independent source profiles start dry when no saved patch is supplied; they do not inherit the backup live graph.

The existing 7,488-case domain and two actual-source mutation witnesses retain their original bounds and claims. Additional source-profile tests verify canonical/native representation and ownership rejection. They do not prove profile-specific capture DSP or live monitoring; the shared native/WASM witnesses establish that separately.

Portable external WAV declarations retain their data URI, SHA-256 and license metadata in canonical Performance data. The writer and reader verify declared bytes before returning a canonical result. The external-asset dependency is source-fenced. The finite 7,488-case grammar remains unchanged; focused `external-assets.test.ts` tests cover asset identity, archive-free roundtrip and slot ownership. This finite grammar does not exhaust WAV decoding or cryptographic behavior.

## Practice release source review

Outcome: updated at `cd3ae7e08c7a852b3d14766ffd9c9a6a1827aaa4`. The covered diff from `894915f` changes only `compiled-song.ts` and `musicxml-song.ts`, in `3abe656` and `08c921d`. The other eleven covered files are unchanged. The initial runners stopped at `SOURCE_DRIFT`; these failures were stale source records, not product counterexamples.

| Covered change | Effect on the verification |
| --- | --- |
| Declared full-measure preludes become chronological ordinals while retaining unique source labels. Variant source-bar references receive the prelude offset. | Intentional timeline extension. The existing Cartesian domain has no prelude, so its bounds and all seven properties remain unchanged. `pickup-timeline.test.ts` separately checks nine pickups, the explicit 32-count period and rejection of an undeclared short pickup. |
| Standard MusicXML measure numbers agree with optional `chartBinding.labels`. Reader and writer preserve the complete label list. | New canonical display agreement. One supplemental witness checks `Pickup 0`, numbered `1`, archive removal and read/write/read. Editing the standard pickup label must reject. A third actual-source mutant removes that precise reader guard and must fail `MEASURE_LABEL_AGREEMENT`. This witness is separate from the 7,488-case Cartesian product. |
| `terminalStops` retains an authored Tail `x` without inventing another measure. | The supplemental timeline witness also preserves the source-located stop through archive-free roundtrip. It does not prove native transport-end behavior. |
| One through four active controls replace the previous mandatory four bindings; undeclared hardware rows are discovered by their labels. | The four-pad Cartesian inputs remain valid and unchanged. `inactive-banks.test.ts` separately checks three controls, native representation, written cues on unassigned controls, empty bindings and duplicate bindings. These cases do not extend the Cartesian domain. |
| Take `periodCounts` and selection window `sustain` preserve explicit loop periods and automatic periodic preparation policy. | No capture or sustain exists in the Cartesian domain. Native packet encoding, waveform analysis, source quality and playback remain separate actual native/WASM checks. No DSP proof is implied by pinning these compiler files. |

The rerun passes all 7,488 canonical cases, 624 voice groups, 312 action pairs and 3,744 equivalent-tempo cases. The case fingerprint remains `8fe4c7f6f6d9cd56188cfbf48f2a130f4a568ce1e41c726465e74cf0e4188a6e` across this maintenance pass. All three actual-source mutants fail their named structured assertions, and every pristine and restored witness passes. The parser separately passes 32,390 cases and six actual-source mutants. The scoped TypeScript check and 36 canonical/ingestion integration tests pass.

Receipts: `/private/tmp/practice-musicxml-final-cd3ae7e-labels.json`, `/private/tmp/practice-cues-final-cd3ae7e.json`, and `/private/tmp/practice-canonical-integration-cd3ae7e.log`. No property or bound was weakened and no generated case was removed. The supplemental witness does not establish arbitrary labels, shortened measures, every prelude length, native sustain preparation or musical suitability.

## Physical input binding maintenance

Outcome: **updated** at `dfd9c1fc61dd6273b08026f8f2da29516e8f58d8`. The old gate rejected `musicxml-song.ts` source drift. The unchanged 624-score, 7,488-canonical-case domain then passed against current code. Review from `cd3ae7e` found only the optional `inputBindings` mapping/compiled field, its copy into and out of canonical Performance metadata, and strict excess-property rejection at the mapping boundary. The semantic digest already hashes the complete interpreted Performance data. These are intentional canonical metadata additions. No old grammar input or property changed.

The source fence now also pins `input-bindings.ts` and the pure registries in `model.ts`. `domain.ts` adds a separate binding grammar over one fixed plain 4/4, one-bar score. It enumerates absent and explicitly empty metadata; each of six physical identities with tempo, Panic, or any of 15 nonempty cue-row subsets; and every target pair for each identity pair, including repeated identities as rejected cases. Controls and rows use registry order. Its cardinality is `2 + 6 × 17 + 21 × 17² = 6,173` configurations. Exactly 1,814 are accepted and 4,359 duplicate-identity or overlapping-row configurations are rejected by actual ingestion.

Every accepted configuration preserves its exact authored binding metadata through read/write/read, deterministic writes, all four archive choices and the compiler entry point. This supplies 7,256 additional archive-state checks. Every accepted authored representation has a distinct semantic digest, including the preserved distinction between absent metadata and explicit `[]`; both mean unbound at execution. These checks do not assign a default musical action.

The complete runner passed the original 7,488 cases, the pickup-label witness, the new binding domain and five assertion-specific real-source mutations. In addition to the three existing mutants, dropping the binding copy from the writer fails `INPUT_BINDING_MEANING`, and omitting bindings from the semantic digest fails `INPUT_BINDING_SEMANTIC_IDENTITY`. Each pristine and restored witness passed. Receipt: `/private/tmp/routing-musicxml-final.json`. The original case fingerprint remains `8fe4c7f6f6d9cd56188cfbf48f2a130f4a568ce1e41c726465e74cf0e4188a6e` for this source.

The initial supplemental grammar fixes zero through two bindings in registry order. The six-control extension below adds a separate declared domain. Neither domain proves raw device selectors, producer leases, input sequencing, hardware authorization, native priority or playback.


## Six-control canonical binding extension

The operator requires all six controls to retain explicit song assignments through canonical interchange. `fullSetupBindingCases` adds 2,786 valid authored tables over the same fixed one-bar score. These are synthetic verification assignments, not defaults or changes to any practice song.

The generator takes every permutation of the six physical identities against six distinct target roles: one each for `L1`, `L2`, `R1`, `R2`, tempo and Panic. Unique prefixes of lengths three through six give 1,920 tables. The generator also permutes each representative authored list of those lengths. Removing overlaps gives 125 three-binding, 383 four-binding, 839 five-binding and 1,439 six-binding tables.

Every table preserves exact metadata and interpreted meaning through archive-free read/write/read and the compiler entry point. The check requires deterministic writes and a distinct semantic digest for every distinct authored representation. It calls the actual native encoder, compares the final PFI1 binding table with independently calculated control IDs, target kinds and row masks, and checks that the packet prefix matches the same song with an empty binding table. Archive-free rewriting must preserve the complete encoded bytes.

The original 6,173 binding configurations, 7,488 canonical score cases and five actual-source mutation challenges remain unchanged. A sixth mutation removes native binding rows while retaining their declared count. The new witness must reject that temporary encoder with `NATIVE_BINDING_TABLE`, then pass again after restoration. `coverage.json` additionally pins `compiled-native.ts` and its generated `wasm-abi.ts` dependency. Both are byte-identical to source sync `dfd9c1fc61dd6273b08026f8f2da29516e8f58d8`; no existing source pin moves.

This finite union does not enumerate every combination of three-to-six arbitrary cue-row subsets or every permutation of every generated list. Its shorter prefixes use the first three, four or five target roles; utility roles occur in the longer tables. Repeated/overlapping targets remain covered only by the original pair grammar. This check proves canonical and encoded table preservation within those bounds. It does not execute C++, establish six-device input ownership, test LED delivery or prove hardware readiness.


The complete source-fenced runner passes at reviewed checkout `0f178bcc7372a907e6524e5d6723bb208536dde1`. It retains all 7,488 original canonical cases, all 6,173 original binding configurations and the original case fingerprint `8fe4c7f6f6d9cd56188cfbf48f2a130f4a568ce1e41c726465e74cf0e4188a6e`. All 2,786 added archive-free roundtrips, distinct digests and native binding tables pass. All six assertion-specific source mutations are caught, and every pristine/restored witness passes. All 17 covered-source hashes match before and after execution. Receipt: `/private/tmp/musicxml-six-full-final.json`; original baseline: `/private/tmp/musicxml-six-baseline.json`. The scoped TypeScript check and `git diff --check` also pass. No product defect or source drift was found; this is an intentional extension of the verification bounds.
