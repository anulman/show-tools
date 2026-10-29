# Actual C1 export integration findings

This follow-up checks actual paired STEP/STL files from the first private C1 prototype. Its producer source is pinned to a Git commit, independent of later edits to the worker checkout. The files remain private local artifacts. The existing box generator and published previews are unchanged.

## What the artifact check establishes

The C1 review covered 138 component, contact-patch, and clearance-probe records across seven posed states. The consumer checked all 276 file hashes, valid single-solid STEP geometry, watertight and consistently wound STL meshes, matching volumes, and matching source-frame bounds. The producer's recorded source hashes matched its immutable source revision.

Clearance uses the actual STEP solid. Paired STL volume agreement within 0.5% and bounds agreement within 0.05 mm describe export integrity, not physical fit or printer compensation. No exact triangle-mesh collision claim is made.

Imported STEP assembly compounds must be normalized to their sole solid before rotation or translation. Otherwise their retained child locations can hide Boolean intersections. The regression fixture places an imported component inside a roof and requires the complete 64 mm3 intersection. A changed STL must also invalidate cached geometry and the final receipt.

## Closed rotation clears the compact keepers

The initial keepers at Y=±36 mm collided with C1's carrier tower and safety key at normal rotation angles 135 and 315 degrees. The compact tabs end inside radius 33 mm and put their screws at Y=±28 mm. They retain the proposed 3 mm thickness and 9 mm mouth spacing.

Every closed C1 component clears a rotation-invariant cylinder containing the keepers and their hardware, clears the stationary spacer/buffer annulus, and stays above the roof. Those separations establish continuous 360-degree closed rotation for this actual artifact set. They do not establish a working unlock or lift path.

## Actual bar contact is interrupted

The two supplied actual planar contact patches total 579.9845 mm2. The proposed annulus has area 695.0774 mm2, so the patches cover about 83.4417% of it. Both complete patches fit the buffer. The spacer geometrically backs the buffer's underside, including the selected roof-port option.

The separate original-source probe measures finite slices and sampled angular gaps. Its approximately 84.6914% coverage at source Z=-0.05 mm is a different quantity from the actual planar patch area. Neither value establishes safe load, buffer capture, drag, wear, or acceptable unsupported spans.

## Three box-access comparisons

| Candidate | Actual posed components | Supplied temporary control probes with bottom removed | Table-contact entry |
| --- | --- | --- | --- |
| Unported nominal box | Removed safety key intersects the roof | Roof, cable groove, and ballast region block probes | Blocked |
| Roof ports at service index 0 degrees | Posed states clear the box | Cable groove and ballast region still block probes | Blocked |
| Roof ports at index 45 degrees, shortened rear ballast pocket | Posed states clear the box | Supplied probes clear the open box | Blocked |

The third candidate keeps a connected roof and preserves the complete central mounting/keeper region and the spacer-support region. Keeper fastener reactions are rechecked after port cutting. Its proposed ballast tray is 76 by 20 mm at Y=42 mm, giving an interior of 72 by 16 by 8 mm. That reduces raw pocket volume from 13.824 to 9.216 cm3. No target mass or stability requirement is satisfied merely by this fit.

The ports establish clearance for the supplied temporary probes. They do not establish engagement with the key or collar, hand access, a safe reaction surface, or a support/access procedure. All three candidates still intersect a table-contact plane with those finite underside probes. No lifting or tipping workflow is assumed.

## Clear endpoints do not establish removal

The consumer compares the actual released and detached component files. Boolean material equality identifies nine stationary pieces and ten pieces moving together by source Z=-35 mm. Intermediate witness poses at 4 through 8 mm of that motion expose the carrier housing intersecting the preset baseplate flange. Clear start and end poses therefore do not establish C1 operability.

This internal latch failure is independent of box-port clearance. `complete_workflow_approved` and `continuous_latch_operation_verified` remain false. A clear set of sampled witnesses in a future revision would still not certify a complete continuous path.

## Reproduce privately

Use the isolated CAD Python from the worktree root. The example variables refer to the preserved producer receipt and its source worktree, not an uploaded asset.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_integration.py
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/integrate_receipt.py \
  --receipt "$C1_RECEIPT" --source-worktree "$C1_WORKTREE" \
  --source-revision 8c46422 --output /tmp/C1-box-integration
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_contact.py \
  --step "$SHOW_TOOLS_DISCO_STEP" --output /tmp/original-contact.json
```

The integration output contains its source and input-file hashes, the closed-rotation check, actual contact coverage, intermediate lift witnesses, three access comparisons, and exported candidate box roofs. It records geometry findings even when the complete workflow fails. Failed runs remove the previous success receipt before reading inputs.

C1's internal transition, actual tool engagement, table-compatible access, installed knob engagement, buffer retention, physical fastener fit, loads, material, and printer preparation remain unresolved. C2/C3 have not been checked by this milestone. No final C is selected and nothing is published. Print readiness remains `NOT_READY`.

The operator subsequently authorized lifting for underside access. [The lifted closed-cover candidate](LIFTED_BASE.md) records that separate follow-up. It preserves the original table-contact failures while checking proposed ports through both panels and a lifted clearance condition.
