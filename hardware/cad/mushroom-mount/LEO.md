# Leo roof-down mushroom candidate

This opt-in revision addresses the operator-confirmed request for sloped undersides on internal ledges. It preserves the previous source, exports and selected scene. `leo_model.py` derives a separate candidate from the unchanged model; `leo_check.py` compares it against the exact checked v2 STEP/STL pair. No shared retention helper is edited.

## Four applicable caps

The mushroom has no tie ledges. Its four cover bosses are radius 8 mm at assembly XY `(±30, ±33)` and span Z3–15. They stop below the chamber ceiling at Z58. In the planning print orientation, rotate the shell 180° around X and translate it +62 mm in Z: the level roof rests on the bed, the opening faces upward, and the four original flat boss caps face the bed at print Z47. Those caps are the applicable overhangs. This is a proposed print orientation, not a previously measured operator setup.

Each candidate cap receives two perpendicular 45° wall-connected ramps toward assembly +Z, clipped to the original radius-8 footprint and Z15–31. The visible ramp faces span assembly Z17.343–30, or print Z32–44.657. They meet the adjacent inner walls at X±37 and Y±40. Their union covers the original cap while preserving the 3.6 mm axial bore. A native face-normal check in the actual print coordinates rejects the flat baseline and accepts exactly eight 45° underside faces in the revised region.

All original material is retained. The bottom is geometrically identical, all material below Z15 is unchanged, and the exterior, cover mating plane, nut pockets, flat bearing surfaces, M3×10 span, key paths, nut loading, mounting ring access and both cable reserves remain. The 23 mm button hole, 4 mm roof and absence of a counterbore retain the operator's approval. No ballast or extra printed pieces are added.

## Check and select explicitly

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/mushroom-mount/leo_check.py \
  --baseline-receipt /private/tmp/mushroom-mount-v2/receipt.json \
  --output /private/tmp/NEW-mushroom-leo --roof-down
```

The flag explicitly selects this planning pose. Use a fresh output directory. The checker pins the exact baseline receipt, compares native material differences, verifies wall attachments and eight slope normals, and reruns actual hardware, nut-loading, key, cover-withdrawal, nominal reference, cable and OEM-tool checks. Exported inch-unit STEP contexts must declare the correct conversion and round-trip to identical native millimetre geometry. Internal STL meshes must be watertight, consistently wound, and agree with STEP mass and bounds. The STEP ZIP contains exactly the shell and bottom, with no reference models.

The output includes `receipt.json`, `selection.json`, actual STEP/STL pairs, `review.png` and a cutaway `ramp-review.png`. The shell exports use the roof-down pose; the bottom retains its flat underside-down pose. Each record includes the explicit rotation/translation needed to recover assembly coordinates.

`leo_scene.py` provides the same no-argument `load()` tuple as the baseline scene. It requires the separate ignored `hardware/cad/build/mushroom-leo/current.json` selector. The coordinator can copy the issued `selection.json` there after review. The loader checks receipt, source and actual export hashes and the geometry pass before displaying the pinned pair with unchanged simplified references. The checker does not select this candidate, change the baseline selector or publish a viewer.

## Limits

The checks establish sloped geometry for these four boss caps. They do **not** establish that the entire print needs no support. Captive-nut pocket ceilings and small bore bridges remain unchanged and need slicer review. Printer, material, layer settings, bridge capability, strength and assembled physical fit remain unverified. The button reference still has an unmeasured rear width and simplified details. The inch STEP archive is a geometry-review handoff, not manufacturing approval.
