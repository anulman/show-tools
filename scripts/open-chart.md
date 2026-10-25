# Select the current chart column

The practice desk's **Open current bar in Sheets** button sends only a spreadsheet ID, sheet ID, and column range to a loopback helper. The helper opens or reuses that spreadsheet in Chrome, waits for Sheets to load, selects the column, and confirms the Name box before acknowledging.

Practice audio runs independently. The helper is optional and only runs on the desktop computer controlling Sheets. Start it manually when you want chart following. Press **Ctrl+C** in its terminal to stop it. The operator manages the helper and Chrome CDP lifecycle.

## Start the helper

The Bash launcher supplies defaults when environment variables are missing. It discovers Chrome or Chromium under `/Applications` or `~/Applications`, then checks executable names on `PATH`. You can run it without a `.envrc`.

To override settings with direnv, copy [.envrc.example](../.envrc.example) to `.envrc`, edit it, and allow it from the repository root:

```sh
cp .envrc.example .envrc
# Edit .envrc before allowing it.
direnv allow
```

`.envrc` is ignored by Git. Run `direnv allow` again after editing it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SHOW_TOOLS_CHROMIUM_APP` | Discovered browser | A Chromium-compatible macOS app bundle or executable path. For example, `/Applications/Chromium.app` or `/usr/bin/chromium`. |
| `SHOW_TOOLS_CDP_PORT` | `9222` | Debugging port shared by the launcher and Sheets helper. |
| `SHOW_TOOLS_CDP_PROFILE` | `show-tools-sheets-cdp` under `${TMPDIR:-/tmp}` | Dedicated browser profile directory. |
| `SHOW_TOOLS_PRACTICE_ORIGIN` | `http://127.0.0.1:8082` | Additional practice origin allowed by the helper. |

Start the dedicated browser in one terminal:

```sh
npm run start:cdp
```

In another terminal at the repository root, run:

```sh
npm run start:sheets
```

If your shell does not load direnv automatically, use `direnv exec . npm run start:cdp` and `direnv exec . npm run start:sheets` instead.

Loading `.envrc` starts no processes. The launcher runs only when invoked. It resolves macOS app bundles to their executable and passes arguments directly without a shell. **Ctrl+C** in the launcher terminal forwards the interrupt to its browser child. **Ctrl+C** in the helper terminal stops chart following. Stop and restart manually after changing settings.

Leave both processes running while following. Press **Open current bar in Sheets** in the practice desk. The browser selects the requested column and the desk reports the confirmed range.

Practice pages on localhost automatically send changed bar columns while the sequencer counts, including the lead-in column. These updates keep Chrome in the background and retain only the newest pending column if Sheets is slow. Stop, Panic, and song changes stop following. For a hosted practice page, first press **Open current bar in Sheets** to opt into following for that session, and allow its origin as described below. Hosted mobile practice sends no automatic helper requests by default.

The viewport keeps two preceding columns to the left of the active column, with the remaining space showing upcoming bars. The helper remembers column positions as it follows, so two previously visited columns provide exact context even when their widths differ. An initial jump to an unfamiliar part of the chart estimates the preceding space from the active column’s width. The active column remains selected after positioning. At the beginning and end of a sheet, scrolling clamps to the available columns. If three unusually wide columns cannot fit, the active column takes priority. Frozen chart labels remain in place. Selection uses only the requested column through trusted Name box input; a temporary scroll listener preserves the viewport through Sheets’ automatic selection reset, then the helper pans once to the intended position. It never selects neighboring columns to measure them.

The helper uses `127.0.0.1:9223`. Its CDP URL uses `SHOW_TOOLS_CDP_PORT` on loopback. The `--cdp` argument can override that URL for the helper. Its default allowed practice origins are `http://127.0.0.1:8082` and `http://localhost:8082`. The configured `SHOW_TOOLS_PRACTICE_ORIGIN` is also allowed. Add further origins with `npm run start:sheets -- --origin https://your-practice-host.example`.

The temporary profile is separate from your normal Chrome profile. If the spreadsheet requires authentication, sign in within that window. No sign-in was needed for the supplied public chart. The helper changes selection only; it never writes cell values.

Real C:C and D:D selections were verified against the supplied spreadsheet. Tests also cover reusing an existing tab, first-load redirects, trusted Name box input, request validation, and serializing overlapping requests.
