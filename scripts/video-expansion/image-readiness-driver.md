# Collect image readiness through a local mailbox

Use this driver when the Figma connector runs in `functions.exec` and the readiness collector runs in Node. The driver emits bounded read requests. It never calls Figma or executes replacement code.

Prepare a JSON input with exact source targets and pinned local files. Paths resolve relative to the input JSON file. Include every source consumed by the replacement, plus the actual authorized replacement script.

```json
{
  "sources": [{
    "target": { "fileKey": "FILE", "pageId": "1:1", "sourceNodeId": "1:2", "imageNodeId": "1:3" },
    "expectedPng": { "path": "registered-source.png", "sha256": "EXACT_SHA256" }
  }],
  "replacementPageId": "2:1",
  "replacementCode": { "path": "authorized-replacement.js", "sha256": "EXACT_SHA256" }
}
```

Compute the hashes from the files accepted in the current art handoff. Source readiness does not grant art approval. Hold the operation when that separate approval is missing.

Start the driver with absolute input and fresh output-directory paths:

```sh
node --import tsx scripts/video-expansion/image-readiness-driver.ts \
  --input /absolute/path/inputs.json \
  --out /private/tmp/new-image-readiness-mailbox
```

The output directory must not exist. The driver creates it with mode `0700`. Every mailbox and output file uses mode `0600`. Do not reuse a previous directory after a failure or timeout.

1. Read `next.json` in that directory. Wait until the first complete message exists.
2. For `kind: "read"`, check the exact live Figma lease and send only `code` through the existing `callOwnedFigma` wrapper. Do not execute a scene builder during collection.
3. Write the complete unchanged connector response inside `{ "runId": request.runId, "step": request.step, "response": toolResponse }`. Use a new temporary file with mode `0600`, then rename it to `request.responsePath`. Publish each response once, after its corresponding call finishes.
4. Wait for a new `next.json` message. Process each step once and in order. A repeated read of the same step is not permission to call Figma twice.
5. Files left after an error or without a `kind: "done"` message are not consumable. On `kind: "error"`, stop dependent work and return the failure to Chief. Do not fabricate a response, skip a chunk, resize artwork, or restart a possibly pending connector call.
6. On `kind: "done"`, verify the named complete code file against `codeSha256` and read its source-readiness receipt. Recheck the current art approval and exact live lease before executing that file unchanged. Do not append code. The driver never executes that file itself.

The driver verifies response run/step identities and rejects stale, duplicate, out-of-order, malformed, oversized, FIFO, symlinked or publicly readable response files. It refuses changed pinned inputs and existing output directories. Accepted replies remain as `accepted-N.json` only for the active handoff; follow the normal retention policy afterward.

Each reply must arrive within 60 seconds. `--timeout-ms` accepts 10 through 300,000 milliseconds when the calling harness needs a different bounded wait. The entire collection has a 15-minute deadline. Input hashes are checked before any request is published. Response files are bounded to 42,000 bytes; their contained connector response remains subject to the collector's 40,000-byte limit.

The mailbox and Figma lease require exclusive cooperating owners. Neither the private directory nor asynchronous Figma exports make this a transaction against concurrent privileged processes, human edits or foreign writes. If ownership becomes uncertain, hold the operation for Chief. No source, visible actor, Figma metadata or Figma-side cache is written by the collector.

Run the actual driver and generated-script regressions without opening Figma:

```sh
node --import tsx --test scripts/tests/image-readiness-driver.test.ts \
  scripts/tests/figma-image-readiness.test.ts scripts/tests/owned-figma.test.ts
```
