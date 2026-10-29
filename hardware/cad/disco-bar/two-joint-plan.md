# Two joints for the disco bar

The corrected design separates knob attachment from ball removal. A shared baseplate stays clamped to the knob. The complete ball/bar assembly latches onto that baseplate and can be removed without changing the knob clamp.

The earlier drawframe mechanisms coupled latch movement to pad pressure. They do not implement this requirement. The coordinator is renaming the current screw study to A and the current bayonet study to B. C1, C2, and C3 below are new bar-to-baseplate latch concepts. A final new C follows only after those three have been modelled, checked, and compared.

## The shared baseplate owns the knob fit

The baseplate contains the original snug socket, its entry bevel, and the fixed 25.4 mm stop depth. The source cylindrical diameter is 44.35475 mm. These are operator-confirmed existing-fit geometry, not independent measurements of the knob.

Two opposed set screws act on retained padded shoes. Their tips do not touch the knurl directly. Captured nuts or other actual threaded hardware provide the screw reaction. The screws are adjusted while the bar is removed, then remain at the same setting throughout every bar-latch operation. Thread hardware, pads, preload, and print tolerances remain proposals until selected and tested.

The operator prefers padding cut from off-the-shelf stock, such as foam, rather than custom compliant parts. New prototypes use simple cut pads on rigid load-spreading shoes. The working interpretation places adhesive between pad and shoe, with an exposed grippy face against the knob. Adhesive contact with the knob is not assumed. The earlier T-backed pad model remains a historical form study; it does not establish the new pad construction.

The baseplate-to-bar pilot provides alignment. Separate positive keys carry clockwise and counterclockwise torque. The latch provides axial capture between the bar and baseplate. The knob clamp's own axial retention is a separate test: releasing the latch must not pull the preset baseplate off the knob.

Print-on-print support contact is confirmed. Which part carries that contact, its seating height, and the complete stock-hex/encoder/box stack still need an installed assembly model. The encoder's existing hex feature must not be treated as a rotating knob clamp or an assumed thrust bearing.

## Three distinct bar-to-baseplate latches

| Concept | Attachment and positive retention | Release and access dependency |
| --- | --- | --- |
| C1: independent quarter-turn retainer | Seat the bar's straight pilot keys, rotate a separate collar under baseplate shoulders, then engage an independent rotation block. Any draw ramp takes up bar/baseplate play only. | Hold the keyed bar as the reaction while operating the collar. Release the block, turn the collar, then lift the bar. Requires access to the separate collar and block. |
| C2: over-centre draw hooks | A draw yoke or equalized hooks engage a baseplate flange. A lever closes against a hard stop beyond centre, with a separate positive catch against reopening. Pilot keys carry torque. | Release the catch and lever before lifting the bar. Requires a reachable lever and catch, with a verified sweep and reaction through the bar. |
| C3: blocking sleeve and rigid dogs | Rigid dogs engage a baseplate groove. An axial sleeve's solid lands block dog retraction, and a separate lock retains the sleeve. Springs may assist motion but are not the retention path. | Deliberately unlock and move the sleeve to expose dog escape pockets, retract the dogs, then lift. Requires access to the sleeve and lock. |

C1 does not rely on twisting the whole ball against a stationary knob. The knob is free to rotate. The keyed bar and a separately operated collar provide the required relative motion and operator reaction. If that collar cannot be reached, C1 is not usable in that placement.

Every concept needs distinct released, seated, and positively locked states. The knob clamp's shoe and pad positions must be identical in all three. No latch motion establishes or adjusts knob-pad preload.

## Installed access permits added spacing and underside controls

The operator confirmed that the baseplate stays clamped to the knob during bar removal. Added collar spacing is allowed. Controls may extend toward the underside, through access openings in the mounting box. The operator prefers a buffer between printed contact surfaces. These permissions allow prototype placement; they do not supply the actual encoder stack height, a buffer material, or a printer tolerance.

The box roof, encoder, knob, baseplate, and full bar must be represented together before placement is approved. The model must show the operator's reaction surface and deliberate release action, not just an unobstructed control on an isolated bar.

The box is stationary while the knob and bar rotate. A fixed access opening needs either clearance at every operating angle or an explicit rotate-to-service-angle procedure. Buffer support must not obstruct the release control, shaft, or stock hex seat. Sliding contact at the box uses a separate proposed wear surface from the high-friction knob pads.

The operator clarified that no additional nut is available above or below the mount. The part's existing hex sits in a well in the roof; the working interpretation seats its top flush with the roof. Earlier underside-retaining-nut proposals are superseded. The seat locates the stationary hex; no additional hardware or upward retention is assumed. Release access does not require a moving box mount or rotating hex recess. Knob and bar rotation, and deliberate latch-control movement, are separate from that stationary mounting joint. Actual hex dimensions and installed stack fit remain unverified.

The operator also authorized comparing tape or latching retention of that stock hex against upward pull. The box-mount session compares two or three approaches, validates them, then synthesizes the simplest candidate from their useful features. These are proposed retainers, not a second mounting nut or a verified load rating. Their geometry must clear the bar latch controls and the rotating assembly. This study remains private until findings are reviewed alongside C1–C3.

The disco-bar and box-mount sessions own separate prototype modules and exchange their access envelopes and datums. Existing viewer geometry remains unchanged during this exploration. The operator requested findings from all three STL-validated prototypes before rendering final designs in the shared viewer. Final C synthesis follows that review.

## Geometry and verification contract

The new module is `baseplates.py` in this directory. Its planned boundary is:

- `knob_baseplate(reference, setting)` supplies the common socket, shoes, pads, and preset screw hardware.
- `bar_latch(reference, baseplate, concept, state)` supplies C1, C2, or C3 without changing that setting.
- `verify_assembly(reference, assembly)` checks the complete assembly and its state transitions.

All detachable bars retain the source 109.22 mm reach, nominal 94.46133 mm insertion profile, long hollow body, and far attachment end. Local cup geometry may change to receive the baseplate. The original mouth, insertion void, and fixed stop are therefore checked in the assembled joint and in the baseplate left on the knob, rather than assumed to remain features of the bar body alone.

Verification must cover preset screw/tool access with the bar removed, retained pads, complete insertion envelopes, positive torque keys, rigid clearances, capture and unlock paths, actuator reaction, and finite support connections. Each print piece needs valid-solid and STEP/STL checks. Attempted opening with the lock engaged must encounter actual blocking geometry. Ordinary clockwise and counterclockwise use must not follow an unlock path.

Deliver the common baseplate and three separately checked prototypes first. Compare their receipts, part count, assembly sequence, release access, and failure paths before synthesizing final C. CAD checks do not establish clamp force, holding strength, fatigue, wear, or safe encoder loads. Those require physical grip, lift, reversal, release, and repeated-cycle tests.
