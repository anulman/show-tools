# Physical controls and song routing

This contract separates physical identity, observed host input and musical binding. It describes the next multi-control implementation. The running release at `991c5d5` still uses one anonymous cue button.

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

Wiring's November 15 record reports Blue on `2SW7` and ordinary LED header output `1`, and Yellow on `1A` and ordinary output `2`. Its local commits are `11475cf` and `f4839f0` in `/private/tmp/show-tools-wiring-assistant`. Chief owns integrating that record. Linux codes remain unknown. SDK channel translation, visible LED behavior, supply and polarity are separate acceptance facts. The planned MOSFET move is not the current installation.

The installation map associates physical IDs with **observed** platform selectors and independently confirmed LED outputs. It carries no song action. Device paths and process IDs are discovery results. The adapter must distinguish input interface identity as well as key code; the same code on another interface is not automatically the same control.

## Identified input protocol

The helper protocol moves to an explicit version 2. Each switch observation carries `session`, globally increasing `sequence`, `controlId` and `down`. Rotation retains signed relative `deltaY` and the same ordering barrier. Neither adapter converts host keys into UI shortcuts or musical commands.

Ready describes every configured switch as released, held or unknown. An initially held or unknown switch must be released before it can produce a fresh press. Host repeats do not produce extra presses; valid ignored observations still consume sequence. A duplicate, stale, unknown or contradictory identity cannot be relabelled as the anonymous cue button.

Disconnect, an input gap or profile replacement revokes the producer lease. No queued edge can cross that lease or binding revision. Release only the musical ownership established by that producer; do not globally stop unrelated loops. Knob disablement continues to consume validated observations without applying musical motion.

## Explicit musical targets

The binding authoring model has three action variants: a nonempty set of cue rows (`L1`, `R1`, `L2`, `R2`), tempo tap, or Panic. An absent binding performs no musical action. These are capabilities, not assignments to Blue, Yellow, pedal or mushroom.

A singleton cue-row set performs that row. All four rows preserve the approved one-press-all-current-cues behavior when explicitly selected. A subset performs only its selected rows. Existing authored grouped actions remain one press, and blank cells still perform nothing.

The initial multi-control profile rejects overlapping cue-row ownership between physical switches. It must not silently duplicate a row or mix an all-row button with individually bound cue buttons. More elaborate aliases require an explicit later ownership model. A software pad remains an alternate ingress; its release cannot release a held action owned by another source.

Bindings belong to PE's declarative performance data, with song instructions retained in canonical MusicXML. Operator authoring defaults may supply bindings, but the exported song must preserve the selected meaning. Installation files contain raw selectors and output addresses, not a second musical scheduler or parallel song source.

The editor may display Blue or Yellow beside the affected cue row. It must not infer that a physical colour corresponds to the existing pastel pad CSS colour. No Sheets cell notes are required beyond the operator's existing terse voice-identification convention.

## Native routing and feedback

Choose a native identified-switch boundary, conceptually `pf_input_switch(engine, input, down, commandId)`, with a bounded binding table prepared while stopped. The numeric ABI and host operation number must be reserved during implementation. TypeScript validates and lowers declarative IDs; C++ owns fresh-edge admission, target selection, release ownership and all musical timing.

Two designs were considered. Bridge-only lowering can reuse today's pad press/release commands, but leaves physical held ownership and LED selection outside the engine. The native boundary keeps them together and supports the complete engine-authored output image. Reuse the existing portable 32-slot input latch and compiled cue executor rather than creating another clock or scheduler.

The engine emits feedback per bound control, through opaque logical LED IDs. The installation map alone translates those IDs to confirmed SDK channels. For explicitly bound cue controls, preserve the accepted policy: held input is 100%; otherwise recording pulses with the engine beat up to 70%, ahead of steady 70% playback. Activity and warnings cover only the bound rows. Utility feedback remains unselected until specified. Absent IDs are off in the consumer's owned map.

Keep the existing engine-incarnation, run, device-session, binding-revision and publication fences. Rebinding requires a stopped engine, clear ownership of removed outputs and a fresh complete image. Helpers deliver the image; they do not synthesize beat timers or commit partially written frames. No LED writes are authorized by a contract or an SDK index calculation.

## Migration and acceptance

Migrate version-one profiles explicitly. Migration requires a confirmed physical identity, observed input selector and selected musical binding. It must not turn historical Tab/Escape into Blue/Yellow defaults. Update both adapters and all bridge/browser consumers together; incompatible protocols fail before attachment. Keep the old release available for rollback rather than adding an anonymous fallback to version 2.

Acceptance must cover independent Blue/Yellow edges, initial held/unknown inputs, ignored repeats, stale sequences, reconnects, mixed input sources, overlapping binding rejection and held-release isolation. Native/WASM witnesses must prove correct cue-row selection, unchanged quantization, grouped actions and missed-commit policy, plus independent complete LED feedback. Same-host browser integration must prevent a raw physical key from also triggering its DOM shortcut.

Hardware acceptance additionally requires EliteDesk's actual type/code/value, interface identity, timestamps, press/release/repeat evidence and Wiring's electrical confirmation. Raw trials wait for EliteDesk's listener READY. Recovering service availability is separate from application-deployment consent. No musical assignments, deployment, LED writes or physical acceptance are implied by offline tests.
