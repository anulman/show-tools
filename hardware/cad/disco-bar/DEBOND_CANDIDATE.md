# Channel-preserving collar candidate

This isolated candidate restores the two bottom-accessible alcohol/debond passages identified in the operator's October 29 Scrawl. It keeps the existing C2 underside collar and captive lock, full 109.22 mm bar, original outer profile and snug knob socket. It adds no height or purchased hardware. Existing producers, frozen exports and publication selections remain unchanged. The earlier C2 fabrication handoff remains on hold pending review of this candidate.

## Construction and verification boundaries

The bar and receiver use three carrier screws at source angles 40, 160 and 280 degrees. The prior 0-degree anchor occupied the positive-X passage. Moving that anchor alone would not restore the negative-X passage, because the prior continuous reinforcement ring also occupied original empty space.

Two construction approaches were considered: remove and fill the old anchor features after generating C2, or reconstruct the same mouth recipe with separately located anchors. The latter keeps original material separate from added reinforcement and avoids reconstructing old drilled holes. Rebuilding the historical 0/120/240 layout without channel restoration must match all 25 frozen C2 components in both Boolean directions.

Within each source-derived analytic channel envelope, the new bar is `(bar − envelope) + (original ∩ envelope)`. The receiver is cut with that same envelope. This restores original bar material in the local region while removing added obstructions. Direct subtraction of the shared-face compound void failed in OCCT, so the construction uses the equivalent local replacement rather than widening the cutter or treating a kernel error as empty space. Purchased screws and nuts are moved intact.

The validation oracle independently derives the original inner cylindrical faces, root plane, outer cylinder and lumen depth. The producer's claimed voids must match that oracle. Narrowed-baseline, connected blocked-channel and blocked-bottom-entry controls must fail. Disconnected extra material is rejected in both component orders before selecting a sole solid. The old design is rejected using actual receiver counterexamples in both passages; this is not a complete inventory of old intrusions.

Occupancy is the actual Boolean material difference `(part ∩ channel envelope ∩ profile) − original`. Native Common and Cut operations must complete and return valid geometry; fuzzy tolerance is zero. All 25 actual parts in all six states must leave the original voids empty. Boolean errors fail validation. No generic exception is interpreted as zero volume, and no fuzzy tolerance or minimum flow width is introduced.

After normal ball removal, the cup stays on the knob. With the cup absent from the bar, actual original root-entry faces are extended below all remaining bar-side hardware and that hardware is subtracted. A connected residual must reach both the original root and the free bottom plane, in locked and released states. This establishes geometric entry, not solvent flow rate, hot-glue compatibility or a successful physical debond.

The full original C2 assembly checks remain: valid connected print solids, nut loading and antirotation, receiver installation, collar and captive-washer assembly, all six states, withdrawal, intermediate motion, full ordinary-key entry, end stops, axial capture and positive lock. Finite material witnesses back each moved screw head and nut reaction. The nominal 0.1 mm nut take-up gap is recorded; preload and resin strength are not inferred.

The compact-base gate imports the actual hash-pinned complete 5 and 7 mm assemblies. It removes the exact 25 old C2 actors by material identity, leaving 41 or 42 fixed bodies including base fasteners, stock hex and ballast. New states and whole tools must clear those actual obstacles. A rotation-invariant radius-33 central shadow through the well and the outer support bound establish full rotation and positive-Z withdrawal clearance. The actual selected bar bearing patches must remain identical and backed by the unchanged PTFE and support.

## Assembly phases

1. Before glue, assemble the receiver, collar, cap and captive screw in the bar. The three side carrier screws remain inaccessible inside the ball afterward.
2. With ball and cup absent, secure the spinner's stock hex with its keepers. Fit the cup and adjust its two padded grip screws with the ball absent.
3. Attach or remove the glued ball/bar using the 4 mm collar key and 2.5 mm lock key from below. The complete routine tool shapes remain below the flush lip.
4. After ball removal, the cup's grip screws are accessible again for adjustment or cup removal.
5. Receiver repair may require debonding. The preserved alcohol passages support that intended access, but physical debonding and complete internal repair are unverified.

## Generate private review files

Commit the source before export. The exporter verifies source bytes against the declared Git revision, captures input hashes before building, and rechecks sources and inputs before writing its success receipt. Use a fresh output namespace; existing files, directories and symbolic-link aliases are rejected without deleting prior receipts.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/disco-bar/check_debond_collar.py \
  --step /absolute/path/to/Disco\ Ball.step \
  --baseline-receipt /absolute/path/to/frozen-C2/receipt.json \
  --compact-receipt /absolute/path/to/compact-mount-v4/receipt.json \
  --output /private/tmp/new-debond-collar-review
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/disco-bar/check_debond_boundaries.py
```

The normal export command runs the passage and installed-access gates before exporting STEP/STL files or writing a success receipt. It requires the pinned baseline and compact receipts; these checks cannot be omitted. Each STEP export is compared to its source material in both directions, and each STL is checked for watertight topology, winding and volume. The receipt names the immutable source revision and all verified input and output hashes. It does not publish a scene or release files for printing.
