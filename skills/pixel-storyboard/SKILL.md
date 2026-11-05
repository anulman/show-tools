---
name: pixel-storyboard
description: Create and refine pixel-art scenes, storyboards, character actions, and tween studies in Figma. Break complete-motion requests into starting, ending, and intermediate poses, then verify a held-pose animatic before adding targeted drawings. Use alongside character-dance for dances and special moves.
---

# Pixel storyboard

Direct the work in small visual decisions. Almost never request a complete motion from an image or video generator in one pass. Even when the operator asks for a complete motion, break the request into the steps below. Drive the review or proceed autonomously within the operator's authorization. Do not make the operator manage the production sequence.

An autonomous grant does not require an operator reply at every stage. Make and record internal decisions, preserve the accepted work and continue. Keep operator acceptance recorded as unreviewed when the operator has not seen that version. Ask only for a decision outside the available authorization or a missing fact that blocks dependent work.

Use Figma as the primary workspace. Keep the storyboard, reusable source art and animation cels there. PNGs and MP4s are review exports. Load the applicable Figma skills before tool calls. Use character-dance for character identity, native pixel finishing, anatomy, temporal review and release requirements. This skill adds scene direction and staged tweening. It does not implement musical timing or promote art into runtime use.

For a static scene study, compose the required shots and review their PNGs. Apply the pose progression and motion-export steps below when the task includes a character action or animation.

Read [the operator instructions](references/operator-guide.md) when explaining or guiding the workflow. Read [the Maestro case](references/maestro-case.md) when diagnosing a failed pose or adapting this process. Read [the handoff record](references/handoff-record.md) when coordinating agents or preserving acceptance through a session restart.

## Establish the scene and action

Resolve the approved model edition and actual Figma nodes. Record the native grid, source hashes, camera, scale, floor or other contact surface, and travel direction. Distinguish a character identity reference from the requested starting pose. Maestro's neutral model was a reference; his action began running left to right.

State what the viewer should read in each shot or action. Use the operator's marked images and recordings, not the transcript alone. Separate shot framing from asset fidelity. A distant figure may be a dot; a closer shot should reveal the intended character without changing models or world geometry.

Compose scenes with separate cels for the world, character, props, foreground or accumulated material, and optional effects. Keep optional snowfall, lights and HUD elements independently controllable. Reuse these cels across camera studies and effect-on/effect-off versions. Do not repaint an entire scene to remove snowfall or change one pose. Scene frameworks are reusable treatments, not a fixed list of worlds.

## Draw start, end, then middle

1. **Establish the starting pose.** Show the actual initial action and facing. Check character identity, scale and support. A running start carries momentum that an upright idle cannot supply.
2. **Establish the ending pose.** Resolve the important final silhouette, contact, proportions and prop placement. Explore bounded alternatives if it is disputed. Preserve the chosen endpoint while working on the rest.
3. **Draw the middle pose.** Place a meaningful physical event between those endpoints. Show changing perspective and overlap when needed. For a fall, test loss of support and airborne descent. Rotating a flat upright sprite does not draw a new perspective.
4. **Split the remaining gaps.** Add an interim only where the current pair cannot communicate the action. Review each new drawing beside its two neighbors. Keep accepted drawings fixed unless a new requirement makes them incompatible.
5. **Play a held-pose animatic.** Show the current drawings without crossfades or generated optical flow. Use it to judge spacing, holds and the remaining drawing gaps. Add selected tweens, then replay.

For a loop, the ending state is its intended closure into the start. Establish the main contrasting pose between them, then split the transitions. An ultra move still follows staged drawing decisions. Its size and effects do not justify generating the whole motion at once.

If an approved endpoint already exists, reuse it and establish the missing start before the interims. A changed start can invalidate the old interims. Do not keep a grounded progression after the operator changes the start to a run.

Pose count is a drawing budget, not an output frame rate. Distinguish "three poses total" from "three interim poses plus two endpoints." Roughly equal progress through an action does not require equal travel distances or final hold durations. Do not turn Maestro's five-pose study into a universal frame count.

Judge the action before expensive finishing. Every action drawing must read as a specific moment, with identity and anatomy appropriate to the intended framing. Review facial construction where the face is visible. If successive fixes fail in the same way, write down the shared assumption and test it. Replace a failed premise before adding more detail. A planted-foot rule was wrong for an airborne fall.

## Keep approval local to the decision

Record separate decisions for scene and camera, pose and action, identity and face, pixel finish, timing and tweening, and runtime promotion. Name the inspected version and who reviewed it. Internal review and operator acceptance are different records.

