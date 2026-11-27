# Add a canonical song

Each song has a canonical `<song-id>.musicxml` document and a small TypeScript loading module. The registry in `index.ts` loads modules on demand. `readBundledMusicXml` reads the same file in Node or from the practice build's offline assets.

Sheets values and mapping JSON remain import inputs. They are not runtime song sources. The [MusicXML guide](../docs/implementation/musicxml-cutover.md) describes the supported profile and extensions. Existing JSON snapshots are retained for lossless migration and import-boundary tests.

To add a song, import it into a complete canonical MusicXML document, copy a neighboring loading module, and register the module in `SONGS`. Use `readMusicXmlSong` for its chart and compiled instructions. Use `musicXmlSourceView` for sheet-facing inspection and catalog discovery. Do not rebuild instructions from the optional audit archive.

Tribulations is executable with seven immutable captures, independent source profiles, named grouped actions and four CC0 Versilian tambourine recordings with source hashes in the MusicXML. Phone motion is explicitly enabled in the Performance Desk and sends manual input to native eligibility windows. Physical phone sensing and sample suitability still need operator audition.

DYC is executable with its 218-bar arrangement, five capture parents, reusable Cowbell bar views, prefix selections and rotation windows. Drunk Girls is executable with nine full pickup measures, numbered bars 1–128 and seven captures. Run `node --import tsx scripts/prepare-drunk-girls.ts SOURCE.json NEW.musicxml` to reproduce its canonical import from the confirmed mapping. The command refuses existing outputs and does not publish a blocked chart. I Can Change requires an E-major tuning bank before Start and includes timed knob cues and the final Tail accent. Daft Punk Is Playing at My House uses L1 for the two guitar takes and L2 for clap phrase selections. All I Want follows the written arrangement. You Wanted a Hit uses a cue-free rehearsal program with draft cues retained in the archived arrangement. To add their rehearsal programs to an existing release catalog, run `node --import tsx scripts/build-rehearsal-catalog.ts --base EXISTING_CATALOG --out NEW_CATALOG`. Publishing authored performance instructions still requires full cue validation.

Compiled JSON and native `.pfp` tables are derived artifacts. Audio recordings start empty. C++ owns timing, capture, playback, cue execution and mixing.
