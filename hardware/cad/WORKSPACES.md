# Work on box mounts and the disco bar

The two long-lived CAD sessions own separate source files and output directories. The CAD coordination session selects which workstream appears in the existing OCP Viewer at <http://127.0.0.1:3939/viewer>. Workers perform headless work and do not publish or restart the viewer.

| Session | Codex thread | Source ownership |
| --- | --- | --- |
| box mount | `01a185db-2443-7682-af19-1d339492bfad` | `box_mount.py`, `box-mount/` |
| disco bar | `01a185db-74d7-7060-a11c-cce4e019ca21` | `disco_bar.py`, `disco-bar/` |

The coordinator owns `workspace.py`, the `cad` launcher, this index, and viewer publication. Each worker uses its own Git worktree and commits verified milestones. The main session independently reviews integration before merging. Future sessions can resume these threads or use their committed source, notes, and validation receipts.

## Select a preview

Publish the box-mount concept:

```sh
hardware/cad/cad view box-mount
```

Publish Darren's local STEP reference:

```sh
hardware/cad/cad view disco-bar --step '/absolute/path/to/Disco Ball.step'
```

To inspect the box interiors, add `--explode 25` to lower their bottoms by 25 mm. Use `cad box-check` for headless box exports and `cad disco-check --step PATH` for private-reference inspection.

`SHOW_TOOLS_DISCO_STEP` can supply the local STEP path instead. The original attachment remains outside the repository. The publisher does not start the viewer or any hardware service. Switching workstreams selects an isometric view. Subsequent publishes of the same workstream retain the camera unless `--reset-camera` is supplied. Only the selected workstream changes the viewer; headless checks leave it alone.

See [integration verification](workspace-verification.md) for the actual export and browser observations.

The ignored `build/workspace/current-view.json` records the last successful publish, labels, source hashes, and private-reference hash where available. A successful publish does not establish visible browser delivery. Confirm the displayed labels or send a Scrawl. If a sleeping page misses publication, reload it and publish again.

## Continue the box mount

The active forms are the flat red A and 5-degree blue C from the [counterbored concepts](BASE-CONCEPTS.md). Preserve the button's seating datum, the initial 35.25 mm interior depth below it, and the 17.5 mm recess unless the operator changes them. Those dimensions come from reference geometry and the operator's requested proportions. They do not establish installed harness clearance. The interior floor stays at Z=-35.25 mm. The proposed 3 mm bottom extends outward to Z=-38.25 mm so it does not consume that interior reserve.

The next design includes wiring passages, removable screw-fastened bottoms, and retained ballast. Fastener geometry, wire exit, and ballast dimensions are proposals until confirmed against the actual parts. Keep ballast separate from the electrical volume and accessible through the removable bottom. See [box-mount notes](box-mount/README.md) for parameters and outstanding measurements.

## Continue the disco bar

Inspect the [disco-bar notes](disco-bar/README.md) before designing a coupling. The supplied STEP describes cylindrical attachment geometry, not an identified spherical shell. Its purpose requires confirmation. The STL and OBJ use coordinate magnitudes that differ from the STEP, so raw mesh coordinates must not be treated as millimetres. Use the STEP for the initial preview and preserve source units.

Knob dimensions, ball mass, shell material, assembly access, and load support are required before a fitted coupling. Separate the job of transmitting torque from carrying the ball's weight and side loads. The operator's hot-glued bar is a design candidate, not a verified load-bearing assembly.

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
