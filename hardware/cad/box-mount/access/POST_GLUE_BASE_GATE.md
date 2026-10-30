# Post-glue coupling: independent compact-base gate

The old C2 coupling is rejected under the operator's post-glue lifecycle requirement. Its historical geometry results cannot admit a replacement. This gate proves compatibility with the exact frozen compact base (`29b85bff…`), and explicitly leaves coupling assembly, capture and reversibility to the independent mechanism checker and exhaustive lifecycle model.

Start with only the printed bare bar permanently glued inside the ball. Every other component begins outside the opening. Every coupling attachment and its reverse must work through that axial opening after glue. There is no hidden preinstalled receiver, nut, washer or insert. Additional permanent glue would prevent a return to the bare-bar state. Box/hex work can occur outside the ball before the cup is attached; radial grip work requires the affected cup assembly outside the ball. No new bar-to-box retaining joint is allowed.

## Analytic unlimited rotation

For an actual moving set `M`, the gate constructs an axisymmetric envelope `E`, proves `M ⊆ E` by native Boolean difference, and proves `E ∩ F` empty against actual stationary base geometry `F`. Since `Rθ(E) = E`, it follows that `Rθ(M) ∩ F` is empty for every real angle and arbitrary revolutions. No angular samples establish this result.

The conservative admissible bands in box coordinates are:

| Box Z | Radius |
| --- | --- |
| −12.5 to 0 mm | 33 to 43.5 mm |
| 0 to 3.5 mm | 33.5 to 43.5 mm |
| 3.5 mm to passive contact height | 30 to 43.5 mm |
| At/above passive contact height | Finite cylinder automatically enclosing the actual moving solids |

The well floor is Z −13. The lower band leaves 0.5 mm to that floor and the island/well walls. The widened region above Z3.5 accommodates a flange above the 3 mm keepers while preserving 0.5 mm vertical separation. The upper region is clear because every fixed base solid lies at or below the contact plane. Only explicitly named passive bar/PTFE bearing faces may touch at that plane. The envelope is sufficient, not a claim that every point outside it collides. A rejected containment requires a tighter independently proved envelope or revised geometry; it must not be converted to a sampled-angle pass.

The actual eight installed base STEP/STL records and optional shim are hash-checked. The 24 standard hardware solids derive from the exact pinned Joint recipe and are checked against the actual installed pieces. Nominal stock/cable/ballast keepouts and cubes participate too. All rotating coupling hardware and the full glued bar must appear in the moving inventory. The bar is immutable for lifecycle attachment purposes but still rotates in world coordinates. Every partial state in which whole-assembly indexing is permitted needs its own rotary certificate and independent capture/co-rotation evidence.

New comparisons use native `BRepAlgoAPI_Common`/`Cut`. Each requires completed operation, non-null result, valid input/output topology and finite nonnegative volume. Exceptions never become empty space. The requested fuzzy value is zero; the installed OCCT kernel reads back its intrinsic 1e-7 mm confusion floor. That effective tolerance is reported explicitly. Residual/intersection volume tolerance is 1e-6 mm³. This is a CAD-model certificate, not physical fit or strength approval.

## Frames and ports

Candidate records declaring native adaptive closed-volume integration are independently recomputed with `BRepGProp.VolumeProperties` at Eps 1e-10 and error bound 1e-8. Receipt agreement remains relative tolerance 1e-6; STEP/STL volume agreement remains 0.5% and bounding-box agreement 0.05 mm. Unknown mass methods fail. The frozen base loader remains unchanged.

Original source Z is negative inside the bar/ball. X180 makes the assembly upright. The frozen base then uses service Z rotation −90 degrees.

| Station | Canonical upright angle | Installed box angle | Radius |
| --- | --- | --- | --- |
| Small lock station | 225° | 135° | 38 mm |
| Drive locked endpoint | 45° | 315° | 38.5 mm |
| Drive released endpoint | 135° | 45° | 38.5 mm |

The right curved slot admits the drive quarter arc from −45 to +45 degrees in installed coordinates. The small lock path is rear-left. A canonical 225-degree target must not be treated as an installed 225-degree hole. `service_index` computes a whole-assembly rotation to align each actual source actuator with a selected station. Several actuators may use one port successively. All affected rotating parts move coherently; withdraw tools before indexing unless an actual simultaneous sweep has been proved.

