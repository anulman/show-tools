# Approved poof entrance and exit effects

The operator approved all three effects for interchangeable use: Soft smoke, Pixel pop, and Star dust. Their original previews use Tapir, Gator and Maestro respectively; the effects are not assigned exclusively to those characters. Figma remains canonical. The [catalog](catalog.json) records the exact effect component sets, eighteen drawing exports, character source references, approval and three animated preview IDs. The existing DYC character releases remain unchanged.

Each effect uses a transparent 128×128 native canvas with foot anchor `(64,106)`. Six held drawings play over 1.5 quarter-note beats. The character switches visibility at beat 0.5, underneath the fully opaque third drawing. The same effect sequence supports entrances and exits; only the character's initial and resulting visibility differ. Character artwork remains separate and unchanged.

The comparison fixture runs at 120 BPM and 8 fps. It enters at 0.5 seconds, dances, and exits at 3.5 seconds. Figma's inclusive terminal yields 41 decoded frames for five authored seconds. The three source previews are 640×480 at native 3× scale. Their headers remain outside the exported movie.

Source sets live under `Asset/Effects/Poof/` on `02 Scene Assets`; animated previews live under `Poof preview/` on `04 Motion review & studies`. Preserve all three approved effect IDs and source pixels while tuning their composition. Runtime variant selection must be deterministic for replay and direct seeking.

Artwork and Figma authoring were supplied by the Video owner in commits `ae4f4ca` (art), `08a2082` (operator approval), and `7965119` (release reader). This integration imports the approved catalog, eighteen native PNGs and standalone reader/tests. Authoring helpers remain with that owner. Applying an effect to differently sized bodies requires checking occupied coverage at the configured scale and anchor.

Native style and temporal reviews are separate from canonical export and movie checks. Current Figma exports match all 294,912 native RGBA pixels, including transparent margins. Actual source IDs, transforms and HOLD visibility were checked at all 123 preview ticks. Operator promotion changed descriptions and approval metadata only; every canonical effect PNG remained byte-identical. The original individual and comparison movies passed all 246 candidate-frame checks. These checks approve the effect artwork and examples; activity-driven integration requires its own movie and transition review.

The requested scene policy is to poof characters in while their parts are playing and out when they are inactive. Procedural video owns the activity-to-presence policy and native sampling integration. Authoring time remains in beats; the renderer composes these frozen effect drawings with frozen character poses. Check the actual body and effect footprint before and after each visibility switch. The shared opaque model envelope is not a guarantee for every padded special/ultra drawing or wide flourish.

Build a separate immutable effect package without changing the character release:

```sh
node --import tsx scripts/video-expansion/poof-release.mts "$PWD" /private/tmp/new-poof-release
```

The output contains the exact approved catalog and its eighteen PNGs. `readPoofRelease({ releaseRoot, catalogSha256 })` validates a pinned offline package, approval, source hashes, native RGBA, timing and peak coverage. Missing approval, modified pixels, unsafe paths and existing output destinations fail closed. Raw capture and movie-review folders are not runtime dependencies. Integration must additionally verify the actual transition poses against the chosen overlay scale, placement and scene bounds.
