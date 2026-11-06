# Upload before replacing a visible actor

A failed Tribulations image upload left a newly created component blank. Replacing the visible actor before checking that fill made the actor disappear. DYC separately showed that correct source pixels and reported instance bounds can coexist with stale, tiny rendered geometry. Source readiness and actual placed visibility are separate checks.

Keep the existing actor while creating, uploading and filling the replacement sources. Under the current exact Figma lease, use `scripts/video-expansion/figma-image-readiness.ts` in the show-tools checkout. Load the current Figma skills first. Use exact source page, component and image-filled node IDs. Do not resize a source to fit a transport limit.

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { prepareImageReplacement } from './scripts/video-expansion/figma-image-readiness.ts';

const ready = await prepareImageReplacement({
  sources: [
    { target: { fileKey, pageId: sourcePageId, sourceNodeId, imageNodeId },
      expectedPng: await readFile('registered-source.png') },
    // Include every uploaded source consumed by this replacement.
  ],
  replacementPageId,
  replacementCode: authorizedReplacementCode,
  readSource: code => callOwnedFigma({ fileKey, code }),
});
await writeFile('replace.js', ready.code, { flag: 'wx' });
await writeFile('source-ready.json', JSON.stringify(ready.receipt), { flag: 'wx' });
```

`callOwnedFigma` represents the existing sequential, lease-guarded connector supplied by the calling harness, not a function exported by this helper. Its complete tool response must be returned unchanged. The Node helper owns source collection; the Figma connector must execute each requested script read-only. Do not replace it with an agent-interpreted screenshot or hand-assembled response.

Each expected PNG is the exact intended source canvas, including transparency and registration. Verify its input hash against the current art handoff. The helper accepts one to eight unique source components in one file. It checks populated visible image fills, nonempty artwork and every decoded source RGBA byte. Missing/DNS-failed uploads, blank exports, wrong targets, incomplete or mixed chunks and pixel mismatches cannot produce a replacement script. It neither approves new artwork nor repaints a failed candidate.

The collector first pins source metadata, the complete PNG byte length and SHA-256, then requests sequential chunks. Every chunk call rechecks the source and reexports the complete PNG before returning at most 24 KiB of PNG bytes encoded as base64. Chunk identity, order, offsets, canonical base64, reconstructed length and full PNG SHA-256 must match. No intermediate Figma state is persisted. If a source changes between calls, restart collection under a valid lease; never join chunks from different attempts.

Execute `ready.code` unchanged under the exact lease. It already contains the authorized replacement code. Do not append additional mutations afterward. Its one shared guard checks file identity first, switches once to `replacementPageId`, and freshly checks every source before any replacement code runs. Sources may live on other pages. Live dimensions, image fill identity, full PNG length and SHA-256 must match their locally verified snapshots. Freshness relies on SHA-256 collision resistance; local decoded RGBA parity remains exact byte equality. A pixel-identical but byte-different reexport is deliberately stale.

Generated read scripts and captured tool responses have 40,000-byte budgets, leaving margin below the connector limits. A source is bounded to 16 MiB of PNG data and 16 megapixels. Figma must materialize an export before its byte size can be checked. The complete guarded replacement is bounded below 50,000 bytes with 1,024 bytes reserved for the owned wrapper. Supply the actual replacement code to preparation so its size is counted. A failed or oversized transport goes to Chief; do not omit checks, crop artwork, waive source parity or lower resolution to recover it.

The guard does not create, hide, replace or delete nodes itself. The existing authorized replacement code still owns exact actor IDs, transforms, output IDs and cleanup. After replacement, export the actual composed scene and inspect visible actor size, position, contact and framing in each requested aspect ratio. Source parity alone cannot pass that delivery check. Preserve the prior valid source/export until this final check passes; correct or restore a failed placed candidate within the existing bounded authorization.

Record source readiness, actual placement review, art/style review and runtime promotion separately. Keep current receipts with active work; no permanent raw-upload archive is required. Run the focused regression with `node --import tsx --test scripts/tests/figma-image-readiness.test.ts`.
