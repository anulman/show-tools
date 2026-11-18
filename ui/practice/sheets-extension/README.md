# Follow a song chart in Sheets

This Chrome extension selects each bar's column in an already-open Google Sheet. It receives local events directly from the practice tab through an extension port. Its runtime uses programmed range links and checks the visible sheet grid and Name box. It uses no LLM, Computer Use, token, or relay server.

## Install the local extension

Run `npm run build` from the repository root first.

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Press **Load unpacked**.
4. Select this repository's `dist/ui/practice/sheets-extension` directory.
5. Pin **Show tools · chart follow** if you want it on the toolbar.

The TypeScript source lives in `ui/practice/sheets-extension`. Rebuild and reload the extension after source changes.

The extension has not been installed automatically. It requests active-tab scripting access for the chart and host access for the practice page. A different static host prompts for that host's permission.

## Start following

1. Open the Performance Desk in Chrome.
2. Open the song's Google Sheets tab and select its song sheet.
3. Click the extension toolbar button while viewing that chart tab.
4. Enter the practice page's exact URL in the follower page.
5. Press **Start following** and leave the follower page open.
6. Start practice in the desk.

For the local development page, use `http://127.0.0.1:8082/ui/practice/`. The practice and chart tabs must be in the same browser. The extension uses a direct tab port, so a practice page on another device is not a source for this version.

The follower uses the event's spreadsheet ID, sheet ID, and explicit bar-column map. For Dance Yrself Clean, count-in selects B:B, bar 1 selects C:C, and bar 2 selects D:D. Same-song bar changes update the range fragment. Song changes navigate to the requested sheet, then wait for its visible grid and range to match. It does not edit cell values.

Press **Stop following** before editing the chart. Stop cancels pending selection work. If the chart tab closes, reopen the follower from the toolbar on the intended chart tab. If the practice tab reloads, start following again.

## Verification status

Real Sheets navigation from C:C to D:D was verified through same-document range links. Tests cover column mapping, URL validation, and rejecting a matching range on the wrong visible song sheet. The installed extension's complete live tab-port path has not been verified yet.

The extension is a visual follower. Browser scheduling can delay a column selection. Audio timing stays in the practice worklet.
