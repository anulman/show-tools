# Preview the panel-mount box

This separate concept replaces the old stock-hex well and keepers with a flat
roof. The fixed shoulder sits above the roof, and the existing nut clamps from
below. The body remains 116 by 116 mm with its former height and removable
bottom. A stationary foot extends 25.4 mm on every side, giving a 166.8 mm square
envelope. The old files remain unchanged.

The 3 mm roof, 29 mm passage, 6 mm foot, and 0.5 mm bottom-removal side allowance
are study parameters. The supplied drawing's nominal body and shoulder diameters
are 28 and 34 mm. Those values do not certify the actual hardware's fit.

The operator's rough knob-underside-to-flange-top estimate is 3/32 inch,
approximately 2.38 mm. Fixed shoulder thickness remains unknown. The old
nut-adjustment range does not define this new roof-to-knob stack.

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
fixed shoulder thickness, and the selected tightening tool remain necessary.
The separately proposed rotating clamp has no combined fit admission with this
box. Roof strength, loaded tipping stability, physical fit, and printability
remain unverified. Preview receipts are explicitly not manufacturing approval.
