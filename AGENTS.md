# Project conventions

Read `docs/architecture.md` for current ownership and audio flow. Use `docs/development.md` for parallel workstreams and verification. Update these guides when changing those boundaries. Historical POC plans do not describe the current implementation.

Use TypeScript for new JavaScript scripting. Keep browser UIs under `ui/` and low-level audio modules and hardware services under `lib/`. The practice desk is the supported browser UI. Do not restore the retired demo pages.

The complete musical engine runs in shared C++ under `lib/performance/`, `lib/sequencer/`, `lib/sampler/`, and `lib/beat-tracker/`. It owns clock advancement, transport, sequencing, chart actions, capture, playback, mixing, and click generation. Browser worklets pass blocks and controls to `pf_process()` through TypeScript bridges. Keep musical decisions and DSP in C++; do not restore JavaScript beat handlers or scheduling fallbacks. Song scripts supply declarative instructions. Native device hosting, compiled-song loading, and hardware controls remain future work.

Commit each verified milestone during implementation.

Follow `docs/data-retention.md` for canonical stores and cleanup. Figma owns promoted animation, Git owns canonical effect code and concise lessons, and operator authoring data belongs in a database sidecar with independent backup. Extract useful lessons before expiring prototypes and process evidence. Preserve active inputs until the canonical handoff is verified; recordings and current work do not require archival backup.

Follow `docs/implementation/deterministic-pipelines.md` for deterministic commands. Product validation fails closed. When an agent drives an unexpected blocked product operation, present its cause and suggested next steps to the operator, and hold only dependent work. Harness failures return control to Chief for recovery instead of repeatedly interrupting the operator. Chief cannot waive product invariants. Expected negative tests do not trigger operator questions. Use temporary forks and isolated worktrees for delegated improvements without interrupting ongoing sessions.

The operator manages the Sheets helper and Chrome CDP lifecycle. Start or restart those processes only when explicitly requested. Practice audio does not require either process.

Use `./show-tools sheets [song-slug-or-1-indexed-number] [--no-cdp] [--skip-open]` for combined Sheets following. Keep `npm run start:cdp` available for standalone browser management. Keep `.envrc` ignored; `.envrc.example` documents optional overrides. The Bash launcher supplies missing defaults and discovers an installed browser. The helper reads the same CDP port environment variable. Start processes only on explicit operator request.

When a design or implementation depends on missing operator-specific facts, block that dependent work and ask concise operator questions. Do not invent hardware configuration, control purposes, protocols, timings, or workflow choices. Distinguish observed current code from intended behavior, and proposed capabilities from verified ones. Continue independent work that uses confirmed facts. For peripherals, start with `docs/hardware-inventory.md`; musical bindings belong to songs and the Performance Engine, not assumptions about button names or knob uses.

Use Effect where it improves asynchronous workflows, resource cleanup, error handling, and external input validation. Keep audio-thread DSP and beat dispatch synchronous and free of Effect runtime work.

# Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md` completely, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the guide does not cover, search through the source code in `node_modules/effect/src`.
