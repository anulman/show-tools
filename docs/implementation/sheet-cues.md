# Sheets cue language

`terse-v2` is the explicit mapping notation version for whitespace-separated actions. Each action is `[press] operation [(source)] [execution]`. Operations are `cr`, `cx`, `r`, `c`, `x`, `p`, `g`, and `h`; compound operations are indivisible. Counts are one-based; `e`, `&`, and `a` are sixteenths. Numeric parentheses before an operation silently establish the press count. Alphabetic parentheses after it identify a source. A leading subdivision uses count one; subsequent subdivisions inherit the last explicit count within the same cell. Each cell resets that anchor.

`(3)&r4 (4)&cr1` presses at 3& and 4&, records on 4, then commits and arms at the following bar's 1. `&cx2` presses at 1& and stores on 2 without launching playback. A numbered execution earlier than its press denotes the next measure; `b` explicitly denotes the next bar. `(4)&cx(lead)b` stores lead next bar. `4er(day)&` and `4ec(day)&` press at 4e and execute at 4&. `x(day)3` has no authored press position and executes on 3. Acceptance of late or absent-prefix presses remains subject to the confirmed cue policy; this parser does not invent a tolerance.

`1p &p 2p &p 3p &p 4p &p` contains eight manual hits. Word playback is finite per hit; guitar playback loops. `3h` sustains one held note until release. `1g` replaces a loop with an ongoing gated instrument mode, permitting repeated press/hold/release until `x` or ordinary `p` exits. A blank cue does nothing. `4x` or `1x` with no active voice is an intentional dry press. Word selection follows chart beat parity, never a press counter. Named sources, immutable takes, and hardware banks are separate concepts.

## Canonical interchange and current execution boundary

`compiled-song.ts` calls `parseSheetCues` at Sheets ingestion. `terse-v2` preserves every valid cell as typed `authoredCues` in the canonical MusicXML performance metadata, including sources, press positions, and execution measure offsets. The reader checks these against the displayed command even in capability-blocked documents. Removing archived Sheets JSON does not lose them. Inspection prints each authored action and timing.

The current native ABI still implements looping `p`, one voice per button, and automatic playback on `c`/`cr`. It cannot yet execute store-only `cx`, `g`, `h`, named/polyvoice captures, or finite word `p`. These are recognized canonical instructions with explicit capability diagnostics, and block native execution. `terse-v2` play remains blocked until playback-mode metadata distinguishes finite and looping clips. Nonzero next-measure execution counts also need a native timing representation. Existing supported arms, commits, stops, and multiple timed actions lower to native data; no JavaScript scheduler is added.

The legacy `dyc-v1` ingestion path explicitly migrates `clb`, `1p*`, and numeric capture cutoffs before the same parser. Cutoffs retain `silence-to-bar-end`; terse numeric suffixes preserve the full source through their actual endpoint. Existing canonical documents remain typed data and are never recompiled from archived JSON. The legacy version remains accepted for existing songs; this milestone does not rewrite their canonical files or the live chart.

## Verification

`npm run verify:formal:cues` exhausts 22,110 cases through the actual parser and catches four real source mutations. This establishes bounded parsed intent, not native playback correctness. `sheet-cues.test.ts` additionally checks real accepted and malformed cues, multiple actions, archive-free MusicXML roundtrip, capability rejection, and tampered semantics. The existing MusicXML verifier retains its separate 7,488-case domain and mutation witnesses.

No C++ capture behavior changes here. `CaptureHandoff.tla`'s successful-publication-autoplays property still describes current `c`/`cr`. A future native `cx` must carry an explicit launch policy through publication and add store-only witnesses and model properties; globally weakening the existing autoplay property would hide a regression.

Confirmed future bend contract: signed rotation velocity relative to the baseline captured at button-down bends an eligible held Boys or gated Guitar sample by up to three semitones; release resets it. There is at most one eligible held sample. Hardware bindings are not inferred. Guitar phase must preserve its 3& preattack anchor; the Day recording retains its full [107:4&, 111:4&) room/effects tail. Neither behavior is established by this parser verification.
