# Front and back exits for the inclined arcade box

This isolated proposal starts from the actual four-part resin-v4 arcade exports. It keeps the existing floor-level front outlet and adds a centered rear outlet on the high edge of the incline. The rear outlet has the same nominal 10 × 9.5 mm opening, raised 26.5 mm above the interior floor. A floor-level rear mirror would cut the ballast capsule; the raised route passes over the intact ballast enclosure instead.

The bottom, ballast body and ballast lid are unchanged in both Boolean directions from the frozen v4 source. The sloped roof and counterbore, ground datum, complete four cover-fastener regions and original ballast enclosure are preserved. The full 63.5 mm axial reserve is checked against all printed parts, actual standard hardware and ballast cubes. Both outlets connect the interior to the exterior with the bottom installed. The conservative 9 × 8.5 mm cable reserves are geometric proposals; the plug, cable diameter and minimum bend radius remain unmeasured.

The original front tie anchors stay on the unchanged cover. A new 46 × 28 × 2 mm bridge joins the rear shell wall and supports two matching closed eyes above the ballast. Its underside sits 6 mm above the original tray roof. The same 2.5 mm wide ties and 1.3 mm conservative tail thickness pass the rear tunnels. Complete tie-loop/head witnesses and straight 3 mm and 8 mm bundle gauges clear the printed shell, cover, standard hardware, capsule and nominal cubes. These gauges are not measurements of the installed wiring. The straight rear reserve avoids a forced turn immediately over the ballast; actual bend compliance, edge protection, threading and pull strength require the real cable.

The bridge is integral to the shell, so the candidate still has four printed parts. The raised rear opening does not require a second groove in the bottom. It gives a choice of outgoing direction while preserving the existing cover and ballast. Rear wiring exits higher than front wiring.

`check_arcade_dual_exit.py` first checks the actual candidate, then requires rejection when either outlet is blocked. It removes real material from the roof, a cover seat and the capsule lid, removes the integral rear bridge/anchors, adds a connected obstruction inside the axial corridor, omits a required producer source and changes the captured receipt. The generator hashes receipt bytes before parsing, requires the exact seven baseline producers, compares every baseline STEP/STL part with regenerated material, and rechecks inputs and outputs through export.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/arcade_dual_exit.py \
  --base-receipt "$RESIN_V4_ARCADE_RECEIPT" --output /tmp/arcade-dual-exit
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_arcade_dual_exit.py \
  --base-receipt "$RESIN_V4_ARCADE_RECEIPT"
```

The output includes four paired STEP/STL print candidates, a complete assembly STEP and a receipt. It does not publish or start services. The rear bridge is a horizontal overhang with a 6 mm gap above the tray roof: resin drainage, washing, orientation and support removal need slicer and physical review. The existing front channel retains its 1.5 mm bottom skin, and the rear bridge is 2 mm thick. No print-strength, connector-passage, cable abrasion, bend-radius, strain-relief load or stability approval is implied by these geometry checks.
