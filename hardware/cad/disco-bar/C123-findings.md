# Private C1, C2, and C3 findings

C1 is the strongest basis for the next C: it uses fewer parts, and a bounded flange relief clears its diagnosed withdrawal snag. All three original assemblies fail operation checks in this checkpoint. The modeled knob clamp remains preset while the bar latch moves. The relief remains a separate proposal; no final C or manufacturing approval follows from these exports.

| Prototype | Individual component exports | Proposed print parts | Assembled operation |
| --- | --- | --- | --- |
| C1 quarter-turn retainer | Pass, 19 components in seven endpoint states | 6 | Original housing catches the flange during lift. Separate relief clears that snag; full operation remains unverified. |
| C2 over-centre attempt | Pass, 33 components in eight states | 11 | Locked assembly has 28 interfering pairs. The dead-centre crossing is genuine, but the linkage does not fit its surrounding parts. |
| C3 sliding dogs and sleeve | Pass, 23 components in six states | 8 | The key interferes while locked; the dogs, followers and sleeve interfere during release. |

Part counts include the common knob clamp and full bar, exclude the box, and distinguish pads and hardware from proposed print parts. They describe assembly complexity, not a manufacturing quote. The earlier pivot-only C2 seed also exports successfully but collides at full opening; it is retained as a rejected seed, not substituted for the over-centre mechanism.

The receipts distinguish component validity, STEP round trips, watertight STL meshes, and assembled interference. Disconnected components fail rather than being silently split into printable solids. The checks preserve the original 109.22 mm bar reach, far attachment end, and radial envelope. Every preset piece is compared in both Boolean directions against the same baseplate at the same setting.

## Recommended ingredients for the next C

Keep C1's separate retainer collar, straight torque keys and fixed padded-screw grip. Use the tested flange-relief proposal as the starting correction. The useful operator idea from C3 is a captive release control; its interfering dog/cam geometry is not ready to reuse. Positive tool engagement and catch captivity still need design and validation before final C is selected.

For the box, use the compact keeper-tab approach: two tabs and two flush fasteners restrain the existing stock hex in its roof well. Tape bonding and extra swing pivots add dependencies without a demonstrated benefit for this stationary joint. Keep the replaceable sliding buffer separate from the grippy knob pads.

The operator permits lifting the box for underside access. The matching service openings can therefore be evaluated with the box lifted. Access through the bottom, ballast containment, tool engagement and a safe reaction surface remain separate checks; roof-port clearance alone is insufficient. The proposed 9 mm spacing still needs checking against actual knob engagement.

The shared viewer is unchanged. These findings precede the final design and its publication.

## C1 withdrawal changes the endpoint conclusion

The original seven C1 states clear, but the path between seated and detached does not. `check_withdrawal.py` records intermediate samples and exports the colliding pair as witnesses. It supplements the original receipt and interface with `operation_pass: false`. See [the C1 findings](C1-findings.md).

The separate `check_c1_relief.py` study preserves the knob cup and locked capture while clearing 1 mm withdrawal samples. A containing swept box establishes clearance of the diagnosed housing through the complete lift. The changed baseplate passes STEP/STL checks. The original C1 geometry and failure remain reproducible; the relief is a separately exported proposal. Other continuous motions, support strength and actual collar-tool engagement remain unresolved.

## C2 includes a real over-centre attempt

`overcentre.py` models two fixed pivots, a 2.5 mm crank, a 5.5 mm connecting link, and a 2 mm hook arm. The closed crank angle is 100 degrees. At 90 degrees the link and crank pass through dead centre; opening continues toward zero degrees. The signed crossing changes from positive through zero to negative while the modeled link lengths remain fixed.

Both sides have a finite stop and an independent push-turn safety key. Those solids are present, but their holding and stop functions are unverified because the locked assembly already intersects. The checker therefore reports diagnostic holding contacts without treating them as proof. The 15.5 mm closed key height also exceeds the proposed 9 mm roof gap. C2 needs a different arrangement and clearance review before box integration.

The pivot-only seed remains under concept `C2` to preserve its failed result. The actual linkage has its own `C2-overcentre` receipt and component directory. They are distinct prototypes.

## C3 needs staged release

At the locked position, the key and carrier overlap by 1.137 mm³. The key remains in conflict after its push-turn sequence. At midstroke, each dog intersects the sleeve by 11.170 mm³ and each follower pin by 4.549 mm³. The released pose also conflicts with the carrier.

The sleeve needs an initial axial dwell that clears the blocking land before cam retraction starts. Follower heads and the key support also need independent clearance. Re-exporting or repairing meshes cannot resolve these assembly conflicts.

## Shared limits and handoff

The knob pads are proposed 2 × 16 × 8 mm cut-stock envelopes backed by retained rigid shoes. Adhesive faces the shoe; no adhesive touches the knob. Actual stock selection, adhesion, clamp force, wear, hardware standards, and installed knob dimensions remain unverified. The separate support buffer has a low-drag role.

All control points rotate with the knob assembly. The proposed box transform rotates source geometry 180 degrees about X and places the mouth at box Z = 9 mm. These failed prototypes do not establish compatibility with the stationary roof, stock hex, keepers, table, or an actual service tool. A clearance probe does not establish tool engagement. The coordinator owns integrated box and full-rotation checks.

Run the endpoint and withdrawal checks described in the C1 findings. Run each comparison with the isolated CAD Python environment:

```sh
~/.local/share/show-tools/cad/venv/bin/python \
  hardware/cad/disco-bar/check_variants.py \
  --step "$SHOW_TOOLS_DISCO_STEP" --output hardware/cad/build/c123 \
  --concept C2-overcentre
```

Repeat with `--concept C2` and `--concept C3`. The local ignored receipts identify source hashes, state-specific STEP and STL artifacts, diagnostic contacts, and explicit failures. No shared preview, publication, printer, or USB action is part of this checkpoint.
