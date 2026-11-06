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
