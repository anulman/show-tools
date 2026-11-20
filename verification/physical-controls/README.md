# Verify six physical controls and four light outputs

One physical source's release must preserve another source's held lights. Every
held control must publish full brightness even before a song assigns it a
function. Releasing a cue control must resume its current sequenced pulse or
playing level. Four explicitly mapped LED outputs must retain independent
brightness values. Sequenced-only baseline IDs must remain independent of held
brightness and continue to advance behind a held control.

Run from the repository root:

```sh
node --import tsx verification/physical-controls/verify.ts
```

The command builds and exercises the actual C++ engine and light-delivery code.
It writes one JSON receipt to stdout and retains a unique temporary directory
with source copies, generated CMake project, compiler dependency records and
logs. `TMPDIR=/private/tmp` can choose the parent directory. No device is opened,
no installed service is contacted and no production source is mutated.

The first verified toolchain is Node 26.13.0, CMake 4.4.5 and Apple clang 21.0.0.
The build requires CMake 3.20 or newer and a C++17 compiler. Receipts record actual
versions rather than promising identical binaries across compilers. Use the
repository's locked dependencies for the `tsx` loader.

## Finite domain

| Check | Complete enumerated domain |
| --- | --- |
| Six held-light identities | All 64 held-bit masks for each of two physical producers, or 4,096 pairs |
| Sequenced-only baselines | IDs 513 through 518 stay zero for every unbound held-mask pair and its source cleanup |
| Light identity families | Both held IDs 257 through 260 and baseline IDs 513 through 516 traverse the complete delivery domain |
| Source cleanup | Revoke the first source in each pair and preserve the second source's mask; revoke the second and require all six off |
| Four output channels | Synthetic SDK layouts `[0, 1, 2, 3]` and `[0, 1, 2, 48]` |
| Mapping order | All 24 list orders for each four-control map |
| Independent brightness | All 256 assignments from the four-level alphabet `0`, `0.25`, `0.7`, `1` |
| Delivery total | 24,576 complete four-output images, preserving the original 12,288 held-ID cases and adding 12,288 baseline-ID cases |
| Delivery integrity | For each image, inspect actual brightness report bytes, zero padding, identical pending retry, rejected partial/modified commit, successful full commit and rejected committed replay |

Each logical LED remains associated with the same SDK channel as the map list is
permuted. The domain does not enumerate every reassignment of channel numbers or
every real-valued brightness. The native report protocol rounds the selected
levels to the nearest byte. These are synthetic SDK indices, not verified board
terminal numbers or physical output acceptance.

A separate concrete native witness records a take through an identified cue
control. It checks a non-peak recording pulse, full held brightness, exact pulse
restoration without advancing audio time, advancing the pulse while held, steady playback, four simultaneous
held arcade controls and release back to the current playback level. Existing
`physical_input_tests` and `cue_light_tests` also run against the copied source.
Those fixtures cover fresh edges, initial release barriers, stale releases and
cue warning behavior. They are witnesses, not exhaustive temporal models.

## Actual source correspondence

`coverage.json` pins 47 build, header, implementation and native-fixture inputs at
source sync `eb994928dab680d594860152b65b677dc47d71d0`. The runner rejects drift
before compilation. After building it reads compiler `.o.d` dependency records
and rejects any project dependency absent from the source record. Operating
system and compiler standard-library headers are identified by the recorded
toolchain, not vendored or hashed here.

The generated project uses the actual `lib/performance/CMakeLists.txt` and its
library dependencies. It links the real `peripheral_light_delivery.cpp` into the
replay. The copied tree includes unbuilt fixtures needed by CMake configuration;
only declared source inputs may appear in actual compiler dependency records.

The main correspondence is:

- `Router::physical_held`, `pf_input_attach`, `pf_input_revoke` and
  `pf_light_output` supply the actual held image and source cleanup.
- Compiled capture and `pf_process` supply the concrete recording/playback
  baseline witness.
- `pp_light_delivery_bind`, `prepare`, `commit` and `pp_ipac_led_report` supply
  explicit channel mapping, report encoding and publication integrity.

## Ability to fail

Every run checks pristine behavior, ten assertion-specific mutations of real
copied C++, restored behavior after each mutation, a final pristine run and
unchanged original source hashes. A compiler failure or unrelated assertion is
not accepted as a caught mutant.

| Broken actual implementation | Required failure |
| --- | --- |
| Skip unbound and utility control lights, reproducing the original omission | `HELD_IMAGE_COMPLETE` |
| Limit held brightness to 70% | `HELD_IMAGE_OR` |
| Remove recording pulse baseline | `BASELINE_RECORDING_PULSE` |
| Remove playing baseline | `BASELINE_PLAYING_LEVEL` |
| Publish the held override as a sequenced-only baseline | `BASELINE_INDEPENDENT_OF_HELD` |
| Suppress the recording baseline while the control is held | `BASELINE_HELD_CURRENT_PULSE` |
| Clear every producer's held bits when revoking one producer | `HELD_REVOKE_ISOLATION` |
| Send every report to SDK channel zero | `FOUR_LED_REPORT_BYTES` |
| Allow a committed publication to be prepared again | `DELIVERY_COMMITTED_REPLAY` |
| Accept an incomplete frame count for commit | `DELIVERY_COMPLETE_COMMIT` |

