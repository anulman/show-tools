# Work on box mounts and the disco bar

The operator's 2026-11-01 instruction explicitly permits a separately labeled unvalidated preview while checks run. This applies to the new exposed-side-grip bar and panel-mount box study. The knob is allowed to protrude below the ball opening, and accessible side screws in that exposed region replace the former axial-only study assumption. The fixed shoulder below the rotating knob is operator-confirmed stationary; the stock nut clamps the roof from underneath. The operator clarified that approximately 3/32 inch, 2.38 mm, is the fixed flange's axial thickness, with no visible gap between its top and the knob underside. The earlier interpretation as a 2.38 mm gap is rejected. The old knob-to-nut adjustment range is not a clearance allowance. Do not present the historical hex-well/tab mount as the new panel interface.

`concept_preview.py` displays pinned STEP exports selected by the ignored `build/flared-side-grip/current.json`. Every new part is labeled `STUDY` and the previous C parts are labeled `HISTORICAL`. The preview cannot claim manufacturing or physical fit approval. Nominal assembled placements must identify the approximate measured flange thickness, zero-visible-gap interpretation and manufacturer nominal body/shoulder diameters separately from study parameters and actual fit. The requested wider foot adds 25.4 mm on each side of the existing box footprint. This is a footprint study, not a verified stability result. The target is five printed pieces: one integral original-height bar plus exposed grip extension, two identical shoes, the box shell and its unchanged removable cover. The separate cup and collar are removed; removal now releases the knob grip rather than retaining its preset adjustment. All prior files and admitted fabrication selections remain retained.

The operator does not require 100% filament infill. Preserve the column's hollow interior and concentrate structural material around the grip, shoe guides, nut pockets and nominal knob stop. A valid closed CAD solid is not a slicer infill specification. Printer, material, wall and infill settings remain unselected; solid checks do not prove strength.

The reported knob profile is approximately 7/8 inch of full-width height plus a 1/8-inch dome, about 1 inch overall. These are coarse observations, not tolerance bounds. The E22 study's shoe contact is 6 to 20 mm above the knob underside, within that reported full-width region. Dome-to-flat-stop contact is not verified by the ideal cylindrical socket probe.

The operator's next-publication instruction is to show only complete publication candidates after their dependent checks pass. Remove historical comparison assemblies from the visible scenes, but retain their source, exports and other old data. Do not substitute a fit coupon for a complete mount. Keep the current scene until a replacement is ready. The operator confirmed Darren's snug socket after superseding the larger diameter estimate; preserve that socket and complete the compact assembly checks before publication. This display choice does not authorize old-data cleanup or establish physical fit.

The specialized CAD sessions own separate source files and output directories. Use the [CAD desk](../../ui/cad/README.md) at <http://127.0.0.1:3940/> to select a workstream yourself. The coordinator maintains this publisher and the embedded OCP Viewer on port 3939. Workers perform headless work and do not publish or restart the viewer.

| Session | Codex thread | Source ownership |
| --- | --- | --- |
| box mount | `01a185db-2443-7682-af19-1d339492bfad` | `box_mount.py`, `box-mount/` |
| disco bar | `01a185db-74d7-7060-a11c-cce4e019ca21` | `disco_bar.py`, `disco-bar/` |
| mushroom mount | `01a1a420-2b7c-7981-93d6-9cd96a0e83d3` | `mushroom-mount/` |
| micro enclosure | `01a1a420-60e5-7db0-bd40-333b2130b6f7` | `micro-enclosure/` |

The coordinator owns `additional_controls.py`, `all_controls.py`, the desk UI, `workspace.py`, the `cad` launcher, this index, and viewer publication. Each worker uses its own Git worktree and commits verified milestones. The main session independently reviews integration before merging. Future sessions can resume these threads or use their committed source, notes, and validation receipts.

## Select a preview

Publish the box-mount concept:

```sh
hardware/cad/cad view box-mount
```

Prepare the [checked final-review pair](FINAL_REVIEW.md), then publish the original disco bar beside A, B, and complete C:

```sh
hardware/cad/cad view disco-bar --step '/absolute/path/to/Disco Ball.step'
```

