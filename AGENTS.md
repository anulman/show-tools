# Project conventions

Read `docs/architecture.md` for current ownership and audio flow. Use `docs/development.md` for parallel workstreams and verification. Update these guides when changing those boundaries. Historical POC plans do not describe the current implementation.

Use TypeScript for new JavaScript scripting. Keep browser UIs under `ui/` and low-level audio modules and hardware services under `lib/`. The practice desk is the supported browser UI. Do not restore the retired demo pages.

The target audio engine owns sample storage, capture, triggering, and playback in shared C++, compiled to WASM for browser practice and natively for the EliteDesk. These functions currently live in JavaScript worklet engines and still need migration. Preserve their behavior while moving ownership; do not treat the current JavaScript sampler as the final backend.

Commit each verified milestone during implementation.

Use Effect where it improves asynchronous workflows, resource cleanup, error handling, and external input validation. Keep audio-thread DSP and beat dispatch synchronous and free of Effect runtime work.

# Learning more about Effect

This repository uses the Effect TypeScript library.

Before writing any Effect code, first read `node_modules/effect/AGENTS.md` completely, and follow the links in the file when required.

If you need to learn more about particular Effect APIs and concepts that the guide does not cover, search through the source code in `node_modules/effect/src`.
