# Compact mount: 5 mm contact height, optional 7 mm setting

This isolated candidate replaces the previous 18 mm support plus 1 mm PTFE stack with 4 mm support plus 1 mm PTFE. The latch occupies an annular recess below the roof. An optional 2 mm annular shim raises the same support, sheet and bar to 7 mm without changing the base, tool ports or selected M3×12 countersunk screws. The ring is passive support; it does not introduce a separate bar-to-box retaining joint.

The full C2 bar, known snug Darren socket, and catalog coupling hardware come from the frozen `4903640` exports. The ordinary grip keys and their operating/entry sweeps come from `c230a14`. The operator confirmed Darren's socket is authoritative, superseding the rough 1⅞-inch knob-diameter estimate. The preserved bore is 44.35475 mm, entry is 45.94225 mm and blind depth is 25.4 mm. These are source socket dimensions, not claims that the knob has those exact dimensions. A diameter-48 tool bound is explicitly conservative and does not resize the cup.

## Interface and internal support

The measured-interface recipe is shared with the small one-keeper trial: AF36 well, diameter-30 barrel passage and 6.6 mm well depth. The approximate 6.35 mm nut places its top 0.25 mm below the roof. Each keeper has a matching 0.25 mm nose. The underlying estimates remain approximate ruler readings; converted decimal values do not imply metrology accuracy. Actual resin fit and nose contact must be tested.

The central island has radius 32.5 mm. The moving annular well extends to radius 44 mm and has its floor at Z −13 mm. A 5 mm web at Z −18 to −13 connects the central island to the outer wall below the moving collar. No radial support crosses the collar at roof height. The outer wall spans R44–46 and joins the existing roof. After cutting both configurations' tool paths, full 12 × 8 × 5 mm support witnesses remain at 90 and 270 degrees. The shell remains one connected solid.

The keeper nut-loading channels continue through the deeper web to its underside. Both actual M3×12 button-head joints retain declared axes, full nominal nut span plus one pitch, head/nut reactions and loading paths. Each keeper individually stops a 0.1 mm nominal hex lift. The well stops a 5-degree nominal hex rotation. These are geometric witnesses, not preload, allowable backlash or strength measurements.

With the approximate 25.4 mm knob height seated against the preserved blind stop, the nominal hex-top-to-knob-underside gaps are 5.25 and 7.25 mm for the two configurations. The relation is `mouth height = hex-top height + underside gap + knob height − 25.4`. The operator's reported adjustable underside-gap range is approximately 4.7625–22.225 mm. These nominal settings lie inside it; physical seating remains a fit-trial gate. No stationary barrel thread pitch is assumed.

## Actual mechanism and tools

Every paired STEP/STL record for 25 C2 components across six states, four whole lock/collar tool envelopes, six grip key/operation/entry envelopes, the prior base and measured coupon is hash-bound and checked. Imported single-solid compounds are normalized before posing. Receipt bytes and hashes are captured before parsing. Exact source inventories are verified against immutable revisions; all input, local generator and output hashes are rechecked through export.

The source-to-box pose is X rotation 180 degrees, then Z rotation −90 degrees, with source mouth at box Z5 by default or Z7 with the shim. At 5 mm, the fully backed-out head clears the well floor by 0.5 mm; the shimmed configuration gives 2.5 mm. Actual actors are separated from checked rotation-invariant bounds containing every fixed base solid above the well floor. Together with the floor separation, this proves clearance against the base during rotation and positive-Z withdrawal. Internal C2 operation retains its separate upstream verification scope.

The same standard ISO10642 M3×12 screws retain the PTFE/support in both configurations. At 7 mm the maximum-head datum is Z6.5 and the nominal tip is Z −5.5, 0.7 mm beyond the nut bottom. Complete nut span plus a 0.5 mm pitch and all seated minimum/maximum head diameter/angle cases are checked. The optional shim plus raised original support is compared in both Boolean directions with a solid 7 mm support from the same recipe. The formed 1 mm sheet, developed flat pattern and 0.69 mm counterseat web remain unchanged.

Two actual planar bar patches selected within R44–45.5 total 353.734235 mm². Both complete selected patches are backed by PTFE and rigid support. This is not approval of load capacity, drag, wear or every other mouth face.

The whole tool staging envelope requires 154.944939 mm geometric lift at the 5 mm configuration and 152.944939 mm at 7 mm. The proposed 180 mm service lift leaves 25.055061 and 27.055061 mm respectively. An unlifted table still blocks entry. These gaps establish tool-envelope clearance; actual hand access and stable support while lifted remain unverified.

## Assembly order B

1. Keep cup and ball off. Seat the stock hex, load the real M3 nuts from below, and tighten both keepers from above with the ordinary 2 mm key.
2. Lower the loosened known-socket cup onto the knob from above.
3. Set the two radial grip screws with the ball/bar off. The full ordinary 1.5 mm keys and their entry/operating sweeps clear the base and conservative knob tool bound.
4. Fit the permanently glued ball/bar and operate the separate collar and captive lock from below through the service ports.

The full cup entry clears the keepers and the open bearing bore. The fitted cup blocks the keeper's top-driven key path, and the installed bar blocks the radial grip key: the checker preserves both failures. No step requires another bar-to-box retention operation. Physical knob attachment, preset grip, assembly handling and actual seating require the real unit.

## Reproduce and review

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_compact_mount.py \
  --collar-receipt "$C2_RECEIPT" --grip-receipt "$GRIP_ACCESS_RECEIPT" \
  --baseline-receipt "$C2_BASE_RECEIPT" --hex-receipt "$HEX_COUPON_RECEIPT" \
  --source-worktree "$SOURCE_WORKTREE"
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/compact_mount.py \
  --collar-receipt "$C2_RECEIPT" --grip-receipt "$GRIP_ACCESS_RECEIPT" \
  --baseline-receipt "$C2_BASE_RECEIPT" --hex-receipt "$HEX_COUPON_RECEIPT" \
  --source-worktree "$SOURCE_WORKTREE" --output /tmp/compact-mount
```

The default `review_components` contains exactly eight installed base components: seven print candidates and the purchased PTFE envelope. `optional_components` holds only the 2 mm shim. Flat cutting/forming references are under `material_patterns`. The five resin `fit_coupons` are clipped from the actual final hex/ear geometry, with separate PTFE specimen references and inverse source transforms. They test the real local material and both screw stacks, not an independently enlarged recipe. Two complete assembly STEP files contain the installed C2 in the 5 and 7 mm configurations.

The checker rejects a restored solid roof, removed lower web, either missing keeper nose, a capped nut-loading channel, a 1 mm substitute shim, an actual M3×10 screw at the raised configuration, insufficient lift, omitted producer/tool records and a changed receipt. Export round trips are compared to actual source material. The small prior coupon's keeper and critical well/fastener regions are preserved; prior ballast parts and PTFE cut pattern remain identical.

The cup-entry check establishes clearance against the fixed base. It does not model the real knob or prove that loosened shoes slide over it. The original snug socket is retained on the operator's confirmation; actual fit still needs the hardware trial.

This is review geometry, not a manufacturing release. Review resin orientation, drainage and cleanup in the deep well, the 2 mm outer wall, thin keeper nose, shim seating and source-clipped specimens. Actual fit, fastening preload, PTFE forming/creep/drag, cycling, abrasion, loads, encoder isolation and ball stability remain physical tests. Existing sources and frozen outputs stay intact; the worker does not publish or start services.
