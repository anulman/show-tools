# Select the current chart column

The practice desk's **Open current bar in Sheets** button sends only a spreadsheet ID, sheet ID, and column range to a loopback helper. The helper opens or reuses that spreadsheet in Chrome, waits for Sheets to load, selects the column, and confirms the Name box before acknowledging.

Practice audio runs independently. The helper is optional and only runs on the desktop computer controlling Sheets.

## Start the helper

Start Chrome with a separate local debugging profile. On this Mac, run this command in one terminal:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --remote-debugging-address=127.0.0.1 --user-data-dir=/tmp/show-tools-sheets-cdp --no-first-run
```

In another terminal at the repository root, run:

```sh
npm run start:sheets
```

Leave both processes running. Press **Open current bar in Sheets** in the practice desk. Chrome selects the requested column and the desk reports the confirmed range.

Practice pages on localhost automatically send changed bar columns while the sequencer counts, including the lead-in column. These updates keep Chrome in the background and retain only the newest pending column if Sheets is slow. Stop, Panic, and song changes stop following. For a hosted practice page, first press **Open current bar in Sheets** to opt into following for that session, and allow its origin as described below. Hosted mobile practice sends no automatic helper requests by default.

The viewport keeps two preceding columns to the left of the active column, with the remaining space showing upcoming bars. The helper remembers column positions as it follows, so two previously visited columns provide exact context even when their widths differ. An initial jump to an unfamiliar part of the chart estimates the preceding space from the active column’s width. The active column remains selected after positioning. At the beginning and end of a sheet, scrolling clamps to the available columns. If three unusually wide columns cannot fit, the active column takes priority. Frozen chart labels remain in place. Selection uses only the requested column through trusted Name box input; a temporary scroll listener preserves the viewport through Sheets’ automatic selection reset, then the helper pans once to the intended position. It never selects neighboring columns to measure them.

The helper uses `127.0.0.1:9223`, with Chrome's debugging connection at `127.0.0.1:9222`. Its default allowed practice origins are `http://127.0.0.1:8082` and `http://localhost:8082`. Add another explicit origin with `npm run start:sheets -- --origin https://your-practice-host.example`.

The temporary profile is separate from your normal Chrome profile. If the spreadsheet requires authentication, sign in within that window. No sign-in was needed for the supplied public chart. The helper changes selection only; it never writes cell values.

Real C:C and D:D selections were verified against the supplied spreadsheet. Tests also cover reusing an existing tab, first-load redirects, trusted Name box input, request validation, and serializing overlapping requests.
