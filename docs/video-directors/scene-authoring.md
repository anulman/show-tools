# Save and inspect a scene script

All twelve song directors use one local SQLite authority:

`/Users/anulman/Library/Application Support/show-tools/video/scene-authoring.sqlite`

The operator confirmed this Mac path. It stays outside Git and individual worktrees. Every command names it explicitly. No database service is needed. The voice library remains separate; this store does not migrate a browser catalog or change MusicXML.

Figma owns the artwork. The database owns operator words and their scene timeline interpretation. MusicXML owns the musical chart and portable voice assignments. JSON files are input transport or derived exports, never a second authoring authority.

## Save the original words first

Set a task variable for the confirmed path:

```sh
scene_db='/Users/anulman/Library/Application Support/show-tools/video/scene-authoring.sqlite'
./show-tools scenes init --database "$scene_db"
./show-tools scenes read --database "$scene_db" --song dance-yrself-clean
```

`init` validates an existing scene store without overwriting it. An unsupported or unrelated database blocks. Initialization creates no scene entries, including none of the `Scene 1 / XX–YY` format examples.

Read the song before editing. Copy its complete `stamp` into the input's `base` field. The stamp contains database identity, restore generation and that song's revision. Another song's edit does not invalidate this revision.

An ingest transport has this shape. These placeholders illustrate the protocol, not song content:

```json
{
  "operationId": "unique-request-id",
  "songId": "dance-yrself-clean",
  "base": {
    "databaseId": "copy-from-read",
    "generationId": "copy-from-read",
    "revision": 0
  },
  "input": {
    "kind": "new",
    "value": {
      "id": "stable-source-message-id",
      "operatorText": "The exact actual operator message, including whitespace.",
      "origin": "The actual conversation or recording reference."
    }
  },
  "scenes": []
}
```

Replace the placeholder stamp with the actual readback, then save:

```sh
./show-tools scenes ingest --database "$scene_db" --input /private/tmp/operator-chunk.json
```

An empty `scenes` array saves the words immediately. Understanding the scene, resolving its bars and obtaining Art references can happen later. Do not rewrite a transcript while saving it, infer ranges from examples, or invent missing stage, cue or tempo facts.

Keep the same operation ID and identical payload when retrying an uncertain write. An exact retry does not duplicate a scene or advance its revision. Its `operationRevision` identifies the original write, while `snapshot` is a coherent current readback that may include later edits. Reusing an operation ID for different content blocks. After a revision conflict, reread and deliberately reconcile before issuing a new operation.

## Normalize an occurrence without losing its source

Each scene has a stable `id` independent of its display label and bar range. Keep that ID when editing its range or stage. Each changed scene supplies:

- `id`, `label` and `description` for the explicit interpretation.
- `range`, either `{ "kind": "known", "startBar": 1, "endBar": 4 }` or `{ "kind": "unresolved", "text": "the actual unresolved wording" }`.
- `stage`, either `{ "kind": "unbound" }` or `{ "kind": "reference", "id": "stage-id", "revision": 1 }`.
- `sourceInputIds`, referring to the stored operator inputs for this song.

The numbered range above only illustrates one-based inclusive endpoints. It is not a DYC assignment. Known reversed or malformed ranges reject; unresolved and out-of-chart draft ranges remain saveable and are diagnosed. An edit replaces only the named scenes, retains previous source references and leaves other scenes untouched. A source input ID cannot be reused to overwrite its original words.

To revise an interpretation from an already saved message, use `input: { "kind": "existing", "id": "stable-source-message-id" }` with a new operation ID and the current base stamp. Original input references remain attached after normalization.

## Bind the actual chart revision

Read the current stamp, then put it in a transport containing only `{ "base": STAMP }`:

```sh
./show-tools scenes bind-chart --database "$scene_db" --song dance-yrself-clean --input /private/tmp/chart-base.json --musicxml /absolute/path/to/current/dance-yrself-clean.musicxml
```

The existing MusicXML parser supplies song identity, measure count, meter and semantic digest. The store also records the XML byte hash. Historical registry hashes do not bind a chart. A document for a different song blocks. Changing the file later does not silently rebase saved scene ranges; inspect it and bind an intended new revision explicitly.

