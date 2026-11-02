# Five-piece disco print proposal

The current packet contains four inch-coordinate STL files: one integral bar/grip, two identical shoes, one 64 mm roof-height mounting shell, and one unchanged cover. The ZIP contains only the four fabrication files. Hardware and printer notes stay outside it. The spinner and ball references, pads, and metal hardware are excluded.

Use `five_part_print.py` for this proposal. The older `disco_inches.py` and `slicer_preflight.check()` deliberately admit the retired eight-file/ten-piece packet; their inventory gates remain unchanged. The new exporter admits the pinned current scene and exact component receipts, verifies the identical shoes, and retessellates their canonical STEP files independently when checking the archive. Inch meshes round-trip at exactly 25.4 mm per inch. Slicer-input meshes must independently match those same canonical posed parts.

The bar has a sealed cavity. Upright automatic supports were rejected because actual support paths entered that cavity. The proposed bar orientation is 45° from vertical, with build-plate-only supports. The shoe rests on its broad flat back: the corrected pose has approximately 348 mm² of planar bed contact; the rejected reverse pose had only 40 mm² at two tabs. The shell roof faces the bed and the cover remains flat. These are rigid print-pose changes, not CAD material changes.

The offline reference uses the installed Bambu Studio with its X1 Carbon / 0.4 mm nozzle / 0.2 mm Standard / Generic PLA profiles. Neither printer nor material is assumed to be the operator's equipment. Every run binds its actual project mesh, G-code, source mesh and effective settings. `check_print_support_cavity.py` checks actual positive-extrusion support centreline edges against the native closed cavity, including the captured extruder offset between G-code and material coordinates. Its successful proposed run processes every candidate edge. An actual unsafe upright slice supplies the rejection control. This is not a deposited-bead-volume, measured unsupported-span, strength, or physical-fit proof.

`check_five_part_hardware.py` checks the grip's standard M3 flat-point set-screw length range and maximum/minimum nut envelopes. The separate cover audit checks actual retained joints, button-head screws, nuts, insertion paths and ordinary keys. Both bind the same current component sources. Hardware fit after printing and torque/grip capacity remain physical checks.

## Run

Use the isolated CAD Python at `~/.local/share/show-tools/cad/venv/bin/python`. New output directories preserve previously issued evidence.

```sh
python hardware/cad/five_part_print.py prepare /absolute/fresh/preflight
python hardware/cad/five_part_print.py slice /absolute/fresh/preflight --variant as-exported
python hardware/cad/five_part_print.py slice /absolute/fresh/preflight --variant candidate
python hardware/cad/five_part_print.py check-slices /absolute/fresh/preflight
```

The cavity checker requires the canonical grip receipt, prepared bar mesh, resulting 3MF, result JSON, G-code, and source-frame X rotation of 135°. Supply those paths through its named CLI arguments. A support or cavity-boundary intersection returns a failure status. `--stop-after-witness` can shorten an unsafe negative-control run; a passing run must process every candidate.

```sh
python hardware/cad/five_part_print.py release /absolute/fresh/preflight \
  --guard /absolute/final/cavity/receipt.json \
  --negative /absolute/unsafe/upright/receipt.json \
  --cover-hardware /absolute/cover-audit.json \
  --grip-hardware /absolute/grip-audit.json \
  --delivery /absolute/fresh/handoff
```

Release checks the exact source ZIP, eight complete reference runs, effective support policy, native support guard, unsafe upright control, hardware audits, unit/pose/inventory controls and shoe bed contact. It prepares a **printer-review proposal**, never production approval. The handoff consists of an STL-only ZIP plus a short text note. Actual printer/material settings, support removal, printed fits, bonding, grip strength and stability remain for printer/operator confirmation. A resin process needs separate cavity drainage and venting review.
