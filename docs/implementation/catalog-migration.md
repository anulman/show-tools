# Voice catalog migration core

This milestone prepares a filesystem authority without changing the running practice desk. The browser still stores schema-v2 SQLite through sql.js in IndexedDB. No sidecar service, endpoint, automatic synchronization, backup schedule or operator-data migration is installed.

Follow the [canonical data policy](../data-retention.md). The operator selected forward migrations over backward-compatible APIs. Old schemas are migration inputs, not alternate canonical write protocols.

## Forward migration

`lib/voice-catalog/schema.ts` owns the SQLite definitions shared with the existing browser store. `migrations.ts` supplies these staging operations:

- `migrateCatalog(sql, bytes, identity)` accepts version-one or version-two SQLite and returns schema-v3 bytes. It preserves the original bytes, revision, voice identities, notes, characters, effect order, parameters and qualified voice/cue bindings.
- `readMigratedCatalog(sql, bytes)` accepts only schema v3 and returns a verified content snapshot. It rejects older or unknown layouts instead of silently migrating on read.
- `restoreCatalog(sql, bytes)` stages a v3 restore with a newly generated UUID, preserving catalog identity and restored revision. Restoring the same backup again generates a different generation instead of accepting an old caller-supplied identity.

Schema v3 stores catalog identity and restore generation alongside revision in SQLite metadata. There is no external manifest transaction or mutation-history ledger. The new reader checks schema, integrity, foreign keys, metadata and domain values. The current browser's v2 writer is unchanged apart from importing the shared schema definitions.

These functions operate on supplied bytes. They do not install a filesystem authority, select a seed library or overwrite a database. Migration inputs remain available for recovery until a later canonical handoff verifies.

## Snapshots and local edits

`authority-model.ts` defines catalog bodies, authority stamps and schema-v3 snapshots. A stamp identifies catalog, generation and canonical revision. The SHA-256 content digest is deterministic across object-key and voice-list ordering while retaining effect order. Parsing a snapshot verifies its digest against validated content.

`replica.ts` supplies pure transitions for an unlinked working copy, a linked copy, an in-flight save, an uncertain save and a conflict. It performs no IO. Each real transition advances a browser-local envelope revision. Canonical revision never replaces this local concurrency token.

Local saves preserve pending data. A refresh cannot discard a local change or silently choose among differing initial libraries. A sent request retains its exact base and content while later edits stay in the working copy. A matching acknowledgment advances the canonical base without deleting later edits. A stale acknowledgment changes nothing.

A lost response leaves the exact attempted write uncertain. Undoing back to the old base does not make that copy synced, because the attempted write may still commit. A read of the same base cannot clear uncertainty. Retry settles the original base and content before publishing a later edit. A newer canonical revision fences the old request: matching local content can become synced, while different local content remains in conflict. A restored generation always requires explicit resolution.

Changed or foreign generations require conflict resolution. A restored catalog cannot accept an old base merely because its revision number repeats. The future IO adapter must capture the local envelope revision when requesting a refresh and commit the entire transition atomically across tabs. The pure revision checks do not themselves provide an IndexedDB lock or a network owner.

`freezeCatalogReplica` returns one detached, deeply frozen effective body, its content digest and canonical or explicitly local provenance. Future audio preparation and Video cast resolution consume this same frozen view. No second catalog read may recast a run after audio preparation. This helper is not yet wired to Practice or Procedural Video.

## Verification

Run the catalog checks from the repository root:

```sh
node --import tsx --test lib/voice-catalog/tests/*.test.ts
npm run typecheck
```

The migration fixtures cover v1/v2 conversion, export/reopen, malformed metadata/schema, invalid effects and links, unknown character preservation, source-byte preservation and generation-changing restore. A temporary native SQLite database produces a consistent backup that a fresh process reopens. The test compares the complete expected catalog after reopening it through sql.js and restoring its generation. The native fixture uses Node's built-in `node:sqlite`; it is a test dependency, not a selected production host driver.

Replica tests cover stale local saves, independent local/canonical revisions, initial-library conflicts, reordered and conflicting snapshots, edits made during a request, stale or mismatched acknowledgments, outage retries, undo after a lost acknowledgment with committed or uncommitted writes, restored generations, explicit resolution and immutable effective views.

These tests do not establish real cross-tab synchronization, filesystem crash durability, endpoint authentication, actual offline Start integration or off-machine backup. No physical devices or operator browser libraries are opened.

## Remaining cutover

After the canonical host and backup destination are selected, implement the native filesystem adapter and its explicit runtime/durability configuration. Upgrade the worker, cache envelope, editor and Video callers together. Obsolete clients must fail clearly without a legacy write adapter. Preserve each existing browser copy while the replacement verifies.

Compare operator-selected exports before choosing the initial canonical library. Revisions from different origins do not identify a winner. Link an identical cache explicitly, and retain a differing cache for resolution. Do not clear a cache when a connection succeeds.

Practice audio remains WASM-only and must start from valid cached state without contacting the authority or a relay. Canonical save, local save, native Applied state and verified backup remain separate outcomes. Cue bindings still require explicit compile, inspect and load before changing a performance program.

A later backup milestone must use a consistent SQLite snapshot, verify schema and representative records in a fresh restore, and separately prove the approved destination covers loss of the host. No claim of off-machine recovery follows from these local fixtures.
