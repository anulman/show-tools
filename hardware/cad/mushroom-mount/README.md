# Two-part mushroom enclosure study

This level-roof enclosure is sized for the inventoried NHD NPB22-M611R 60 mm momentary mushroom. It uses the arcade enclosure's rounded shell, removable bottom and four ISO 7380-1 M3×10 screws with DIN 934 M3 nuts. There are exactly two printed pieces, no ballast structures and no separate clamp or adapter. The button uses its OEM mounting ring.

`scene.py` exposes `load()` with no arguments and returns `(objects, labels, colors, alphas, provenance)`, matching `arcade_scene.load`. Assembly coordinates are native millimetres with the bottom on Z=0. Loading requires the ignored `hardware/cad/build/mushroom-mount/current.json` selection, the exact receipt hash, passing geometry checks, matching local source/dependency hashes, and unchanged STEP/STL exports. It loads those exports with their inverse print translations. Loading is headless and never publishes or restarts a viewer. The opaque red head and dark body are simplified drawing references, not exact OEM CAD.

The proposed shell is 80×86 mm with 10 mm outside corner radii, 3 mm walls, a level roof at Z62 and a 4 mm roof thickness. The bottom is 3 mm thick. A 1 mm, 45° chamfer removes the outside shell lower rim at Z3–4; the cover mating plane remains Z3. Both front and rear have 12×8 mm cable openings extending down to the cover seam. They allow laying wire into an open enclosure; actual plugs, wire bends and strain relief remain unverified.

## Published dimensions and study choices

The exact [NHD product page](http://www.nhdi.com.tw/other_lang/22mm-push-button17.html) identifies the NPB22-M611R and specifies a **23 mm mounting hole**. This supersedes treating the 22 mm series name or retailer hole listing as the cut diameter. The [NHD PB Rev17 catalogue](http://www.nhdi.com.tw/assets/img/manul_img/PB-20251120-Rev.17.pdf), physical page 4 (printed page 3), shows Ø60 head, 30.7 mm projection above the panel, 47.5 mm behind the panel, 45.5 mm rear side height, and T≤5 mm. Physical page 13 (printed page 12) confirms the Ø23 panel hole and optional Ø3.2 antirotation hole, whose centre is 11.3 mm from the main axis. Both overlapping holes are included. `sources.json` pins the downloaded page and PDF hashes and the visually read facts.

The preview uses an **unmeasured 45.5 mm rear width** equal to the published side height as a conservative square study envelope. This does not establish the real width or terminal locations. The cap thickness, dome, stem, bezel and rear profile are simplified visual choices; only the explicitly published overall dimensions are nominal manufacturer facts. The rear drawing reserve ends at Z14.5, leaving 11.5 mm over the flat bottom. This does not establish harness bend clearance. Printer, material, tolerance allowance, strength and stability are unselected.

## Assembly and service

With the bottom removed, load the four M3 nuts upward into their hex seats. Insert the button through the roof and fit its stock mounting ring from below. NHD's PPB22-02T mounting-ring tool is Ø29.4×79.3 mm; the checker proves its full axial cylinder clears the open shell. **Remove the contact blocks before introducing the ring tool**, following NHD's contact mounting/removal illustration. The clearance witness covers the shell and ring region; it does not prove hand access, tool engagement, or disassembly of the actual purchased unit. Stock thread, key lug, gasket, ring seating and printed fits need a real-hardware check.

Lay the cable through either seam opening, refit the bottom and install four M3×10 button-head screws from beneath. Ordinary 2 mm keys enter through the bottom. The native checker verifies the nominal joint axes, head bearing reaction, nut retention/rotation, thread reach, nut loading and continuous cover withdrawal. It does not verify real thread friction or resin strength.

## Rerun the checks and exports

From the repository root, using the established CAD environment:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/mushroom-mount/check.py \
  --output /private/tmp/NEW-mushroom-export
```

Use a fresh output directory. The checker runs native assembly booleans, validates STEP round trips against the source, checks watertight consistently wound STL meshes and matching volume/bounds, and produces a receipt, an offline review image, millimetre STEP/STL pairs and a ZIP containing exactly the two grounded STLs. Each record includes its print translation; negate it to recover assembly placement. These millimetre exports and the ZIP are internal review artifacts, not printer-ready delivery. Fabrication handoff must follow the operator’s imperial-unit requirement with independently verified unit-aware round trips. These are geometry checks for a complete nominal study, not manufacturing approval.

The coordinator owns shared viewer publication and integration. This directory owns only the mushroom source and checks. Historic mushroom blanks and other enclosure variants remain unchanged.
