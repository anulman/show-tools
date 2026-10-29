# Resin retention candidate and printer trials

This is a new, unported candidate. It does not replace the published final-C/base models or their immutable exports. The simpler collar, operator spinner dimensions and final mouth spacing remain separate integration inputs. The temporary gap is a reproducible packaging value, not a selected fit. No viewer or service is started.

The manufacturer drawings establish the button's nominal 98.5 mm diameter and M24 × 2 thread, and SpinTrak's nominal 28 mm body, 6 mm shaft, 34/44 mm knobs and 1–25 mm panel range. They do not establish the actual stock hex's across-flats dimension or thickness, or installed knob height. No dependent hex-well change is made here. The confirmed 63.5 mm arcade reserve, ground datum and roof alignment remain unchanged.

## Standard hardware

The candidate uses ISO 7380-1 M3 × 0.5 button-head screws: maximum head diameter 5.7 mm, maximum height 1.65 mm, ordinary 2 mm hex drive. Nut geometry follows the DIN 934/ISO 4032 M3 envelope: 5.5 mm maximum AF and 2.4 mm maximum height. The checks also use a smaller 5.32 mm AF, 6.01 mm corner envelope when checking rotation restraint. These are purchased hardware envelopes, not printed threads.

Supplier specifications: [button screw](https://dibolt.co.uk/products/m3-x-10mm-socket-button-screw-high-tensile-grade-10-9-bright-zinc-plated-iso-7380/), [manufacturer head table](https://eshop.boellhoff.de/out/media/pdf/ISO_7380-1_Edelstahl_A2_Innensechskant___de.pdf), [nut](https://dibolt.co.uk/products/m3-hexagon-full-nuts-black-stainless-steel-a2-304-din-934/). Equivalent purchased parts must meet the recorded envelope; different head styles are not interchangeable by thread size alone.

The selected trial bore is 3.6 mm, nut pocket 5.8 mm AF, and head pocket 6.3 mm diameter × 1.85 mm depth. Cover seats rise 1.5 mm inward at the four corners and matching shell reliefs receive them. The exterior ground face stays in place, while the actual head-seat web becomes 2.65 mm. The central floor retains its reserve.

Each `coupon-AF5p7`, `coupon-AF5p8` and `coupon-AF5p9` trial has separate `lower` and `upper` print parts. These reproduce the actual raised cover seat, bore, head recess, nut loading and bearing web. The filename identifies the pocket size. Load a real nut with the halves apart, mate them, then insert a real M3 × 10 button screw. The CAD checks require maximum-size hardware clearance, minimum-size nut rotation restraint, head/nut bearing reactions, nut insertion after printing and full nominal nut engagement plus one pitch. Print these small trials with the intended resin, orientation, washing and cure process before full shells. Choose the smallest pocket that permits assembly without force while restraining rotation; no torque limit is inferred.

## Buffer retained below the opening plane

The operator confirmed that the internal bar root is approximately flush with the outer ball opening. The v1/v2 raised cap was therefore rejected. The replacement requires every fixed component outside the original R47.230665 profile to stay at least 0.5 mm below the root plane. The complete fixed-base guard checks printed parts, PTFE and hardware, and a whole-candidate regression reinstates the old cap to prove rejection. No ball sphere is invented.

The replacement uses a flat ID88/OD92 bearing annulus and four 8 mm-wide ears cut from the same purchased 1 mm PTFE sheet. A 150 × 150 mm blank gives cutting margin. Each ear bends down 1.8 mm over a 3 mm projected run and remains flat under its fastener. The true developed ramp length is 3.498571137 mm, so its flat pattern adds 0.498571137 mm radially. The mitered CAD profile retains exactly 1 mm normal sheet thickness; formed and flat stock volumes agree. Sharp miter geometry is a forming model, not a claimed physical bend radius. The spacer has open reliefs and ramps 0.05 mm below the modeled bend; the active flat annulus and outer ears have their own flat seats.

Four ordinary [M3 ISO10642 countersunk A2 screws](https://www.accu.co.uk/countersunk-socket-head-screws/5430-SSK-M3-25-A2) retain the ears under their cones. Their maximum head is 6.72 mm diameter × 1.86 mm height and uses the same ordinary 2 mm hex driver as the other box hardware. At provisional g19 they are M3 × 25, measured INCLUDING the head. `Joint.length_datum_z` explicitly distinguishes this basis from button screws measured under the head. The maximum head has 0.64 mm nominal clearance to each ear side and end. At the nominal reference pose its top is 0.5 mm below root. Smaller heads seat farther down the cone; all four seats are checked at diameter 5.54/6.72 mm and angle 90/92 degrees, including axial capture after seating, hardware reactions and root-plane clearance.

The cap print part is removed. The PTFE ears and screw holes provide positive axial/radial retention. The developed flat pattern is exported separately under `material-patterns/`, explicitly excluded from print instructions. Cut, form and counterseat this stock material against the printed spacer during the printer's fit stage. The revised full joint leaves 0.69 mm material below the counterseat at the pilot edge; every ideal seated minimum/maximum head and 90/92-degree case must preserve at least 0.5 mm. The earlier 1.2 mm-drop joint left only 0.09 mm and is historical, not the final choice. Actual forming, creep, drag, tightening load and wear remain physical trials; the modeled cone reactions do not establish those properties. Contact support and the complete ordinary-key collar workflow still require the new collar artifacts.

The temporary gap is now 19 mm and the buffer ID is 88 mm to follow the new collar proposal. Neither is an installed measurement. The three operator spinner dimensions remain the dependent fit inputs. This proposal changes no old immutable assets.

## Contained ballast and cable anchorage

Each box receives a separate capsule with a screwed lid, 2 mm floor and 2 mm lid. Eight nominal 6.35 mm [Pinewood Pro 021244 tungsten cubes](https://www.pinewoodpro.com/tungsten-cube-weights.html) fit a row; their supplier-rounded nominal mass is 38.4 g. This is packaging evidence, not a required stabilizing mass. The rear compartment grows to 14 mm internally without changing external datums. Capsule walls retain cubes when the enclosure cover is removed; support the capsule during that operation. The capsule is not sealed for powder or liquid. Rattle, cushioning and stability require physical trials.

Two closed eyes are fused to the cover. A purchased [HellermannTyton T18I 111-02370](https://www.hellermanntyton.com/products/cable-ties-inside-serrated/t18i/111-02370), 145 × 2.5 × 1.2 mm, threads through them and wraps the heatshrunk bundle. The CAD uses a conservative 1.3 mm tail and oversized head envelope. Complete finite loop/head witnesses clear proposed 3 and 8 mm cylindrical bundle gauges and leave length for a 20 mm handling tail. This establishes routing witnesses, not actual tie bending, wire bend radius, head threading by hand or pull resistance. Heatshrink protects the bundle; the closed printed eyes provide its box anchor. Do not transfer the manufacturer's tie tensile rating to the printed assembly.

At provisional g19, one arcade box uses six M3 × 10 screws and six nuts: four cover joints and two capsule joints. One knob box uses those six joints, two M3 × 12 keeper joints and four M3 × 25 countersunk buffer-ear joints: twelve screws and twelve nuts. The existing spinner hex is not an additional purchased nut. One ordinary cable tie is proposed per box. Bar/collar fasteners are a separate inventory.

## Reproduce and review

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_resin_retention.py
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/resin_base.py \
  --variant arcade-inclined --output /tmp/resin-v2/arcade
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/resin_base.py \
  --variant knob --gap 19 --output /tmp/resin-v2/knob
```

Receipts record actual part and coupon STEP/STL hashes, normalized single-solid validation, two-way STEP material equality, assembly equality, standard hardware dimensions and source hashes. Tests reject a freely rotating nut, missing nut roof, missing buffer cap, missing cable anchor, oversized tie tail, short screw and open ballast lid. Actual cover withdrawal, nut loading, installed capsule/hardware separation and the arcade's complete axial corridor are checked.

`independent_base_geometry_checks_pass` is separate from `geometry_review_pass`, which remains false until collar integration. `NOT_READY` remains in effect for fitted manufacture. The next physical trials are the hardware coupons, sleeve/tie threading and pull test, buffer capture/drag, capsule handling/rattle, and assembled load/stability checks. The printer protocol is owned by the coordinator.

The Joint record owns each declared XY seat and its screw/nut shapes. All hardware exports derive from these records. Axis checks reject swapped nuts and whole pairs moved to another valid seat, both at helper and whole-candidate level; roof reaction and Z overlap alone are insufficient. The same class was previously fixed in a915442 and reappeared in a5bf946.

The next integrated purchasing references use natural A2 [SSB-M3-10-A2](https://www.accu.co.uk/socket-button-screws/8103-SSB-M3-10-A2) button screws and [HPN-M3-A2](https://www.accu.co.uk/hexagon-nuts/7888-HPN-M3-A2) nuts. The earlier Dibolt 10.9 screw page was a dimensional reference, not an A2 purchase selection. Live stock and Canadian checkout are not verified.

[The actual one-ear trial](EAR_TRIAL.md) exercises the revised full joint with two small print pieces and separate developed/formed PTFE references. Its geometry must remain material-identical to the pinned full source.
