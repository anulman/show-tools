# DYC answered-semantics implementation

The compiler and shared C++ engine remain the musical owners. The browser submits one button occurrence. It neither schedules the starred tempo hit nor constructs silent audio.

## Grounding and design decision

The existing semantic compiler pairs captures and creates immutable selections. Its old `end` field conflates capture cutoff with loop period. Native prepared tables execute cues and processed-cache playback, but ordinary playback starts at phase zero. The tracker advances ahead of compiled rendering within each block, so a queued render action cannot safely backdate a tempo command.

Two designs were compared: explicit capture/loop/anchor domain fields, and bounded compound-action lists. Independent review selected the former for its smaller public interface. Retained past cue-frame anchors and explicit column-scoped applicability come from the second candidate. No general instruction VM or second scheduler is introduced.

## Source facts and usage

J21 `2c3` is pressed near bar 8 beat 2 and commits at beat 3. Its second Bing-Bong capture spans bar 7 beat 1 through bar 8 beat 3: six counts. The declared rest spans bar 8 beat 3 through bar 9 beat 1: two counts of zero source. Its full loop therefore spans eight counts, matching the first capture at bars 5 through 7. The group origin is bar 5 beat 1; the second layer joins at phase six, without restarting its note. Natural effects tails remain audible during the zero-source suffix.

The R1, L1, and L2 matching phrase pairs are layers with explicit source-cell group membership. R2 retains distinct chart-selected variants. All starting gains are unity. Equal declared periods and matching normalized phrases are invariants; changed authoring fails with source-located expected and actual spans rather than being stretched, truncated, or silently padded.

`1p*` performs play-now and a beat-1 tempo-hit intent at the actual accepted press frame. The future pedal uses the same native handler with no beat hint. The hint records provenance; it never identifies or resets transport phase. The existing bounded median tap estimator is retained as a technical baseline with rephasing removed. Isolated hits need not produce a BPM estimate. Starred tempo is restricted to immediate execution between processing blocks. Outer command deduplication precedes the compound operation.

Cue windows are explicit milliseconds, initially 25 ms early and late. Equal-distance ties reject. Numeric cues retain their actual past occurrence frames across tempo changes; future targets project from the current tempo anchor. Prefixless cues remain column-scoped. Knob `d` execution is explicitly deferred for the first A run.

## Contract sketch

- Semantic takes contain `begin`, `captureEnd`, `loopEnd`, an explicit group identity, and `phraseAnchorTakeId`. The inspector prints captured, rest, and loop spans beside their source cells.
- Mapping groups identify the voice and arm cells that must double. Normalized phrase and loop-period checks protect those authoring assertions.
- Compiled packet version 2 retains the 16-field header, with early/late values measured in milliseconds. Take rows contain voice, begin bar/beat, capture-end bar/beat, gain, loop-end bar/beat, and anchor-take index. Cue rows append a tempo beat hint, zero for none and one for starred beat-1 input.
- ABI 4 exposes the versioned tables and shared tempo-hit observation. Native loading independently validates capture graphs, explicit periods, and group anchors.
- Filters owns `ProcessedTake::commit(period)`, `period()`, and `Playback::start_at_capture_end(loop)`. Source/printed storage ends at the captured prefix; the suffix consumes virtual zero source. A prepared endpoint Rack starts the joined playback. Wrap moves only the source cursor.
- The native Program owns concrete group period/phase checks. It preserves existing members instead of restarting them. Capture-end playback becomes the sole owner of the outgoing captured voice history; live-route draining must not duplicate that tail.

The loop period can exceed PCM capacity because its suffix has no PCM storage. Extra endpoint Rack memory is included in preparation admission. No callback seek, preroll, allocation, or freeing is permitted. Runtime phase/period incompatibility is an explicit error, never an unreported resampling or reshape.

## Verification

Verify source-linked DYC spans and group identities; equal-period and phrase mismatch rejection; actual capture cutoff, silent-source suffix, common phase wrap, and one audible tail owner; fixed millisecond windows and tie rejection; identical pedal/star intent with phase, serial, and epoch preserved; duplicate input suppression; native/WASM PCM equivalence; and prepared-path allocation guards. Current browser, microphone, and MP3 acceptance remains a separate gate.

## Ownership correction from the full-source run

The baseline full A run rejected F21 in both native and WASM at 44.1 and 48 kHz. That exposed an incorrect armed-owner inference, not an authoring defect. R1 records during `[3:1,5:1)` and Bing-Bong during `[5:1,7:1)`. Future arming during bar 4 is legal. The live route changes immediately while R1 captures through its own rack. Prepared tail snapshots handle the detached monitor history; they never feed the recorded stream.

The corrected native model has separate live-route, active-capture, and pending-reservation state. At a shared boundary, completed captures commit before new captures start, regardless of button or press order. Missing the old commit causes a source-indexed, nonfatal rejection of the attempted second recording. It does not auto-commit or stop the existing recording. The compiler rejects genuine recording-span intersections and permits earlier arming. No chart correction or overlap exception is needed.
