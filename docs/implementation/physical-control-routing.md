# Physical controls and song routing

This contract separates physical identity, observed host input and musical binding. It describes the implemented version-two source boundary. Deployment receipts and physical acceptance separately establish what is running on a host.

## Ownership

| Owner | Responsibility |
| --- | --- |
| Wiring Assistant | Canonical physical connections and electrical acceptance in `docs/hardware-inventory.md` |
| EliteDesk | Raw Linux observations, device qualification, adapter review and host deployment |
| Performance Engine | Shared input and binding schemas, native routing, held ownership and engine-authored feedback |
| Chief | Shared-file reservations, integration and release coordination |

No runtime or adapter files are reserved by this document. Reserve them with Chief before implementation, particularly `performance_engine.*` and `compiled_program.*`, which other engine work may touch.

## Stable identities

Physical switch IDs are `blue`, `yellow`, `red`, `green`, `pedal` and `mushroom`. Relative rotation uses `knob`. These names identify controls within one configured controller; they do not identify voices, sheet rows, keys or musical actions.

The canonical [November 15 inventory](../hardware-inventory.md#november-15-button-wiring-map), merged in [PR #148](https://github.com/anulman/show-tools/pull/148) at `0c748b6`, reports Blue on `2SW7` and ordinary LED header output `1`, and Yellow on `1A` and ordinary output `2`. Linux codes remain unknown. SDK channel translation, visible LED behavior, supply and polarity are separate acceptance facts. The planned MOSFET move is not the current installation.

The installation map associates physical IDs with **observed** platform selectors and independently confirmed LED outputs. It carries no song action. Device paths and process IDs are discovery results. The adapter must distinguish input interface identity as well as key code; the same code on another interface is not automatically the same control.

## Identified input protocol

The helper protocol uses explicit version 2. Each switch observation carries `session`, globally increasing `sequence`, `controlId` and `down`. Rotation retains signed relative `deltaY` and the same ordering barrier. Neither adapter converts host keys into UI shortcuts or musical commands.

Ready describes every configured switch as released, held or unknown. An initially held or unknown switch must be released before it can produce a fresh press. Host repeats do not produce extra presses; valid ignored observations still consume sequence. A duplicate, stale, unknown or contradictory identity cannot be relabelled as the anonymous cue button.

Sequence must increase, not remain contiguous: ignored observations can create valid jumps. Input loss requires an explicit adapter loss indication, disconnect or lease failure. Never infer loss from a sequence jump alone.

Disconnect, an input gap or profile replacement revokes the producer lease. No queued edge can cross that lease or binding revision. Release only the musical ownership established by that producer; do not globally stop unrelated loops. Knob disablement continues to consume validated observations without applying musical motion.

## Explicit musical targets

The binding authoring model has three action variants: a nonempty set of cue rows (`L1`, `R1`, `L2`, `R2`), tempo tap, or Panic. An absent binding performs no musical action. These are capabilities, not assignments to Blue, Yellow, pedal or mushroom.

A singleton cue-row set performs that row. All four rows preserve the approved one-press-all-current-cues behavior when explicitly selected. A subset performs only its selected rows. Existing authored grouped actions remain one press, and blank cells still perform nothing.

The initial multi-control profile rejects overlapping cue-row ownership between physical switches. It must not silently duplicate a row or mix an all-row button with individually bound cue buttons. More elaborate aliases require an explicit later ownership model. A software pad remains an alternate ingress; its release cannot release a held action owned by another source.

Cross-row held precedence remains an operator decision. Current `Program::gate_press()` and held execution replace another row's held sample. Do not infer polyphony from independent physical identities or change that policy before the answer. Source-scoped release and revocation are required under either musical policy.

Bindings belong to PE's declarative performance data, with song instructions retained in canonical MusicXML. Operator authoring defaults may supply bindings, but the exported song must preserve the selected meaning. Installation files contain raw selectors and output addresses, not a second musical scheduler or parallel song source.

The storage field is optional `inputBindings` in canonical performance metadata, compiled data and ingestion mappings. It contains physical ID and the target union, never OS codes or SDK channels. Missing bindings mean unbound, not an inferred legacy action. Existing canonical songs need no invented assignments. Strict readers must reject unsupported binding data rather than discard it.

Host operation 9 installs that table atomically with the compiled instruction program. Separate external-WAV uploads are outside that transaction. Successful replacement advances a native input-binding generation; failure preserves the previous song and table. Stop and Start retain the table. Replacing the song, changing the table or disposing the engine invalidates its producer leases. No runtime editor override may bypass canonical export and the stopped preparation boundary. Musical binding generation and the existing device/LED-map `bindingRevision` are distinct identities.

The editor may display Blue or Yellow beside the affected cue row. It must not infer that a physical colour corresponds to the existing pastel pad CSS colour. No Sheets cell notes are required beyond the operator's existing terse voice-identification convention.

## Native routing and feedback

Use the reserved native identified-input boundary `pf_input_event`, with a bounded binding table prepared while stopped. TypeScript validates and lowers declarative IDs; C++ owns fresh-edge admission, target selection, release ownership and all musical timing.

Native execution extends the existing resolve-all-first, commit-before-arm batch with a selected row mask. Repeated calls to `press(row)` are not equivalent. Record the admitted held owner and ownership generation per row, including software producers. A rejected press cannot acquire another producer's held ownership; late release or revocation cannot release a newer owner. Queued held launches also retain the admitted owner token; superseded launches cannot execute later or cancel another owner. Producer cleanup uses `release_owner`, and the global `release_current()` path is removed.

Two designs were considered. Bridge-only lowering can reuse today's pad press/release commands, but leaves physical held ownership and LED selection outside the engine. The native boundary keeps them together and supports the complete engine-authored output image. Reuse the existing portable 32-slot input latch and compiled cue executor rather than creating another clock or scheduler.

The engine emits identified feedback for all six physical controls, through opaque logical LED IDs. The installation map alone translates those IDs to confirmed SDK channels. For explicitly bound cue controls, preserve the accepted policy: held input is 100%; otherwise recording pulses with the engine beat up to 70%, ahead of steady 70% playback. Activity and warnings cover only the bound rows. Unbound and utility controls have an off baseline and the same full-brightness held override. Absent IDs are off in the consumer's owned map.

Keep the existing engine-incarnation, run, device-session, binding-revision and publication fences. Rebinding requires a stopped engine, clear ownership of removed outputs and a fresh complete image. Helpers deliver the image; they do not synthesize beat timers or commit partially written frames. No LED writes are authorized by a contract or an SDK index calculation.

## Per-client DOM input policy

Each browser client explicitly selects `keyboard` or `native-controls`; an unselected client has pointer/touch controls but no musical DOM shortcuts. Persist the selection in that client's session storage, not a server-global setting. Operator-provided client configuration may supply an explicit selection. Neither a device lease, server URL, IP address nor `KeyboardEvent` establishes co-location or USB identity.

The UI boundary is a Keyboard shortcuts / Physical controls selection. `native-controls` guards keydown and keyup before Escape/Panic, Space/transport and QWAS/pad handling. It also guards any DOM musical wheel path. It does not assume that native relative Y is a wheel. It leaves form editing and pointer/touch controls available. A networked laptop that selects `keyboard` retains its own shortcuts regardless of the server's hardware lease.

Native same-host activation requires that explicit client policy when operator configuration has not established it. Pairing cannot silently enable both producers. Policy changes and blur revoke only the keyboard producer's admitted ownership, clear its local pressed UI and establish fresh release barriers before keyboard readmission. Pointer, remote-client and native-device ownership remain separate. Perfect automatic USB-specific DOM suppression is not a supported capability.

## Implemented ABI and host slots

The integration source uses PF ABI 12. These changes are not a deployment or physical acceptance receipt. Existing `pf_control` IDs are unchanged, including 16–79 for external samples; host operation 15 remains WAV preparation.

| Surface | Implemented boundary |
| --- | --- |
| Native/WASM handshake | `PF_ABI_VERSION = 12` |
| Binding storage | Optional compiled-packet-7 extension `PFI1` (`0x50464931`), bounded by six physical switches |
| Native API | `pf_input_attach`, `pf_input_event`, `pf_input_revoke`, `pf_input_info`, `pf_input_is_panic`, `pf_input_inherit` |
| Host operation 14 | Attach producer: slot, monotonic session, binding generation, producer kind, released mask, held mask |
| Host operation 16 | Observation: producer slot, session, binding generation, sequence, input ID, value |
| Host operation 17 | Revoke producer: slot and matching session |
| Light output | Keep format version 1, 78 fields and capacity 32; identified controls use opaque IDs 257–262, separate from existing aggregate ID 1 |

`pf_input_info` returns exactly 196 doubles. Its four-field header is binding generation, active producer count, session high-water mark, and the physical Panic binding mask. Up to 32 active records follow, ordered by slot, with six fields each: slot, session, producer kind, released mask, held mask, and last sequence. Inactive trailing records are zero. The high-water mark survives revoke, Stop and Start, so a replacement gateway can allocate newer sessions without guessing hidden retired-slot state.

Native host preparation verifies a separate candidate engine. Before the atomic swap, `pf_input_inherit(candidate, previous)` advances the previous binding generation and carries its session high-water mark. It transfers no producer records. Invalid candidates or precision exhaustion leave the previous engine unchanged. Events queued against the old generation fail even if a slot number is reused.

The producer table is preallocated with 32 slots. Physical producers use switch IDs 0–5 and knob ID 6; logical keyboard/pointer producers use existing logical control IDs. The host assigns slots and monotonic sessions from authenticated producer identity; a client cannot adopt another client's slot. A full table rejects admission rather than evicting an owner. The audio thread allocates nothing for attach, input or revoke.

Attach, input and revoke are one engine-thread path in browser/WASM and native hosting. Existing raw producers, keyboard and pointer callers migrate to that path; low-level legacy control callers have a distinct reserved source, not global release authority. Explicit UI Panic remains the reserved global utility through control 4, including immediate local recording and microphone cleanup when backend acknowledgement fails. The DOM policy runs before Escape, and physical Panic readback also performs that UI cleanup without a second Panic action. This utility has no held-sample release ownership. A bound physical Panic input must enter the existing reserved Stop/Panic lane after checking its current binding generation; do not trust a client-supplied priority claim.

## Initial file reservations

Chief granted the lanes below in reservation receipt revision 2, `/private/tmp/chief-physical-control-reservations-20261115.json`. PE is the single integration owner. No active capture-deadline writer is identified: the earlier warning referred to a historical environment name, not an observed owner. Keep lane writers disjoint.

| Lane | Initially granted paths |
| --- | --- |
| PE domain and canonical data | New `lib/performance/input-bindings.ts`; existing `lib/performance/model.ts`, `lib/performance/compiled-song.ts`, `lib/performance/compiled-native.ts`, `lib/performance/musicxml-song.ts` |
| PE native engine and WASM | New `lib/performance/src/input_router.h`; existing `lib/performance/include/performance_engine.h`, `lib/performance/src/performance_engine.cpp`, `lib/performance/src/compiled_program.h`, `lib/performance/src/compiled_program.cpp`, `lib/performance/wasm-performance.ts`, `lib/performance/wasm-abi.ts`, `lib/performance/native-observation.ts` |
| PE host and gateway | `lib/native-host/instrument.h`, `lib/native-host/instrument.cpp`, `lib/native-host/service.cpp`, `lib/remote-performance/commands.ts`, `lib/remote-performance/native-schema.ts`, `lib/remote-performance/observation.ts`, `lib/remote-performance/instrument.ts`, `lib/remote-performance/session-schema.ts`, `lib/remote-performance/controller.ts`, `lib/remote-performance/gateway.ts` |
| PE bridge and browser | `lib/peripherals/bridge.ts`, `lib/peripherals/bridge-cli.ts`, `lib/peripherals/browser-protocol.ts`, `lib/peripherals/browser-server.ts`; new `ui/practice/musical-input-policy.ts`; existing `ui/practice/peripheral-input.ts`, `ui/practice/browser-peripheral.ts`, `ui/practice/audio.ts`, `ui/practice/practice-worklet.ts`, `ui/practice/remote-schema.ts`, `ui/practice/app.ts`, `ui/practice/index.html` |
| PE common helper protocol and Mac adapter | `lib/peripherals/host/control_stream.h`, `lib/peripherals/host/control_stream.cpp`, `lib/peripherals/host/macos_host.cpp` |
| EliteDesk Linux adapter implementation and PE review | `lib/peripherals/host/linux_host.cpp`, `lib/peripherals/host/linux_runtime.h`, `lib/peripherals/host/linux_runtime.cpp`, `lib/peripherals/host/linux_order.h` |
| PE focused fixtures and build registration | New `lib/performance/tests/input-routing.test.ts`, `lib/performance/tests/physical_input_tests.cpp`, `lib/performance/tests/physical-input-wasm.test.ts`, `ui/practice/tests/musical-input-policy.test.ts`; existing `lib/performance/CMakeLists.txt`, `lib/native-host/tests/service_test.py`, `lib/peripherals/tests/bridge.test.ts`, `lib/peripherals/tests/bridge-integration.test.ts`, `ui/practice/tests/browser-peripheral.test.ts`, `ui/practice/tests/peripheral-input.test.ts`, `lib/remote-performance/tests/commands.test.ts` |

The header-only router avoids adding a new compilation unit to both WASM build scripts. Chief separately reserved adapter fixtures, profile/deployment consumers and formal-verification records during integration. The initial list is historical and grants no directory-wide edit allowance; consult the current reservation receipt before adding writers.

## Common helper boundary for adapter implementation

PE owns the `control_stream.h/.cpp` parser and these shared records. The installation map contains sources, switches, at most one relative axis and independently accepted LED bindings. Linux and HID selectors are different variants, not interchangeable codes.

- A Linux source selector contains a USB interface number and exact supported event-type, key-code and relative-axis sets. Match within the qualified board; zero or multiple matches fail. Transient paths, ports and `phys` values are evidence, not selectors.
- A HID source selector contains the observed interface number and top-level usage page/usage. Its selected control additionally names the element's usage page/usage. Nonunique collections fail rather than selecting by enumeration order.
- Each switch contains physical ID, source ID and raw type/code in its source's namespace. Each axis contains `knob`, source ID and raw type/code. No selector values are supplied by this document.
- Each LED binding contains physical ID and confirmed SDK channel. Empty LED bindings permit input-only operation without opening or writing an output interface. Nonempty LED bindings also require explicit electrical/wiring confirmation.

The version-2 production CLI is `peripheral-host SESSION --map-version 2`, followed by fixed-arity repeated arguments: `--linux-source ID INTERFACE EVENT_TYPES KEY_CODES RELATIVE_AXES` or `--hid-source ID INTERFACE USAGE_PAGE USAGE`; `--switch CONTROL SOURCE TYPE CODE`; optional `--axis knob SOURCE TYPE CODE`; and `--led CONTROL SDK_CHANNEL` only with `--confirm-wiring`. Capability sets use sorted unique decimal comma-separated values, with `-` for an empty set. Source IDs are bounded ASCII identifiers. Validate the whole map before opening any device. No shell interpretation occurs: the bridge uses `spawn()` argument arrays.

`Ready(version=2)` lists each configured switch's physical ID and released/held/unknown state. Button records carry `controlId` and `down`; motion remains signed `deltaY`. All observations share one increasing session sequence. Repeat value 2 advances observation order without emitting another semantic press. Helpers forward the first held/unknown-to-released edge even when their local latch admits no semantic release, so the engine can clear its own initial barrier. Explicit loss emits a detached/loss diagnostic and revokes the stream; sequence jumps do not.

The Linux runtime receives a qualified collection of source handles, that immutable map and initial switch states. It replaces `LinuxHandles`' one keyboard, one mouse, one selected `ButtonKey` and one held Boolean. It owns polling, stable per-interface order, fresh snapshots and explicit loss. It never selects a song target, allocates an engine producer slot or produces musical LED timing.

Helper stdin retains fenced bind/full-image/clear/quit delivery. Bind expands the complete configured physical-ID-to-SDK map, including removed-output clearing; no single-channel constructor remains in the production path. Shared PE logical LED IDs 257–262 correspond to the physical registry order, not SDK channels. Existing descriptor validation and complete-frame prepare/deliver/commit remain mandatory.

## Migration and acceptance

Migrate version-one profiles explicitly. Profile migration requires a confirmed physical identity and observed input selector. Musical assignments remain separate and may stay unbound. It must not turn historical Tab/Escape into Blue/Yellow defaults. Update both adapters and all bridge/browser consumers together; incompatible protocols fail before attachment. Keep the old release available for rollback rather than adding an anonymous fallback to version 2.

Acceptance must cover independent Blue/Yellow edges, initial held/unknown inputs, ignored repeats, stale sequences, reconnects, mixed input sources, overlapping binding rejection and held-release isolation. Native/WASM witnesses must prove correct cue-row selection, unchanged quantization, grouped actions and missed-commit policy, plus independent complete LED feedback. Same-host browser integration must prevent a raw physical key from also triggering its DOM shortcut.

Hardware acceptance additionally requires EliteDesk's actual type/code/value, interface identity, timestamps, press/release/repeat evidence and Wiring's electrical confirmation. Raw trials wait for EliteDesk's listener READY. Recovering service availability is separate from application-deployment consent. No musical assignments, deployment, LED writes or physical acceptance are implied by offline tests.


## Six-control practice acceptance

The operator's November 16 target includes four arcade buttons, mushroom and pedal, four concurrent LED levels, and spinner measurement. Recognition and held-light feedback do not require a musical assignment. Runtime lookup uses the validated installation map; a discovery tool may propose a map, but cannot supply an inferred fallback during practice.

| Installation input | Operator-reported connection | Remaining correlation |
| --- | --- | --- |
| Blue arcade | `2SW7`, LED output `1` | Current host type/code and interface capture |
| Yellow arcade | `1A`, LED output `2` | Current host type/code and interface capture |
| Red and Green arcade | Remaining switches `2A`, `2SW8`; remaining LEDs `3`, `4` | Individual colour, switch and LED correspondence |
| Mushroom | `1B` | Current host type/code and interface capture |
| Pedal | `2B` | Current host type/code and interface capture |
| Spinner | Signed relative mouse Y | Current source selector and timestamped motion capture |

Current reported LED outputs are `1`, `2`, `3`, `4`. The proposed move to `1`, `2`, `3`, `49` is a future configuration change. Output number and SDK channel remain distinct fields of the confirmed installation. Four channels maintain independent levels in the complete image; serial USB reports do not promise electrically atomic transitions.

Every physical control publishes held brightness `1`, including an unbound control. Release removes only that override and samples its current sequenced baseline. For a cue binding this preserves the current warning/recording pulse or playing level; an unbound control has baseline zero. Device detach removes its held contribution without changing transport.

Spinner measurement requires signed cumulative raw counts relative to an explicit zero epoch, monotonic observation timestamps, and a rate query over a requested interval. Raw counts do not imply calibrated degrees. Movement history must remain independent of musical jiggle admission and same-direction transport coalescing. A reset or loss cannot silently preserve an invalid absolute reference. Queries outside available history must report that limitation rather than fabricate a rate. Current source does not yet implement this measurement contract.

Readiness requires one repeatable practice run for each current canonical Dance Yrself Clean, Drunk Girls and Tribulations document, with its actual effect metadata and explicit song input bindings, plus the validated board configuration. Each run must exercise the identified physical path, capture/commit/playback, source cleanup, four independent output levels and release-to-baseline behavior. Song changes must happen while stopped. Compilation success alone is insufficient.

The audit found all three canonical songs executable with no compilation diagnostics, but without physical input bindings. The current remote desk has one installed song package. The [bounded actual-source physical-control check](../../verification/physical-controls/README.md) now covers all 4,096 two-source held combinations and 12,288 four-output images with eight deliberate source mutations. The canonical MusicXML proof separately covers its declared three-to-six-binding domain. These checks do not establish spinner measurement, stopped-only song selection or installed physical acceptance, which remain open. Existing Capture and NativeAudio models retain their separate lifecycle/capture claims. Full practice readiness still requires the three-song and physical acceptance above.
