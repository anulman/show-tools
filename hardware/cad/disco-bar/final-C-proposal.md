# Final C for human review

Final C keeps the full-height source bar and the preset cut-stock-pad knob clamp. A separate quarter-turn collar releases the bar. Its safety pin remains captive in the carrier throughout service. This is a geometry-checked proposal for human review, not manufacturing approval.

## Operator sequence

1. Lift the box for underside access and rotate the ball to the box's service index. The integrated box proposal defines the index and ports.
2. Hold the keyed bar as the reaction. Use the proposed 0.6 × 2.4 mm slot-driver blade to push the captive pin 0.8 mm toward the ball.
3. Keep the pin pushed and turn it 90 degrees into the release channel. Remove the driver.
4. Insert the proposed fork 4.5 mm tangentially through the housing window, underneath the cap. Pull the pin 2.8 mm from its pushed position, ending 2 mm outward from its original position. Remove the fork. The cross-lug meets the fastened roof and prevents further extraction.
5. Seat the proposed two-pin spanner in the collar's opposed blind holes. Turn the separate collar 90 degrees to align its fingers with the baseplate notches. Remove the spanner.
6. Lift the complete bar off the preset baseplate. The knob clamp, shoes, pads, screws, and their settings stay in place.

To refit the bar, align its straight pilot slots, seat it, turn the collar back with the spanner, and reverse the pin sequence. Push the pin inward from its released position, turn it back, and use the fork to seat it against the locked pocket's upper stop. The closed pin blocks collar reversal. No spring, gravity return, or ball-only twist is assumed.

The pin is a custom control requiring fabrication, not a selected purchased part. The roof, carrier, collar, bar, cup, and shoes are printable geometry proposals. The screws and nuts are standard-fastener reference envelopes with specifications still unselected. Pads are cut-stock reference envelopes.

The driver, fork, and external spanner are proposed custom tool shapes requiring fabrication. A catalog tool or fabricated tool has not been selected. Tool engagement is checked in CAD; hand access and practical ergonomics require operator review.

## What changed from C1

The release pin sits at source angle 135 degrees, R38.5 mm. This places its housing between the two collar-tool arcs rather than inside the original 45-degree arc. A 6.8 × 6.8 × 4 mm relief, rotated 45 degrees locally at this location clears its inward corner during bar withdrawal. The relief affects the flange only. Material inside R33 and all grip pieces remain unchanged.

A blind lug channel replaces the removable key's exit slot. The cross-lug cannot pass the roof at the released stop. A separate printed roof and two proposed screw/nut pairs make the pin installable; this is an additional carrier fastener joint, not an encoder retaining nut. The roof nuts load through explicit side channels before the screws are fitted. Actual fastener specification and strength remain open.

The pin has a slotted cap for push and torque. A U-shaped fork engages underneath for pull. The fork approaches along source angle 45 degrees, tangent to the key’s R38.5 mm position. Its housing window and flange relief share this orientation. Its tight containing sweep includes the U-shaped tip and off-axis stem.

The spanner bridge is at source Z100–106 mm, below the closed box cover. Only its two long off-axis pins enter the box. Its handle remains off-axis at source Z105–130 mm. Straight entry stages the whole spanner with its pin tips at source Z90 mm. The 89.1 mm approach translates its handle to source Z219.1 mm. For a cover near source Z89.055 mm, the tool alone needs about 130.045 mm of space below the cover before additional clearance. The lifted-base check determines the final proposed lift. The driver and fork also have complete axial entry envelopes. No tool shaft occupies the stationary encoder axis. Holding and using the lifted box at that height remains unverified. Two Ø2.4 mm, 1.5 mm-deep blind holes in the collar accept proposed Ø2 mm spanner pins at 72.6 mm spacing. Their remaining bottom floors are 0.5 mm thick.

Source coordinates place the bar mouth at Z0, with the full source bar extending to Z−109.22 mm. Withdrawal moves toward negative source Z. The proposed box transform rotates 180 degrees around X and places the mouth at box Z9 mm. Closed controls reach source Z8.6 mm, leaving 0.4 mm nominal roof clearance before tolerances. During service, the pin reaches Z10.6 mm and temporary tools extend through the underside ports. The fixed box geometry must pass its own integrated checks.

## Assembly sequence

Load the two roof nuts through the carrier's side channels. Before fitting the roof, insert the custom pin with its lug along the open Y channel. Push it into the turning chamber, turn it to the locked X pocket, and seat it outward. Lower the roof over the cap and fit its two screws. The roof can pass over the cap while the lower lug remains beneath it. Roof and nut insertion have explicit collision samples. The carrier's separate three fastener pairs attach it to the bar.

## Evidence and limits

`check_final_c.py` checks all 24 components in seven assembly states, including STEP round trips and watertight, consistently wound STL exports. It compares every preset piece in both Boolean directions, preserves source reach and far-end geometry, and checks the original radial envelope.

Continuous containing volumes check inward pin motion, the pushed turn, outward pin release, and collar rotation. Intermediate checks cover 9 push poses, 19 pin rotations, 29 pull poses, 46 collar angles, and 36 withdrawal positions at 1 mm spacing. The diagnosed housing withdrawal also has a continuous containing-volume check. The complete withdrawal is sampled; a continuous swept-volume proof for every component is not claimed.

Named rejection tests cover locked collar reversal, unpushed pin rotation, straight pin pull, excessive inward push, released pin extraction, flange capture, and pilot-key reaction. Removing the lug defeats captive retention. Removing the fingers defeats flange capture. Continuous containing sweeps also check the tools through their approach and motion. The actual driver, fork, and spanner solids clear their checked working poses and contact the intended bearing faces when perturbed in the load direction.

The receipt and box interface include hashed state components, actual contact patches, tool solids, containing motion sweeps, and STEP-independent access geometry from `final_c.control_sweeps()`. Contact patches come from actual source faces, not an assumed full annulus.

Hardware standards, printed fit, strength, fatigue, friction, pad adhesion, knob height, and useful preload remain unverified. The roof and pin features are small and need manufacturing review. The nominal g9 gap is a proposal rather than an installed measurement. Box, keeper, buffer, stock-hex, port, and lifted-table checks belong to the coordinated final-base receipt.

## Design decision

The architecture comparison considered a captive blind-channel pin and a screw with an independent retaining washer. The pin was selected because it preserves positive push-turn locking without thread modeling. The screw proposal required additional thread, groove, and clip decisions. The independent judge also selected the pin, with two required additions: actual pull engagement and a buildable assembly sequence. The under-head fork and separate fastened roof address those findings.

The implementation has two new modules. `final_c.build(reference, state)` returns the existing assembly contract; `final_c.control_sweeps()` supplies STEP-independent service geometry. `check_final_c.py` owns evidence and exports. Previous C1/C2/C3 files remain historical studies. The coordinator owns page integration and publication.

## Reproduce

```sh
~/.local/share/show-tools/cad/venv/bin/python \
  hardware/cad/disco-bar/check_final_c.py \
  --step "$SHOW_TOOLS_DISCO_STEP" --output hardware/cad/build/final-c
```

The checker removes stale receipts before running and writes `receipt.json` and `interface.json` only after every required check passes. Local private STEP data and derived exports remain ignored.
