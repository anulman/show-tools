# Practice desk implementation notes

Current ownership, audio flow, and design rationale live in [the architecture explanation](../../docs/architecture.md). Use [the development handoff](../../docs/development.md) for separate workstreams, setup, and verification. The [practice contract](CONTRACT.md) describes current commands and state. The complete musical engine now runs in shared C++. It owns transport, chart actions, sequencing, sample storage, capture, playback, mixing, and click generation. Browser worklets transfer blocks and controls and publish native state.

Earlier implementation notes recorded an incomplete browser pass and uncommitted work. Those notes are superseded by the committed practice implementation and the verification baseline in the development handoff. The sampler and sequencer `PLAN.md` files retain their historical POC designs.
