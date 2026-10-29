# Test the mating latch before printing the full bar

Use this packet for the agreed unloaded first-fit trial. It keeps the actual C2 lock, drive, race, carrier fasteners, capture flange and pilot keys. Two source parts are shortened by planar cuts. Nothing is scaled, and no latch or hardware interface is replaced.

The mouth fixture retains source Z=-12 through 0 mm from the verified bar. The cup-rim fixture retains source Z=-8 through 0 mm from the verified cup. The receiver halves, collar, cap and purchased hardware are exact frozen C2 components. This packet does not test the padded knob grip, spinner fit, box ports, ball attachment or full-bar strength.

## Generate and inspect the packet

Run the checker against the frozen candidate receipt:

```sh
/Users/anulman/.local/share/show-tools/cad/venv/bin/python hardware/cad/disco-bar/check_standard_first_article.py --source hardware/cad/build/review-candidates/4903640/C2/receipt.json --output /private/tmp/standard-first-article
```

Use the resulting `receipt.json` to check the source hashes, trimmed regions and exported files. The checker rejects a different source receipt. It verifies the exact retained material, assembly paths, motion, ordinary-key access and positive retention before exporting STEP and STL files.

## Prepare six printed parts

Print one copy of each of these files from `review_components`. Let the fabricator choose orientation, supports and material preparation.

- `mouth-only-latch-test-fixture.stl`
- `cup-rim-latch-test-fixture.stl`
- `fixed-receiver-half-A.stl`
- `fixed-receiver-half-B.stl`
- `standard-screw-drive-collar.stl`
- `preassembled-captive-lock-cap.stl`

The remaining exports show purchased hardware for assembly review. Do not print the modeled screws, nuts or washer.

Prepare four Accu SSB-M3-8-A2 button-head screws, five Harrison Silverdale 10401 M3 SS full nuts, one plain-stainless WDS 899-M3-12M3 captive screw and its WDS 899-M3 threaded washer. Use ordinary 2 mm, 2.5 mm and 4 mm hex keys. The [candidate parts list](standard-collar-proposal.md#parts-and-tools) links the supplier specifications. No pads, shoe screws, spinner, adhesive or full bar are needed for this latch trial.

## Assemble the actual interfaces

1. Put the captive screw through the separate cap. Wind the purchased washer over its threaded tip onto the reduced neck. Seat the washer in the cap recess.
2. Lower the cap, screw and washer onto the collar. Load the permanent cap-joint nut through its inner radial opening. Fit one M3 × 8 button-head screw with the 2 mm key.
3. Back the captive screw out to its washer stop. Its modeled travel is 6 mm. Do not force the stop.
4. Put the collar midway between release and lock. Load the fixed lock nut into the back of the receiver bracket. Bring both receiver halves laterally around the collar.
5. Load three nuts through the mouth fixture's inner radial channels. Insert the receiver and collar assembly into the mouth fixture. Fit the remaining three M3 × 8 button-head screws from outside.
6. Set the collar to release with the 4 mm key. Place the mouth fixture onto the cup-rim fixture. The pilot keys and release slots must seat without force.
7. Turn the collar to its locked stop with the 4 mm key. Remove that key. Engage the captive lock with the 2.5 mm key.

The permanent cap joint stays assembled throughout the trial. Use the separate 4 mm drive to turn the collar. Do not push the captive screw sideways as a lever.

## Complete the unloaded trial

Support the fixtures by their printed rims. Keep the ball and other loads off the test assembly.

1. Confirm that the seated pilot keys prevent relative rotation of the mouth and cup fixtures in both directions.
2. Confirm that the locked collar retains the cup rim and that the engaged captive screw prevents the collar from turning toward release. Use gentle hand checks. These checks do not measure load capacity.
3. Back the captive screw out to its washer stop with the 2.5 mm key. Remove the key. Confirm that the screw and washer remain captured.
4. Turn the separate drive 90 degrees to release with the 4 mm key. Remove the key.
5. Withdraw the mouth fixture straight from the cup-rim fixture. Confirm that the collar, cap, screw and washer remain on the mouth fixture.
6. Reinsert, turn the collar to lock, then engage the captive screw. Repeat the release-and-lock sequence for 20 unloaded cycles.
7. Inspect the cap roof, washer shelf, race lips, drive socket, end stops and carrier mounts. Record binding, cracks, loose nuts, escaped hardware or incomplete seating.

If a part binds, cracks or loses retention, stop the trial and record the location. Do not approve the full batch from an incomplete trial. Twenty unloaded cycles establish first-fit operation only. They do not prove durability, resin strength, safe operating torque or loaded ball retention.

The full bar remains print-ready under the operator's instruction. The fabricator decides any print-time preparation or skipping. This small test packet does not add a sealed-cavity prerequisite.
