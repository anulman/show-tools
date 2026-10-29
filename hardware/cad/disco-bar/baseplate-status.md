# Independent preset knob-clamp study

This milestone covers joint 1 only. The baseplate stays on the knob; no bar latch, latch flange, support seat, or actuator placement is modelled yet. The required installed release-access answer still gates C1–C3.

`baseplates.py` provides `knob_baseplate(reference, setting_mm)`. Its frozen assembly record contains nine components: the cup, two retained shoes, two pads, two headless set-screw envelopes, and two nut envelopes. The cup and shoes are three proposed print pieces.

The original socket diameter, entry bevel, and 25.4 mm stop depth remain the released-fit baseline. Outward reinforcement is proposed at radius 33 mm. That is not an installed-stack fit claim. The proposed shoes move inward by 0.2 mm in the preset comparison. This represents possible pad compression without establishing preload, friction, or actual knob dimensions.

T-shaped pad backs encounter jaw lips under attempted inward removal. Shoe tabs encounter their guide shoulders, and the nut envelopes encounter finite outward reaction roofs. The nuts load through the cup before shoe installation. Pad deformation or an assembly change may be needed to insert the T backs; physical pad insertion and service access remain unverified.

The shaft, nut, drive-access, and pocket dimensions are geometric envelopes. No thread standard, actual insert, tightening torque, material, or printer tolerance has been selected. Nothing in this module operates the preset screws during bar removal.

Run the independent check from the repository root:

```sh
~/.local/share/show-tools/cad/venv/bin/python \
  hardware/cad/disco-bar/check_baseplates.py --step "$SHOW_TOOLS_DISCO_STEP"
```

The receipt and three STEP/STL pairs go to ignored `hardware/cad/build/two-joint-baseplate/`. The check covers released and proposed preset states, source void and stop preservation, component intersections, bar-off driver paths, pad seats, positive retaining geometry, and export round trips. It also rejects preset pad overlap falsely labelled as released, and a removed blind stop. Source/reference hashes identify the checked code and asset.

These are CAD checks of an independent form study. They do not establish clamp strength, knurl protection, pad installation, complete bar attachment, support loads, or installed access. The original full-height bar is unchanged. The Disco bar page shows this preset component study beside the original, A and B, labelled as a component only with no bar latch.
