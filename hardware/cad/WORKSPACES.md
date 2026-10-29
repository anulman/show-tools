# Work on box mounts and the disco bar

The two long-lived CAD sessions own separate source files and output directories. Use the [CAD desk](../../ui/cad/README.md) at <http://127.0.0.1:3940/> to select a workstream yourself. The coordinator maintains this publisher and the embedded OCP Viewer on port 3939. Workers perform headless work and do not publish or restart the viewer.

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

Publish the complete original disco bar from Darren's local STEP:

```sh
hardware/cad/cad view disco-bar --step '/absolute/path/to/Disco Ball.step'
```

To inspect the box interiors, add `--explode 25` to lower their bottoms by 25 mm. Use `cad box-check` for headless box exports and `cad disco-check --step PATH` for private-reference inspection. Use `cad disco-check --concepts hardware/cad/build/disco-clamps` to export and check the proposed clamp parts without publishing.

`SHOW_TOOLS_DISCO_STEP` can supply the local STEP path instead. The original attachment remains outside the repository. The publisher does not start the viewer or any hardware service. Switching workstreams or box variants selects an isometric view. Subsequent publishes of the same workstream retain the camera unless `--reset-camera` is supplied. Only the selected workstream changes the viewer; headless checks leave it alone.

See [integration verification](workspace-verification.md) for the actual export and browser observations.

The ignored `build/workspace/current-view.json` records the last successful publish, labels, source hashes, and private-reference hash where available. A successful publish does not establish visible browser delivery. Confirm the displayed labels or send a Scrawl. If a sleeping page misses publication, reload it and publish again.

## Continue the box mount

The active variants are now `arcade-inclined`, `rotor-level`, and `mushroom-level`. The old flat Adafruit-button study is historical. Use `cad view box-mount --variant arcade-inclined` to inspect one variant, or omit `--variant` to compare all three.

The inclined arcade mount must provide at least 2.5 inches, exactly 63.5 mm, from the counterbore floor along the tilted button's centre axis. The operator confirmed both the starting datum and direction. The low edge need not provide that full length. The current concept keeps a flat bottom and provides an unobstructed proposed corridor around the centre axis; it does not claim measured clearance for the actual harness. Its 17.5 mm recess and 5-degree inclination remain in place. The removable bottom extends outward below the interior floor.

The level rotor concept uses the SpinTrak manufacturer's drawing as a nominal reference. Its 34 mm across-flats hex pocket and 5 mm depth are illustrative design inputs, not verified dimensions read from that drawing. The 29 mm body passage includes a proposed 1 mm diametral allowance over the published 28 mm nominal. Its mounting fit remains unverified. The mushroom variant is an uncut housing blank while wiring and mounting details are tested. The proposed level roofs align with the low edge of the inclined arcade roof, and all exterior bottoms share the same ground plane. The incline lifts the arcade roof above that shared level. The operator confirmed this roof alignment.

All three retain proposed removable screw-fastened bottoms, wiring passages, and a separate ballast compartment. Fasteners, wire dimensions, and ballast remain subject to physical fit checks. See [box-mount notes](box-mount/README.md) for exact parameters and validation commands.

## Continue the disco bar

Inspect the [disco-bar notes](disco-bar/README.md) before designing a coupling. The supplied STEP describes the full bar inside the disco ball, rather than the spherical shell. Its full height reaches the top attachment. The STL and OBJ use coordinate magnitudes that differ from the STEP, so raw mesh coordinates must not be treated as millimetres. Use the STEP for the preview and preserve source units.

The operator confirmed that the full bar height reaches its top attachment and the width was precisely measured to fit the disco-ball opening. The **Disco bar** tab shows that complete original bar in its original pose. Preserve its full insertion profile and attachment geometry. The previous three short clamp studies omitted this functional height, and B and C exceeded the source outer profile. They are historical headless studies only, not replacement bars. Future screw-clamp variants must fit within the confirmed constraints and preserve a continuous connection to the top attachment.

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
