# Box-mount geometry checks

Checked on October 29, 2026 with the existing isolated CAD environment. The corrected generator records its own SHA-256 in every receipt. `depth` now measures to the interior floor; the bottom extends below that reserve. Generated geometry stays outside Git.

| Run | Parameters | Result |
| --- | --- | --- |
| Default | Interior depth 35.25 mm, recess 17.5 mm, C tilt 5 degrees | Both assemblies pass; interior floor -35.25 mm, exterior underside -38.25 mm |
| Deeper variant | Interior depth 40 mm, other defaults unchanged | Both assemblies pass; interior floor -40 mm, exterior underside -43 mm |
| Unrecessed variant | Interior depth 35 mm, recess 0, tilt 0 | Both assemblies pass; interior floor -35 mm, exterior underside -38 mm |
| Exploded preview | Default parameters, bottoms lowered 30 mm | Six separate entries; enclosure parts valid; invalid manufacturer references isolated |
| Clash rejection | Default parameters with `tray_y=30` | C rejected because its tilted stem passage intersects the ballast compartment |

The floor regression in `check_reserve.py` fails against the previous source with `A 3.0mm cover interior floor: -32.25 != -35.25`. It passes against the corrected source for both A/C and both 3 mm and 5 mm covers. It checks actual CAD bounds against the requested reserve, independently of the derived datum properties.

The default compartment moved to `tray_y=32` to remove that CAD clash. This does not establish the actual switch or harness envelope.

The generator also rejects nonfinite dimensions, boolean dimensions, channel or head pockets that consume the bottom skin, and nut pockets that consume the boss roof. Unknown parameter names fail at parsing.

The default receipt is `hardware/cad/build/box-mount-proposal/receipt.json`. It records four valid single-solid part exports, two valid two-solid assembly STEP exports, watertight consistently wound STL meshes, export hashes, package versions, and assembly checks. Both assemblies have zero measured solid overlap between shell and cover, and zero measured overlap with the modeled downward cover sweep.

SVG views into both shells and bottoms were generated from CAD visible edges and inspected. The views expose the nut pockets, screw passages, ballast compartment, cover groove, and seam exit. No shared viewer was started or published by this workstream.

These checks establish the recorded properties of the proposed CAD geometry. Physical fit, actual wire clearance, screw engagement, retained ballast behavior, strength, stability, printing, and assembly remain unverified. Machine-readable print readiness is `NOT_READY`.
