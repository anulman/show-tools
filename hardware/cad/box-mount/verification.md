# Three-variant geometry checks

Checked on October 29, 2026 with the isolated CAD environment. This revision applies the operator's corrected 2.5-inch minimum and supersedes the previous 3.25-inch request. The operator confirmed that the new 63.5 mm minimum starts at the counterbore floor and follows the tilted button centre axis.

The active export includes `arcade-inclined`, `rotor-level`, and `mushroom-level`. It must produce six valid single-solid enclosure parts and three valid two-solid assembly STEP files. Each part must survive STEP round-trip and STL integrity checks. The receipt records all source and output hashes, parameters, versions, and assembly results.

For the default arcade box, the interior floor is -65 mm and the external underside is -68 mm. The axis reaches 65.2483 mm before crossing the floor. The complete proposed 27 mm diameter, 63.5 mm long corridor is unobstructed by the shell, bottom, and ballast compartment. Its lowest end point has approximately 0.5650 mm above the floor. This finite corridor check is separate from the centreline projection and does not verify the actual harness.

The default ballast compartment centre is Y=36 mm. Its actual shell walls, roof, and closed bottom are checked against the proposed wiring and ballast envelopes. All variants preserve the shared interior floor and exterior ground plane. The level roofs align with the actual arcade low roof edge, as confirmed by the operator. The check reads the uppermost CAD vertices at the -Y outer edge, avoiding bottom and seam-cable-opening vertices. Shared bottoms are checked separately. The operator confirmed that the displayed roof alignment matches the intended design. Each has zero measured shell-cover solid overlap, planar cover contact, a clear downward removal sweep, clear screw axes, and clear underside nut insertion paths.

Rotor checks establish an open proposed 34 mm across-flats by 5 mm deep hex pocket, an open 29 mm body passage, and a supporting shelf. The hex dimensions remain illustrative. Mushroom checks establish that its roof has no component opening.

Run these checks from the worktree root:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box_mount.py --output /tmp/box-mount-review
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/check_requirements.py
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/check_reserve.py
```

`check_requirements.py` checks the inch conversion and confirmed axial datum, then checks the actual CAD against an independently constructed finite corridor. It rejects both the former 35.25 mm interior depth and a 63.3 mm centreline-only depth that fails the proposed radial allowance. It also rejects an axial reserve shorter than 63.5 mm. The requirements report writes no CAD files.

`check_reserve.py` checks actual cover and shell bounds for all three variants with both 3 mm and 5 mm covers. Both thicknesses retain the full proposed 65 mm interior reserve.

The pure preview returns seven entries for all variants: six enclosure parts and one separate upstream-invalid arcade reference. Selecting arcade returns three entries. Selecting rotor or mushroom returns two. Exploded covers remain independently selectable. No shared viewer is started or published by this workstream.

The SVG inspection views show the shell interior, exterior roof, and cover interior for each variant. Physical fit, actual wire clearance, screw engagement, ballast retention under load, strength, stability, printing, and assembled hardware remain unverified. Machine-readable print readiness remains `NOT_READY`.

The roof-confirmation follow-up changes only requirement metadata and notes. A metadata-only check confirms the recorded alignment; geometry was not rebuilt or published. The earlier export receipts describe the unchanged shape revision and retain their original source hashes. Physical fit and printer readiness remain unverified.
