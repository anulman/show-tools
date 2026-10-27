# Practice with the desk

From the repository root, build the manual clock and browser files.

```sh
npm install
npm run build
npm start
```

Open <http://127.0.0.1:8082/ui/practice/>. The page runs audio locally through its WASM/worklet bridge. The development server serves static files only.

## Capture the opening loop

Sample slots start empty. For this current capture path, bypass **Slapback** before Start. Effect-enabled sample capture is not available yet. The steps and notation below describe the checked-in DYC snapshot, not the pending chart grammar update.

1. Select **Dance Yrself Clean**.
2. Press **Start practice** and allow microphone access when prompted.
3. The demo recorder waits through the lead-in, then starts automatically with the song.
4. During the count-in, press **R1** or **W** while its cue is `rb`.
5. Perform the drums and clap phrase from bar 1.
6. During bar 2, press **R1** or **W** while its cue is `cb`.

Capture starts at bar 1 and commits at bar 3. The committed take starts looping at that crossing without another play tap.

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

For example, `rb`, `cb`, `crb`, and `xb` queue their actions for the next bar. In R2, bar 2's `rb` starts capture at bar 3. Bar 3's `crb` commits that take at bar 4 and starts another capture while the first take plays. Bar 4's `cb` commits the replacement at bar 5.

Numbers indicate beats. `e`, `&`, and `a` divide a beat into sixteenths, and a closing square bracket marks the phrase end. Generic tap cues play one hit per press. A song script can instead replay a recorded bar automatically; the pad then shows **Auto · recorded bar**.

Dance Yrself Clean's cowbell uses full-bar recordings without extraction. During bar 2, press **R2** or **S** to arm bar 3 and perform the double sound. During bar 3, press again to commit it and arm bar 4 for the single sound. During bar 4, press again to commit. The single take plays on normal bars. Bars 8 and 10 automatically use the recorded double take where `&a` is marked, then return to the single take. No double tapping is needed. The explicit stop cue still stops the cowbell.

Captures are limited to 30 seconds. Reaching the limit commits and loops the take. **Stop** and the mushroom commit active captures while silencing playback and canceling pending actions. Processed live monitoring is available only after explicit physical-device confirmation; see the live-effects steps below. Captured takes stay in memory and disappear when you leave or reload the page.

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

1. While stopped, enable **Slapback** under **Live voice effects**. Start with delay 100 ms, feedback 0, and wet amount 0.25. Change these venue values in the web UI before a run.
2. Choose the practice range and count-in, then press **Start practice**. Grant microphone access. Wait for the native-confirmed live voice status and applied revision.
3. Live monitoring starts closed. After Start, use **Live monitoring** to confirm the actual physical relationship of your input/output devices. Different physical devices or the same USB audio interface permit monitoring. Same non-USB hardware or an unconfirmed setup leaves it off. Do not claim a different-device or USB setup unless you know it is true.
4. Speak or clap. On an eligible output, expect centered live voice and one repeat about 100 ms later. The song click stays separate from the effect. Changing effect values during a run is unavailable in this capability.
5. Press **Stop** or Escape. Live audio and delay history stop immediately, and microphone access releases. Wait for MP3 export, then use **Download take**. The download includes processed live voice even if monitoring stayed off. The mandatory lead-in stays outside the demo download.
6. To test a second setting, change values while stopped, Start again, and confirm the physical setup again after microphone acquisition. A replaced/lost microphone invalidates prior monitoring confirmation.

Sample capture with a nonempty effects stack is unavailable until capture routing and cached-loop behavior are defined. Capture commands reject explicitly; they do not record a dry fallback. Existing sample playback and click remain available. Bypass Slapback to use the current identity-capture route. The standalone processed-cache fixtures do not establish effect-enabled practice sampling.

Automated browser checks use synthetic microphone input. An operator microphone/room test must record the actual input/output facts and be reported separately. No fixture audition is a physical monitoring test.