Treat "the poses are great, polish the face" as approval of the poses plus authorization for a bounded face correction. Define the permitted edit region and the pixels, silhouettes, layers and transforms that must remain fixed. Compare every outside-region RGBA pixel and any declared immutable alpha regions before and after. Freeze the complete alpha channel when the correction changes only RGB, as in Maestro's eye cleanup. Do not infer preservation from equal dimensions or a few sample pixels. If the correction requires changing protected geometry, explain that conflict rather than silently widening the edit.

Polish the existing facial construction. Preserve eye proportions, clear face planes, intentional hair boundaries and coherent perspective. Reuse actual clusters when the view is unchanged. Draw view-specific marks when it changes. Avoid patchwork greys, holes and isolated high-contrast flecks. Consistency does not mean pasting an upright face onto every head angle.

Apply the character-dance finishing gates to every new drawing, including tweens. Match the approved model's fidelity. For this project's mid-res 8-bit art, ask "Is this the work of a mid-res 8-bit pixel artist?" Native pixel cleanup, palette reduction and lossless export are not substitutes for a visual answer. A correction changes the artwork version and invalidates the affected old reviews and export receipt.

## Use the animatic to choose tweens

Render the current accepted drawings first. Keep presentation clean. Omit diagnostic tickers, invented slogans, phase labels and HUD elements unless the operator requests a diagnostic view. Choose a short review cadence and a useful landing or closure hold. Label those timings as provisional review timings, not song timing.

Use seconds for a narrative review clip. For music-driven work, record the intended beat relationship separately and consume authoritative performance time. Do not invent a song tempo or cue binding to satisfy animation metadata.

In Figma, held opacity swaps can show one pose at a time. Verify exactly one drawing is visible at every switch, repeated cycle and ending. Keep common scene coordinates and model scale. Preserve actual travel and airborne gaps; do not independently center or fit every drawing. Respect moving feet, free limbs and creature-specific geometry.

Export the actual Figma timeline as MP4. Preserve integer source-pixel scaling and inspect decoded frames around every change, the close-up face, contact, repeated cycles and ending. A static screenshot or a locally rebuilt movie cannot prove the Figma timeline. If the motion or export API is unavailable, report that concrete limit and label any fallback accurately.

Identify a weak transition by its neighboring poses and what is missing. Examples include support loss, a shoulder overlap, a changing head plane or contact compression. Add a deliberate drawing in that interval. Adjust a hold instead if the drawings read correctly and only the timing is wrong. Keep the intended choppy cadence. More video frames do not supply more articulated poses.

For a finished-animation request, continue through targeted drawings and timing checks until the actual export communicates the requested action. Do not stop at the first storyboard or call a rough held-pose study finished. For a request to inspect tween gaps, deliver that study and the next decision it supports.

## Coordinate one bounded handoff

When collaborating in this project, the Art Director owns shared model and pose artwork. A song Director owns the assigned page's shots, placement and review timing. Use one source writer for a correction. Give collaborators the consolidated current brief, permitted edits, immutable items, source IDs, acceptance evidence and return artifact. Use the handoff record instead of scattered status messages.

The receiver acknowledges once, works, then returns the actual artifact or a concrete blocker. The Director inspects it and sends one consolidated correction. Do not create a second approval gate for an already authorized bounded update. Avoid repeated "still waiting" messages, duplicate authorization requests and expensive generation while an existing request is pending.

Respect the team's current Figma write coordination. Keep any file lease short and release it during generation, review and video rendering waits. Never steal another session's lease. Use isolated preparation directories and one writer for shared skill or source changes.

## Clean up after a verified handoff

Update existing source components in place when their semantic identity is unchanged. Preserve the existing body and effects separation, named-layer identities, instance references and transforms. This project uses layers named Body and Effects. Verify the actual placed instances and export after the source update.

Replace rejected drawings in the working review area. Remove exact superseded shared sources only after checking their current instances and declared consumers. Keep an approved endpoint, useful active comparisons and evidence needed by pending work. Do not delete by broad name matching or leave obsolete alternatives mixed into the current result.

Unknown consumers block deletion of that source only. Keep it outside the current presentation, record the unresolved reference check and continue the authorized art or export work.

Retain compact current source IDs, hashes, registration, timing and decisions. Temporary generations, contact sheets and process logs can expire after verified handoff and consumer migration. Keep canonical art in Figma. Do not accumulate PDFs, review debris or unreferenced local asset copies as the design system.

Deliver the current Figma view, a clean shareable export and the decision it is ready to support. A successful storyboard or held-pose test does not approve all future tweens, final timing or runtime integration.
