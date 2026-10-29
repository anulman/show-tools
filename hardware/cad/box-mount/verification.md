# Box-mount geometry checks

Checked on October 29, 2026 with the existing isolated CAD environment. The final generator records its own SHA-256 in every receipt. Generated geometry stays outside Git.

| Run | Parameters | Result |
| --- | --- | --- |
| Default | Depth 35.25 mm, recess 17.5 mm, C tilt 5 degrees | Both shell-cover assemblies pass all generator checks |
| Deeper variant | Depth 40 mm, other defaults unchanged | Both assemblies pass all generator checks |
| Unrecessed variant | Depth 35 mm, recess 0, tilt 0 | Both assemblies pass all generator checks |
| Exploded preview | Default parameters, bottoms lowered 30 mm | Six separate entries; enclosure parts valid; invalid manufacturer references isolated |
| Clash rejection | Default parameters with `tray_y=30` | C rejected because its tilted stem passage intersects the ballast compartment |

The default compartment moved to `tray_y=32` to remove that CAD clash. This does not establish the actual switch or harness envelope.

The generator also rejects nonfinite dimensions, boolean dimensions, channel or head pockets that consume the bottom skin, and nut pockets that consume the boss roof. Unknown parameter names fail at parsing.

The default receipt is `hardware/cad/build/box-mount-proposal/receipt.json`. It records four valid single-solid part exports, two valid two-solid assembly STEP exports, watertight consistently wound STL meshes, export hashes, package versions, and assembly checks. Both assemblies have zero measured solid overlap between shell and cover, and zero measured overlap with the modeled downward cover sweep.

SVG views into both shells and bottoms were generated from CAD visible edges and inspected. The views expose the nut pockets, screw passages, ballast compartment, cover groove, and seam exit. No shared viewer was started or published by this workstream.

These checks establish the recorded properties of the proposed CAD geometry. Physical fit, actual wire clearance, screw engagement, retained ballast behavior, strength, stability, printing, and assembly remain unverified. Machine-readable print readiness is `NOT_READY`.
