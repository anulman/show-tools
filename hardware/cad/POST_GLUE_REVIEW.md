# Three post-glue coupling prototypes

All three mechanisms start with the **bare printed bar already glued inside the ball**. Every cup, collar, pad, screw and nut is installed afterward. The complete coupling can be removed and dismantled through the opening without releasing that glue bond. The old collar is withdrawn from the viewer; its source and exports are retained.

The Disco Bar page shows A in orange on the left, B in green in the centre and C in purple on the right. The transparent blue geometry is each candidate's full-height bar. These are human-review candidates, not fabrication approval.

| Candidate | Mechanism | Main tradeoff |
|---|---|---|
| A | Three captured M4 screws/nuts enter keyholes, turn 35°, then seat in hex registers. | Most conventional purchased retention hardware; nine screw turns in three alternating rounds, with underside indexing. |
| B | Three integral printed bayonet lugs turn 35°; one captured M4 screw locks the position. | Fewest parts and fewer operations; printed lugs carry more of the retention load. |
| C | The knob cup stays aligned with the bar; a separate removable collar turns 35° and one captured M4 screw locks it. | Separates latch motion from knob motion, but adds two collar halves and a two-key force-transfer operation. |

The cup/collar never retains the glued bar to the stationary box. The stock hex and its keepers secure the spinner in the box. The bar, cup and knob rotate together over the passive bearing surface.

## Installation and removal

First secure the stock hex in the mounting box and close its keepers. This happens before the coupling obscures them. Support the box on stable bench blocks for underside tool access; the checked tool arrangement uses 180 mm of table clearance. The operator then has both hands available.

Assemble the detachable module outside the ball. Fit it over the knob and adjust its two padded grip screws while the ball is still off. Lower the already-glued ball/bar over this complete module. Engage, lock and unlock the coupling from beneath with ordinary long L-shaped hex keys. Reverse the sequence to lift the ball away; release the grip and lift the module off the knob before dismantling it outside the ball.

For A, tighten or release each M4 screw by one full turn per round. Do three rounds, maintaining support under the ball. Withdraw the key before indexing the whole rotating assembly to reach the next screw. Including the captured head's 0.5 mm float, the checked worst relative nut-height loss is 1.2 mm; 0.3 mm of nominal hex engagement remains. Physical fit and load capacity at that small engagement require testing.

For B, the single lock screw needs three turns. Keep the ball supported while the nut enters or leaves its register. The bayonet turns with the cup and knob relative to the held ball during installation and removal.

For C:

1. Outside the ball, preload the four cover nuts. Assemble the M4 nut and screw, cover, and two cover screws to collar half A. Slide that group around the fixed cup. Slide half B and its preloaded nuts under the cover, then fit its two cover screws. This sequence reverses outside the ball after glue.
2. Grip the knob with the complete module. Push the ordinary 4 mm key against its socket floor to hold the collar at its upper stop. Lower the glued ball over the module, then turn the collar 35° while the other hand holds the ball.
3. Rest the ball on the bearing surface. Insert the ordinary 3 mm key and press the screw head onto its seat. Transfer the supporting push from the 4 mm key to the 3 mm key, then withdraw the 4 mm key.
4. With one hand maintaining that push and the other lifting the ball 2.1 mm, seat the nut. Tighten three turns while following the ball back onto the bearing surface. Withdraw the key after clamping.
5. To remove it, push with the 3 mm key and unwind three turns while lifting the ball. Lower the ball onto the bearing surface, transfer the push back to the 4 mm key, withdraw the 3 mm key, turn back 35°, and lift the ball/bar off the whole module.

Do not completely unthread an M4 nut inside the ball. Complete unthreading and all cover/collar work happen with the module outside. A relaxed C collar must be pushed back to its upper stop before turning; its recovery motion is checked. Its captured head may float during the turn, but must be reseated before nut seating and clamping.

## Verification result

