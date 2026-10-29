# Arcade, rotor, and mushroom box concepts

`box_mount.py` generates three distinct component studies. Every concept has a removable bottom, proposed screw and captive-nut seats, a wiring groove, and a separate ballast compartment. All remain `NOT_READY` for printing or fitted manufacture.

| Variant | Current geometry | Remaining fit gates |
| --- | --- | --- |
| `arcade-inclined` | 5-degree roof, 100 mm counterbore, 17.5 mm axial recess, confirmed minimum 63.5 mm reserve along the tilted button axis | Actual button, nut, switch, harness, travel, and bend clearance |
| `rotor-level` | Level roof, proposed 34 mm across-flats by 5 mm deep hex recess, proposed 29 mm body passage | Rotor identity, actual hex dimensions, retention and wiring envelope |
| `mushroom-level` | Level housing with an uncut roof | Wiring test, mounting dimensions, and harness envelope |

The former flat Adafruit A is retired from the active variants. It is not a rotor or mushroom reference. Only the inclined arcade study displays the pinned manufacturer button reference, which has invalid upstream geometry. No rotor or mushroom component replicas are invented.

## Arcade clearance starts at the counterbore floor

The operator confirmed 2.5 inches, or 63.5 mm, from the counterbore floor along the tilted button's centre axis. The counterbore-floor centre and seating-shoulder centre remain at `(0,0,0)`. Positive button-axis Z tilts toward -Y; the inward wiring direction therefore travels toward +Y and -Z. The low edge of the inclined roof need not provide the full centre clearance.

The centreline requirement projects to `63.5 × cos(5°) = 63.2584 mm` below the seating shoulder. The proposed interior floor is Z=-65 mm. This gives 65.2483 mm along the axis to the floor. The proposed 3 mm bottom extends below it to Z=-68 mm, preserving the full interior reserve.

The generator separately checks a 63.5 mm long cylinder with a proposed 13.5 mm radius. This corridor passes through the complete shell and cover without interference. Its lowest off-axis point is `-63.5 × cos(5°) - 13.5 × sin(5°) = -64.4350 mm`, leaving about 0.5650 mm above the floor. The radius is a proposal, not a measured wire-bundle or connector size. No actual component occupancy or bend radius is verified by this empty-housing check.

The ballast compartment moved to Y=36 mm to clear the extended tilted corridor. The operator confirmed that both level roofs align with the inclined box's low edge. All bottoms share Z=-68 mm. The level roofs are approximately Z=12.0551 mm, giving a level-box exterior height of approximately 80.0551 mm. The arcade's high edge remains Z=23.0786 mm, or 91.0786 mm above the ground plane. Its centre roof rises about 5.5118 mm above the level roofs. The button's seating-shoulder centre remains at Z=0. Installed component heights remain unverified.

`depth` measures vertically from the seating shoulder to the interior floor. Changing `bottom_thickness` moves the exterior underside without consuming that interior space. The original 35.25 mm depth is retained in project history and has been superseded for the active arcade box.

## Rotor dimensions distinguish source facts from proposals

The [Ultimarc SpinTrak drawing](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/images/1/spintrakdiag.gif), linked from the [manufacturer product page](https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/), labels a nominal 28 mm body dimension. Its 34 mm label does not establish the mounting hex's across-flats dimension or its thickness.

The rotor concept uses a 29 mm body passage, comprising the published nominal 28 mm body size and a proposed 1 mm diameter allowance. The 34 mm across-flats and 5 mm deep hex recess are illustrative parameters. They are not dimensions verified from that drawing. The passage is for the body, not the knob shaft. A geometric check confirms that the proposed passage and hex pocket remain open and that the recess has a supporting shelf. Actual component fit and retention remain blocked.

The rotor recess floor is 5 mm below its level roof. Its centre has approximately 72.0551 mm to the interior floor. This empty-housing space is not a verified attached-harness envelope.

## Construction and ballast remain proposals

Four underside-loaded hex nuts and cylindrical screw-head seats provide a proposed M3 fastening arrangement. Screw length, actual head shape, nut dimensions, engagement, and tightening loads need review. The exterior screw-head recess is 1.5 mm deep, leaving 1.5 mm of bottom material with the default 3 mm cover.

A proposed 10 mm wide groove in the cover joins a notch through the -Y wall at the seam. The groove is 1.5 mm below the interior floor and the exit extends 8 mm above it. No strain relief, abrasion protection, seal, or real connector clearance is established.

The shell's roofed ballast compartment closes against the removable bottom. Its proposed interior is 72 by 24 by 8 mm. The checked envelope is 71 by 23 by 7 mm. Its material and target mass are unselected. A sealed sand pouch, steel plate, washer stack, or contained shot can be evaluated later. Loose grains are not part of this model. No stability claim follows from the pocket volume. Support or remove ballast before opening the bottom, which opens the compartment downward.

## Generate and inspect the concepts

Use the existing isolated CAD Python without starting a viewer:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box_mount.py --output /tmp/box-mount-review
```

The default output directory is `hardware/cad/build/box-mount-proposal/`. Use `--variant arcade-inclined`, `--variant rotor-level`, or `--variant mushroom-level` to export one concept. `--requirements` prints component identities, confirmed clearance, source distinctions, and remaining gates without writing geometry.

Each concept has shell and bottom STEP and STL files, a two-solid assembly STEP, and SVG inspection views. The receipt records all parameters, source and output hashes, package versions, nominal sections, assembly checks, and fit gates. File names mark the parts `PROPOSAL-NOT-FIT-VERIFIED`. Failed geometry runs remove their previous success receipt before building.

`--parameters PATH` accepts a JSON object of `Proposal` field overrides. Unknown fields, nonfinite values, insufficient axial reserve, and a floor that cuts the finite corridor fail. The default depth is deliberately larger than the centreline-only projection to preserve the proposed finite radius and floor allowance.

`preview(parameters=None, *, explode=0, include_reference=True, variant="all")` returns `(objects, names, colors, alphas)` without connecting to a viewer. Its seven default entries are six enclosure parts and the separate arcade reference. A selected level variant has two entries; the arcade variant has three. `explode` lowers the covers. Only the coordinator publishes this payload.

Run the focused checks with the same Python:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/check_requirements.py
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/check_reserve.py
```

The generator checks valid solids, STEP and STL round trips, shell-cover overlap and contact, cover withdrawal, cable and ballast envelopes, nut insertion, screw axes and seating material, ballast enclosure, and each component's proposed opening. The arcade check distinguishes the axial centreline from the complete finite corridor. Mushroom checks preserve the uncut roof.

Printer, material, orientation, allowances, fit coupons, actual wiring, fastener fit, retained ballast behavior, stability, strength, and physical assembly remain unverified.
