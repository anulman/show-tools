# Adafruit 100 mm button reference

`button.step` is the unmodified manufacturer model for [Adafruit 1185](https://www.adafruit.com/product/1185). The operator confirmed four buttons of the same model in red, green, blue, and yellow on October 28, 2026. This red-part model represents the shared family provisionally. Physical equivalence across the four buttons remains unmeasured.

`source.json` pins the upstream repository commit, source path, and SHA-256. The accompanying upstream MIT `LICENSE` covers the CAD repository. No geometry has been healed, fused, or substituted.

The import contains five solids. Solid 1, using zero-based numbering, fails OpenCascade validation. The complete imported shape also fails validation. Its bounding box is approximately 98.5 × 98.5 × 68.5 mm. These are model extents, not measured dimensions or a verified clearance envelope. The model may contain overlapping or differently positioned internal parts. Do not export it as a printable button or subtract it blindly from a mount.

The [manufacturer drawing](https://cdn-shop.adafruit.com/datasheets/massivebutton.jpg), inspected visually, labels a 98.5 mm body diameter and M24 × 2 mounting thread. The nominal 100 mm product name does not specify the mounting hole. A thread designation does not supply a finished hole clearance or printer compensation.

## Mechanical facts still needed

No fitted mount can be generated until the relevant interfaces and construction choices are confirmed. Record actual measurements beside their datum and method. A ruler can establish rough layout; use calipers or a physical fit coupon for close fits.

| Item | Current status |
| --- | --- |
| Overall body and underside profile on each colour | Manufacturer reference only; compare against physical parts |
| Stem outside diameter and usable threaded length | Unmeasured |
| Retaining nut outside diameter and tool access | Unmeasured |
| Panel contact face and desired exposed height | Undecided |
| Wood thickness and recess depth | Undecided |
| Button tilt and arrangement | Undecided |
| Microswitch, connectors, and wire exit clearance | Unmeasured with harness attached |
| Fastener type and attachment to wood | Undecided |
| Printer, material, and fit allowance | Unselected; require a fit coupon |

The four-copy preview uses illustrative 120 mm centre spacing and uniform colours over the whole reference. It does not propose a housing layout, reproduce the real plastic colours, or assign musical bindings.
