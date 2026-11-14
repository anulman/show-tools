# Add a canonical song

Each song has a canonical `<song-id>.musicxml` document and a small TypeScript loading module. The registry in `index.ts` loads modules on demand. `readBundledMusicXml` reads the same file in Node or from the practice build's offline assets.

Sheets values and mapping JSON remain import inputs. They are not runtime song sources. The [MusicXML guide](../docs/implementation/musicxml-cutover.md) describes the supported profile and extensions. Existing JSON snapshots are retained for lossless migration and import-boundary tests.

To add a song, import it into a complete canonical MusicXML document, copy a neighboring loading module, and register the module in `SONGS`. Use `readMusicXmlSong` for its chart and compiled instructions. Use `musicXmlSourceView` for sheet-facing inspection and catalog discovery. Do not rebuild instructions from the optional audit archive.

Tribulations is executable with nine immutable captures, independent source profiles, named grouped actions, finite lead clips and its replaceable CC0 tambourine asset. Phone motion is explicitly enabled in the practice desk and sends manual input to native eligibility windows. Physical phone sensing and sample suitability still need operator audition.

DYC is executable with its 218-bar arrangement, five capture parents, reusable Cowbell bar views, prefix selections and rotation windows. Drunk Girls is executable with nine full pickup measures, numbered bars 1–128 and seven captures. Run `node --import tsx scripts/prepare-drunk-girls.ts SOURCE.json NEW.musicxml` to reproduce its canonical import from the confirmed mapping. The command refuses existing outputs and does not publish a blocked chart. I Can Change remains a timing-only placeholder and is marked not ready. Any authored performance instructions must validate before loading audio.

Compiled JSON and native `.pfp` tables are derived artifacts. Audio recordings start empty. C++ owns timing, capture, playback, cue execution and mixing.
