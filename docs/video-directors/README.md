# Direct a song in Figma

Work with the operator to compose your assigned song on its Figma page. Video (Art) supervises the shared design language and creates or delegates new assets. Video (Procedural) owns renderer intake and implementation. The operator authorizes directors to request asset work from Art and its assigned specialists.

Use the [song workspace directory](index.md) to open a page. Read [the registry](registry.json) for your song, page, thread IDs, and confirmed chart source. The full set has twelve songs. Only the first three currently have registered runtime song modules. A set-list entry does not establish a completed chart, casting, arrangement, or engine support.

## Own your song page

The shared Figma Design file is `QWreOYAnaje2LlywefJFiK`. Each director owns one `Song NN` page. Keep song-specific scene frames, storyboards, composition studies, and approved scene revisions there. Reuse existing component instances and tokens. Keep exploratory work clearly identified and remove exact superseded studies after the operator chooses a direction.

Art owns the shared pages: `00 System` (`31:50`), `01 Characters` (`31:51`), `02 Scene Assets` (`31:52`), `03 Frameworks` (`31:53`), and `04 Motion review & studies` (`54:1383`). Request changes to these pages through Art. Keep shared masters intact and ordinary cast instances linked. For an Art-approved blocking puppet, you may create an instance on your assigned page and detach only that new working copy into an editable frame. Do not repaint a shared model, change shared tokens, delete another song's work, or promote a new global component independently.

The existing framework components are NoteHighway (`39:174`), SideScroller (`39:501`), JRPG (`39:704`), and Composer (`39:884`). Inspect current source nodes before reuse. These are starting frameworks, not a limit of four worlds or four screen types. Close-ups, lyric scenes, guest entrances, and other formats can develop with the operator and Art. Figma template availability does not establish renderer support.

Use the Figma skills for every applicable MCP call. A resting screenshot proves composition, not animation. Keep reference assets in Figma; local PNGs and short review movies support authoring and verification. Do not substitute PDFs for sprite work.

When the operator wants to arrange a scene directly, use pixel-storyboard's [manual staging workflow](../../skills/pixel-storyboard/references/manual-staging.md). Deliver separate editable actors, locked scenery, useful pose alternatives, and actual control verification. After delivery, the operator owns that workspace. Read current placements and duplicated endpoints before using them. Produce subsequent animation in a separate frame, and preserve the working stage unless the operator explicitly requests a bounded edit.

## Keep Figma calls sequential

Different song pages isolate composition work, but MCP calls still share one Figma file. This is a cooperative session protocol; MCP does not automatically enforce the lease or page ownership. Serialize file calls with an atomic directory lease at `/private/tmp/show-tools-figma-QWreOYAnaje2LlywefJFiK.lease`.

1. Acquire the lease with `mkdir` on that exact path. Require a completed command result with `exit_code: 0` before recording ownership or making any file call. A busy, failed, missing, or still-running result grants no ownership. Continue independent work and send harness recovery to Chief.
2. Record your thread ID, a fresh unique token, and owned page as JSON in `owner` inside the directory. Retain that complete expected record for the batch. Use the [shared owned-call wrapper](figma-lease.md) to check the exact live record immediately before every file call. Keep calls sequential and restricted to your page.
3. Finish or reconcile a failed call before releasing. Verify the exact owner record again before removing your own `owner` file and the empty lease directory. Never release a foreign lease.

The supervisor's verified page-creation receipt is enough to establish bootstrap ownership. If the file is busy, defer a fresh page read until composition starts instead of blocking readiness on the lease. Inspect the page before its first mutation.

Never hold the lease while waiting for operator input, generating artwork, or polling a render job. Do not remove another session's lease. Art can recover an abandoned lease after checking that the owner has stopped and its pending file call has finished.

## Maintain the shared look

Start from approved mid-res 8-bit pixel art. Preserve character identity, silhouette, proportions, source palette, pivots, integer pixel scale, and intentional held poses. Motion should read as the same model moving. Avoid blur, texture crawl, disconnected joints, stray limb tips, and accidental travel across the stage. Use the `character-dance` skill for new poses and moves.

Concepts may be exploratory. Finished assets require separate identity, pixel-style, temporal, anatomy, and canonical export checks. The style question is: "Is this the work of a mid-res 8-bit pixel artist?" New or corrected art receives new hashes and explicit promotion. A renderer selects and composes frozen artwork; it never silently repaints or invents tween drawings.

Use perspective consistently across performers and crowds. Define the ground plane, character anchors, scale, depth, occupied footprint, and output fit. Preserve pixel clarity when fitting a scene. Do not assume every character uses the same canvas or pivot. Avoid diagnostic tickers, invented scene slogans, and unused HUD decoration in performance output.

Ask Art for the current approved release and scene-fit pins before export. A newer-looking filename is not an approval. The Sardine pose2 correction is a future release; the reviewed Dance Yrself Clean video retains its existing asset pins.

## Compose every scene in both aspect ratios

All twelve directors provide both 16:9 and 4:3 renders for every scene and animatic handoff. Compose each aspect deliberately. Preserve each actor's native pixel grid and integer pixel scale across the pair. Do not stretch sprites or blindly crop a widescreen frame into 4:3.

Keep performers, key props, and any required UI readable within each composition. Record each aspect's frame dimensions, placements, occupied bounds, and fit policy. Use separate fit checks and export receipts for the two outputs. A passing fit check for one aspect does not approve the other.

