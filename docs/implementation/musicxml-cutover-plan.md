# MusicXML cutover

## Definition of done

Canonical full-song MusicXML independently produces DYC's 218-bar chart, native performance tables and current musician sheets. All application song consumers load MusicXML. Sheets JSON and mapping parsing remain only at the import/migration boundary. Removing the audit archive changes no executable or printable musical meaning.

## Work list

- [x] Read poteto-mode principles and ground current ownership.
- [x] Compare canonical document approaches. Choose one XML reader with shared typed projections, rather than independent consumer parsers.
- [x] Capture current compiled instructions, native bytes and writing-page baselines.
- [x] Implement and validate canonical MusicXML reader/writer with standard music facts and versioned app instructions.
- [x] Migrate rendering, Sheets exports, CLI, built-in songs and Practice imports.
- [x] Regenerate complete song fixture; eliminate old downstream input paths.
- [x] Verify document edits, archive removal, native behavior, deterministic CLI output and rendered PDFs.
- [x] Review, remove redundant code, commit verified milestones and document remaining interoperability limits.

## Work ownership and throughput checkpoint

The core worker owns the new codec and its focused tests. The consumer worker owns Practice, song modules and chart CLI. The verification worker owns the independent conversion check and migration guide. The coordinator owns the Sheets adapter, musician renderer, Apps Script and integration. Independent files keep parallel edits separate. Review after the first codec integration to check whether the parsed shape exposes enough meaning without reconstructing Sheets input.

## Synthesis

Both design candidates converged on one persisted MusicXML document and one parsed semantic model. Standard music facts are read from XML, while typed application instructions cover capture and control facts lacking standard notation. Original source and mapping can remain optional provenance only. This avoids a wrapper around the old JSON compiler and preserves C++ ownership of real-time execution. The migration reuses existing semantic validation and native table generation.

## Remaining external verification

The browser access host was unavailable. Live browser interaction and Google authorization/installation were not verified. The strict v1 profile rejects external pitched notation, harmony, repeats and tempo changes until their semantics are supported. These are capability limits, not fallback paths.
