# Lower disco mounting box

The low study has a 2.52-inch roof height above the desk (64 mm), down from 3.15 inches (80.055 mm). Its illustrative ball top is approximately 8.47 inches above the desk, down from 9.10 inches. The arcade button, original bar height, grip exposure, knob datum, foot width, and removable cover design are unchanged.

The [Ultimarc drawing](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/images/1/spintrakdiag.gif), linked from the [SpinTrak product page](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/), shows an axial chain of 28 + 15 + 16 mm below the fixed flange. That totals 2.32 inches (59 mm), including the rear shaft. The roof lies against the flange underside. Its thickness is already within this depth and must not be added again.

The proposed minimum adds 3 mm for the general bottom plate and 2 mm of mechanical clearance below the nominal device. It adds no aesthetic height or vertical wire-bend reserve. The existing centre cable groove leaves a thinner local plate; that extra clearance is not used to shrink the box. The checker conservatively reserves the full nominal 28 mm body diameter through the entire 59 mm depth because the rear shaft diameter is not separately labelled.

`panel_mount_box_concept.py --roof-to-ground-mm 64` raises the source lower shell and cover together before rebuilding the upper 20 mm and wider foot. It does not scale the geometry or shrink fasteners. `check_low_panel_box.py` compares actual exported STEP material against the retained previous panel study: the cover and lower features are identical after translation, and the upper roof/interface remain identical without translation. It also checks valid single solids, full device-depth clearance, shell/cover separation and the reserved under-roof tool space. The combined scene retains a shared Z=0 desk and moves every current disco actor down by the same height reduction.

The low scene is a nominal fit study. Actual printer tolerances, hardware fit, strength, and stability remain unverified. Previous designs and the unused lower candidate remain retained. The selected 64 mm proposal does not rely on the narrow cable groove for device clearance.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/panel_mount_box_concept.py \
  --selection /absolute/path/to/retained/selection.json \
  --output /absolute/path/to/fresh/low-box-output --roof-to-ground-mm 64
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_low_panel_box.py \
  --receipt /absolute/path/to/low-box-output/preview-receipt.json \
  --previous /absolute/path/to/previous-panel/preview-receipt.json \
  --output /absolute/path/to/fresh/check.json
```

## Visible spinner reference

`spinner_reference.py` adds the red knob, fixed body, encoder housing, and rear-shaft axis to both Disco ball and All controls. It reads the published axial chain from the hardware facts file. The housing diameter is a conservative body-width envelope, because the drawing does not separately dimension it. The rear shaft is a line with no assumed diameter. The knob uses the manufacturer's nominal large-knob diameter and the operator's approximate height and dome profile. These are display references, not replacement hardware or fabrication parts. A native check confirms that the shaft-axis tip is 59 mm below the flange datum.