To inspect the box interiors, add `--explode 25` to lower their bottoms by 25 mm. `cad box-check` exports the legacy box generator; the matching C rotor base uses the checked pair described in [FINAL_REVIEW.md](FINAL_REVIEW.md). Use `cad disco-check --step PATH` for private-reference inspection. `cad disco-check --concepts` exports legacy A, not new C. Headless checks never publish.

`SHOW_TOOLS_DISCO_STEP` can supply the local STEP path instead. The original attachment remains outside the repository. The publisher does not start the viewer or any hardware service. Switching workstreams or box variants selects an isometric view. Subsequent publishes of the same workstream retain the camera unless `--reset-camera` is supplied. Only the selected workstream changes the viewer; headless checks leave it alone.

See [integration verification](workspace-verification.md) for the actual export and browser observations.

The ignored `build/workspace/current-view.json` records the last successful publish, labels, source hashes, and private-reference hash where available. A successful publish does not establish visible browser delivery. Confirm the displayed labels or send a Scrawl. If a sleeping page misses publication, reload it and publish again.

## Continue the box mount

The operator-requested clean arcade delivery now uses the [two-part arcade recipe](box-mount/access/ARCADE_TWO_PART.md): shell and bottom only, with no internal ballast structures or capsule hardware. Its print ZIP contains exactly two grounded STLs. Original inclined interfaces and both wire/tiedown routes remain; prior four-part exports are preserved history.

For the current C mounting box, use the [air-gap design and print package](AIR_GAP_DISCO.md). Its four prints are the shell, blank bottom and two hex keepers. It has no bearing support, PTFE sheet, height cap or ballast compartment. The default bar root is 5 mm above the roof; a 7 mm setting uses the existing knob adjustment. Bottom-off service holds the ball by hand and exchanges ordinary keys sequentially. The bearing-supported [previous base](box-mount/access/C_MOUNT_NO_BALLAST.md), marked-bottom and C2 candidates remain history. The inclined arcade box is a separate workstream.

The older multi-variant generator offers `arcade-inclined`, `rotor-level`, and `mushroom-level` studies. Their dimensions and ballast discussion below are historical, not the current print package. The old flat Adafruit-button study is historical. Use `cad view box-mount --variant arcade-inclined` to inspect one variant, or omit `--variant` to compare all three.

The inclined arcade mount must provide at least 2.5 inches, exactly 63.5 mm, from the counterbore floor along the tilted button's centre axis. The operator confirmed both the starting datum and direction. The low edge need not provide that full length. The current concept keeps a flat bottom and provides an unobstructed proposed corridor around the centre axis; it does not claim measured clearance for the actual harness. Its 17.5 mm recess and 5-degree inclination remain in place. The removable bottom extends outward below the interior floor.

The level rotor concept uses the SpinTrak manufacturer's drawing as a nominal reference. Its 34 mm across-flats hex pocket and 5 mm depth are illustrative design inputs, not verified dimensions read from that drawing. The 29 mm body passage includes a proposed 1 mm diametral allowance over the published 28 mm nominal. Its mounting fit remains unverified. The mushroom variant is an uncut housing blank while wiring and mounting details are tested. The proposed level roofs align with the low edge of the inclined arcade roof, and all exterior bottoms share the same ground plane. The incline lifts the arcade roof above that shared level. The operator confirmed this roof alignment.

All three retain proposed removable screw-fastened bottoms, wiring passages, and a separate ballast compartment. Fasteners, wire dimensions, and ballast remain subject to physical fit checks. See [box-mount notes](box-mount/README.md) for exact parameters and validation commands.

## Continue the disco bar

The Disco bar page shows the admitted air-gap box with its unchanged reduced C bar and collar. Use the [air-gap package](AIR_GAP_DISCO.md) and [serial-key mechanism guide](disco-bar/AIRGAP_C.md). Every detachable coupling component is installed and removed after the bare bar is glued inside the ball. A normal locked assembly has no rotor-to-box contact or retaining joint. The operator may lift the box and remove its bottom for service; allow 180 mm underneath for the ordinary long keys. The ball is hand-held during unclamped service. Physical grip, spindle load capacity, handling and fit remain unverified.

