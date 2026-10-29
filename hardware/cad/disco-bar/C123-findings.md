# Private C1, C2, and C3 findings

All three detachable-bar concepts fail operation checks in this checkpoint. The modeled knob clamp remains preset while the bar latch moves. No final C, integrated box fit, or manufacturing approval follows from these exports.

| Prototype | Individual component exports | Assembled operation | Finding |
| --- | --- | --- | --- |
| C1 quarter-turn retainer | Pass, 19 components in seven endpoint states | Fail during withdrawal | The carrier key housing strikes the preset flange at source-Z lifts of −4, −6, and −8 mm. |
| C2 pivot-only seed | Pass, 23 components in seven states | Fail when released | Each hook intersects the carrier by 3.615 mm³. This seed lacks the required over-centre linkage. |
| C2 over-centre attempt | Pass, 33 components in eight states | Fail in the locked state | Carrier, hook, lever, link, and pin clearances conflict. The mathematical dead-centre crossing does not establish a functioning latch. |
| C3 sliding dogs and sleeve | Pass, 23 components in six states | Fail in the locked state and during release | The key intersects the carrier. Cam retraction begins before the blocking land clears; dog and follower-pin envelopes collide with the sleeve. |

The receipts distinguish component validity, STEP round trips, watertight STL meshes, and assembled interference. Disconnected components fail rather than being silently split into printable solids. The checks preserve the original 109.22 mm bar reach, far attachment end, and radial envelope. Every preset piece is compared in both Boolean directions against the same baseplate at the same setting.

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
