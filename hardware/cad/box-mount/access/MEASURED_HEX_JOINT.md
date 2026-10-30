# Measured-interface hex and keeper trial

This small coupon tests a complete hex well and one keeper joint before a new complete mount. The operator supplied approximate ruler estimates: hex AF about 1⅜ inch (34.925 mm), threaded stationary barrel about 1⅛ inch (28.575 mm), nut thickness about ¼ inch (6.35 mm), and knob height about 1 inch. The decimal values are conversions, not measurement accuracy. The operator subsequently confirmed Darren's original snug socket and superseded the larger 1⅞ inch knob-diameter estimate. The frozen trial used that larger diameter only as a conservative keeper-tool clearance bound. It does not use or resize the knob socket, and its exports remain unchanged. The socket bore is not a measurement of the knob itself.

The proposed well is AF36, the barrel passage is diameter 30 and the well is 6.6 mm deep, with 5 mm of seat material beneath it. Against the estimates, these give 1.075 mm total AF allowance and 1.425 mm diametral barrel allowance. The estimated hex still bears on a minimum 2.4625 mm-wide ledge outside the passage. These allowances are fit-trial choices, not approved compensation for a selected resin.

With an estimated 6.35 mm-thick nut in a 6.6 mm pocket, its top is at Z −0.25 relative to the roof. The keeper has a matching 0.25 mm nose below the roof datum. It does not silently leave that clearance as axial play. Actual nut thickness or printing error may still prevent contact or cause interference; check without forcing and correct the fit recipe before using it in a full mount. The coupon proves no preload, load capacity or resistance to tilting under load.

The screw is a standard M3×12 ISO7380-1 button head with a DIN934 M3 nut and an ordinary 2 mm key. Its length is measured under the head. The actual standard hardware envelopes and declared joint axis are checked. The deeper roof requires the nut-loading channel to open at the coupon underside rather than stopping at the old −10 mm datum. The nominal 30 mm insertion sweep, upward nut reaction, head bearing and complete nut thread span plus one pitch are checked.

The nominal stock hex contacts the floor when moved down 0.1 mm and the keeper nose when moved up 0.1 mm. A 5-degree rotation encounters the well. This establishes geometric restraint against those motions, not acceptable backlash or actual thread fit. The checker rejects the old AF34, diameter29 and 5 mm-deep recipe, a missing nose, a cap under the nut-loading channel, and a joint moved to another axis.

For assembly order B, the cup and ball remain off during keeper tightening. A conservative full L-key envelope based on Wera 950 L 05021605001 (2 mm, 100 mm long leg, 16 mm short leg) clears the coupon and the estimated bare-knob radial bound. The short arm is above the modeled knob envelope. The filled catalog screw envelope does not model proprietary Hex-Plus engagement. This is not permission to tighten the keepers after the cup is fitted; the actual cup blocks that axial access.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_measured_hex_joint.py
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/measured_hex_joint.py \
  --output /tmp/measured-hex-joint
```

Print the two pieces under `print/`; each is centered in XY and rests at Z0. Arrange them separately in the slicer. The receipt records inverse translations into the source assembly. The assembly STEP includes nominal purchased stock and standard hardware as references, not additional print parts. The material volume of the two print pieces is about 8.68 cm³. Review orientation and supports, especially the keeper's small underside nose. Use the intended resin, wash and cure; no printer settings or strength are approved.

The generating source hashes are captured before construction and rechecked during verification and export. STEP material identity and paired STL integrity are checked on the actual exports. No existing generator, frozen output, viewer or service is changed. The future compact mount must reuse the shared `interface` recipe and independently verify both keepers, the complete mechanism, passive bearing and every tool path.
