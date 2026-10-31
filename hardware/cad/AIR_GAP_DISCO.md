# Disco prototype with an air gap

This version removes the PTFE bearing sheet, raised bearing support, four countersunk screws, four nuts and optional height cap. The box retains the stock-hex well, two hex keepers, removable bottom and fixed cable route. It has no ballast compartment.

The default bar-root plane is 5 mm above the roof. The stock hex's top is 0.25 mm below the roof, so the nominal knob-underside-to-hex gap is 5.25 mm. This setting lies within the operator's reported 4.7625–22.225 mm adjustment range. The collar extends into the mounting well: 5 mm describes the bar-root plane, not the closest distance between every rotating part and the box. The continuous rotation envelope has a conservative minimum clearance of about 0.255 mm at the hex keepers. This is a geometric lower bound, not a measurement of the actual cured assembly or its print tolerances.

The ball's weight passes through the removable cup and padded knob grip to the spinner. No passive support carries that load. Spinner load capacity, grip, resin fit, strength, wear, stability and the glued bond require physical testing. Geometry and instructed assembly checks do not establish these properties.

## Assembly and service

The bar is glued into the ball before any coupling component is installed. Assemble the removable module outside the ball and grip the knob with its two padded screws. All subsequent collar operations use access from below, with the box bottom removed. There is no screw joint between the rotating bar and the stationary box.

The air-gap protocol holds the ball with one hand and exchanges the two ordinary hex keys sequentially with the other. Full-key recovery is checked throughout the captured collar and screw-head float ranges. Do not use the old PTFE-resting instructions for this version. A complete base-and-collar admission is required before exporting or publishing the revised assembly.

1. Secure the spinner's stock hex in its roof well with the two keepers. Set the nominal knob-to-hex gap before fitting the cup. Assemble the removable module outside the glued bar and tighten its padded grip screws around the knob.
2. Remove the box bottom and support the box stably on ordinary bench blocks, leaving 180 mm of clear working space underneath for the long hex keys. This does not support the ball: hold the ball whenever the collar is unclamped.
3. Engage the 4 mm key from below and push the collar to its upper stop. With the other hand, lower the ball and its glued bar over the module. Make the 35-degree locking turn while maintaining the stop position.
4. Keep holding the ball. Release the 4 mm key's push and withdraw that key completely. Insert the 3 mm key, seat it in the screw head, and push to seat the head and recover the collar's upper stop. The released collar is captured; do not turn it while loose.
5. With the ball hand, lift the ball 2.1 mm into the nut register. Tighten the screw three full turns while following the ball's return stroke with that hand.
6. Withdraw the key and release the holding hand only after the clamp is secured. Check unobstructed rotation and refit the bottom. Only remove or refit the bottom with the ball absent or fully clamped, with both collar keys withdrawn.

Removal reverses these actions. Hold the ball before releasing the clamp. Unwind with the 3 mm key and reverse the register stroke; withdraw that key before introducing the 4 mm key. Recover the upper stop before reversing the 35-degree turn and lifting the ball away. The bar stays glued inside the ball throughout. Handling, actual key reach and load capacity remain physical checks.

## Prepare the print package

Use the installed CAD Python and a fresh output directory:

```sh
python hardware/cad/air_gap_disco.py prepare --admission /absolute/path/to/admission.json --output /absolute/path/to/new-handoff
python hardware/cad/check_air_gap_disco.py /absolute/path/to/new-handoff
```

The ZIP contains eight STL files for ten physical prints. Print both filenames marked `PRINT-2` twice; print all other files once. The shell, bottom and two hex keepers form the four-piece box. The bar, cup, two shoes and two collar halves form the six-piece rotating assembly. No PTFE references or height caps belong in this package. Historical bearing-supported exports remain unchanged.

Configure the selection in the checkout running the existing CAD desk:

```sh
python hardware/cad/air_gap_disco.py configure /absolute/path/to/new-handoff/selection.json
python hardware/cad/workspace.py disco-bar --reset-camera
```

These commands do not start or restart either service. The scene includes the checked base fasteners and a nominal stock hex as reference geometry. It does not invent a mesh of the physical knob or spinner. Reference hardware is excluded from the print ZIP. Inspect the rendered canvas before reporting visual delivery.

## Hardware for one assembly

| Item | Quantity |
| --- | ---: |
| ISO 7380-1 M3×10 button-head screws | 4 |
| ISO 7380-1 M3×12 button-head screws | 2 |
| ISO 7380-1 M3×8 button-head screws | 2 |
| ISO 4026 M3×6 flat-point set screws | 2 |
| DIN 934 M3 plain full nuts, 5.5 across flats × 2.4 thick | 10 |
| ISO 4762 M4×12 fully threaded socket-cap screw | 1 |
| M4 plain full nut, 7 across flats × 3.2 thick | 1 |

M3 pitch is 0.5 mm. M4 pitch is 0.7 mm. Reuse the spinner, knob and adjustable stock hex. Cut two 16×8 mm pads from nominal 2 mm adhesive-backed neoprene sponge; adhesive faces the printed shoes. Retain the cable tie, heat shrink and hot glue from the previous materials list. Use ordinary long 1.5, 2, 3 and 4 mm hex keys. The arcade box has its own separate hardware list.