The earlier A/B concepts, C1/C2/C3 comparison, captive-pin proposal and bearing-supported reduced C remain historical. Their assembly instructions and PTFE-rest workflow do not describe the air-gap version. Old source and exports remain preserved.

Inspect the [disco-bar notes](disco-bar/README.md) before designing a coupling. The supplied STEP describes the full bar inside the disco ball, rather than the spherical shell. Its full height reaches the top attachment. The STL and OBJ use coordinate magnitudes that differ from the STEP, so raw mesh coordinates must not be treated as millimetres. Use the STEP for the preview and preserve source units.

The operator confirmed that the full bar height reaches its top attachment and the width was precisely measured to fit the disco-ball opening. Only axial access is available once installed. The active **Disco bar** tab shows the current publication candidate; the original bar and prior comparisons remain available as historical files. Failed intermediate concepts remain headless historical studies. B's holding and access remain unverified. A's export has four printed pieces in the legacy `c` directory; new C uses the selected final-review receipt. Offsets are for comparison only. Full bodies remain visible; no crop replaces their functional length.

The released knob opening uses the original snug pocket dimensions, floor, and entry bevel. Pads are recessed outward to preserve insertion clearance. The full end region and material outside explicitly bounded clamp edits remain protected. All printed parts and hardware envelopes must remain inside the original insertion profile. Future actuators must be reachable axially with the knob in place. Side-access mechanisms are unsuitable for the installed assembly.

The previous three short clamp studies omitted the functional height, and B and C exceeded the source outer profile. They are historical mechanism studies, not replacement bars. The full-height variants must be evaluated as complete assemblies, including their connection to the retained bar and top attachment.

Knob dimensions, ball mass, shell material, assembly access, and load support are required before a fitted coupling. Separate the job of transmitting torque from carrying the ball's weight and side loads. The operator's hot-glued bar is a design candidate, not a verified load-bearing assembly. Run `disco-bar/check_full_bar.py --step PATH` with the CAD Python environment to verify the restored preview and reject the historical crop and display offset.

## Validate before manufacturing

A repeatable receipt must identify the exact parameters, source hashes, units, and exported parts. State each check's limits rather than treating all successful checks as print approval.

| Stage | Evidence required |
| --- | --- |
| Solid and export integrity | Valid positive-volume solids, STEP round trips, watertight and consistently wound STL meshes, matching volumes |
| Assembly geometry | Checked lid, channel, screw, nut, and ballast clearances; retained mating datums; independent moving-part envelopes |
| Printer preparation | Selected printer, nozzle, material, orientation, fit allowances, slicer review, and support/removal access |
| Physical fit | Fit coupons and assembled hardware tests with the real connectors, fasteners, knob, and shell |
| Mechanical function | Stability, ballast retention, screw cycling, slip, runout, and load-support tests appropriate to the selected design |

Geometry predicates and dimensional constraints can be checked by code. They do not prove print strength, adhesive bonding, friction capacity, or encoder load capacity. A concept with missing measurements or printer settings remains unapproved for manufacturing even when its mesh is valid.

## Current five-piece print proposal

See [FIVE-PART-PRINT.md](FIVE-PART-PRINT.md) for the current four-file/five-piece export and offline reference checks. This separate admission path preserves the retired packet validators. The proposed bar print is tilted 45° with build-plate-only supports to avoid trapped material in its sealed cavity. The human ZIP includes fabrication STLs only; source pins and validation reports remain separate. This prepares a printer-review proposal and does not approve unknown equipment, printed fits or strength.

## Additional control enclosures

The Mushroom mount and Micro enclosure pages load each specialist's `scene.load()` result through `additional_controls.py`. Scenes return native millimetre geometry, labels, colours, opacity, and provenance. Their assembled bottoms share Z=0. The combined page preserves vertical placement and places the additional controls behind the arcade and disco assemblies, leaving 40 mm between their bounding boxes.

The micro enclosure depends on the installed PCB and mounting-feet dimensions. Its `missing_measurements()` result blocks fitted geometry when those facts are unavailable. The combined view records the missing values and continues showing the controls that have complete geometry. A missing dimension never supplies an assumed board or foot size. Selecting the micro page reports the required measurements and preserves the last published model.
