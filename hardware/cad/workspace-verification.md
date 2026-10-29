# CAD workstream integration verification

The initial integration uses the existing pinned CAD environment and running localhost viewer. Neither worker starts or contacts the viewer. The coordinator's `workspace.py` is the publisher for both workstreams.

The coordinator independently ran `cad box-check` through the Python entry point with output under `/private/tmp/box-coordinator-check`. Four parts passed solid validity, STEP and STL round trips, and assembly constraints. The box workstream's receipt retains `print_readiness: NOT_READY` and its unmet physical and printer gates. An offline rendering of exported interior views was inspected for the wire passage, screw pockets, ballast compartment, and removable bottoms.

The coordinator independently imported Darren's original STEP through `disco_bar.py`. It remained one valid positive-volume solid, in millimetres. The worker's full mesh-comparison receipt and offline render were inspected. Neither private attachments nor their derived geometry are included in Git. Mesh scale comparisons are sampled evidence, not full equivalence proofs.

`cad view disco-bar --step PATH` published the private reference to the existing server. Native Vivaldi interaction selected its existing OCP Viewer tab, and the reference label and cylindrical geometry were visible. A missing private path produced a clear CLI error with exit code 2 and did not change the preview.

`cad view box-mount --explode 25` publishes the two square mounts, with bottoms lowered 25 mm for inspection. The ignored current-view receipt records the selected workspace, source hashes, labels, and camera choice. Switching workstreams resets the view; subsequent publishes keep the camera unless requested otherwise. Vivaldi displayed both labelled shells, both lowered bottoms, and the separate red and blue button references. The wire passages, fastener pockets, and ballast compartments were visible through the translucent shells. Publication and visible delivery do not establish physical fit or print approval.

No USB IO, printer jobs, Sheets, Chrome CDP, or audio processes were started or changed. No adhesive, friction, strength, stability, or measured hardware fit has been tested.

`bash -n hardware/cad/cad`, local guide-link checks, and `git diff --check` passed.