The finite verifier exhaustively enumerates the instructed discrete operating states, including interrupted key-out indexing and C's relaxed-race recovery. Every reachable state has a path back to the bare glued bar with all coupling components outside. Continuous CAD envelopes separately cover the strokes between those states. This does not prove arbitrary misassembly, damaged parts or physical strength.

| Requirement | A | B | C | Evidence |
|---|---:|---:|---:|---|
| Post-glue installation and complete reversal | PASS | PASS | PASS | 67 / 33 / 39 reachable states; every state removable; exact inventories of 22 / 18 / 22 detachable actors. |
| Installed access only through opening/underside | PASS | PASS | PASS | Actual part paths and full ordinary-tool entry, operation and withdrawal bounds; C also checks its partial external assembly groups. |
| No custom fork, spanner or driver | PASS | PASS | PASS | Ordinary 1.5, 2, 3 and 4 mm hex keys; purchased M3/M4 hardware. Printed pieces are structural coupling parts and pad carriers. |
| Unlimited assembled rotation | PASS | PASS | PASS | Axisymmetric clearance bounds against the actual fixed base at every angle, with no angular samples or external stop; geometry-bound rotor ownership. |
| Full fitted bar profile and socket retained | PASS | PASS | PASS | Actual delivered STEP checks against the pinned original profile, socket void and blind floor. |
| Original debond passages accessible after module removal | PASS | PASS | PASS | Original channel material/void preserved; operator-confirmed access scope. |
| Mounted grip adjustment and module withdrawal | PASS | PASS | PASS | Full grip-key sweeps clear the base at every angle; continuous module/knob service clearance. |
| Displayed files match checked artifacts | PASS | PASS | PASS | STEP/STL hashes, valid closed solids, positive adaptive volume and STL winding/volume checks; 65 visible objects and a fresh inspected canvas. |
| Actual fit, resin strength, grip force and adhesive performance | UNTESTED | UNTESTED | UNTESTED | Requires physical hardware and printed specimens. |

The preserved bar is 109.22 mm high with an original outside diameter of 94.4613302 mm. The accepted socket is 44.35475 mm in diameter, with a 45.94225 mm entry and 25.4 mm depth. Those are socket dimensions, not a newly measured knob diameter. The supplied hex dimensions are 34.925 mm across flats and approximately 6.35 mm thick. Nominal hex-to-knob gaps of 5.25 and 7.25 mm fit the supplied 4.7625–22.225 mm adjustment range.

C's worst captured-head float leaves only 0.1 mm nominal clearance below its bar lip during the turn. This is geometrically clear in the checked files, but particularly sensitive to printing tolerances. Compare the printed fit and operating feel before selecting C over B.

Some source-to-STEP Boolean identity comparisons remain **INCONCLUSIVE** because of native CAD classification failures. They have not been converted to PASS. The delivered STEP files are the authoritative subjects of the requirement checks, and their STL companions are independently checked.

## Reproducing the checks

The final local review bundle is `/private/tmp/post-glue-human-review-20261030-r1/selector.json`. Each candidate has its exact protocol, forward/reverse traces, proof receipts and admission record. `delivery.json` binds the freshly inspected canvas. Input geometry is A/B revision `419ccd7` and C revision `456665c`; final Disco proof helpers are revision `94057a1`.

`verification/publication_bundle.py::load()` rechecks file pins, mandatory geometric results, external action coverage, actor inventory, finite reachability/removal and rotor ownership before the viewer can load a candidate. `verification/freeze_publication.py` produces that bundle from pinned proof inputs. The viewer loads actual checked exports rather than regenerating geometry.

Negative controls reject preinstalled hardware, missing unlock operations, installed side access, custom tools, omitted hardware, altered proof files and connected collision fins. Actual STEP mutations of **each** candidate also reject a shortened bar, a plugged debond passage and an obstructed socket. Generic verifier regressions additionally check all 64 three-location directed graphs against an independent oracle.

Physical validation remains necessary for resin shrinkage/brittleness, captive-pocket life, pad compression/recovery, grip torque/pull strength, bearing drag, shell/glue compatibility, balance and operator handling. No print order or fabrication job has been submitted.