The working review canvases are 1280 × 720 and 960 × 720. These are provisional authoring defaults, not approved final delivery or CRT resolutions. Confirm delivery requirements before final export. Preserve existing approved releases and pins until replacement outputs pass review.

## Save scene scripts

Use the [shared scene authoring guide](scene-authoring.md) to preserve actual operator words and scene-to-bar interpretations in the operator-selected SQLite store. Unknown ranges, stages and chart revisions remain saveable drafts. Do not turn format examples into scene entries or treat a draft export as runtime admission.

## Compose with confirmed musical facts

Read the canonical `songs/<song-id>.musicxml` when one exists. Saved song effects and character assignments travel in validated MusicXML voice metadata. SQLite/IndexedDB remains the editor's library and backup format. Inspect the document's actual assignments before using a cast. Ask about missing song-specific facts while continuing independent visual exploration. Do not invent voices, character assignments, tempo, sections, cue semantics, or hardware bindings.

Canonical MusicXML and the current Street preparation adapter are merged. The adapter reads MusicXML, using embedded voice assignments when present or an explicitly supplied catalog otherwise. Inspect the intended current document rather than binding historical registry hashes or substituting another checkout. This does not establish arbitrary scene graph support. Read `docs/implementation/musicxml-cutover.md` for source ownership.

Dance Yrself Clean, Drunk Girls and Tribulations have executable canonical charts with performer activity. I Can Change remains a timing and form placeholder. Eight other songs have confirmed set-list entries but no registered canonical chart in this checkout. Inspect each current document for saved voice metadata; keep missing casting and cue bindings explicit.

Record artistic timing in explicit beat units and distinguish proposed scene behavior from implemented behavior. PE owns authoritative musical time and activity. Directors describe visual intent. Procedural Video maps that intent into supported deterministic data and reports unsupported capabilities. No director creates a competing musical clock, browser beat scheduler, or audio behavior.

Dance Yrself Clean's existing policy keeps the singer visible, introduces backup on its first eligible cue through section end, and merges overlapping poofs. Preserve that song's approved behavior unless the operator changes it. Confirm the right policy for another song rather than silently treating this arrangement as universal.

## Request assets from Art

Send requests to Video (Art), thread `01a17a72-c840-7363-837f-a04c3269351b`, or a specialist Art explicitly assigns. Requests are authorized; no extra operator approval is needed for routine exploration within the agreed song direction.

Include your song, owned page and scene node IDs, a short visual purpose, existing reference IDs, required pose or effect, logical size and pivot, occupied footprint, beat timing, and whether you need a concept or finished asset. State which facts remain unknown. Art returns reusable Figma references and reviewed exports, or identifies a concrete dependency. Keep new source artwork on Art's shared asset pages and use instances on your song page.

Send focused review requests to Art at the first composed scene, a new visual direction, and before renderer handoff. Include the actual frame link and the operator's decisions. Art checks consistency across songs and can combine ideas from different explorations.

## Hand a scene to Procedural Video

Send approved scenes to Video (Procedural), thread `01a189eb-3e69-7172-9d51-df02e3c8f9fd`, with Art included. A handoff contains:

- Song ID and confirmed source revision, plus saved casting references or explicit missing bindings.
- Figma file, page, scene and actor node IDs; both 16:9 and 4:3 compositions with their frame sizes and fit policies.
- Separate visual evidence, fit results, and export receipts for each aspect.
- Character and effect release pins, component identities, named layers, pivots, placement, scale and depth.
- Scene changes, presence rules, beat units, cue and source-mode behavior, transition policy and defaults.
- Operator-approved choices, visual evidence, outstanding questions and unsupported capabilities.

This is an intake contract, not a claim that an automatic song-page compiler exists. Ask Procedural Video which exact prepared schema and exporter it currently supports. It owns renderer code and ingestion. Art owns source asset promotion and final style checks. Keep chart-planned offline output, observed live playback, audio synchronization and CRT delivery as distinct claims.

The merged renderer currently supports a fixed background, held character sprites and poof staging. Arbitrary Figma graphs, cameras and animated HUDs need implementation work. A new layout needs its own exact-cast fit profile. The DYC street fit profile is not a universal fit certificate. Current intake references are `lib/video/street-score.ts`, `scripts/normalize-street-assets.ts`, `lib/video/street-fit.ts`, `ui/video/README.md`, and `lib/video/README.md` on merged main. Procedural Video resolves adapter differences with the authoring checkout.

Do not edit renderer, PE, hardware or another song's files from a director session. Request an isolated worktree before any implementation work. Do not start Sheets, CDP, audio or hardware services. Preserve approved videos until a requested replacement is verified.

## Start a director session

Read this guide, your registry entry, `AGENTS.md`, `docs/architecture.md`, and `docs/development.md`. Confirm your owned page and report the available references and missing facts to Art. Begin with read-only setup; leave composition choices to the conversation with the operator. Do not launch an unrequested asset batch, render, Figma mutation or operator questionnaire during bootstrap. Wait for the operator's song-specific direction after reporting readiness. The first three canonical charts support timing investigation; the other directors can discuss and compose visual concepts while chart and casting facts are supplied.

The supervisor maintains the registry and this guide. Each director records its song decisions on its own page and in its conversation. Keep cross-song asset requests and renderer questions addressed to their owning sessions so the supervisor can support all directors after context renewal.
