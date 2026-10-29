# A and C box-mount proposals

`box_mount.py` develops A/red flat and C/blue tilted concepts as a shell and removable bottom. `print_readiness` is `NOT_READY`. All construction dimensions are proposals. No screw, nut, washer, cable, printer, material, or fit allowance has been selected from measured hardware.

The seating-shoulder centre remains at Z=0. The external underside is Z=-35.25 mm. The 17.5 mm counterbore rises along the button axis. C tilts 5 degrees toward -Y. The bottom is 3 mm thick, so its internal floor is Z=-32.25 mm. Closing the base reduces the original open underside space by that thickness. These datums follow the existing [base concepts](../BASE-CONCEPTS.md).

The shell has four bosses with proposed M3 screw passages and hex nut pockets. Nuts enter from below before the cover closes the pockets. Recessed cylindrical screw-head seats open on the external underside. These are geometric provisions for a proposed fastening method. Screw length, actual head shape, nut dimensions, engagement, and tightening loads need review.

A groove in the top of the bottom cover joins a notch in the -Y wall at the seam. The closed groove and exit have a proposed 10 mm width, 8 mm height above the floor, and 1.5 mm depth below the floor. The remaining cover skin below the groove is 1.5 mm. No strain relief, connector clearance, bend radius, seal, or abrasion protection is verified. -Y is a proposed rear cable exit, independent of installed orientation.

A roofed rectangular ballast compartment belongs to the shell and closes against the bottom cover. Two short ribs connect its roof to the rear wall. Its proposed interior is 72 by 24 by 8 mm. The checked empty rectangular envelope is 71 by 23 by 7 mm. Steel washers are a proposed ballast, with no selected diameter, count, mass, or arrangement. Removing the bottom opens the compartment downward. Support or remove ballast before opening it. No performance claim depends on its weight.

The compartment separates the proposed ballast volume from the wiring space in ideal CAD geometry. Cover gaps, flex, wear, loose fragments, and behavior under load are unverified. The reference button has invalid upstream geometry and is not used as a subtraction tool or a clearance envelope.

## Generate and check the proposals

From the worktree root, use the existing CAD environment without starting a viewer:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box_mount.py
```

Set the Python path yourself if the environment lives elsewhere. The command writes ignored outputs under `hardware/cad/build/box-mount-proposal/`. Each concept has shell and bottom STEP and STL files, plus a two-solid assembly STEP and SVG views into the shell and bottom. File names mark them `PROPOSAL-NOT-FIT-VERIFIED`. `receipt.json` records source and output hashes, package versions, all parameters, and checks. A failed run removes the previous success receipt before attempting geometry.

Override `Proposal` fields with a JSON object. Unknown fields and nonfinite values fail. This example varies only the underside depth and writes a separate output:

```sh
printf '{"depth":40}' > /tmp/box-depth.json
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box_mount.py --parameters /tmp/box-depth.json --output /tmp/box-depth-40
```

Parameters permit exploration, not arbitrary valid combinations. CAD validity and assembly checks reject combinations that lose required material or introduce interference. A successful parameter set still needs the physical checks below.

The importable `preview(parameters=None, *, explode=0, include_reference=True)` returns `(objects, names, colors, alphas)` for the parent-owned publisher. It never connects to a viewer. The six default entries keep each shell, bottom, and manufacturer button reference separate. Reference loading checks the pinned asset hash. `explode` lowers the bottoms for inspection. No button reference is included in the manufactured-part exports.

## Evidence and remaining decisions

Every exported part must be one valid positive-volume solid. It must survive a STEP round trip and produce a watertight, consistently wound STL within 0.5% of CAD volume. Each assembly must round-trip with two valid solids and matching volume.

Assembly checks cover zero solid overlap, planar shell-cover contact, the external underside datum, the internal floor datum, a full downward cover sweep, unobstructed wiring and ballast envelopes, aligned screw passages, nut insertion sweeps from below, screw-head seating material, nut-pocket roofs, ballast floor and roof, the stem bore, the axial counterbore, and a supporting-shoulder sample. Their tolerances describe CAD computation. They do not describe manufacturing tolerance.

Fitted dimensions and a print release remain blocked on these operator facts:

- Measure each button's underside, retaining nut, microswitch, and attached harness against the seating shoulder. Confirm moving-part travel with the body recessed.
- Confirm wire-bundle and connector sizes, the desired exit direction, and strain relief.
- Select screws and nuts. Measure their heads, across-flats dimensions, and thickness. Choose engagement and an assembly tool path.
- Select ballast dimensions, mass, retention, and a safe service procedure. Confirm the proposed compartment position against the actual harness.
- Select the printer, material, bed size, orientation, and manufacturing allowances. Check a fit coupon and a physical assembly.

No strength, stability, physical clearance, printability, or completed hardware test is claimed by these exports.
