# Add a song script

Each song is a loadable TypeScript module beside its chart snapshot. The registry in [index.ts](index.ts) loads modules on demand.

The snapshot's `rowNotes` object preserves the control-row cell notes from Sheets. `parseChart` uses each control's note as its displayed name or purpose. For example, Dance Yrself Clean's `R2` note is `Cowbell`. A chart without a note shows `R2`, never another song's name. Refresh these notes alongside the chart values when updating a snapshot.

To add another song from the set list:

1. Save its chart snapshot as `<song-id>.chart.json` in this directory.
2. Copy a nearby song module into `<song-id>.ts`.
3. Set its ID, parsed chart, compiled control rows, default range, and description.
4. Add a lazy import entry to `SONGS` in `index.ts`.
5. Run `npm run build` and choose the song in **Song script**.

A module exports a value that satisfies `SongScript` from `lib/performance/model.ts`.

```ts
import source from './my-song.chart.json';
import { parseChart } from '../lib/performance/chart.js';
import { compileChartControls } from '../lib/performance/chart-controls.js';
import type { SongScript } from '../lib/performance/model.js';

const chart = parseChart(source);

export default {
	id: 'my-song',
	chart,
	program: {
		lengthBeats: 4,
		events: [],
		controls: compileChartControls(chart),
	},
	practice: { startBar: 1, endBar: 16 },
	description: 'Chart-driven capture and playback.',
} satisfies SongScript;
```

`compileChartControls` preserves the lead-in and numbered-bar columns. It compiles each L1, R1, L2, and R2 cell into an action that runs when that pad is pressed while the column is active.

The action letters are `r` for arm, `c` for commit, `cr` for commit-and-arm, `x` for stop, and `p` for play. A `b` suffix applies the action at the next bar. Commit starts the captured take looping. Commit-and-arm records a replacement while the committed take plays. A blank cell is no action, never an implicit exit.

Notation without an action letter defaults to a manual tap cue. Beats are numbered 1 through 4. `e`, `&`, and `a` divide a beat into sixteenths. A closing square bracket marks the phrase end, so `&a]` means the last bar's 4& and 4a. A script can replace those manual cues with full-bar playback using `program.barPlayback`.

All current scripts have empty scheduled-event lists and preload no samples. Captures and explicit file loads supply each channel's audio. The shared engine also defaults to an empty program. Song-specific action assignments belong here, rather than in UI handlers.

For sparse sounds, pass capture hints when compiling the chart. Each assignment identifies the channel and active bar of an arm or commit-and-arm cue. Beat positions are zero-based, so `3.5` is 4& and `3.75` is 4a.

```ts
controls: compileChartControls(chart, [
	{ id: 'R2', bar: 2, capture: { kind: 'sparse', beats: [3.5, 3.75], radiusBeats: 0.2 } },
	{ id: 'R2', bar: 3, capture: { kind: 'sparse', beats: [3.5], radiusBeats: 0.2 } },
]),
```

Use one position for a single hit. Sparse capture detects attacks near those positions, trims quiet tails, and plays only the extracted clips. Normal loops place their onsets on the expected beat grid. Later manual taps play the clips in order, restarting that order each bar. A missing hit stays silent in the loop and reports an error if tapped. Continuous captures without hints retain the complete recording.

Detection uses amplitude attacks, not source separation. Competing loud sounds inside a search window can be selected. Sparse capture remains optional.

Dance Yrself Clean bypasses extraction for cowbell. Its recording cues use `{ kind: 'bar', variantKey: 'cowbell-double' }` and `{ kind: 'bar', variantKey: 'cowbell-single' }`, retaining all PCM and silence from bars 3 and 4. Its `barPlayback` entries select the full double take in bars 8 and 10 and the single take in normal bars, based on the chart's cowbell row. Playback changes only an already-running loop. It does not restart a stopped channel or invent a missing recording. These assignments live entirely in the song script.

The bundled charts are Dance Yrself Clean at 98 BPM, Drunk Girls at 144 BPM, and I Can Change at 117 BPM. Only the first chart has filled pad-action rows. The other two retain their chart timing and sections but create no actions from blank cells.
