# Voice catalog migration core

This work prepares a filesystem authority without changing the running Performance Desk. The browser still stores schema-v2 SQLite through sql.js in IndexedDB. A native file adapter is verified with temporary databases. No sidecar service, endpoint, automatic synchronization, backup schedule or operator-data migration is installed.

Follow the [canonical data policy](../data-retention.md). The operator selected forward migrations over backward-compatible APIs. Old schemas are migration inputs, not alternate canonical write protocols.

## Forward migration

`lib/voice-catalog/schema.ts` owns the SQLite definitions shared with the existing browser store. `migrations.ts` supplies these staging operations:

- `migrateCatalog(sql, bytes, identity)` accepts version-one or version-two SQLite and returns schema-v3 bytes. It preserves the original bytes, revision, voice identities, notes, characters, effect order, parameters and qualified voice/cue bindings.
- `readMigratedCatalog(sql, bytes)` accepts only schema v3 and returns a verified content snapshot. It rejects older or unknown layouts instead of silently migrating on read.
- `restoreCatalog(sql, bytes)` stages a v3 restore with a newly generated UUID, preserving catalog identity and restored revision. Restoring the same backup again generates a different generation instead of accepting an old caller-supplied identity.

Schema v3 stores catalog identity and restore generation alongside revision in SQLite metadata. There is no external manifest transaction or mutation-history ledger. The new reader checks schema, integrity, foreign keys, metadata and domain values. The current browser's v2 writer is unchanged apart from importing the shared schema definitions.

These functions operate on supplied bytes. They do not install a filesystem authority, select a seed library or overwrite a database. Migration inputs remain available for recovery until a later canonical handoff verifies.

## Native file adapter

`native-store.ts` is a Node-only adapter around an explicitly supplied, existing schema-v3 file. It opens absolute filesystem paths without creating a missing database. It neither migrates old schemas on open nor selects a default data path. The browser and audio worklet do not import it.

Paths reject embedded NULs. Existing paths and destination directories resolve through the operating system before URL encoding, preserving the meaning of `..` across symlinks. File arguments cannot end in a separator or final dot segment. A lexical file-URL conversion alone can select a different catalog.

`NativeCatalogAuthority.open(filename)` validates the file. Its `read()` captures a coherent SQLite transaction. `replace(base, desired)` checks catalog and generation before considering identical-content acknowledgment, then checks revision before changing data. Business rows and the next revision commit in the same `BEGIN IMMEDIATE` transaction. Unchanged content within the same generation does not advance revision. An exhausted revision cannot wrap.

All transaction steps are synchronous. The asynchronous content digest uses the captured result after the transaction completes, so another connection cannot change the returned stamp/body pair during hashing. SQLite errors propagate. A failed or unobserved acknowledgment is not proof that a write failed; the replica's uncertain state retains that request until reconciliation. SQLite transactions serialize connections; this module does not provide a deployment process lock, connection service or retry timer.

`snapshot(destinationDirectory)` exclusively creates a new private directory and returns `{ filename, snapshot }`. The parent must already exist. Existing files, directories (even empty ones), and symlinks are refused untouched. A directory owns the complete SQLite namespace: publishing a bare file beside orphan `-wal`, `-shm`, or `-journal` files can replay stale data when SQLite reopens it. Checking those sidecars before linking a file leaves a race, so the adapter never adopts an existing namespace.

Within the reserved directory, the adapter creates a consistent `VACUUM INTO` copy in private staging, validates it, and flushes its completed file. It publishes `catalog.sqlite` with a no-clobber hard link, removes staging, and flushes both the new directory and its parent. Callers reopen the returned `filename`; the returned stamp and digest describe that copy even if the source later changes. Concurrent publishers to the same destination have one winner through exclusive directory creation.

On failure before publication, cleanup removes owned staging and attempts to remove the empty reserved directory non-recursively. Unexpected contents are preserved. After publication, failures retain the completed database and reject rather than claim success or rollback. Cleanup failures preserve the original error in an aggregate error. The caller must own the parent and prevent replacement or outside writes to the reserved directory during publication. This contract does not defend against another process with the same credentials deliberately changing that namespace.

`close()` releases the native connection. The adapter uses Node's built-in `node:sqlite`; a production host/runtime has not been selected. The fixtures verify the available Node runtime, not Windows filesystem behavior or power-loss durability. No automatic live restore or off-machine upload is supplied.

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

The migration fixtures cover v1/v2 conversion, export/reopen, malformed metadata/schema, invalid effects and links, unknown character preservation, source-byte preservation and generation-changing restore. A temporary native SQLite database produces a consistent backup that a fresh process reopens. The test compares the complete expected catalog after reopening it through sql.js and restoring its generation. The native fixtures and file adapter use Node's built-in `node:sqlite`; no production host/runtime is selected.

Replica tests cover stale local saves, independent local/canonical revisions, initial-library conflicts, reordered and conflicting snapshots, edits made during a request, stale or mismatched acknowledgments, outage retries, undo after a lost acknowledgment with committed or uncommitted writes, restored generations, explicit resolution and immutable effective views.

Native adapter tests cover coherent reads, revision persistence, stale writers, identity-first generation fences, no-op writes, exhausted revisions, SQLite busy errors, exact path resolution, copied-snapshot identity, fresh-process reopen, orphan-journal refusal, competing-process publication, pre-publication cleanup and no-clobber publication. On non-root Mac/Linux fixtures, a real directory-permission failure after publication verifies that the completed snapshot remains intact. Real authority/replica tests exercise an uncertain save followed by a local undo, with committed or uncommitted writes and another writer. They verify that a late old-base request cannot overwrite the final undo. A restored snapshot with repeated revision rejects an old-generation equal-content save.

These tests do not establish real cross-tab synchronization, after-DML disk-full handling, filesystem crash durability, endpoint authentication, actual offline Start integration or off-machine backup. No physical devices or operator browser libraries are opened.

## Remaining cutover

After the canonical host and backup destination are selected, configure and verify the host's runtime, filesystem durability and ownership around the file adapter. Upgrade the worker, cache envelope, editor and Video callers together. Obsolete clients must fail clearly without a legacy write adapter. Preserve each existing browser copy while the replacement verifies.

Compare operator-selected exports before choosing the initial canonical library. Revisions from different origins do not identify a winner. Link an identical cache explicitly, and retain a differing cache for resolution. Do not clear a cache when a connection succeeds.

Practice audio remains WASM-only and must start from valid cached state without contacting the authority or a relay. Canonical save, local save, native Applied state and verified backup remain separate outcomes. Cue bindings still require explicit compile, inspect and load before changing a performance program.

A later backup milestone must use a consistent SQLite snapshot, verify schema and representative records in a fresh restore, and separately prove the approved destination covers loss of the host. No claim of off-machine recovery follows from these local fixtures.
