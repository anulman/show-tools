# Download MusicXML from selected Sheets rows

The experimental bound Apps Script adds **Show Tools → Export selected voices…** to the chart spreadsheet. Select one or more voice/instrument rows, open the dialog, check the voice names and bar count, and click **Download MusicXML**.

This first build supports the configured **01 Dance Yrself Clean** worksheet, gid 101, in its existing spreadsheet. It reads the approved `A1:HL30` chart extent and uses the same mapping and deterministic MusicXML converter as the offline CLI. Copies and other songs need explicit mapping support; their source identities are never silently substituted.

Selection chooses voices, not a bar crop. Selecting any cells in Cowbell and Bing Bong produces those two score parts across all 218 mapped bars. Noncontiguous and overlapping selections work. Header/control rows do not become parts, and a selection with no voice rows fails clearly. Timing, control rows, cell notes and the **complete chart source, including unselected voices**, remain embedded in the file. Selected non-AF parts additionally get separate [musician sheets](musician-sheets.md): printable HTML with five blank staff lines, section/vocal cues, and matching MusicXML.

## Build and install

```sh
node --import tsx scripts/build-sheets-musicxml.ts \
  --out-dir /private/tmp/show-tools-sheets-musicxml-new
```

The destination must not exist. The build produces `Code.gs`, `Export.html`, `appsscript.json`, `INSTALL.md`, and a ZIP of those four files. These generated deployment files stay outside Git. The updated musician-sheet package is available at `output/sheets-musicxml/show-tools-musicxml.zip`.

1. Open the configured spreadsheet and choose **Extensions → Apps Script**.
2. For a new bound project, paste `Code.gs` into the script file. Create an HTML file named **Export** and paste `Export.html` into it.
3. In **Project Settings**, enable the manifest editor. Paste the supplied `appsscript.json` into the manifest and save.
4. Reload Sheets, select the voice rows (DYC rows 8–15, or a subset), and use the new menu.
5. Complete Google's current-spreadsheet authorization when asked. Reopen the export dialog if necessary, check its summary, and download.

If the spreadsheet already has a bound script, preserve it: add the exporter separately, merge its `onOpen` menu registration with the existing handler, and merge manifest settings/scopes. Do not replace another project's files blindly. No web-app deployment is required.

## Ownership and file contents

`scripts/sheets-musicxml/server.ts` is a thin synchronous Apps Script adapter. It validates the active workbook/tab, reads selected row ranges and the configured chart's display values/notes, and returns JSON-safe data. It performs no cell writes, Drive operations or external fetches. Values and notes are separate Google reads; this is not an atomic snapshot against concurrent editors.

`ui/sheets-musicxml/` owns the dialog. The bundled browser code validates the payload and runs the existing compiler and MusicXML exporter, using browser WebCrypto. It creates a Blob URL and a user-clicked download link. The source is returned through `google.script.run`, not embedded in executable HTML. No CDN, local audio process, helper, relay or additional service is required.

`scripts/build-sheets-musicxml.ts` packages both halves and emits top-level Apps Script entry functions. The manifest requests current-spreadsheet and container-UI scopes, with `@OnlyCurrentDoc` on the generated script. It requests no Drive or external-request scope.

MusicXML study profile v2 records the resolved selected label cells alongside the complete source and mapping. Equivalent selections yield identical XML, in worksheet order. It does not erase unselected source rows or renumber source coordinates. The [MusicXML study guide](musicxml-study.md) explains the rhythm-guide convention and application metadata.

## Verification and remaining live check

```sh
node --import tsx --test scripts/tests/sheets-musicxml.test.ts \
  lib/performance/tests/sheet-musicxml.test.ts
npm run typecheck
```

Tests run the actual generated server code against a narrow Spreadsheet service fixture and feed its output through the real converter. They cover selected/all/control-only ranges, duplicates, stale source rejection, full metadata retention, script-like source text, unsupported worksheet identity, minimal scopes, and byte-identical repeated package builds. The fixture supplies no write, Drive or network APIs. The combined exporter, source and compiler checks passed 46 tests; TypeScript also passed.

A local Safari fixture ran the actual dialog bundle with a frozen-source Google callback adapter, showed **Cowbell, Bing Bong · 218 bars**, and produced a Blob download link. Clicking it reached Safari's native download-permission prompt; that optional prompt was canceled without changing permissions. This verifies local conversion and link presentation, not a completed downloaded file or the actual Google iframe.

The exporter is **not installed in the operator's spreadsheet**. Google authorization, menu execution and download within the real Sheets dialog remain unverified. No live chart or browser library was changed.

Google documents [custom dialogs](https://developers.google.com/apps-script/guides/dialogs), [asynchronous server calls](https://developers.google.com/apps-script/guides/html/reference/run), [iframe downloads](https://developers.google.com/apps-script/guides/html/restrictions), and [current-document authorization](https://developers.google.com/apps-script/guides/services/authorization).
