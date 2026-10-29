# Private rotor-box and stock-hex retention studies

These independent studies do not modify `box_mount.py`, existing previews, the CAD desk, or any published model. The current work separates the stationary device mount from the rotating knob/baseplate/bar and from deliberate latch-control motion. Installed C1/C2/C3 clearance still awaits their actual geometry and control manifests.

## The stock hex sits in a top-side well

The latest operator clarification governs this model: there is no additional device mounting nut. The part's existing stock hex sits in a roof well, with its top flush with the roof. The nominal well is 34 mm across flats and 5 mm deep, with a 5 mm bearing roof below its seat. These dimensions are proposals, not measured stock-hex dimensions. No thread pitch is inferred.

Roof Z=0 is the shared study datum. The stock-hex keepout occupies Z=-5 to 0. The bearing seat is Z=-5, with supporting material down to Z=-10. The proposed body passage is 29 mm. The hex keys rotation geometrically, but the well alone does not positively retain the device against upward pull.

The existing level-box height is preserved in this roof-local frame: interior floor -77.0551 mm and exterior underside -80.0551 mm. The existing bottom, wiring groove, fastener axes, and separated ballast compartment remain. No ballast material or mass is selected. Opening the bottom exposes the ballast compartment downward; no safe tipping or lifting procedure for the complete ball assembly is assumed.

The source bar has its mouth at source Z=0 and extends toward negative source Z. A 180-degree X rotation followed by an upward translation places it above the study box. The nominal stack defaults to 6 mm spacing. The selected thicker-retainer comparison uses a proposed 9 mm spacing, comprising an 8 mm spacer and 1 mm buffer. This may reduce actual knob engagement. Its interface records the full transformation matrix. Installed knob height and actual engagement remain unknown.

The proposed spacer and buffer are annuli with inner radius 43 mm and outer radius 45.5 mm. The buffer is a separate sliding-contact candidate. Cut-to-size grippy material in the knob clamp serves a different purpose. Neither the buffer's material nor its friction, wear, capture, or load capacity is selected.

The coordinator's source inspection found incomplete bar contact across this annulus. The study therefore does not assume a continuous source support face, uniform loading, or a proven washer span. Contact lands, unsupported spans, retention, and actual candidate interference remain integration gates.

## Compare three stock-hex retention approaches

| Study | Proposed upward restraint | Checks and limits |
| --- | --- | --- |
| R1 tape strips | Two consumable strips bridge the flush stock hex to the roof | Rising-hex contact is present. Adhesion, peel resistance, replacement, and load capacity are unverified. No positive mechanical retention is claimed. |
| R2 keeper tabs | Two independently removable tabs capture the hex rim with two flush-head fasteners | Rising-hex blocking, screw-head restraint, and captured fastener-nut roof reaction are checked. Thread engagement and strength are unverified. |
| R3 captive swing clips | Two pivoted clips capture the rim; separate locking fasteners prevent their rotation | Locked rotation is rejected. Captive pivot restraint, released swing, and open-state extraction are checked. More hardware and service steps remain. |

The hardware envelopes in R2 and R3 represent proposed keeper fasteners. They are not an additional SpinTrak mounting nut. Actual screw standards, fit allowances, thread engagement, shoulder hardware, torque, and materials still need selection.

Every bolt and nut is associated with its intended axis and roof seat. R2 keeper nuts and R3 pivot and lock nuts each have a 0.2 mm axial seating allowance. Every nut's 0.3 mm upward attempt must encounter its own roof material. Displaced nuts and two keeper nuts duplicated onto one axis are rejected. No unnecessary roof bosses are added. This is a geometric reaction check, not a proof of bolt or plastic strength.

The thicker study uses 3 mm keeper tabs and a proposed 9 mm mouth spacing. An earlier general actor-height reference was incomplete: the actual preliminary C1 safety key reaches Z=1.5. The first tabs collided with it at some rotation angles. The revised tabs end inside radius 33 mm and use screw axes at Y=±28 mm, clearing the known outer controls by radius rather than relying on height alone. Actual C1/C2/C3 validated mesh integration remains a separate step; the old height reference is marked incomplete in the receipt.

A separate 1 mm tab and 6 mm spacing comparison is retained as packaging evidence only. It is not selected as the final retainer and carries no strength claim.

The simplest private candidate uses R2's two thicker keeper tabs. It needs neither a tape bond nor additional swing pivots. Its six exported CAD pieces comprise five proposed print parts and a separate buffer envelope with unselected material. The ten-solid assembly is exported separately. This is a private synthesis for review, not approval to manufacture.

Routine bar release must not change the device retainer or the preset knob grip. Device maintenance is a separate operation. Keeper-tab removal may require removing the bar, obstructing baseplate, spacer, and buffer before withdrawing the tabs radially. Box-only driver clearance does not establish access through an installed bar or baseplate.

## Underside access still depends on the installation

The nominal stack checks a finite 8 mm diameter proposed tool path at X=38, Y=0. It intersects both the unported roof and a table slab touching the box bottom. These are deliberate negative checks. Spacing above the roof does not provide entry below a box resting on a table.

Fixed roof ports do not stay aligned with rotating controls. Candidate integration must establish either a rotation-independent corridor or an explicit rotate-to-service alignment. The locked assembly must rotate normally without permanent stems crossing the roof. Roof openings must retain material paths from the device seat to the box walls and support surfaces. No operator workflow that lifts or tips the assembly during performance is inferred.

## Generate private artifacts and run checks

Run from the worktree root using the isolated CAD Python:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access_study.py --output /tmp/rotor-stack
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/retention_studies.py --output /tmp/rotor-retention
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_stack.py
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_retention.py
```

`access_study.py --parameters PATH` accepts JSON overrides of the proposed stack dimensions. All remain proposals. Its four-part nominal export includes STEP/STL files, assembly STEP, `interface.json`, and a receipt.

The retention command exports R1/R2/R3 and `simplest-final-private/`. Tape shapes are consumable envelopes, not print recommendations. The final directory contains the shell, bottom, spacer, buffer, two tabs, full assembly STEP, interface, and inspection SVGs. Generated derivatives stay local and private. No attachments or generated geometry belong in Git.

The receipt records source and file hashes, solid validity, two-way STEP material equality, STL integrity, component separation, bearing material, stock-hex and keeper blocking, bottom withdrawal, and table-access limits. R3's conservative full-circle swing envelope contains each clip and remains clear; sampled release poses are also checked. A failed rebuild removes stale success receipts before construction. Independent single-solid export handles avoid the CAD exporter's assembly-child failure.

Actual C1/C2/C3 mesh clearance, source contact support, installed reachability and reaction, hardware fit, tape adhesion, buffer capture, loads, wear, stability, encoder support, and printer preparation remain unverified. Print readiness remains `NOT_READY`.

## Final-C review candidate

[The final fixed-base candidate](FINAL_BASE.md) supersedes the original C1 tool-access proposal for final-C review. It checks complete whole-tool entry, not just working probes. Its proposed 140 mm service lift and cable outlet 25 degrees from the front require physical workflow review. The generator consumes immutable final-C exports and writes six private review components without requiring the private source STEP for a base-only preview.
