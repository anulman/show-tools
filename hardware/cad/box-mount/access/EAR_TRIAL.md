# Actual countersunk PTFE-ear trial

Print this small joint before the full buffer spacer. The six button-head coupons test a different head and stack. This trial tests the actual M3 ISO10642 countersunk joint, purchased 1 mm PTFE ear, forming ramp and nut pocket used in the revised full source.

The full joint now drops the outer ear 1.8 mm over a 3 mm projected run, retaining the previous bend angle. Its developed ramp is 3.498571137 mm long. The counterseat leaves 0.69 mm material at the pilot edge, and all minimum/maximum head/angle seating cases require at least 0.5 mm. The earlier 0.09 mm-web exports remain historical and must not be treated as the final joint.

The generator reads the full candidate's hashed STEP/STL exports and checks the producing source hashes. It clips the actual roof, spacer and PTFE with a 20 × 20 mm radial/tangential block around the 45-degree R53 joint. The block includes the complete 10 mm roof and the full spacer/material stack, excluding unrelated lower enclosure geometry. Every clipped and exported piece is compared in both Boolean directions with the exact source material.

There are exactly two resin print files under `print/`:

- `ear-trial-roof.stl`
- `ear-trial-spacer.stl`

Each is centered, rotated into the radial trial frame, and rests at Z0. Preserve scale. The receipt records inverse transforms back to the source assembly. The assembly STEP uses a shared transform, keeping the real mating positions.

The separate `materials-DO-NOT-PRINT/` directory contains formed and developed-flat PTFE references. Cut/form purchased 1 mm stock; these are not resin parts. The developed allowance is included rather than simply using the projected ramp length. The pilot is diameter 3.6 mm; the 3D cut pattern includes the conical seat. Cutting its larger top circle as a straight through-hole would change retention and is not the specified geometry.

Use one A2 M3 × 25 ISO10642 countersunk screw and one matching M3 DIN934 nut, with an ordinary 2 mm hex key. The 25 mm length INCLUDES the head. Load the nut before mating the printed pieces. The trial retains the full source's selected 5.8 mm AF pocket, 3.6 mm bore, ramp reliefs and screw reach. If the basic hardware coupons require another allowance, revise and regenerate the full joint and this trial together; do not independently scale the trial or force assembly.

The checks cover source material identity, complete nominal screw reach, declared screw/nut axis, nut loading after printing, cone-bearing reaction, axial retention, four seated head diameter/angle cases and the below-opening-plane guard. The checker rejects altered spacer material, an incorrect under-head interpretation of the countersunk screw length, and a mismatched declared joint axis.

Use the printer's intended resin, support/orientation, wash and cure process. Check actual nut insertion and rotation restraint, screw seating, ear forming without tearing, repeatable retention and clearance below the root datum. Do not infer a tightening torque or load rating. PTFE creep, wear, drag, full-ball clearance and installed spinner fit remain unverified. The operator's hex and knob measurements are still pending.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/buffer_ear_trial.py \
  --base-receipt "$REVISED_KNOB_RECEIPT" --output /tmp/actual-ear-trial
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_buffer_ear_trial.py \
  --base-receipt "$REVISED_KNOB_RECEIPT"
```

Package the two print STL files separately from material references and assembly evidence. No model is published and no service is started by these commands.
