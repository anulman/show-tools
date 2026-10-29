# Final-C fixed base for human review

This candidate uses the lifted, closed-cover base and compact keeper tabs with the final-C captive push-turn control. The box, stock unit hex and keeper hardware stay stationary. The bar assembly rotates above the proposed spacer and separate low-drag buffer. The stock hex sits flush in the top well; there is no additional unit retaining nut.

The proposed bar-mouth spacing remains 9 mm. The actual installed knob height and stock-hex dimensions are unknown, so this is a packaging proposal rather than verified device fit. High-grip adhesive-backed stock material cut for the knob shoes is separate from the low-drag box buffer. Neither envelope selects a material or constitutes a print instruction.

## Complete underside entry

The spanner bridge and off-axis grip stay below the closed cover. Only its two long pins enter the box through quarter-arc ports. The pin driver and fork have their own containing entry and operation envelopes. Keeping the cover installed is a design proposal; the operator authorized lifting the box.

The full spanner staging envelope reaches box-local Z=-210.1 mm. The exterior underside is Z=-80.055061 mm. Consequently the modeled complete tool entry needs more than 130.044939 mm of lift. The proposed 140 mm service height leaves 9.955061 mm above the modeled table. The earlier 15 mm proposal applied to the original C1 probes and does not accommodate these complete tools.

The cable outlet is proposed 25 degrees from the front (-Y) toward +X, preserving the earlier channel section and cable reserve. The original front route crosses the key tools; a +X route crosses a spanner-pin arc. Actual cable dimensions, outlet direction and strain relief still require operator confirmation.

The fork's U-shaped ports leave small detached scraps. The generator removes these explicitly, rejects detached material totaling 10 mm³ or more in either panel, and reports the removed volume. It then requires one connected solid per panel. Separate exact material comparisons preserve the full central R33 mounting region, spacer support, all four cover-fastener regions and the ballast floor.

## Reproduce

Use the immutable final-C receipt and its producing source commit:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/final_base.py \
  --receipt "$FINAL_C_RECEIPT" --source-worktree "$FINAL_C_WORKTREE" \
  --source-revision "$FINAL_C_COMMIT" --output /tmp/final-base-review
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_final_base.py \
  --receipt "$FINAL_C_RECEIPT"
```

The validator checks immutable producer-source hashes, every supplied STEP/STL pair, actual operating and staged tools, full entry envelopes, moving-control containing sweeps, all assembly states, contact patches and continuous normal rotation. STEP components are normalized to sole solids before posing, avoiding assembly-child Boolean errors. It also checks continuous upward bar withdrawal against the fixed base using vertical separation, radial bounds and exact vertical extrusions of the below-roof profiles. Internal bar withdrawal retains the producer's distinction between continuous housing clearance and sampled whole-assembly clearance.

The output receipt binds the exact producer receipt, source files and six exported CAD pieces. Its `review_components` records support a base preview without the private bar STEP. The ten-solid assembly includes keeper hardware. Export integrity and two-way STEP material equality must pass before `geometry_review_pass` is written. An unsuccessful rerun removes the prior receipt first.

The regression checker rejects the earlier 15 mm lift, unported cover, damaged cover seat, opened ballast floor, original cable route obstructing stationary unit hardware, and a cap-rim obstruction between clear withdrawal endpoints.

## Remaining physical checks

Print readiness remains `NOT_READY`. The 140 mm height does not verify hands, lifting supports, lifting stability, grasp or operator comfort. Knob engagement, stock-hex and fastener dimensions, thread engagement, material choice, adhesion, loads, wear and printer preparation remain unverified. Ballast mass and material are unselected. The coordinator owns preview publication; this generator does not start or restart services.
