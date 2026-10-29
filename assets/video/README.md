# Gator and Tapir assets

Figma is the canonical source for promoted artwork and animation. This directory supplies derived runtime assets and identity references. Unpromoted prototypes and raw review records can expire after their useful lessons are extracted and the canonical handoff is verified. See [the project retention policy](../../docs/data-retention.md).

The [editable Figma pose gallery](https://www.figma.com/design/QWreOYAnaje2LlywefJFiK?node-id=2-12) belongs to **Aidan's Starter team**. It contains eight model component sets with three `Pose` variants each. The gallery displays all 24 variants as instances. Each variant contains the registered 640 × 800 PNG artwork with a foot baseline at 776. The components, image fills, and layout are editable. The artwork remains raster images.

[figma.json](figma.json) records the file key, team key, gallery and motion node IDs, and each component, pose, and artwork node ID. Model names and pose paths match [manifest.json](manifest.json).

The [editable Figma motion study](https://www.figma.com/design/QWreOYAnaje2LlywefJFiK?node-id=2-154) has a four-second timeline. `HOLD` opacity keyframes select poses 0, 1, 2, 1, and 0 at 0, 1, 2.5, 3, and 3.5 seconds. Its eight cells have 4:3 stage bounds. The verified MP4 contains 20 frames at 5 FPS and lasts exactly 4.000 seconds. The server export included a duplicate endpoint frame, which was removed for the loop. Generated MP4s are review artifacts and are not committed.

The [browser studio](../../ui/video/README.md) adds restrained upper-body mesh deformation while keeping the feet anchored. Figma shows the held-pose sequence. Neither preview subscribes to live Performance Engine time. The browser adapter can draw an explicitly supplied, validated observation.

The Original treatment is generated cleanup matching the PDF treatment. The operator's original PDFs remain unchanged, and the selected source page renders remain in [references](references/). Original page copies are excluded from Figma. Those optional uploads are blocked by automatic approval review and do not prevent use of the completed pose library or motion study. Source provenance and generation prompts remain in the manifest.

The Figma gallery and motion study were visually inspected on October 27, 2026. Structural checks confirmed eight component sets, 24 image-filled pose variants, 24 gallery instances, and 24 animated study instances. Eight sampled moments from the decoded MP4 showed the expected pose sequence without missing or cropped figures. These checks cover the authored study, not live browser interaction, audio synchronization, or CRT output.
