# Import verified pixel cels into Figma

These authoring helpers publish frozen, registered pixel cels into the project's Figma library, `QWreOYAnaje2LlywefJFiK`. They do not redraw artwork, choose musical timing or approve its style.

Run commands from the checkout root with `node --import tsx`.

1. Prepare a JSON spec with the intended `fileKey`, target `pageId`, deterministic `collectionName`, `batchSize` from 1 through 4, and nonempty `assets`.
2. Run `scripts/video-expansion/prepare-story-cels.mts SPEC_JSON NEW_OUTPUT_DIRECTORY`.
3. Execute the generated `batch-N.js` files sequentially through Figma MCP under the shared writer lease. Save each complete tool response in the output directory as `result-N.json`.
4. Run `scripts/video-expansion/verify-story-cels.mts OUTPUT_DIRECTORY`.

Each asset supplies a unique `id` and component `name`, native integer `width` and `height` up to 512, `pivot` with `x` and `y`, human-readable `purpose`, a `combined` PNG reference and ordered `layers`. Each layer supplies a unique `name` and an `image` PNG reference. PNG references contain `path` and exact file `sha256`.

Preparation requires matching dimensions, binary alpha, unchanged source hashes and an exact declared layer composite. It converts those pixels into native integer SVG geometry and produces bounded import scripts. Each script requires the live `figma.fileKey` to match the intended target before any other Figma access. Missing or different identity stops the import. Existing components are reused only when their complete direct child names, order and visibility match. Unexpected children, including hidden extras, stop the import before export.

Verification requires nonempty coverage, unique asset identities and exact batch coverage. Every batch response must report the actual file identity and match the intended target. It checks all component pixels, transparent margins, named-layer pixels and complete direct child order. No file or layer is inferred from its name alone.

A successful run atomically replaces `canonical-receipt.json`. The receipt binds its result to hashes of `expected.json`, every exact batch response and the verifier itself. It applies only to those inputs. A failed rerun preserves the prior receipt, whose input hashes identify its earlier coverage. Re-run verification for changed inputs; a bare `PASS` field is insufficient.

This receipt certifies source pixels and the recorded structure. Independent identity, style, anatomy and motion reviews remain separate. A composed scene and its actual Figma timeline export require their own verification. The helpers do not add renderer support or adopt an artwork catalog.

Run the focused CLI regressions with `node --import tsx --test scripts/tests/story-cels.test.ts`. The repository's `npm test` command includes these tests.
