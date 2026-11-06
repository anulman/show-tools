# DYC import awaiting cue definition

The public `01 Dance Yrself Clean` worksheet (gid `101`) was fetched through `show-tools chart fetch` on November 6, 2026 at 06:32 UTC. The import contains all 218 bars, the used range `A1:HL55`, and 468 unchanged cell notes. Google public exports supply no revision identifier. This observation does not assert a later worksheet revision is identical.

The resulting `show-tools-song-v2` MusicXML passes the canonical reader and preserves the compiled model and musician report through write/read round trips. Neither the previous document nor the fresh import contains portable voice metadata. The fresh document is **non-executable** and has not replaced the runnable bundled song.

## Changes since the single-take Whistle revision

| Cells | Previous | Fresh worksheet |
| --- | --- | --- |
| E10, F10 | `-` | `-'` |
| I12, J12 | `1` | `1'` |
| D18; F18 | `crb`; `cb` | `cb`; blank |
| I19; K19 | blank; `rb` | `rb`; blank |
| L19, M19; N19 | `crb`; `cb` | blank |
| O19 | whitespace | `clb` |
| CB19; CE19 | blank; `rb` | `rb`; blank |
| CF19, CG19; CH19 | `crb`; `cb` | blank |
| CI19; CI20 | `x`; blank | `clb`; `x` |
| H21; J21 | `crb`; `2c3` | `cb`; blank |

The Drums & Claps and Bing Bong changes remove their second captures. Their explicit doubling-group mappings still reference those removed arms and need a deliberate authoring-policy revision. Cowbell now arms earlier and removes its individual bar commits. Its retained-variant source references still point at the removed `CE19` arm.

## Execution remains blocked

`clb` at `O19` and `CI19` is undefined by the current grammar and sheet legend. These cells have no explanatory notes. The historical [performance plan](../plans/performance-engine.md) defines `cl` as committing the last bar, explicitly distinct from next-bar commit; it does not define `clb`. That historical proposal does not establish the meaning of this new spelling or authorize splitting these new multi-bar recordings.

The current import reports 98 errors: two unknown cues, one overlapping take, one uncommitted take, four layer-group errors, two variant-source errors, 78 unresolved variants and ten unresolved play selections. Most follow from the unknown commit operation and obsolete mapping references. Preserve these diagnostics until the cue meaning and capture/selection policy are resolved; do not substitute `cb`, invent retained takes, or relax executable validation.

The original frozen cutover fixture and verifier remain unchanged. Staged import evidence belongs in temporary working storage until promotion, following [data retention](../data-retention.md).

Verification passed 44 focused MusicXML reader, exporter, cutover and chart-CLI tests. The deterministic CLI produced a reviewable compiled draft and correctly rejected native encoding with `CHART_ENCODE_BLOCKED`.
