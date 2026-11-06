# Latest DYC capture import

The public `01 Dance Yrself Clean` worksheet (gid `101`) was fetched through `show-tools chart fetch` on November 6, 2026 at 06:32 UTC and fetched again at 06:42 UTC with identical values and notes. The import contains all 218 bars, the used range `A1:HL55`, and 468 unchanged cell notes. Google public exports supply no revision identifier. This observation does not assert a later worksheet revision is identical.

The canonical song uses `show-tools-song-v3`. It preserves the compiled model and musician report through write/read round trips and is executable. Neither the previous document nor the fresh import contains portable voice metadata.

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

The Drums & Claps and Bing Bong changes remove their second captures. Their groups now each contain one take. Cowbell arms earlier and retains each complete multi-bar recording as one immutable parent. Explicit shortened reuses select bar 82 from the parent armed at `CB19`.

## Commit last bar and reuse recorded bars

The operator confirmed `clb`: commit the last completed bar, retaining recorded material for later matching reuse. At the start of its written bar, this commits the preceding recording and selects its final completed bar for looping. `O19` commits bars 8–12 at bar 13; `CI19` commits bars 79–84 at bar 85. This spelling does not postpone source capture until the following bar.

Each performed Cowbell bar supplies a source slice identified by its normalized written phrase. Consecutive matching slices from the same recording continue sequentially when available; otherwise the latest previously recorded matching identity is selected. Shortened bars 96 and 164 reuse bar 82 through count 3.5, then admit zero source for the remainder of their four-count loops.

Selections carry an explicit source beginning, exclusive end and loop period in chart counts. C++ observes their exact frame boundaries and captures the source rack state at each slice beginning. Playback references immutable parent PCM and starts from that captured history; it never copies PCM, replays a long prefix on the audio thread or adds fake operator cues. Changing views keeps the running effect history and loop phase. Independent slice starts restore their original boundary state.

The frozen source retains its original musical instructions. The verifier
explicitly projects versioned fields and native window rows to the historical
layout before checking the original cutover hashes and nine handout pages.
Staged import evidence belongs in temporary working storage until promotion,
following [data retention](../data-retention.md). A final public fetch before the
combined handoff matched the canonical compiled song and musician report exactly,
including all 468 notes.

The initial unsupported import failed closed with 98 diagnostics. After implementing the confirmed semantics and updating stale mappings, native and WASM complete-song execution passed at 44.1 and 48 kHz. Independent PCM checks cover slice heads, evolving loops, omitted source, retained tails, phase-preserving switches and allocation-free playback. The canonical song retains five parent takes, eleven complete Cowbell bar views and one shortened view reused at two positions; the earlier fixed cutover fixture remains separate.

Practice regression fixtures follow the same separation. Current chart checks exercise its actual cue cells, five-parent startup at both device rates, eleven Cowbell bar views and the real worklet control-port recording sequence. Historical doubled captures and overlapping future-arm reservations use the frozen cutover song explicitly, preserving those engine regressions without attributing old instructions to the latest chart.
