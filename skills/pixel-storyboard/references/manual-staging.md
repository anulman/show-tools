# Build an operator-editable stage

Give the operator a Figma scene they can rearrange directly. Use this workflow for actor placement, endpoint comparisons, and rough body-part posing.

## Hand over the workspace

Art owns shared source artwork and reusable rigs. A Director builds the initial composition on the assigned page. The operator owns the delivered working stage.

Read the current Figma state before using an existing stage. The operator may have moved actors, selected poses, changed visibility, or duplicated endpoints. Do not restore their workspace from a builder or cached export. An explicit request can authorize a bounded edit. Preserve their other changes.

Create subsequent animation and finishing work in a separate production or review frame. Keep the operator's layout as its placement reference. A request to use the layout does not authorize resetting it.

## Keep the scene editable

Use approved component sources. Record each source's canvas, native grid, registration, pivot, and permitted scale. Gallery previews can have different offsets from native sprites. Ask Art for a registered wrapper when needed. Do not fit every character independently by eye.

Keep scene actors free of auto-layout constraints that would rearrange them. Use auto-layout for surrounding labels and shelf cards. Lock scenery against accidental dragging. Leave performers unlocked and individually named. Keep props, foreground, and effects separate from the cast. A registered raster sprite can remain inside an editable scene.

Order layers by the intended overlap. For example, a bedroom actor can sit above the room and nightstand but below the bed foreground. Derive another setting's order from its surfaces. Do not reuse the bedroom stack as a universal rule.

Pre-position useful alternatives as hidden, named ALT layers. Explain which layer to hide when showing an alternate. Provide duplicate-ready poses and effects at their intended scene scale. Use actual Figma properties and layers. Do not draw decorative buttons that have no behavior.

Test pose selectors on a copy. A variant change must preserve the intended size and anchor and match the selected source. Keep shelf labels consistent with selector values.

## Offer an approved blocking puppet

For body-part posing, request an approved blocking rig from Art. Keep the shared master intact. Create an instance on the assigned page and detach only that new working copy into an editable frame. Ordinary cast instances remain linked. This exception does not authorize dismantling an unapproved character or detaching existing scene instances.

Name joint controls by body part and pivot. Choose the part split for the character's geometry. Parent attached parts so they follow the intended chain, such as a prop following its arm. Verify that the neutral assembly reconstructs the complete registered source.

Moved or rotated parts can reveal gaps, wrong perspective, or antialiasing. Treat them as rough pose intent. Finish chosen drawings through character-dance's identity, anatomy, pixel-art, and motion checks before sprite or video promotion.

## Verify controls and actual placement

Use the project's current Figma coordination guide and owned caller. Keep calls sequential under the exact lease. In show-tools, read `docs/video-directors/figma-lease.md` and use `scripts/video-expansion/owned-figma.ts`. Do not copy lease commands from an old transcript. Use the [image-readiness gate](image-readiness.md) for uploaded replacements.

Inspect actual layers and exports. Confirm that scenery is locked, actors are movable, source fills are populated, selectors work, and foreground overlap is correct. Read rendered labels and instructions. A screenshot alone cannot prove editability.

Exercise controls on an isolated probe. Move an actor or joint, verify its actual export changes, restore it, and compare with the baseline. Do not run a move-and-restore exercise on an operator-edited stage. Verify neutral rig reconstruction against the full registered source RGBA.

Inspect exports at actual scene dimensions and an appropriate integer enlargement. Confirm that the export service did not resize a large board. Source equality, visible placement, usable controls, artistic quality, operator acceptance, timing, and runtime admission are separate checks.

## Consume the next endpoint

Discover current workframes, including copies made since delivery. Record frame and actor IDs, camera, source editions, pose properties, transforms, visibility, and layer order. Do not assume an old ID list includes a new endpoint.

Extend the [existing handoff record](handoff-record.md) with workspace ownership and permitted agent edits. Use the project's authoring API for database changes. Manual placement does not supply a musical cue, timing approval, or runtime binding.

Continue the starting, ending, and intermediate pose workflow from the selected endpoint. A rough puppet pose does not certify finished artwork or every tween.

## Teach another Director

Art maintains this guidance and the source bank. Give the next Director the skill location, a working example, the page ownership boundary, and the next applicable action. Ask them to read the guidance before that stage task. Adoption requires no live Figma writes. Record sent messages separately from actual responses or demonstrated use.

The [DYC staging desk](https://www.figma.com/design/QWreOYAnaje2LlywefJFiK?node-id=868-23349), reviewed November 13, 2026, is a teaching example with layered rooms, guest alternatives, a pose shelf, and a detached Maestro puppet. Its current arrangement belongs to the operator. Inspect it read-only if useful. Its cast, coordinates, aspect ratios, and seven-part puppet are examples, not defaults. Future use does not depend on temporary construction receipts.
