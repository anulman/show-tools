# Project conventions

Read `docs/architecture.md` for current ownership and audio flow. Use `docs/development.md` for parallel workstreams and verification. Update these guides when changing those boundaries. Historical POC plans do not describe the current implementation.

Use TypeScript for new JavaScript scripting. Keep browser UIs under `ui/` and low-level audio modules and hardware services under `lib/`. The practice desk is the supported browser UI. Do not restore the retired demo pages.

The complete musical engine runs in shared C++ under `lib/performance/`, `lib/sequencer/`, `lib/sampler/`, and `lib/beat-tracker/`. It owns clock advancement, transport, sequencing, chart actions, capture, playback, mixing, and click generation. Browser worklets pass blocks and controls to `pf_process()` through TypeScript bridges. Keep musical decisions and DSP in C++; do not restore JavaScript beat handlers or scheduling fallbacks. Song scripts supply declarative instructions. Native device hosting, compiled-song loading, and hardware controls remain future work.

Commit each verified milestone during implementation.

The operator manages the Sheets helper and Chrome CDP lifecycle. Start or restart those processes only when explicitly requested. Practice audio does not require either process.

Use Effect where it improves asynchronous workflows, resource cleanup, error handling, and external input validation. Keep audio-thread DSP and beat dispatch synchronous and free of Effect runtime work.

# Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md` completely, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the guide does not cover, search through the source code in `node_modules/effect/src`.
