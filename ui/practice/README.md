# Practice with the desk

From the repository root, build the manual clock and browser files.

```sh
npm install
npm run build
npm start
```

Open <http://127.0.0.1:8082/ui/practice/>. The page runs audio locally through its WASM/worklet bridge. The development server serves static files only.

## Load and inspect a chart

Open **MusicXML song & inspection** to import a complete MusicXML song or fetch a public worksheet into MusicXML. Inspect the source-located report, then load the resolved song while practice and output export are stopped. Worksheet JSON and mappings are import/audit inputs. CLI commands are documented in the [performance guide](../../lib/performance/README.md#compile-a-canonical-song).

The DYC authoring answers are encoded: unity gains, automatic cowbell variants, matching doubled groups, explicit `2c3` silent-source remainder, starred tempo hits, configurable ±25 ms cue windows, and native chart-gated backup chorus. F18 commit and F21 future arm are legal in either press order during bar 4: Drums & Claps records until bar 5, then Bing-Bong starts. Arming immediately changes the monitored voice while the earlier recording keeps its own processing. Software readiness is tracked in the integration review; physical microphone, room, and browser download checks remain operator-test steps.

For an executable compiled song, choose your default microphone and output in browser or system sound settings, configure each voice’s effect footer, and press **Start practice**. Grant microphone access. The demo recorder waits through the lead-in and starts with the song. Arm switches live processing immediately to the target voice; recording starts at the declared boundary. Commit starts the selected take or layers at its boundary without another play tap. `crb` commits the old take and starts the next capture at the same crossing.

An already-started compiled take finishes automatically at its written capture endpoint if you miss its commit cue. The engine saves and loops that take. A missed commit-and-arm also starts its declared next recording. Initial arm, play, and stop cues still require your press. Missed play and stop cues do nothing.

The pad annotations show the recording plan. Native take readback shows which layers or versions are actually saved and playing. For DYC, Drums & Claps layers bars 1–2 with bars 3–4 into a repeating `[1+3, 2+4]` phrase. Bing Bong layers bars 5–6 with bars 7–8. Its second layer stops recording at bar 8 beat 3 and keeps two counts of silent source. Cowbell retains three separate one-bar versions from bars 10, 11, and 12. Later chart phrases select their matching version.

Each pad resolves its action from its own row in the active column. A blank cell does nothing and never stops an existing loop. The pad's capture or playback status appears separately from its chart cue.

The supported action notation is:

| Cue | Press action |
| --- | --- |
| `r` | Arm capture immediately |
| `c` | Commit the capture and start its loop immediately |
| `cr` | Commit and loop the current take, then capture a new take |
| `x` | Stop this channel's playback immediately |
| `p` | Start the saved take looping |
| `b` suffix | Apply the action at the next bar crossing |

For example, `rb`, `cb`, `crb`, and `xb` queue their actions for the next bar. A numbered cue can distinguish its press position from its execution boundary; the inspection report shows both.

Numbers indicate beats. `e`, `&`, and `a` divide a beat into sixteenths, and a closing square bracket marks the phrase end. Generic tap cues play one hit per press. A song script can instead replay a recorded bar automatically; the pad then shows **Auto · recorded bar**.

Compiled captures have declared recording and loop intervals. Actual recordings cannot overlap; future arming for a disjoint interval is allowed. A silent-source remainder feeds zeros through the warm effects state. The layer joins the existing phrase phase without restarting its note; natural tails remain audible. Playback stays at original speed. Printed PCM is never processed again. **Stop** and the mushroom silence output, cancel pending actions, and discard incompatible partial drafts. Captured takes disappear when you leave or reload the page.

## Use the keyboard layout

The pad grid matches these physical key positions:

These names come from Dance Yrself Clean's chart notes. Each song supplies its own names. Unnamed controls display their hardware ID.

| Left column | Right column |
| --- | --- |
| Q · L1 · Whistle | W · R1 · Drums & Claps |
| A · L2 · Bing Bong | S · R2 · Cowbell |

Touch and mouse presses use the same actions. **Space** starts or stops transport. **Escape** presses the mushroom and stops everything, including while a slider or other input has focus. Other shortcuts ignore inputs and selectors. Held keys do not retrigger controls.

Each sample starts at 100%. Use the horizontal volume slider beneath its pad to adjust that channel, and **MUTE** to silence it. Unmuting preserves a running loop's phase. **LOAD** chooses an optional audio file for that pad while stopped. **Song click** defaults off and controls clicks during the song. The lead-in always clicks.

To load a file instead of capturing a take, stop practice and press **LOAD** on that pad. Loading a file does not change the chart action behind the pad. Supported audio formats depend on the browser.

## Record a demo

1. Press **Start practice**. Microphone access starts immediately. Stereo output recording starts automatically when the song begins, after the lead-in.
2. Perform the chart's capture and playback cues.
3. Press **Stop** to finish the take and release the microphone, then **Download take**. **Finish take** can end the demo recording while practice continues.

The download contains your main live voice, song click, and sample output, starting with the song. The practice lead-in is excluded. The native live-effects stem enters the recording once. Mono microphone input reaches both channels before the stack; sample stereo stays unchanged. Live speaker monitoring is separately gated by explicit physical-device confirmation and does not control the download. After stopping, the browser prepares a stereo 192 kb/s MP3 locally. Wait for **MP3 ready**, then download the `.mp3` file. Conversion runs in a worker without uploading audio. Start reports an error if microphone access or output recording is unavailable. A completed take remains available to download after a song change.

## Choose a song and range

Choose **Song script** to load another song. Switching stops and disposes the previous audio session, then loads the new chart, tempo, and control rows.

| Song | Tempo | Default range |
| --- | --- | --- |
| Dance Yrself Clean | 98 BPM | Bars 1 through 76 |
| Drunk Girls | 144 BPM | Bars 1 through 16 |
| I Can Change | 117 BPM | Bars 1 through 16 |

Song scripts and chart snapshots live in the top-level [songs directory](../../songs/README.md). Drunk Girls and I Can Change currently have no filled pad-action rows. Their empty cells do not create playback actions or preload samples.

Set **Tempo**, **Count-in**, **Start at**, and **End at bar** while stopped. Turn off **Loop range** to stop at the range end. Every Start begins a fresh count-in. A range loop wraps without another count-in. The final partial Dance Yrself Clean bar, 218, is excluded from playback.

## Open or follow the chart

With the [local Chrome helper](../../scripts/open-chart.md) running, localhost practice follows the lead-in and current bar automatically in Sheets. Changed columns are verified against the visible song sheet and Name box. Updates keep Chrome in the background and do not participate in audio timing. **Open current bar in Sheets** selects and brings forward the current column manually. On a hosted practice page, this button also opts into automatic following for that session. Hosted mobile practice makes no automatic helper requests by default.

The [Chrome Sheets follower](sheets-extension/README.md) can continuously follow position events directly from the practice tab. It remains a separate extension installation.

## Practice on a phone

Publish `dist/` on an HTTPS static host and open `/ui/practice/`. Plain HTTP on a LAN address does not provide the secure context required by browser audio and microphone APIs.

Load the page once and wait for the cached-files message before trying offline access. The cache contains app files and song programs. It does not preserve microphone takes or output recordings. Download a completed take before leaving the page.

Desktop offline reload and local audio have been checked. Physical-phone installation and browser behavior remain unverified. The desktop Sheets helper is optional and does not affect mobile practice.

## Develop the UI

`audio.ts` adapts microphone, native stereo buses, recording, and monitoring. `practice-worklet.ts` passes audio blocks and controls to the shared C++ performance engine through `pf_process_stems()`. C++ owns count-in, chart-action boundaries, capture, playback, and DSP. `app.ts` renders snapshots and submits controls through the bridge. Song-specific routes live outside the UI in `songs/`.

The practice clock build contains no aubio. Microphone capture works independently of tempo detection. The optional full tracker build retains its GPL-3.0-or-later dependency.

`npm run build:wasm` builds the complete shared manual-tempo performance engine, sampler, sequencer, and patch DSP. `npm run build:ui` bundles the browser app, audio worklet, song scripts, and extension. Rebuild after source changes.

```sh
npm run typecheck
npm test
npm run check:layout
```

## Try live microphone effects during practice

Build this checkout with `npm run build` and serve its `dist/` directory on localhost or HTTPS. Use the existing practice desk. Sheets, a relay, and the CDP helper are not required for audio. Choose the actual microphone/output setup in your browser or operating system before testing.

1. While stopped, open a voice’s **FX** footer. Adjust its ordered stages, then use **Save voice**. Applied values come from native readback. New settings do not change a previously captured take’s effects. Initial Slapback values are delay 100 ms, feedback 0, and wet amount 0.25.
2. Choose the practice range and count-in, then press **Start practice**. Grant microphone access. Wait for the native-confirmed live voice status and applied revision.
3. Live monitoring starts closed. After Start, open **Audio & Sheets** and use **Live monitoring** to confirm the actual physical relationship of your input/output devices. Different physical devices or the same USB audio interface permit monitoring. Same non-USB hardware or an unconfirmed setup leaves it off. Do not claim a different-device or USB setup unless you know it is true.
4. Speak or clap. On an eligible output, expect centered live voice and one repeat about 100 ms later. The song click stays separate from the effect. Changing effect values during a run is unavailable in this capability.
5. Press **Stop** or Escape. Live audio and delay history stop immediately, and microphone access releases. Wait for MP3 export, then use **Download take**. The download includes processed live voice even if monitoring stayed off. The mandatory lead-in stays outside the demo download.
6. To test a second setting, change values while stopped, Start again, and confirm the physical setup again after microphone acquisition. A replaced/lost microphone invalidates prior monitoring confirmation.

Compiled song pads support processed capture with Slapback enabled. Legacy songs and direct generic sampler/sequence recording still reject effect-enabled raw capture. Each voice has its own prepared graph and revision. Main vocals use their Slapback stack. Backup Vocals starts with Slapback followed by Chorus. Its compact rotation control sends signed observations to the native engine; physical knob bindings remain separate. During a marked `d` span, nonzero rotation starts backup processing. The next quarter-count grid boundary strictly after the last accepted movement, or an earlier written span end, stops feeding new source and leaves natural tails. Both directions have the same audio meaning. The deadline follows musical time across tempo changes; no browser timer schedules it.

While that song is running, vertical scrolling over the desk also sends knob movement. Both directions count as activity. Scrolling over value editors or an open settings/inspection panel keeps its normal behavior, as do horizontal scrolling and modified zoom gestures. A focused value editor also keeps the proxy inactive. Trackpad momentum continues to count while it produces wheel events. Raw wheel deltas retain their sign in pixel, line, or page mode; they indicate activity and are not calibrated physical-knob distances. The native chart rule owns activation and release; the wheel proxy adds no inactivity timer.

Automated browser checks use synthetic microphone input. An operator microphone/room test must record the actual input/output facts and be reported separately. No fixture audition is a physical monitoring test.

## Voices, effects, and characters

Open a voice's **FX** footer or **Manage voices** below the pads. The local library stores its display name, notes, optional Video character, avatar frame, ordered effect stack, and sheet-row connections. **Dry** means an empty stack. Capture instruments begin dry; vocal defaults remain available. Character artwork is a preview, and unassigned voices use initials.

**Save voice** first saves locally, then prepares routed audio while stopped. It does not open the microphone. The readback distinguishes saved from applied effects. Retained takes keep their recorded effects. Extra sheet voices can have metadata and effects without an assigned audio input. A changed source label requires explicit confirmation before reconnecting its saved voice.

The smaller rows below the pads show other instruments and their literal current-bar chart cues. They do not detect whether an external instrument is audible. AF-prefixed rows belong to the managed voice set; the prefix is part of a row label, not column AF.

The library lives in this browser and site origin. Use **Export JSON** for a portable library and **Import library** to replace the current library from validated JSON. **SQLite backup** downloads the underlying database for inspection/recovery; the editor imports JSON. Export before clearing browser storage or moving devices. Canonical MusicXML downloads include the saved effects and character assignments for that song. Native packets remain derived timing instructions.

Saved character selections also appear beside the sheet names on the sample pads and live vocal rows. Unassigned voices keep the compact text-only layout. All 51 selectable characters have static preview avatars. Imported unknown character IDs still use initials. These portraits are static presentation and do not indicate audio activity.

**Sheet connection** separates the **Voice row** (for example, `AF - Drums & Claps` at A10) from its **Cue row** (`R1` at A18). The default follows the loaded song's declared commands. Select and save a different cue row to author a new connection. Then open **Chart source, compiler & inspection**, import the source into MusicXML and inspect its derived program, resolve any related capture/layer diagnostics, and explicitly **Load staged song** while stopped. Saved connections feed that compilation; the editor continues showing the currently loaded command row until the replacement song is loaded. A cue connection does not assign an audio input or a new physical control.

Existing libraries and version-one JSON backups upgrade automatically. Version-two exports include the separate cue-row connections.

The static avatar library includes five pixel-final snapshots and 46 gallery previews. Finished animation review is pending for the gallery previews. Artwork provenance and review status are recorded in [the avatar handoff](https://github.com/anulman/show-tools/tree/main/assets/video/avatars).

## Audio modes

Choose Browser mode to run practice audio on this device. Choose Hardware mode when the desk is served by the EliteDesk gateway; the native host owns audio and timing. Hardware mode requires the gateway and its token. Stop browser audio before switching modes. Switching reloads the desk, so download a take first. Leaving Hardware mode detaches this desk without stopping the native instrument. Start remains a separate action after switching.

The Hardware desk stays available with audio off. **Enable audio** opens and prepares the configured native engine without starting practice. Once ready, use **Start practice** for the count-in and performance. Loading or reloading a page attaches to the current engine and transport; it never restarts them. Enable is disabled while an engine exists, and practice Start is disabled during an existing performance.

**Stop** silences the performance and retains the prepared engine and captured takes. **Terminate audio** releases the sound card and discards the engine's in-memory takes; the web desk stays connected. A native failure leaves the desk available for diagnosis and explicit re-enabling. Connection loss disables controls and warns that audio may still be running. See the [session CLI](../../docs/implementation/session-cli.md) to start or stop the web service from an existing host terminal.

Song imports and downloads use complete canonical MusicXML. Saved effects and character assignments travel with a song download. See the [cutover guide](../../docs/implementation/musicxml-cutover.md) for the profile, CLI and current notation capabilities. JSON worksheet snapshots are explicit import/audit inputs only.
