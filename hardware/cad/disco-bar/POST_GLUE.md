# Post-glue coupling prototypes

These proposals assemble through the root after the bare one-piece bar has been glued inside the ball. They supersede the rejected C2 retention scheme. None is a promoted manufacturing design.

- A uses three M4 bolts with nuts that enter keyholes, turn 35 degrees and seat in integral hex pockets.
- B uses three printed bayonet lugs and one M4 locking bolt.
- C keeps the padded cup stationary while a removable two-piece collar turns 35 degrees. Its integral drive is at 170 degrees before turning. Two external M2 joints close the collar around the cup outside the ball.

Each M4 clamp moves 2.1 mm over three turns at 0.7 mm pitch. Ordinary cap screws and a printed head-capture cover keep the released assembly together. The cover is functional retention hardware. Do not replace it with a reduced-neck screw or washer without a new capture and access proof.

C has axial collar play from -0.5 to +0.6 mm relative to the cup. Normal exported operating poses explicitly hold the upper stop at -0.5 mm. Its 3 mm key must bottom on the socket floor at source Z4.5 to transmit axial force through the head seat to that stop. A floating key at Z4.7 does not establish that force path. The actual STEP race checker bounds the complete released 1.1 mm race travel and 0.5 mm threaded head float at fixed nut orientation, with positive upper/lower-stop, head-seat and cover-capture witnesses. Rotation still requires the upper stop and seated head; the bounds do not authorize free rotation or free nut spin. Operating contact conditions require lifecycle admission.

C's M4 nut enters radially before the screw is inserted. An axial nut approach crosses the fixed upper race. All collar joints, cover hardware, grip hardware and final dismantling remain outside the ball. Normal ball removal leaves the M4 nuts threaded onto their screws.

The original bare-bar profile outside the bounded mouth and both original fluid channels remain protected. Debond access is established after the removable module is withdrawn. Full straight extensions of those channels through the installed module are not guaranteed during actuation.

## Verification

Run the generator/export check with `check_post_glue_candidates.py --step ORIGINAL.step --concept A|B|C --output OUTPUT`. Run actual-artifact assembly checks with `check_post_glue_external.py --source OUTPUT/receipt.json --output PROOF` in the isolated CAD Python environment. Use `check_post_glue_preservation.py --source OUTPUT/receipt.json --reference ORIGINAL.step --output STATIC.json` for actual-file profile, channel, socket and blind-floor checks. For C, use `check_post_glue_race.py --source OUTPUT/receipt.json --output RACE` for released race/head-float bounds and contact witnesses. Source hashes are captured before each run and checked again before its receipt is written.

The delivered STEP solids are authoritative for requirement checks. Some C source-to-STEP Boolean comparisons classify an entire part as difference in one direction while returning zero in the other. Raw signed mass is positive and infinity classifies OUT for both solids; two imports of the same STEP compare empty in both directions. Changing STEP precision, pcurves, split-plane numerical normal, or a temporary split offset did not resolve the source comparison. Its positive results remain recorded as INCONCLUSIVE, never zero or equivalence PASS. Validity, adaptive mass and STL checks do not replace actual STEP geometry, motion, contact and lifecycle proofs.

Endpoint clearance and external assembly/tool bounds are separate milestones. Final admission also needs original-profile/channel/socket checks on actual files, continuous root insertion/turn/clamp/removal, C's race/contact states, unlimited installed rotation against the actual base, and a reversible lifecycle graph bound to those artifacts. Physical fit, preload, grip strength, material durability and adhesive strength remain unverified.

Frozen receipts under ignored build storage are active review evidence. Preserve them and the original input until a self-contained editable design checkpoint and manufacturing handoff have been verified under `docs/data-retention.md`.