The original omission has a short witness. Load a song with no physical
bindings, attach a released physical producer and inspect its light image. The
broken implementation omits all six identified rows, so a later press cannot
publish that unbound button's held brightness. The source-isolation mutation has
a different witness. Attach the first source with no buttons held and the
second with Blue held, revoke the first, and observe that the broken cleanup
incorrectly extinguishes Blue.

Mutation rebuilds remove the affected generated object, engine archive and
replay executable. This prevents coarse Make timestamps from reusing a mutant
binary after source restoration. It does not use sleeps or modify real source.

## Verified result

The maintained run at `eb994928dab680d594860152b65b677dc47d71d0` passes 4,096 held-mask pairs, all six independent baseline rows under each pair and cleanup, and 24,576 delivery images across both identity families. The concrete native witness verifies that the baseline pulse advances while the held image remains one, then that release restores the current pulse. Playback baseline and existing input and cue-light fixtures pass. Ten actual-source mutants fail on their exact named assertions, including both new baseline faults. Each restored run and the final pristine run pass. All 47 recorded hashes and 34 actual compiler dependencies match.

The retained receipt is `/var/folders/gr/rxxj7y9j4bs54nht4mpqsh7h0000gn/T/show-tools-physical-controls-rRnab1/receipt.json`. Initial source-hash rejection and old mutation anchors were verification drift, not product findings. The old seven-row assertion changed to thirteen because the intentional six extra baseline rows fit the unchanged 32-pair image. No original held-mask or delivery case was removed. Capture policy and its separate formal model remain unchanged.

The new helper's offline overlay, bind/clear fencing and platform adapters are not linked by this replay. Their native tests and physical acceptance remain separate; baseline publication verification must not be reported as installed idle-light readiness.

### Initial result

The first complete run passed all declared held and output cases, the baseline
witness and both existing native fixtures. All eight actual-source mutants
failed on their named assertions; each restored run and the final pristine run
passed. All 47 original and copied source hashes matched after restoration, and
34 actual project compiler dependencies were covered by the record.

The retained receipt is
`/private/tmp/show-tools-physical-controls-Zcs0Dt/receipt.json`. A separate negative
check changed one covered source byte, observed the expected `SOURCE_DRIFT`
rejection before compilation, restored the source and checked all 47 hashes.
TypeScript checking and `git diff --check` also pass. These results establish the
finite source behavior described here, not installed hardware readiness.

## Meaning and limits

A pass is bounded exhaustive verification of the tables above using the actual
C++ implementation, plus named concrete witnesses. It is not a proof of every
execution trace, every producer allocation or unknown/lost attachment recovery.
It does not cover spinner measurement, physical USB delivery, electrical wiring,
calibration, real-time performance, electrically atomic LED updates, song
assignments or all-song practice readiness.

The delivery API checks the complete prepared frame. The caller must invoke
commit only after all physical reports were written successfully. This replay
does not establish that a particular USB adapter follows that rule; adapter
failure tests and physical acceptance remain separate.

When covered source changes, use `/maintain-formal-verification-skill`. Review
the actual diff before refreshing hashes or the sync commit. Do not change a
property merely to obtain a pass. A finite replay failure is a product finding
only after confirming the witness uses valid source operations. Toolchain and
harness failures require repair rather than operator approval of broken
behavior.

## Sample-export source correspondence

Reviewed the additive read path at `a831cc6`. `pf_copy_take_audio()` reads the latest committed cache only while transport is stopped and copies at most 4096 stereo frames into caller storage. The native owner admits its read against the native run identity without changing it. The controller checks the native target before and after its await. None of these paths allocates or replaces a capture bank, changes input ownership, starts transport, or writes a light baseline. Existing model transitions, properties and bounds remain unchanged. The source fences now include this reviewed code.

The existing formal models do not prove WAV/ZIP encoding or multi-chunk sample export. Actual C++ no-allocation/state-preservation checks, real WASM layered exports at 8/48 kHz and an authenticated native-host HTTP test cover those additions separately. These checks do not establish physical audio or LED acceptance.

## Stopped song replacement

The source record now includes the current dedicated pedal and mushroom
routing, grouped compiled cues, and the percussion code linked into the engine
build. Those changes made the prior source gate fail before compilation. The
declared held-mask, baseline, and report-delivery domains are unchanged.

The copied native input witness also swaps a stopped candidate with equal
bindings while a control is held. It verifies that the original lease and
sequence survive, a repeated sequence is rejected, and the original producer
can release the control. Changing the binding table retires the old lease
and preserves the allocator watermark. The separate authenticated server
fixture verifies continuous LED image ordering through actual song changes.
