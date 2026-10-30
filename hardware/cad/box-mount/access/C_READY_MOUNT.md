# Mounting box for post-glue C

Historical candidate: the operator superseded this marked, ported bottom with [bottom-off service](C_PANEL_SERVICE_MOUNT.md). Preserve these sources and exports; use the newer recipe for the current mounting box.

This C-specific review candidate uses the complete compact mounting box with final C geometry `456665c` and ordinary-tool evidence `94057a1`. The existing tool ports already clear C. The only material change is a 0.4 mm engraving of `C`, `3` and `4` on the removable bottom. Each stroke retains at least 2.55 mm of floor above it. No port, mounting seat, bearing surface, keeper or cable channel is moved.

The `3` identifies the ordinary 3 mm hex key for the M4 lock. The `4` identifies the ordinary 4 mm hex key for the collar drive. These numbers identify key sizes, not mounting screw sizes. Read them from underneath with the box's +X to the right. The C mark sits on the opposite side from the drive slot.

| Interface | Installed box coordinates |
|---|---|
| 3 mm lock entry | R38, angle 135°, XY approximately −26.870 / +26.870 mm |
| 4 mm collar drive | R38.5, continuous arc from +20° to −15° |
| Whole rotor service index | 280°, equivalent to −80°, after the source X180 upright transform |
| C source lock / drive motion | Lock 110°→145°; drive 260°→295° |
| Normal contact heights | 5 mm, or 7 mm with the existing optional 2 mm shim |

The larger existing drive slot is deliberately preserved. Its complete ordinary-tool staging and reverse path are checked. The box does not lock or stop the bar, collar, cup or knob. Unlimited whole-assembly rotation remains a passive PTFE bearing interface.

## Connecting C

Secure the stock hex with its two keepers before fitting the detachable module. Keeper screws are reached from above with the cup and ball absent. The unchanged hex well is AF36 with a diameter-30 barrel passage and 6.6 mm depth. Its fit and the estimated stock dimensions still require the real hardware trial.

Fit and adjust the complete C module on the knob with the ball/bar off. Its ordinary 1.5 mm grip keys clear the base throughout entry, operation and withdrawal. Keep all cover and split-collar assembly outside the ball. The checked [C operating sequence](../../POST_GLUE_REVIEW.md#installation-and-removal) remains authoritative.

Installed C is serviced through the bottom. Support the box stably with the checked 180 mm underside service clearance. The 3 mm and 4 mm tools use the same whole-rotor service index, so their supporting push can be transferred while the ball rests on PTFE. The 4 mm key must bottom on its socket floor to push the collar to its upper stop; the 3 mm key must bottom to seat the screw head. Turn the collar only at source delta −0.5 mm. Relaxed-race recovery is checked, but does not permit freely turning a displaced collar.

Keep one hand supporting the ball during the 2.1 mm nut-registration stroke and three screw turns. Follow the prescribed reverse operation before lifting the ball away. Do not completely unthread the M4 nut inside the ball. Remove the complete module from the knob before cover/collar dismantling. Debond-fluid access is required after module removal, as confirmed by the operator.

The same stock-hex keepers, support screws, passive PTFE sheet, cable reserve and tiedowns, removable bottom, and closed eight-cube ballast compartment remain. The inclined arcade box and its exports are unchanged. The 2 mm optional shim remains a separate component; choosing the final height requires physical fit testing.

## Verification and exports

`c_ready_mount.py` starts with the actual frozen compact-base STEP/STL records, not a regenerated substitute for their geometry. It copies unchanged component files byte for byte and independently reloads the newly engraved bottom. The final checks use these actual exported parts.

The receipt includes:

- Every-angle analytic base clearance for all 23 C solids across five stages at both heights; no angular samples establish clearance.
- Complete ordinary 3 mm and 4 mm tool entry, full operation and withdrawal sweeps at both heights, including the shared-index transfer. Actual tool-to-tool clearance and socket-floor contact remain bound to the unchanged C proof.
- Analytic base clearance through the complete relaxed collar and captured-head ranges, using vertically eroded rotation-invariant windows. This does not grant free internal collar rotation.
- Continuous complete-module withdrawal and all-angle full 1.5 mm grip-tool clearance with the ball off.
- Stock-hex lift/rotation contact, keeper and support joints, nut loading, countersunk-seat webs, cable/tiedown reserve, bottom withdrawal, ballast containment and hardware clearance.
- Actual C bar bearing patches backed by the unchanged PTFE and rigid support at both heights.
- Exact upstream C actor/protocol/evidence binding and real-candidate negative controls.

The default inventory contains eight base components: seven print candidates and one purchased PTFE envelope. The shim is optional. Material cutting/forming patterns remain separate from printed parts. Complete C-plus-box STEP assemblies are included for review; individual checked component exports remain authoritative. Source-to-STEP Boolean identity of the combined assembly is not claimed.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_c_ready_mount.py \
  --base-receipt "$COMPACT_V4_RECEIPT" --candidate-receipt "$FINAL_C_RECEIPT" \
  --bundle /private/tmp/post-glue-human-review-20261030-r1
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/c_ready_mount.py \
  --base-receipt "$COMPACT_V4_RECEIPT" --candidate-receipt "$FINAL_C_RECEIPT" \
  --bundle /private/tmp/post-glue-human-review-20261030-r1 --output /tmp/NEW-C-mount
```

The output namespace must be fresh. The complete candidate receipt is `verification/receipt.json`; a failed build cannot overwrite an older result. Existing compact, C and arcade inputs remain immutable. The worker does not publish the shared viewer or start any service.

This is geometry ready for human review, not fabrication approval. Actual knob fit, resin strength and shrinkage, pad grip, stable service support and hand access, PTFE forming/drag/wear/creep, and the engraved labels' print legibility require physical validation.
