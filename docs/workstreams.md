# Plan the next four workstreams

This brief records the operator's October 26, 2026 scope updates. It supersedes the initial session assignments. Each session first produces a plan using poteto mode, grounded in current source and evidence. Save the plan in its own worktree, commit the verified planning milestone, and present recommendations and genuine product questions before implementation. Do not start the live Sheets/CDP services.

Read [architecture.md](architecture.md), [development.md](development.md), and `AGENTS.md`. Existing sessions have isolated managed worktrees based on `619df03`. Keep source edits in those worktrees and integrate changes deliberately. Use TypeScript for scripting, Effect where appropriate outside synchronous rendering, and shared C++ compiled natively and to WASM for portable engine and DSP behavior. Prefer permissive dependencies; identify any copyleft or commercial licensing implications before adopting them.

## Filters and patches

First deliverable: a plan for a slapback patch that can attach and detach through performance cues and physical controls. The same implementation must work in native EliteDesk hosting and browser WASM. Commands may originate from the web performance UI. Local WASM practice continues to communicate over its bridge without requiring a relay; the hardware host may receive commands through its server.

Determine the patch graph, cue and parameter representation, audio routing, and observable state. Explicitly distinguish live voice, captured PCM, sample playback channels, recording downloads, and click. Recommend whether bypass preserves tails, how Stop/Panic/reset behave, and how attachment avoids discontinuities. Propose delay, feedback, wet/dry, stereo and allocation behavior, with rendered-PCM verification. Keep DSP portable under `lib/` and song-specific assignments under `songs/`.

Coordinate the command and compiled-song contracts with Performance Engine. Own patch DSP implementation; do not independently redefine the performance ABI or clock contract.

Plan artifact: `docs/plans/filters-and-patches.md`.

## Performance Engine

This is the renamed Practice UI session. It covers the browser performance/practice UI and coordination of engine services running on EliteDesk or in WASM.

First deliverable: a plan for formalizing chart notation and a deterministic chart compiler. Given a Google Sheets spreadsheet/worksheet link and explicit worksheet/cell mappings, a runnable program should produce a machine-readable, human-verifiable performance representation. An LLM may invoke that program and supply mappings; parsing and compilation must not depend on an LLM.

Inspect current chart snapshots, cell notes, song scripts, `compileChartControls`, and the native program loader. Preserve current musical semantics, including action timing, sparse capture hints, commit-and-autoplay, variants and manual taps. Recommend an output format and versioned schema, source locations, diagnostics, normalized timing and stable identifiers. Show an example input mapping and compiled artifact, plus a migration path from current song modules. Account for Sheets authentication/read access, offline fixtures and deterministic verification.

The compiled program maps button presses and cues to sequencer, sampler and patch operations. Keep decisions in the shared C++ engine. Own the semantic command, compiled-song and performance/WASM contracts; coordinate ABI changes with Filters and peripherals before editing shared headers or bridges. External network delivery is not a musical clock boundary.

Plan artifact: `docs/plans/performance-engine.md`.

## EliteDesk hosting and peripherals

Prioritize peripheral management so physical wiring can begin tonight. Read the repo for any existing parts inventory; identify the exact missing hardware facts instead of assuming a controller, voltage, pinout or communication protocol.

Plan how knob turns, button presses and other supported inputs become performance controls, and how sequencer clock/state drives arcade-button illumination, pulse and release behavior. Preserve the established cue-light semantics. Account for debounce, input ordering, timestamps, reconnection, output update rate, and a testable simulated hardware adapter.

Separate portable control/light state from device-specific IO. Evaluate what can run as shared C++ in browser WASM and what requires a host adapter or browser device API. Explain browser/device support limits. Do not claim that WASM can directly operate GPIO. Keep low-level EliteDesk utilities under `lib/`; host the web UI elsewhere. Coordinate semantic events and clock feedback with Performance Engine. Give a concrete first wiring milestone and a hardware-independent verification path.

Plan artifact: `docs/plans/elitedesk-peripherals.md`.

## Video Assistant

Analyze both character-ideas PDFs visually with the PDF skill before making character-specific claims:

- `/Users/anulman/Dropbox/Old TV Character ideas-1.pdf`
- `/Users/anulman/Dropbox/Old TV Character ideas-2.pdf`

The operator made both files available offline. The parent verified PDF headers and sizes of 18,501,385 and 17,636,797 bytes respectively. Analyze the real pages; do not infer character contents from filenames.

Pitch how selected characters and objects can develop into a reusable animated asset collection through Figma MCP, covering ideation, asset expansion, components/variants, rigging or keyframes and export. Follow the relevant Figma skills. Inspect available MCP capabilities and distinguish supported automation from proposals. Do not create a Figma file before selecting an appropriate workflow and following its creation skill.

Recommend a sequencer-clock-driven animation pipeline. Compare live browser rendering and offline video output, including browser libraries such as Remotion where appropriate. Evaluate licensing, output formats, transparency, seeking, replay, frame/beat alignment, tempo changes, loop boundaries and late events. Video should consume performance time rather than become a separate musical clock. Coordinate the event/time contract with Performance Engine.

Figma is canonical for promoted artwork and animation. Keep stable identity metadata, Figma references, necessary runtime exports, tools, and concise lessons under version control. Follow [the retention policy](data-retention.md): unpromoted prototypes and raw process records can expire after extracting lessons and verifying the canonical handoff. Browser animation UI belongs under `ui/video/`; reusable C++ utilities intended for EliteDesk belong under `lib/` and should also compile to browser WASM. Recommend whether keyframes plus runtime interpolation, pre-rendered video, or a hybrid best fits the material.

Plan artifact: `docs/plans/video-assistant.md`.

## Coordinate the plans

Before implementation, the four plans should agree on command identity, transport state, clock/frame timestamps, cue timing and resource ownership. Performance Engine coordinates these shared contracts; each other session supplies its requirements. Separate worktrees prevent file overwrites but do not settle contract disagreements.

Each plan should state the first useful demo, phases, tests, dependencies, assumptions and a short list of decisions that need the operator. Keep real microphone/audio checks separate from fixture tests and physical-device claims separate from simulations. Do not merge plans or branches automatically into the operator's checkout.

Review the published plans through their [GitHub PRs](plan-review.md). GitHub comments are the durable review record; Hunk remains optional for local diff browsing because installed Hunk 0.24.0 does not persist notes after quit. The operator prefers inline file comments over routing feedback through a central conversation.

## Session registry

| Session | Thread ID |
| --- | --- |
| Show tools · Filters & patches | `01a1725c-d20e-7710-a36c-977d4943a5ff` |
| Show tools · Performance Engine | `01a1725c-da47-7851-8a43-354e7a51f7af` |
| Show tools · EliteDesk hosting | `01a1725c-dd77-7973-88da-86743f86a5b3` |
| Show tools · Video Assistant | `01a17a72-c840-7363-837f-a04c3269351b` |

Use these IDs for explicit cross-session coordination. They are not native ABI identifiers or repository configuration.
