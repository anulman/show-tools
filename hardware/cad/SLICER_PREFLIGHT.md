# Disco FDM slicer preflight

Bambu Studio 02.08.02.61 is installed. The supplied photo shows a Bambu Cool Plate for filament printing. It does not identify the printer model, nozzle, filament or the final printing process. The operator authorized preliminary checks while those facts remain unknown.

Bambu Studio is an external tool under the copyleft [GNU Affero General Public License, version 3](https://github.com/bambulab/BambuStudio/blob/master/LICENSE). Its source and binary are not vendored in this repository.

Sixteen offline slices completed successfully: eight designs in their exported poses with supports off, then eight proposed printing poses with supports where indicated below. Six baseline slices reported floating cantilevers. None of the eight proposed slices reported that warning. This result establishes that the reference slicer can generate toolpaths, not that the parts are ready for fabrication.

The reference settings are Bambu Lab X1 Carbon, 0.4 mm nozzle, Generic PLA and 0.20 mm Standard @BBL X1C. The preset uses two walls and 15% infill. These are comparison settings, not strength or material recommendations. No printer was connected and no print was submitted.

| Design | Quantity | Baseline cantilever warning | Proposed pose | Reference supports |
| --- | ---: | --- | --- | --- |
| Box shell | 1 | Yes | Roof down, open bottom up | Automatic |
| Box bottom | 1 | No | Exterior flat face down | Off |
| Hex keeper | 2 | Yes | Head-counterbore face down, small nose up | Off |
| Disco bar | 1 | Yes | Open root up | Automatic |
| Knob cup | 1 | Yes | Blind floor down, socket up | Automatic |
| Grip shoe | 2 | No | Broad outer back down, recessed pad seat up | Off |
| Collar A | 1 | Yes | Original pose, blind tool socket up | Automatic |
| Collar B with cover | 1 | Yes | Cover down | Automatic |

The comparisons changed printing poses and support settings together. They do not isolate the effect of either change. Automatic supports can still be difficult to remove. In particular, the upright bar contains internal supports. Support marks in its snug socket, collar races, nut registers or tool sockets can prevent assembly. The flipped shell also has an annular floor that closes above a cavity. A warning-free slice does not prove that these surfaces print cleanly.

The selected-layer toolpath plot is a partial inspection aid. It is not a complete native layer-preview review or proof that every support can be removed. Native GUI layer review was not completed. The saved project archives were checked directly instead.

## Verified artifact properties

The inch-coordinate archive was revalidated against the admitted millimetre source. Its geometry was restored to physical millimetres for the slicer. STL carries no standard unit field; the editable 3MF project explicitly declares millimetres. The bar remains 4.3 inches tall. No CAD geometry or fastener specification changed.

The checker compares every triangle of the staged printing meshes against the source after the stated rigid pose. It also compares the actual meshes stored in all sixteen sliced projects and the combined review project against those staged meshes. It follows the referenced external mesh IDs and composes component and build transforms. Only rigid XY arrangement is allowed beyond the stated printing pose. Scaling, tilt, changed Z placement, unexpected components and mismatched inventory reject. Both the root project and referenced mesh files must declare millimetres. Bambu reported zero mesh repairs. The combined project has eight designs and ten print instances, including two keepers and two shoes. Its archive contains no G-code.

Seventeen negative controls use the real saved projects and result receipts. They cover added G-code, a missing instance, wrong units, a reported mesh repair, an edited vertex, build scaling, component scaling, tilt, off-bed placement, extra or missing components, wrong external-mesh units, non-printable or negative parts, a different design in a comparison slot, divergent archived G-code and a cleared result warning. Each slice slot is bound to its canonical source design, quantity and pose. The inspected standalone G-code must match the G-code stored in its project byte for byte. The result must match the captured run snapshot, log hash and design identity. These checks establish artifact integrity. They do not measure printer accuracy or mechanical performance.

## Remaining fabrication decisions

Darren must confirm the actual printer, nozzle, build plate and filament before choosing a production profile. The earlier resin-specific material instructions are not an FDM release. If Darren uses resin instead, the FDM slicing results do not validate that process.

Physical trials must check the original snug socket, hardware seats, tool access, collar travel and full reverse disassembly after support cleanup. The current geometry includes a nominal released-turn clearance as small as 0.1 mm and a conservative rotating-to-box clearance of about 0.255 mm. Neither is a printer tolerance allowance. The M3 nut pockets provide only 0.15 mm per flat beyond a nominal 5.5 mm nut. Elephant foot and support scars matter here. Global scaling would change several different fits together and is not a verified remedy.

The upright bar, collar lugs and screw seats also need material and layer-strength review. A successful PLA slice does not establish grip, creep resistance, spinner load capacity, pull-apart strength or adhesive compatibility. The prototype must allow every coupling part to be installed and removed after the bare bar is glued inside the ball. A fit trial must simulate that restricted access. It must not rely on coupling hardware installed before gluing.

## Reproduce the reference checks

Use the installed CAD Python and Bambu Studio with an admitted inch packet and a fresh output directory:

```sh
OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 /absolute/path/to/cad/python hardware/cad/slicer_preflight.py /absolute/path/to/inch-packet /absolute/path/to/new-preflight
```

The command runs both sets of eight slices, generates an unsliced layout, and checks the actual archives and effective G-code settings. The source slicer binary and bundled preset files are pinned by SHA-256. Recheck existing output with the same command and `--check-existing`. That mode revalidates the packet, composed project geometry, quantities, effective settings and seventeen negative controls without slicing again.

The `review/DISCO-PRELIMINARY-REVIEW-NOT-FOR-PRINT.3mf` file is an editable orientation and quantity layout. It has global automatic supports enabled. It does not reproduce the per-part support switches in the comparison table. Select the actual printer and review supports per object before slicing it for fabrication. The sixteen reference jobs under `analysis-only/` are diagnostic outputs, not printer handoffs. Keep the original eight-file STL fabrication archive unchanged.
