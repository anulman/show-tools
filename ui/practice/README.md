# Practice with the desk

For the installed EliteDesk and physical I-PAC controls, use the [practice quickstart](../../docs/practice-quickstart.md).

From the repository root, build the manual clock and browser files.

```sh
npm install
npm run build
npm start
```

Open <http://127.0.0.1:8082/ui/practice/>. The page runs audio locally through its WASM/worklet bridge. The development server serves static files only.

## Hear a reference or identify a sung note

Open **Tuner** in the header. **Use shared audio** connects the tuner to the desk's existing session. In Hardware mode, enable audio on the desk first. Opening the tuner does not request a microphone or start the song.

Choose a root note, octave, and scale. Each selection applies immediately. Major and C3 are the defaults. **Hear note** plays the current reference. **Play scale** previews the complete ascending scale without changing your confirmed progress. **Stop sound** cancels a reference or scale preview. **Confirm** advances silently; confirming the final note completes the exercise.

Click **Listen** to display the note you sing, its frequency, and how sharp or flat it is. Listen uses the same microphone as practice. Reference playback briefly pauses pitch detection. The detector handles one note at a time. Closing the tuner stops its analysis and reference without terminating the shared audio session.

Stop practice and finish the demo recording before tuning. Starting practice, Stop, Panic, and microphone loss close native tuning.

## Load and inspect a chart

