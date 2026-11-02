# Preview the panel-mount box

This separate concept replaces the old stock-hex well and keepers with a flat
roof. The fixed shoulder sits above the roof, and the existing nut clamps from
below. The body remains 116 by 116 mm with its former height and removable
bottom. A stationary foot extends 25.4 mm on every side, giving a 166.8 mm square
envelope. The old files remain unchanged.

The 3 mm roof, 29 mm passage, 6 mm foot, and 0.5 mm bottom-removal side allowance
are study parameters. The supplied drawing's nominal body and shoulder diameters
are 28 and 34 mm. Those values do not certify the actual hardware's fit.

The corrected operator description gives the fixed flange's axial thickness as
roughly 3/32 inch, approximately 2.38 mm, with no visible gap above it. The flange
bottom is on roof Z=0, and the nominal knob underside is at flange-top Z=2.38125.
The earlier interpretation of 3/32 inch as a gap is invalid. Precision thickness
and rotating-shaft clearance remain unmeasured. The old nut-adjustment range does
not define this new roof-to-knob stack.

Generate preview STEP files in a fresh directory:

```sh
python hardware/cad/box-mount/access/panel_mount_box_concept.py \
  --selection /private/tmp/disco-air-gap-prototype-20261030-r2/selection.json \
  --output /absolute/path/to/fresh-preview
```

Run independent geometry diagnostics:

```sh
python hardware/cad/box-mount/access/check_panel_mount_box_concept.py \
  --receipt /absolute/path/to/fresh-preview/preview-receipt.json \
  --output /absolute/path/to/new-diagnostics.json
```

The wider foot preserves the original corner nut pockets and extends the old
cable route through the front of the foot. The checks cover bottom separation
and continuous removal, cable clearance, retained cover fasteners, complete AF2
cover keys, and cover-nut loading. Nominal body and shoulder probes check the
proposed opening and bearing annulus.

The 50 mm coaxial cylinder reserves tool space. It is not a model of an actual
spinner nut, wrench, or socket. Actual nut dimensions, thread and body projection,
precision flange thickness, and the selected tightening tool remain necessary.
The separately proposed rotating clamp has no combined fit admission with this
box. Roof strength, loaded tipping stability, physical fit, and printability
remain unverified. Preview receipts are explicitly not manufacturing approval.

## Check the five-print nominal assembly

The intended print count is five: the integral bar and grip, two identical shoes,
the box shell, and the bottom. No separate cup, collar, or keeper belongs in that
count. CAD material boundaries do not prescribe slicer infill or wall settings.

For the E22 concept, rotate its source geometry 180 degrees around X. The checked
nominal placement puts the original bar root at Z=24.38125 mm and the grip end at
Z=2.38125 mm. Both values assume a 25.4 mm knob height as well as the approximate
flange-thickness datum. Actual knob height is still unknown.

With the knob top seated against the stop, bar-root height is
`T + E + (Hactual - 25.4)` and grip-end height is `T + (Hactual - 25.4)`.
A shorter knob lowers the grip by the same height difference. Using nominal
T=2.38125 mm, the grip end is above the roof only when Hactual exceeds 23.01875 mm.
This geometric condition is not a manufacturing allowance or actual fit proof.

```sh
python hardware/cad/box-mount/access/check_panel_integral_nominal_clearance.py \
  --base-receipt /private/tmp/panel-mount-box-concept-v5/preview-receipt.json \
  --grip-receipt /private/tmp/integral-exposed-grip-stop-concept-v3/concept.json \
  --key-receipt /private/tmp/integral-grip-service-v3/receipt.json \
  --output /absolute/path/to/new-nominal-clearance.json
```

The check requires corrected thickness and zero-visible-gap metadata. It rejects
the earlier gap interpretation and an inconsistent nominal socket height before
geometry work. Continuous axisymmetric
windows contain all nine rotating solids and both complete side-key bounds.
The nominal geometric bounds are 2.38125 mm for rotation and 0.5 mm for the key
windows. No angle samples are used, and the two shoes must match after a
180-degree rotation. The key receipt must bind the corrected grip and placement;
the older receipt with the invalid gap interpretation is rejected. Intrinsic
grip service and the post-glue lifecycle proof remain separate evidence from
these box-clearance checks.

The nominal 28 mm body envelope and 34 mm flange envelope are drawing-based
clearance probes. The body envelope's depth is conservative, not a measurement
or a test of body fit inside the enclosure. Actual spinner-nut/tool fit, rotating
shaft profile, roof stiffness, pad grip, and loads remain unverified.
