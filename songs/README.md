# Add a canonical song

Each song has a canonical `<song-id>.musicxml` document and a small TypeScript loading module. The registry in `index.ts` loads modules on demand. `readBundledMusicXml` reads the same file in Node or from the practice build's offline assets.

Sheets values and mapping JSON remain import inputs. They are not runtime song sources. The [MusicXML guide](../docs/implementation/musicxml-cutover.md) describes the supported profile and extensions. Existing JSON snapshots are retained for lossless migration and import-boundary tests.

To add a song, import it into a complete canonical MusicXML document, copy a neighboring loading module, and register the module in `SONGS`. Use `readMusicXmlSong` for its chart and compiled instructions. Use `musicXmlSourceView` for sheet-facing inspection and catalog discovery. Do not rebuild instructions from the optional audit archive.

DYC is executable and retains its 218-bar arrangement, doubled recordings, variants, prefix selections and rotation windows. Drunk Girls and I Can Change are timing-only documents with no filled performance instructions. Their modules expose the existing blank-control practice behavior without claiming executable authored arrangements.

Compiled JSON and native `.pfp` tables are derived artifacts. Audio recordings start empty. C++ owns timing, capture, playback, cue execution and mixing.
