# Compare four button bases

Publish the four form studies to the existing viewer:

```sh
hardware/cad/cad bases --depth 35.25 --tilt 5 --show --reset-camera
```

The comparison follows the October 28 Scrawl at 0:12 through 1:01. The operator clarified that base depth starts at 1.5 times the stem length below the button body. The reference STEP extends 23.5 mm below its body plane at Z=0, giving the initial concept depth of 35.25 mm. This is a model-derived proportion, not a measured module clearance.

| Concept | Button colour | Form |
| --- | --- | --- |
| A | Red | Square base with rounded vertical corners |
| B | Green | Circular base that widens toward a bottom flange |
| C | Blue | Rounded square with a sloped roof and button tilted 5 degrees toward -Y |
| D | Yellow | Elongated capsule with a rear service opening for cable access |

The colour associations identify the comparison only. Every design could hold any button colour. Positions in the comparison do not specify the final arrangement. Each beige base and coloured button reference has a separate tree entry. Use the eye controls to hide a button and inspect its base, or use Clip for a section.

For another depth, pass a different `--depth` in millimetres. `--tilt` controls only C and accepts 0 through 5 degrees. Omit `--reset-camera` to retain the current view. Omit `--show` to validate and export without changing the viewer. If the page misses a publish, reload it and publish again.

All bases have open undersides and conceptual cavities. A, B, and D have flat top faces at Z=0. C has its top-face centre at Z=0 and a flat bottom at Z=-depth. The sloped roof rises on +Y, so the button faces -Y. This direction describes the model coordinates; the operator can choose the installed orientation later.

The initial 28 mm stem opening, 5 mm nominal roof, cavity sizes, corner radii, flange, and rear opening are design choices for visual comparison. They do not establish retaining-nut access, connector clearance, screw positions, print allowance, or a construction method. C's roof thickness is measured vertically. No switches, wires, or connector replicas are invented. The separate button reference retains its upstream invalid geometry.

## Inspect the exported concepts

The command writes one STEP and STL per base, without the button reference:

```text
hardware/cad/build/base-concepts-35.25mm-5deg/
  A/concept-NOT-FIT-VERIFIED.step
  A/concept-NOT-FIT-VERIFIED.stl
  B/...
  C/...
  D/...
  receipt.json
```

The receipt records parameters, source hash, model bounds, solid validity, and export checks. Each base must be one valid positive-volume solid, survive a STEP round trip, and produce a watertight, consistently wound STL with matching volume. Passing these checks establishes geometric integrity. It does not approve a print or prove physical fit.

Before cutting wood or printing a fitted mount, complete the [mechanical worksheet](components/adafruit-1185/README.md#mechanical-facts-still-needed). The next revision can adapt a preferred form to wood construction, a printed shell, or both once those choices and measurements are known.
