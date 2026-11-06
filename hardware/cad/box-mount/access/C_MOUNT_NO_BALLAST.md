# C mount with four default printed parts

This is the current simplified C mounting-box candidate. It has no ballast tray, capsule, cubes, washer retainers or their dedicated screws/nuts. The fixed wiring anchors, blank removable bottom, stock-hex interface and C operating sequence remain.

The existing passive-bearing support is fused into the shell without changing its occupied material. The default printed parts are:

1. Shell with integral support.
2. Blank removable bottom.
3. First stock-hex keeper.
4. Second stock-hex keeper.

The formed1mm PTFE sheet remains purchased material, retained by the same four M3 countersunk screws. It is not printed. Flat PTFE and a combined hex keeper remain unimplemented proposals; this candidate retains the checked interfaces.

## Both height settings remain

The default PTFE contact plane remains5mm. A single optional profiled height cap raises it to7mm, replacing the previous flat under-spacer shim. The cap is derived by exact Boolean material difference from the original7mm stack. The fused default body plus this cap has exactly the same occupied rigid material as the original shell/spacer/shim at7mm; the5mm body union is also identical to the original5mm assembly. No dimensions or hardware lengths are changed.

Do not substitute the old flat shim: the support is now integral, so a flat ring in its former location does not provide the raised setting. Change height with the ball and cup absent. Remove the PTFE and its four support screws, lower or lift the profiled cap axially, then refit the PTFE and screws. The checked50mm cap path clears the body, hex keepers, cover hardware, captive nuts and central OEM envelope in both directions.

The verification code retains the old spacer only as a reference subregion of the material union. It is not an additional print or an extra occupied part. Actual physical configurations, exports and assembly inventories use the fused shell and optional cap.

## Assembly and hardware

Use the unchanged C coupling `456665c` and tool evidence `94057a1`. Remove the bottom for installed collar/root-tool work and refit it only after both C keys are withdrawn. Wiring remains on the fixed shell; no cable slack or disconnection is assumed. The 3mm and4mm tools, upper-stop requirement,5/7mm contact heights and unrestricted normal rotation remain unchanged. There is no rotor-to-box retaining joint or stop.

The base needs four ISO7380-1 M3×10 button screws, two ISO7380-1 M3×12 button screws, four ISO10642 M3×12 countersunk screws, and ten DIN934 M3 nuts. Button lengths are under-head; countersunk length includes the head. There are no M3×16 ballast screws, penny washers, capsule closure screws or cubes. Existing PTFE and fixed cable-tie material remain separate.

Actual STEP/STL checks cover the fused body's single-solid integrity, exact5/7 material identities, cap installation/reversal, stock-hex contacts and loading, passive bearing backing, PTFE fastener tolerances, fixed cable reserve, panel removal/refit, complete ordinary-tool paths and every-angle C clearance. The unchanged C39-state protocol composed with the exterior panel state has66 reachable states, all reversible. Real negatives reject a restored tray, an unfused body and the wrong flat shim.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/c_mount_no_ballast.py \
  --base-receipt "$COMPACT_V4_RECEIPT" --candidate-receipt "$FINAL_C_RECEIPT" \
  --bundle /private/tmp/post-glue-human-review-20261030-r1 --output /tmp/NEW-clean-C-base
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_c_mount_no_ballast.py \
  --base-receipt "$COMPACT_V4_RECEIPT" --candidate-receipt "$FINAL_C_RECEIPT" \
  --bundle /private/tmp/post-glue-human-review-20261030-r1 --receipt /tmp/NEW-clean-C-base/verification/receipt.json
```

Use a fresh namespace. The default print inventory excludes PTFE and all reference-only regions. The optional cap is separate. Old ballast-bearing sources/exports remain preserved history. This worker does not publish the viewer. Physical fit, resin strength, grip force, PTFE behaviour and stable180mm service handling remain untested.
