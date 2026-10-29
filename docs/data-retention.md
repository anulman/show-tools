# Canonical data and retention

Preserve completed work and useful lessons. The project does not require a permanent archive of every experiment, recording, or review artifact. This policy records the operator's decisions on October 29, 2026.

## Canonical stores

| Data | Canonical store | Retention boundary |
| --- | --- | --- |
| Engine, effects, tools, tests, and concise lessons | Git repository | Commit the selected implementation and the information needed to maintain it. |
| Promoted characters, poses, and animation | Figma | Preserve stable identities, file and node references, and the export path. Runtime exports are derived assets. |
| Per-voice effects, character assignments, sheet bindings, cue connections, and other operator authoring data | A database sidecar, with SQLite preferred | Keep it separate from code and Git history. Give it independent backup and restore. |
| Completed CAD designs | Saved, self-contained design checkpoints | Preserve an editable design, required components, units, assembly information, and manufacturing exports needed for the completed design. |
| Unpromoted prototypes, comparison reports, generated candidates, and process evidence | Temporary working storage | Extract useful lessons before routine expiry. |
| Recordings, unfinished takes, and current work | Temporary storage unless explicitly promoted | Loss is acceptable. No default archival requirement. |

An asset becomes canonical through an explicit promotion, not because an agent generated it or a local commit exists. Stable character IDs belong to the shared registry; Figma node IDs remain references to artwork.

## Promotion and cleanup

Owners review temporary material at milestone handoff and during periodic housekeeping. Before deleting old process material, they record the useful result in existing documentation, code, parameters, or tests. A short explanation of a failed approach is enough when no executable rule is useful. Do not replace discarded reports with another large provenance archive.

For animation, verify that the promoted Figma artwork and motion can supply the required exports. Unpromoted prototypes can expire after their lessons are extracted. Git retains runtime code, identity metadata, necessary exports, and concise lessons.

For the Tribulations guitar effect, commit the selected effect, its maintained parameters, meaningful tests, and useful lessons. Raw input recordings, fit candidates, comparison reports, and listening-analysis output need not become repository assets.

For CAD, verify the completed saved checkpoint before discarding its original inputs and process work. A restored design must support further iteration without private temporary paths, expired receipts, or unpublished worker commits. Keep active studies and their required inputs until that handoff is complete. Source code still follows normal repository maintenance.

This policy authorizes routine expiry after these conditions are met. It does not mark today's active prototypes as completed or establish a running cleanup schedule. Owners must implement and verify promotion and expiry in their workstreams.

## Database sidecar and backups

The database sidecar holds current operator data independently of a code checkout. A code rollback or Git branch switch must not silently replace that data. Schema migration and application compatibility need explicit handling.

The intended voice-library authority is a persistent database, with SQLite preferred. Browser copies can support offline authoring and practice. Saving locally, synchronizing with the sidecar, and completing a backup are distinct outcomes. Practice audio must continue without a database connection or relay.

The backup must restore the sidecar independently of Git. A SQLite backup must be a consistent database snapshot, rather than an arbitrary copy of a live database file. A configured copy on the same disk alone does not cover loss of that computer. Restore verification must open a backup and check its schema and representative voice, effect, character, and cue bindings.

The canonical host, backup destination, snapshot cadence, and retention remain configuration decisions. No sidecar host or automatic backup is established by this document.

## Current implementation

The voice library already uses relational SQLite through `sql.js`. Its current durable copy is a SQLite snapshot in browser IndexedDB, scoped to the browser profile and site origin. JSON export and SQLite download are manual recovery paths. The filesystem sidecar and independent automatic backup are not implemented yet.

CAD generators and current comparison pages still use ignored frozen receipts and source-revision checks. These validate active proposals, but they are not the final-design restore path described above. Promotion must remove that dependency before those inputs can expire.

Figma is the canonical source for promoted animation. Existing local experiment libraries and raw review records are not a new requirement for permanent backup. Each owner must first extract lessons and verify the canonical handoff.