Use the operator's actual current chart path, not whichever checkout happens to contain a similarly named file. Songs without a current chart can retain unbound drafts. A complete song in an older MusicXML application profile can also be unsupported by the running reader. Keep that exact source and leave binding unresolved until an explicit compatible intake or reviewed migration is available. Do not relabel its profile, reimport it, or choose another checkout just to make validation pass.

## Share stages without retargeting occurrences

Art owns stage artwork, source layers, registration and fit evidence. A reusable stage definition has its own stable `id` and immutable versions. A scene occurrence references an exact stage version; a new Art version does not silently change earlier scenes.

Use `stage-put --input FILE` for a request containing `operationId`, the observed `base` stamp and `definition`. A minimal stage definition is `{ "id": "stage-id", "label": "supplied label", "description": "supplied description", "art": { "kind": "unbound" } }`. `stage-read --stage ID` returns the current version; add `--revision NUMBER` for an exact version. To create a new stage, use the store identity and generation from a song read with revision zero as the stage base.

Bound Figma definitions record the file/root IDs, supplied layer references and separate aspect references. Layer roles are world, props, foreground, actors and FX. Unverified source references remain distinct from pinned source bytes, native dimensions/grid and registration. A reported node ID or flattened world concept does not establish independently movable props, reflections or actor bindings.

Both 16:9 and 4:3 composition references and fit receipts remain explicit. Use the [shared composition requirements](README.md#compose-every-scene-in-both-aspect-ratios); review dimensions remain provisional. A scene script or stage save does not promote artwork, certify fit or establish renderer support. The actors layer role describes slots or source references, not an inferred cast or another voice-assignment map. Future renderer admission must validate fit receipt contents and their exact source, version and aspect dependencies; a well-formed hash alone is insufficient. Draw order, anchors, occlusion and camera behavior are not fully represented by this first schema and remain explicit adapter gaps.

## Inspect and export a draft

```sh
./show-tools scenes inspect --database "$scene_db" --song dance-yrself-clean --musicxml /absolute/path/to/current/dance-yrself-clean.musicxml
./show-tools scenes export --database "$scene_db" --song dance-yrself-clean --musicxml /absolute/path/to/current/dance-yrself-clean.musicxml --output /private/tmp/dyc-scene-draft.json
```

Inspection reports source changes, unknown ranges/stages, missing aspect fit, out-of-range scenes, overlaps and uncovered intervals. Gaps are computed only when the chart's bounds are known. Overlap diagnostics identify both scene IDs and their intersection. Nothing automatically repairs or fills the timeline.

An export captures the current authoring snapshot and diagnostics. It remains a draft, with runtime explicitly `not-admitted`. The first milestone accepts no reviewed or runtime-ready flag through ingest. `intake` fails closed until a separate content-bound review and renderer-admission contract is implemented. This does not prevent saving, reading or sharing incomplete script chunks now.

The existing Street preparer reads MusicXML and verified assets. This authoring store does not add arbitrary Figma scene graph playback, new camera behavior, a musical clock or automatic stage-to-renderer conversion. Casting and musical execution remain with the existing MusicXML/Performance Engine boundaries.

## Make a consistent local snapshot

```sh
./show-tools scenes snapshot --database "$scene_db" --output /absolute/path/to/new-snapshot-directory
```

The destination must be new. The command uses SQLite's consistent snapshot mechanism, verifies the copy and refuses to overwrite an existing namespace. Reopen the returned database to verify its records. Do not copy a live SQLite file with an ordinary file-sync tool, replace the active authority with an old snapshot, or discard current inputs before a verified handoff.

Independent off-machine backup, its destination, cadence and retention are not configured. A local snapshot is not protection against losing this computer. Follow [the retention policy](../data-retention.md).

The [storage design](../implementation/scene-authoring.md) records ownership, tradeoffs and the remaining admission boundary.

## Verify infrastructure changes

```sh
node --import tsx --test lib/video/scene-authoring/tests/*.test.ts scripts/tests/scene-authoring.test.ts
npm run typecheck
```

The tests use owned temporary SQLite files. They cover exact-word retention, reopen, concurrent writers, retry/conflict behavior, immutable stage references, diagnostics, export safety and snapshot recovery. They do not claim artwork approval, musical execution, off-machine recovery or an installed sidecar service.
