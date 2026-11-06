# Leo box ledge candidates

`access/leo_box_ledges.py` adds external ramps to the four nut-seat ends and two wall-mounted cable eyes on each selected shell. It preserves the issued producers and exports. These candidates cover the circled ledges in Leo's photo. They do not qualify either complete box for printing without supports.

## Affected geometry

All coordinates below are assembly millimetres. The arcade input includes the previously issued 1 mm outside lower-rim chamfer.

| Box | Nut axes | Nut free ends | Wall-eye footprint | Eye free ends |
| --- | --- | --- | --- | --- |
| Arcade | X ±49, Y ±54 | Z −53 | X ±11, Y 51 through 59 | Z −35.4 |
| Disco | X ±49, Y ±49 | Z −49 | X ±11, Y −53 through −34, including existing braces | Z −55.4 |

Each nut ramp joins its nearest X wall. Each eye ramp joins its existing Y wall. The ramps extend toward the roof because the chosen shell print pose has the roof facing the build plate. Flat nut bearing faces, hex pockets, cover mating surfaces, and original material remain unchanged. The Ø3.6 mm screw bores continue through the added ramps. Full-height posts elsewhere do not receive ramps.

The arcade front eyes belong to the bottom cover. They already grow from the plate in the proposed upright cover pose and receive no external ramps. Both boxes retain their original closed tie tunnels and their complete tail, loop, head, and cable envelopes.

## Print poses and remaining bridges

The proposed shell rotation about X is 175° for the arcade and 180° for the disco. Grounding follows rotation. The arcade pose first cancels the 5° roof incline, then turns the roof toward the plate. Bottom covers retain their upright pose. Exported files retain assembly coordinates; their recorded source-to-export translations are zero.

Disco ramps have equal rise and run. Arcade ramps use a 1.2 rise/run ratio so their actual face normals pass the 45° overhang limit after the 175° rotation. The check transforms the normals into the print pose.

The preserved tie-loop passages interrupt the ramps. Their new flat spans are at most 2.5 mm along Y; the inherited tie tunnels span 3.2 mm. The arcade also has 0.625 mm interruptions. These are deliberate bridge exceptions. The receipt records their actual face bounds and areas.

Other inherited surfaces remain outside the ledge check. The arcade rear outlet includes a 5 mm wall-depth ledge. The disco wide foot has a broad face toward the plate in the proposed roof-down pose. Screw bores also remain open. Slicer and physical review are still required; strength, fit, and global support-free printing remain unverified.

## Verification record

The verifier reads the pinned source STEP files. It rejects all six original flat free ends per box, then accepts the changed free ends. It checks valid single solids, preservation of all source material, exact bottom and nut-seat equality, and confinement of additions to the named ramps.

Native checks cover the M3×10 cover joints, 9.71 and 10.29 mm screw length endpoints, nut loading, AF2 key paths, screw withdrawal, and 100 mm continuous cover withdrawal. Tie checks preserve the full 2.5×1.3 mm tail envelope, 3.2×1.8 mm tunnels, complete tie loops and heads, and Ø3/Ø8 mm cable witnesses. The upper 20 mm and central Ø50 mm device/tool space remain equal to the source. The arcade retains its Ø27×63.5 mm inclined button reserve.

The export check reimports each inch STEP and compares material in both directions. Internal STL files retain millimetre coordinates. The artifact checker verifies closed meshes, winding, bounds, and STEP/STL volume agreement. ZIP contents are checked against the exported file hashes. Source files and native source BReps are checked for mutation.

`load_review(receipt_path, expected_sha, expected_kind)` returns `(parts, provenance)`. `parts` contains `shell` and `bottom` in original assembly millimetres. The caller supplies an independently inspected receipt hash and either `arcade` or `disco`. The loader verifies the parent, producer revision, source pins, inch units, actual STEP/STL files, and inventory. It does not change selectors or the viewer.

The generator requires the pinned inputs listed in `PINNED` and a fresh output directory. Its interface is `--kind arcade|disco --output /absolute/fresh/directory`. The output receipt binds the producer, inputs, geometry evidence, print poses, and archive. Active input and candidate files must remain available until the coordinator verifies the canonical handoff.
