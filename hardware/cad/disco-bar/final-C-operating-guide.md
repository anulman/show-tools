# Attach and release final C

The routine latch does not add screws between the box roof and the cylinder plate. You turn the **separate collar**, then put the already-captive pin back into its locked position. The bar, carrier, and blue preset plate remain aligned while the collar turns.

The blue preset cup stays clamped to the knob. During use it rotates with the knob and the attached bar. The box roof and stock-hex keepers stay stationary. Those keepers are a different joint from the bar latch.

## Attach the bar

1. Provide underside service access and align the assembly to the base's service index. The current CAD proposal uses a 140 mm box lift for complete tool insertion; physical handling at that height remains unverified.
2. With the pin retracted and collar released, align the straight pilot keys and seat the complete bar onto the preset plate.
3. Hold the bar still and turn the separate collar 90 degrees with the proposed two-pin spanner. The collar's fingers capture the plate's flange.
4. Use the slot driver to push the pin inward 2.8 mm from its retracted position, toward the ball. While held inward, turn the pin back 90 degrees.
5. Use the under-head fork to pull the pin outward 0.8 mm to the locked pocket's stop. Remove the tools. The seated pin now blocks collar reversal.

Turning the whole ball does not create this relative collar movement on a free-spinning knob. The bar supplies the reaction while the collar turns.

## Release the bar

1. Push the pin inward 0.8 mm and turn it 90 degrees while held inward.
2. Pull the pin outward 2.8 mm with the fork. Its lug stops against the pin-retaining bridge; the pin stays captive.
3. Hold the bar, turn the collar back 90 degrees with the spanner, and remove the tool.
4. Lift the complete bar off. Leave the preset cup and grip setting on the knob.

## Screws that stay fitted

The two grip set-screws establish the padded cup's initial grip. Three carrier screw/nut pairs attach the carrier to the full bar. Two smaller screw/nut pairs secure the pin-retaining bridge to the carrier. These stay fitted during ordinary attachment and release. The pin-retaining bridge is on the bar's carrier, not the box roof.

The stationary stock-hex keeper hardware belongs to the box and is not a collar fastener. The animation omits the box and full outer bar shell to expose the coupling.

## What the animation shows

`animate_final_c.py` uses only the verified state STL files named and hashed by a final-C receipt. It does not regenerate geometry, import the CAD model, or publish a page. It checks the preset positions and the assembly screws' positions relative to their carrier before rendering.

The video uses discrete verified poses for attachment, locking, and reverse release. The carrier and pin-retaining bridge are shown in cutaway. The pin detail follows the moving carrier. These are CAD instructions, not a physical simulation or evidence of a tested printed latch.

Run it with the isolated CAD Python environment:

```sh
~/.local/share/show-tools/cad/venv/bin/python \
  hardware/cad/disco-bar/animate_final_c.py \
  --receipt /absolute/path/to/C/receipt.json \
  --output hardware/cad/build/final-c-instructions-v1
```

The output contains an MP4, a GIF, a poster, a contact sheet, the staged PNG frames, and an input/output hash manifest. The renderer uses Pillow, NumPy, trimesh, and the installed `ffmpeg` command. The geometry, custom control and tools still require fabrication, fit, strength, and ergonomic review.

The installed FFmpeg build reports GPL-3.0-or-later, and this renderer uses its `libx264` encoder. FFmpeg runs as an external local tool. No FFmpeg binary is committed or added to the browser application.
