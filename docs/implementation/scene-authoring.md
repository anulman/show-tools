# Scene authoring storage

Directors need to save incomplete scripts without waiting for artwork or renderer support. MusicXML owns music and portable voice assignments; Figma owns promoted visuals. The operator selected a separate shared local SQLite file for scene authoring. The existing voice catalog has a strict incompatible schema and remains untouched.

The [director workflow](../video-directors/scene-authoring.md) describes the CLI. Callers read a song stamp, then submit an operation ID, exact source input and explicit edits to stable scene IDs. They do not execute SQL or coordinate source retention themselves.

`lib/video/scene-authoring/model.ts` owns strict schemas and content identities. `store.ts` owns transactions, immutable source inputs, current song documents, stage versions and compact retry receipts. `intake.ts` adapts the existing MusicXML reader and computes diagnostics. The CLI only supplies paths, transport and shared command failures.

The design comparison considered normalized occurrence columns and revisioned song documents. Song documents inside SQLite were selected for the smaller edit boundary and fewer migrations as visual descriptions develop. The normalized candidate contributed store-enforced same-song source retention and immutable stage dependencies. The public API owns merging, validation and concurrency rather than exposing those tasks to twelve director callers. Cross-family judging was unavailable; both candidate designs were read before synthesis.

Each song has its own optimistic revision. Shared stages have independent immutable versions. Original input text is stored once as validated JSON, preserving exact Unicode and whitespace. Retry receipts retain only the original result revision, not a growing archive of complete song snapshots. An exact retry returns current readback and its original operation revision.

Application validation of references inside a song document is the accepted tradeoff for a compact SQL schema. Opening a database still checks the complete expected SQL schema, integrity and stored domain values. An unrelated file is rejected read-only before any write connection is opened. Writes use synchronous SQLite transactions; no audio-thread code, service or musical clock is involved.

Per-worktree files were rejected because they fork operator state. MusicXML embedding was rejected because draft visual planning must not change executable music. Extending the voice catalog was rejected because existing readers reject additional tables. Full event sourcing was unnecessary; immutable operator inputs preserve the evidence needed for this milestone.

The first milestone is deliberately draft-only. It can preserve text, normalize ranges, register stage drafts, diagnose coverage and export assessment data. It has no review or runtime-promotion write path. Future admission needs content-bound review evidence, verified source/aspect dependencies and an implemented renderer adapter. A syntactically valid receipt hash is not enough.

Independent backup destination, cadence and retention remain unconfigured. Consistent local snapshots and fresh-process reopen tests establish local recovery behavior, not off-machine protection or power-loss durability. No live restore command is supplied.