`gap_mm` always selects the stationary base configuration (5 or 7). It is separate from the physical bar-mouth height. A source cup shifted +2 with bar mouth at `gap+2` stays fixed in world; a cup shifted +50 and mouth at `gap+50` is outside the ball while still fixed over the knob. Exported stage angles are already baked into the solids and must not be applied twice.

For time-varying coupled transforms, compose each instantaneous physical transform before taking the swept union. Unioning source poses and then applying one arbitrary mouth height loses that correlation. Use actual box-frame tool sweeps for those actions.

## Reusable APIs

`post_glue_base_gate.py` provides:

- `load_base(path)`: only the exact frozen base receipt and complete source inventory are accepted.
- `bind_input(data, name, path)`: snapshot input bytes before parsing. The caller also verifies the complete producer source inventory against its immutable revision.
- `load_records(data, records, expected_names)`: verify exact actor/tool inventory and paired artifacts, normalizing imported single-solid compounds. Expected names come from the complete lifecycle/geometry registry, including hardware.
- `check_rotor(data, named_box_solids, base_gap)`: include the full bar and every co-rotating solid. It proves base clearance for every angle conditional on actual co-rotation.
- `service_index(source_target_point, port)`: compute the whole-rotor Z index. This does not move only the actuator.
- `check_operation(data, operation, source_sweeps)`: one fixed source reference, explicit `mouth_z_mm`, source axes and `approach_source`. Root entry points toward source −Z.
- `check_box_operation(data, operation, box_sweeps)`: actual physical box sweeps, box axes and `approach_box`; declare `bar_mouth_z_range_mm`. Root entry points toward box +Z. No shape transform is applied.
- `freeze_report(data, report, fresh_directory)`: reject an existing file/directory/symlink namespace, recheck all inputs and sources, write exclusively, recheck the proof bytes, and attach authoritative gate provenance. Failed written evidence is retained under an INVALID name.

Both operation APIs require a standard named tool/catalog part, action ID, `gap_mm`, whole-assembly `service_index_degrees`, `access` (`root` or `external-module`), and target/tool axes containing `point`, `direction`, and `AF_mm`. Axis lines and AF must match. The sweep argument is a dictionary with exactly three nonempty phases: `entry`, `operation`, `withdrawal`; each contains named actual whole-tool solids. One shaft or engaged endpoint cannot replace them. Invoke for every working and reaction tool. The mechanism checker separately proves working-end engagement, tool-to-tool clearance, actual bar/aperture clearance, retained hardware and full forward/reverse motion. External-module access also needs lifecycle proof that the complete affected module is outside the ball.

The proposed service lift remains 180 mm. Each tool sweep must clear the actual complete base and that lowered table plane. The ordinary-tool name registry matches the lifecycle verifier; a catalog label alone does not establish the tool geometry. No custom fork/spanner is admitted by relabeling a printed part.

## Commands and negative controls

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_post_glue_base_gate.py \
  --base-receipt "$COMPACT_V4_RECEIPT" --source-worktree "$SOURCE_WORKTREE"
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/post_glue_base_gate.py \
  --base-receipt "$COMPACT_V4_RECEIPT" --source-worktree "$SOURCE_WORKTREE" \
  --output /tmp/NEW-base-envelope-proof
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_post_glue_candidate_base.py \
  --base-receipt "$COMPACT_V4_RECEIPT" --candidate-receipt "$NEW_POST_GLUE_RECEIPT" \
  --source-worktree "$SOURCE_WORKTREE" --output /tmp/NEW-candidate-rotation-proof
```

Every output namespace must be fresh. The candidate CLI uses a trusted concept registry: A/B require exactly eight producer sources and undo the cup's declared stage rotation; C requires those eight plus `post_glue_cassette.py` and keeps the cup's angle fixed while the collar rotates. It verifies actual stage exports, complete equal stage inventories, full bar height and the cup's shift/angle cancellation. It checks every exported stage at both base heights with source mouth `gap+shift`. Inventory completeness against physical design, co-rotation/capture and lifecycle admission remain separate requirements; positive base geometry must not silently promote those flags.

Negative controls include a fin clear at 0/180 degrees that hits a real keeper at 90; below-floor rotary material; omitted hardware/tool inventory; wrong canonical/service frame; side or custom tool; absent withdrawal phase; mismatched axis/AF; +2/+50 source/world translations; native operation failure/null/invalid topology; existing proof namespaces; changed input bytes; and a proof modified during writing. The old C2 lifecycle stays REJECTED in the reference report. New coupling lifecycles stay NOT_EVALUATED until the separate full checks pass. No model geometry, old export, viewer or service is changed by this work.