Open **MusicXML song & inspection** to import a complete MusicXML song or fetch a public worksheet into MusicXML. Inspect the source-located report, then load the resolved song while practice and output export are stopped. Worksheet JSON and mappings are import/audit inputs. CLI commands are documented in the [performance guide](../../lib/performance/README.md#compile-a-canonical-song).

The DYC authoring answers are encoded: unity gains, automatic cowbell variants, matching doubled groups, explicit `2c3` silent-source remainder, starred tempo hits, configurable ±25 ms cue windows, and native chart-gated backup chorus. F18 commit and F21 future arm are legal in either press order during bar 4: Drums & Claps records until bar 5, then Bing-Bong starts. Arming immediately changes the monitored voice while the earlier recording keeps its own processing. Software readiness is tracked in the integration review; physical microphone, room, and browser download checks remain operator-test steps.

For an executable compiled song, choose your default microphone and output in browser or system sound settings, configure each voice’s effect footer, and press **Start**. Grant microphone access. The demo recorder waits through the lead-in and starts with the song. Arm switches live processing immediately to the target voice; recording starts at the declared boundary. Commit starts the selected take or layers at its boundary without another play tap. `crb` commits the old take and starts the next capture at the same crossing.

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

Touch and mouse presses use the same actions. **Space** starts or stops transport. **Escape** closes an open dialog. On the desk, it triggers Panic even when a slider or other input has focus. Other shortcuts ignore inputs and selectors. Held keys do not retrigger controls.

Each sample starts at 100%. Use the horizontal volume slider beneath its pad to adjust that channel, and **MUTE** to silence it. Unmuting preserves a running loop's phase. **LOAD** chooses an optional audio file for that pad while stopped. **Song click** defaults off and controls clicks during the song. The lead-in always clicks.

To load a file instead of capturing a take, stop practice and press **LOAD** on that pad. Loading a file does not change the chart action behind the pad. Supported audio formats depend on the browser.

## Audition an effect

On the EliteDesk, enable audio and leave transport stopped. Select **Audition** on a vocal row, or open a pad’s effects and select **Audition** there. Adjust the dials and listen through the EliteDesk. The desk applies edits as you adjust the selected voice. Select **End audition** to return to the default monitor voice. Starting the song returns control of routing to the chart.

## Record a demo

1. Press **Start**. Microphone access starts immediately. Stereo output recording starts automatically when the song begins, after the lead-in.
2. Perform the chart's capture and playback cues.
3. Press **Stop** to finish the take and release the microphone, then **Download take**. **Finish take** can end the demo recording while practice continues.

The download contains your main live voice, song click, and sample output, starting with the song. The practice lead-in is excluded. The native live-effects stem enters the recording once. Mono microphone input reaches both channels before the stack; sample stereo stays unchanged. Live speaker monitoring is separately gated by explicit physical-device confirmation and does not control the download. After stopping, the browser prepares a stereo 192 kb/s MP3 locally. Wait for **MP3 ready**, then download the `.mp3` file. Conversion runs in a worker without uploading audio. Start reports an error if microphone access or output recording is unavailable. A completed take remains available to download after a song change.

In **Hardware mode**, the EliteDesk records the same song mix as a stereo WAV. It starts at the song boundary and keeps recording if you close the browser. **Stop**, **Finish take**, or the end of the selected range makes the file available. The latest completed WAV remains available after **Terminate audio**. Download it before stopping the web service or finishing another demo. The host caps each take at 192 MiB of audio, about 17 minutes at 48 kHz.

## Download a voice’s captured samples

After **Stop**, use **Voice samples → Download [voice]**. Each voice downloads a ZIP containing a separate stereo float32 WAV for every available committed chart take, plus `samples.json` with capture and selection references. Layered recordings remain separate files. Browser and Hardware modes use the same C++ capture data.

These are the latest retained processed samples, before playback gain and sequencing. They are not full-length channel stems, uncaptured live vocals, every earlier recapture, or the mixed demo MP3. Download them before terminating audio, reloading Browser mode, or changing songs. A changed practice session aborts the download; stop and retry. One voice archive is limited to 128 MiB.

## Choose a song and range

Choose **Song script** to load another song. Switching stops and disposes the previous audio session, then loads the new chart, tempo, and control rows.

| Song | Tempo | Default range |
| --- | --- | --- |
| Dance Yrself Clean | 98 BPM | Bars 1 through 76 |
| Drunk Girls | 144 BPM | Bars 1 through 16 |
| I Can Change | 117 BPM | Bars 1 through 16 |

Song scripts and chart snapshots live in the top-level [songs directory](../../songs/README.md). Drunk Girls and I Can Change currently have no filled pad-action rows. Their empty cells do not create playback actions or preload samples.

Set **Tempo**, **Count-in**, **Start at**, and **End at bar** while stopped. Playback stops at the end of the range by default. Turn on **Loop range** to repeat it. Physical controls are selected by default. Choose **Keyboard shortcuts** in Settings to enable them for this tab. Every Start begins a fresh count-in. A range loop wraps without another count-in. The final partial Dance Yrself Clean bar, 218, is excluded from playback.

## Open or follow the chart

With the [local Chrome helper](../../scripts/open-chart.md) running, localhost practice follows the lead-in and current bar automatically in Sheets. Changed columns are verified against the visible song sheet and Name box. Updates keep Chrome in the background and do not participate in audio timing. Run the [Sheets command](../../scripts/open-chart.md) on the Mac to follow Hardware mode through the EliteDesk event stream without opening the desk page.

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

Build this checkout with `npm run build` and serve its `dist/` directory on localhost or HTTPS. Use the existing Performance Desk. Sheets, a relay, and the CDP helper are not required for audio. Choose the actual microphone/output setup in your browser or operating system before testing.

1. While stopped, open a voice’s **FX** footer. Adjust its ordered stages, then use **Save voice**. Applied values come from native readback. New settings do not change a previously captured take’s effects. Initial Slapback values are delay 100 ms, feedback 0, and wet amount 0.25.
2. Choose the practice range and count-in, then press **Start**. Grant microphone access. Wait for the native-confirmed live voice status and applied revision.
3. Live monitoring starts closed. After Start, open **Audio & Sheets** and use **Live monitoring** to confirm the actual physical relationship of your input/output devices. Different physical devices or the same USB audio interface permit monitoring. Same non-USB hardware or an unconfirmed setup leaves it off. Do not claim a different-device or USB setup unless you know it is true.
4. Speak or clap. On an eligible output, expect centered live voice and one repeat about 100 ms later. The song click stays separate from the effect. Changing effect values during a run is unavailable in this capability.
5. Press **Stop** or Escape. Live audio and delay history stop immediately, and microphone access releases. Wait for MP3 export, then use **Download take**. The download includes processed live voice even if monitoring stayed off. The mandatory lead-in stays outside the demo download.
6. To test a second setting, change values while stopped, Start again, and confirm the physical setup again after microphone acquisition. A replaced/lost microphone invalidates prior monitoring confirmation.

Compiled song pads support processed capture with Slapback enabled. Legacy songs
and generic sampler/sequence recording still reject effect-enabled raw capture.
Each voice has its own prepared graph and revision. Main vocals use Slapback;
Backup Vocals uses Slapback followed by Chorus. During a marked `d` span,
meaningful jiggle starts backup processing. A full quarter-count of inactivity,
or an earlier written span end, stops new source and leaves natural tails.
Native travel/reversal thresholds ignore isolated tiny twitches. The deadline
follows musical time across tempo changes; no browser timer schedules it.
The [I-PAC bridge](../../lib/peripherals/README.md#persistent-mac-device-host)
supplies the laptop interface's raw signed Y reports and unified button edges.

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

## Shake the iPhone to audition Tambourine

Open the HTTPS desk in Safari and select **Tribulations**. In Hardware mode, switch the desk to **Live** and wait for audio to be ready. For phone output, select **Browser** in **Settings** instead.

Tap **Audition Tambourine** and allow motion access. A sharp brake plays a hit. Your speed just before braking selects the soft or hard hit. Acceleration selects the soft or hard shake recording. Audition works at any bar and while stopped. Tap **End Tambourine audition** to finish. Leaving the page, starting or stopping transport, and Panic end the audition. During playback, the audition is part of the output mix, including a demo recording.

Open **Tune motion** below the tambourine controls to adjust the thresholds while auditioning. The same values apply to chart playback from this browser. The phone saves the values locally. Select **Reset motion defaults** to return to the starting calibration.

Tap **Enable shake** during playback to switch back to chart-controlled motion. Tribulations uses the same four recordings for chart shake in bars 137–160.

## Audio modes

Choose Browser mode to run practice audio on this device. Choose Hardware mode when the desk is served by the EliteDesk gateway; the native host owns audio and timing. Hardware mode requires the gateway and its token. Stop browser audio before switching modes. Switching reloads the desk, so download a take first. Leaving Hardware mode detaches this desk without stopping the native instrument. Start remains a separate action after switching.

The Hardware desk stays available with audio off. **Enable audio** opens and prepares the configured native engine without starting practice. Once ready, use **Start** for the count-in and performance. Loading or reloading a page attaches to the current engine and transport; it never restarts them. Enable is disabled while an engine exists, and practice Start is disabled during an existing performance.

**Stop** silences the performance and retains the prepared engine and captured takes. **Terminate audio** releases the sound card and discards the engine's in-memory takes; the web desk stays connected. A native failure leaves the desk available for diagnosis and explicit re-enabling. Connection loss disables controls and warns that audio may still be running. See the [session CLI](../../docs/implementation/session-cli.md) to start or stop the web service from an existing host terminal.

Song imports and downloads use complete canonical MusicXML. Saved effects and character assignments travel with a song download. See the [cutover guide](../../docs/implementation/musicxml-cutover.md) for the profile, CLI and current notation capabilities. JSON worksheet snapshots are explicit import/audit inputs only.
