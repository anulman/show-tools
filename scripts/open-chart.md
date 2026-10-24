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

The helper uses `127.0.0.1:9223`, with Chrome's debugging connection at `127.0.0.1:9222`. Its default allowed practice origins are `http://127.0.0.1:8082` and `http://localhost:8082`. Add another explicit origin with `npm run start:sheets -- --origin https://your-practice-host.example`.

The temporary profile is separate from your normal Chrome profile. If the spreadsheet requires authentication, sign in within that window. No sign-in was needed for the supplied public chart. The helper changes selection only; it never writes cell values.

Real C:C and D:D selections were verified against the supplied spreadsheet. Tests also cover reusing an existing tab, first-load redirects, trusted Name box input, request validation, and serializing overlapping requests.
