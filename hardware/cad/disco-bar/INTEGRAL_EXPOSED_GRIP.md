# Integral exposed opposed-shoe concept

This is a separately exported concept, not a manufacturing admission. It replaces the cup, collar, cover and M4 latch with a single printed extension of the complete original bar. The two original rigid shoes, two cut pads, two M3 set screws and two M3 nuts are reused geometrically. There are three physical printed pieces from two designs: integral bar and two shoes.

The selected exploratory exposure is 22 mm below the original ball-opening plane. Side screw axes are 9 mm below that plane, and the complete shoes occupy 2 to 16 mm below it. The conical external foot grows from the original 47.2306651 mm radius to a proposed 51 mm radius. These are design parameters, not hardware measurements. A straight full-width extension was considered but offers no material or access advantage over this one-piece taper.

The original bar remains exactly at source Z -109.22 to 0; the extension occupies positive Z. This keeps the measured insertion profile and full attachment reach. Original debond lumens are preserved and extended through the foot to its exposed end. The foot ends at the proposed knob-underside plane, so it does not intentionally occupy the space below the knob.

The operator subsequently estimated about 3/32 inch (2.38125 mm) between the knob underside and the top of the stationary flange. This is approximate and has no verified tolerance. The flange thickness and actual roof-contact datum are still missing. The concept has no base, flange or roof alignment and makes no installed-clearance claim.

The 22 mm variant preserves the original blind socket, so it does not add an axial stop at the proposed knob top, source Z -3.4 mm. The old stop remains at -25.4 mm. The operator must hold the ball at height during gripping; load capacity, friction, screw preload, pad adhesive, integral shell strength and fit remain unverified. A separate relocated-stop design can be compared without changing this frozen concept.

`integral_exposed_grip.py` exports nine valid actual STEP/STL components plus an assembly and `concept.json`. `check_integral_exposed_grip.py` checks the actual files with strict native predicates: both directions of complete original negative-Z material equality, original channel material/void equality, clear extended lumens, a nominal socket-radius knob approach, shoe/pad axial and radial paths, nut radial loading, screw entry and exposed-side key bounds. Whole nominal 100 by 20 mm L-key bodies are contained at operation and withdrawal extremes; the continuous bound covers the full approach and lower-half reindexing operation. Actual tool dimensions and stock screw hex engagement remain physical checks.

This milestone does not yet prove nut axial feeding, full eight-actor lifecycle, installed base clearance, unrestricted rotation against the base, FDM printability or strength. No hidden pre-glue nut or separate receiver is authorized. All eight detachable actors must remain loadable and removable after the integral bar has been glued into the ball.

The read-only concept outputs are `/private/tmp/integral-exposed-grip-concept-v2/concept.json`; the local proof receipt is `/private/tmp/integral-exposed-grip-check-v2/receipt.json`. The earlier 32 mm exposure was a preliminary visual comparison and is not the selected concept.
