# Follow the current chart in Sheets

Start the combined browser and Sheets helper from the repository root:

```sh
./show-tools sheets 1
```

The command reuses Chromium at the configured CDP port, or launches a dedicated browser if none is listening. It starts the local helper and opens the selected song's lead-in column. Leave the command running while you practice. The practice desk sends changed bar columns as the sequencer counts.

Use a song slug or a 1-indexed set-list number:

```sh
./show-tools songs
./show-tools sheets dance-yrself-clean
./show-tools sheets 2
./show-tools sheets
./show-tools sheets 1 --no-cdp --skip-open
```

Without a song, the command finds and activates a tab for `SHOW_TOOLS_SET_LIST_URL`, or opens that spreadsheet if absent. If that URL includes a `gid`, it selects the specified sheet. Otherwise an existing tab keeps its current sheet. `--no-cdp` requires an existing working CDP browser and never launches one. `--skip-open` suppresses initial song-chart or set-list opening; later practice events still open and select their requested chart. These flags can appear before or after the song.

An explicit startup song selects its chart only. Choose the matching song separately in the practice UI. Later practice events identify their own song chart, so the helper follows UI song changes.

The CLI starts no audio or practice web server. Microphone capture still starts through **Start practice** in the page. Startup chart opening activates the chart tab once. Automatic bar following stays in the background and does not move keyboard focus away from the practice controls.

Press **Ctrl+C** to stop the helper and any browser this invocation launched. A reused browser stays running. The startup output reports whether it launched or reused Chromium. An occupied helper port or incompatible CDP service produces an error without stopping another process. Browser profiles and recordings are never deleted.

## Use the command outside the checkout

Register the executable with your current Node installation:

```sh
npm link --offline --ignore-scripts
show-tools sheets 1
```

The executable resolves its checkout even when invoked through the npm symlink or from another working directory. Direnv loads `.envrc` only when your shell enters its allowed directory; run from the checkout if you want those local overrides. `./show-tools` and `npm run start:sheets -- 1` work without global registration.

If you use nodenv and the linked command is not found, run `nodenv rehash`.

## Configure Chromium

Bash supplies missing defaults and discovers Chrome or Chromium under `/Applications` or `~/Applications`, then checks executable names on `PATH`. You can run without a `.envrc`.

To override settings with direnv, copy [.envrc.example](../.envrc.example) to `.envrc`, edit it, and allow it:

```sh
cp .envrc.example .envrc
# Edit and uncomment the overrides you need.
direnv allow
```

`.envrc` is ignored by Git. Run `direnv allow` again after editing it. Loading it starts no processes. If your shell does not load direnv automatically, use `direnv exec . ./show-tools sheets 1`.

Quote browser paths containing spaces without adding backslashes inside the quotes:

```sh
export SHOW_TOOLS_CHROMIUM_APP="/Applications/Google Chrome.app"
```

`"/Applications/Google\ Chrome.app"` retains a literal backslash and causes an `ENOENT` launch error. The launcher passes the configured path directly to the operating system without shell evaluation.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SHOW_TOOLS_CHROMIUM_APP` | Discovered browser | Chromium-compatible macOS app bundle or executable path. |
| `SHOW_TOOLS_CDP_PORT` | `9222` | Debugging port shared by the launcher and helper. |
| `SHOW_TOOLS_CDP_PROFILE` | `show-tools-sheets-cdp` under `${TMPDIR:-/tmp}` | Dedicated browser profile directory. |
| `SHOW_TOOLS_PRACTICE_ORIGIN` | `http://127.0.0.1:8082` | Additional practice origin allowed by the helper. |
| `SHOW_TOOLS_SET_LIST_URL` | The bundled set-list spreadsheet URL | Spreadsheet opened when no song is supplied. Include `#gid=...` to select a specific sheet. |

A reused browser needs no configured executable. Its CDP connection is checked through HTTP, a WebSocket connection, browser identity, and target enumeration. A missing listener permits launching unless `--no-cdp` was supplied. Other connection failures report a conflict. Browser startup has a 15-second readiness deadline.

The helper listens only on `127.0.0.1:9223`. Its default allowed origins include both `127.0.0.1` and `localhost` on ports 8082 and 8084, plus `SHOW_TOOLS_PRACTICE_ORIGIN`. Port 8084 matches the development guide. Keep that environment override to an HTTP or HTTPS origin without a path.

The dedicated profile is separate from your normal browser profile. If Sheets requires authentication, sign in there first. A failed initial chart selection stops the command's owned resources and reports an error. Use `--skip-open` to start without waiting for an initial chart selection. The helper changes selection only; it never writes cell values.

## Follow during practice

The practice desk's **Open current bar in Sheets** button sends a spreadsheet ID, sheet ID, and column range to the loopback helper. The helper opens or reuses that spreadsheet, switches to the correct sheet, selects the column, and confirms the Name box before acknowledging.

Practice audio runs independently. The helper is optional and runs on the desktop controlling Sheets. It is unnecessary for mobile audio practice.

Practice pages on localhost automatically send changed bar columns while the sequencer counts, including the lead-in column. Updates remain in the background and retain only the newest pending column if Sheets is slow. Stop, Panic, and song changes stop the current following session. For a hosted practice page, press **Open current bar in Sheets** to opt into following for that session and configure its allowed origin. Hosted mobile practice sends no automatic helper requests by default.

The viewport keeps two preceding columns to the left of the active column, with the remaining space showing upcoming bars. The helper remembers column positions, so two previously visited columns provide exact context even when widths differ. An initial jump estimates preceding space from the active column's width. Scrolling clamps to available columns. If three unusually wide columns cannot fit, the active column takes priority. Frozen chart labels remain in place.

Selection uses the requested column through trusted Name box input. A temporary scroll listener preserves the viewport through Sheets' automatic selection reset, then the helper pans once to the intended position. It never selects neighboring columns to measure them.

## Run the individual tools

For manual browser management:

```sh
npm run start:cdp
./show-tools sheets --no-cdp
```

The standalone browser launcher stays in the foreground until that browser exits. Ctrl+C forwards the interrupt to its child. The lower-level helper also remains available for custom CDP addresses or additional allowed origins:

```sh
node --import tsx scripts/open-chart.ts --cdp http://127.0.0.1:9333 --origin https://practice.example
```

`./show-tools --help` describes the supported combined interface. Invalid arguments exit with code 2, startup or runtime failures exit with code 1, and graceful Ctrl+C exits with code 0. The [original CLI proposal](../docs/proposals/cli.md) records the alternatives considered.
