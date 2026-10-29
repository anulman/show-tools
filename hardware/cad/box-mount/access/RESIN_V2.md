# Resin retention candidate and printer trials

This is a new, unported candidate. It does not replace the published final-C/base models or their immutable exports. The simpler collar, operator spinner dimensions and final mouth spacing remain separate integration inputs. The temporary 9 mm gap is a reproducible packaging value, not a selected fit. No viewer or service is started.

The manufacturer drawings establish the button's nominal 98.5 mm diameter and M24 × 2 thread, and SpinTrak's nominal 28 mm body, 6 mm shaft, 34/44 mm knobs and 1–25 mm panel range. They do not establish the actual stock hex's across-flats dimension or thickness, or installed knob height. No dependent hex-well change is made here. The confirmed 63.5 mm arcade reserve, ground datum and roof alignment remain unchanged.

## Standard hardware

The candidate uses ISO 7380-1 M3 × 0.5 button-head screws: maximum head diameter 5.7 mm, maximum height 1.65 mm, ordinary 2 mm hex drive. Nut geometry follows the DIN 934/ISO 4032 M3 envelope: 5.5 mm maximum AF and 2.4 mm maximum height. The checks also use a smaller 5.32 mm AF, 6.01 mm corner envelope when checking rotation restraint. These are purchased hardware envelopes, not printed threads.

Supplier specifications: [button screw](https://dibolt.co.uk/products/m3-x-10mm-socket-button-screw-high-tensile-grade-10-9-bright-zinc-plated-iso-7380/), [manufacturer head table](https://eshop.boellhoff.de/out/media/pdf/ISO_7380-1_Edelstahl_A2_Innensechskant___de.pdf), [nut](https://dibolt.co.uk/products/m3-hexagon-full-nuts-black-stainless-steel-a2-304-din-934/). Equivalent purchased parts must meet the recorded envelope; different head styles are not interchangeable by thread size alone.

The selected trial bore is 3.6 mm, nut pocket 5.8 mm AF, and head pocket 6.3 mm diameter × 1.85 mm depth. Cover seats rise 1.5 mm inward at the four corners and matching shell reliefs receive them. The exterior ground face stays in place, while the actual head-seat web becomes 2.65 mm. The central floor retains its reserve.

Each `coupon-AF5p7`, `coupon-AF5p8` and `coupon-AF5p9` trial has separate `lower` and `upper` print parts. These reproduce the actual raised cover seat, bore, head recess, nut loading and bearing web. The filename identifies the pocket size. Load a real nut with the halves apart, mate them, then insert a real M3 × 10 button screw. The CAD checks require maximum-size hardware clearance, minimum-size nut rotation restraint, head/nut bearing reactions, nut insertion after printing and full nominal nut engagement plus one pitch. Print these small trials with the intended resin, orientation, washing and cure process before full shells. Choose the smallest pocket that permits assembly without force while restraining rotation; no torque limit is inferred.

## Retained buffer

The new PTFE envelope is ID86/OD100 × 1 mm, replacing the old OD91 proposal for this candidate only. Buy a larger blank with cutting margin, such as 150 × 150 × 1 mm. The spacer supports it, a surrounding wall locates it radially, and a removable cap overlaps its outer rim. Four M3 screws through the spacer and roof fix the entire kit to the box. Captive nuts enter through the full 10 mm roof thickness. At the temporary g9, the cap screws are M3 × 20; the generator selects a longer standard length when the gap increases.

The cap opening is diameter 98 mm, beyond the source bar's complete radius 47.230665 mm. The cap starts 0.2 mm above the buffer top. Its outer radius is 57 mm; screw axes are R53 at diagonal angles. The cap and maximum head envelopes clear the internal bar radial bound at every rotation angle. That bound excludes the outer ball shell. The operator has since confirmed that the bar root is approximately flush with the ball opening: the raised cap outside R47.230665 is therefore a known unsuitable geometry for full assembly and must be redesigned below that plane. These exports support hardware coupons and independent retention review only; do not fabricate this raised-cap arrangement as the finished base. The forthcoming hand collar must still be checked separately, and actual contact/drag must be recalculated for the wider ring. Grip-pad material is a separate material.

## Contained ballast and cable anchorage

Each box receives a separate capsule with a screwed lid, 2 mm floor and 2 mm lid. Eight nominal 6.35 mm [Pinewood Pro 021244 tungsten cubes](https://www.pinewoodpro.com/tungsten-cube-weights.html) fit a row; their supplier-rounded nominal mass is 38.4 g. This is packaging evidence, not a required stabilizing mass. The rear compartment grows to 14 mm internally without changing external datums. Capsule walls retain cubes when the enclosure cover is removed; support the capsule during that operation. The capsule is not sealed for powder or liquid. Rattle, cushioning and stability require physical trials.

Two closed eyes are fused to the cover. A purchased [HellermannTyton T18I 111-02370](https://www.hellermanntyton.com/products/cable-ties-inside-serrated/t18i/111-02370), 145 × 2.5 × 1.2 mm, threads through them and wraps the heatshrunk bundle. The CAD uses a conservative 1.3 mm tail and oversized head envelope. Complete finite loop/head witnesses clear proposed 3 and 8 mm cylindrical bundle gauges and leave length for a 20 mm handling tail. This establishes routing witnesses, not actual tie bending, wire bend radius, head threading by hand or pull resistance. Heatshrink protects the bundle; the closed printed eyes provide its box anchor. Do not transfer the manufacturer's tie tensile rating to the printed assembly.

At the temporary g9, one arcade box uses six M3 × 10 screws and six nuts: four cover joints and two capsule joints. One knob box uses those six joints, two M3 × 12 keeper joints and four M3 × 20 buffer-cap joints: twelve screws and twelve nuts. The existing spinner hex is not an additional purchased nut. One ordinary cable tie is proposed per box. Bar/collar fasteners are a separate inventory.

## Reproduce and review

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_resin_retention.py
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/resin_base.py \
  --variant arcade-inclined --output /tmp/resin-v2/arcade
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/resin_base.py \
  --variant knob --gap 9 --output /tmp/resin-v2/knob
```

Receipts record actual part and coupon STEP/STL hashes, normalized single-solid validation, two-way STEP material equality, assembly equality, standard hardware dimensions and source hashes. Tests reject a freely rotating nut, missing nut roof, missing buffer cap, missing cable anchor, oversized tie tail, short screw and open ballast lid. Actual cover withdrawal, nut loading, installed capsule/hardware separation and the arcade's complete axial corridor are checked.

`independent_base_geometry_checks_pass` is separate from `geometry_review_pass`, which remains false until collar integration. `NOT_READY` remains in effect for fitted manufacture. The next physical trials are the hardware coupons, sleeve/tie threading and pull test, buffer capture/drag, capsule handling/rattle, and assembled load/stability checks. The printer protocol is owned by the coordinator.

The Joint record owns each declared XY seat and its screw/nut shapes. All hardware exports derive from these records. Axis checks reject swapped nuts and whole pairs moved to another valid seat, both at helper and whole-candidate level; roof reaction and Z overlap alone are insufficient. The same class was previously fixed in a915442 and reappeared in a5bf946.
