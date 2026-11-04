# I-PAC Ultimate I/O enclosure

Two-part enclosure workstream: floor-and-wall shell plus a removable screw-fastened cover. No ballast. `scene.py:load()` returns the same five-value API as `arcade_scene.py`: native-mm objects, labels, colours, alphas, provenance. The assembled shell is grounded at Z=0. No viewer publication occurs here.

## Evidence and blocked fits

The [official Ultimate I/O page](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/) confirms a USB connection and a 5.5 mm barrel / 2.1 mm pin power connection. Its common FAQ says approximately 17 mm board height but links to I-PAC 2 and I-PAC 4 drawings; this is **not** a verified Ultimate enclosure stack height. The [CAPFEET page](https://www.ultimarc.com/output/led-and-output-controller-accessories/pcb-mounting-feet/) confirms four mounting feet, PCB screws and woodscrews. It supplies no foot dimensions. Pages inspected November 3, 2026.

The repository inventory confirms the board is already on these feet and uses the Adafruit 1466 supply directly. Neither a barrel's electrical mating diameter nor a product photograph establishes the installed plug body, cable bend radius or opening size.

Measured PCB length/width and total feet-bottom-to-highest-connected-component height are required in `measurements.json` before `load()` can return a provisional scene. Detailed feet positions, PCB thickness and ports remain optional pending fits. Missing measurements deliberately block the actual design. The checker creates a **synthetic fixture**, proving the geometry recipe only; it does not establish I-PAC dimensions or release parts for printing.

Minimum preview facts are PCB length, width and installed total height. Remaining fit facts are:

- PCB length, width, thickness; hole centres and diameters if wanted in the reference.
- Installed foot height to PCB underside, each foot's footprint/position, and each floor screw centre and shaft diameter. Feet may be rotated or offset; do not infer centres from PCB holes.
- Highest installed connector/harness above PCB underside, solder protrusion below it, cable/plug body widths/heights and preferred exit side(s).
- Cable bundle size, bend/service clearance and strain-relief method; confirm whether preterminated harness must pass without unplugging.

The schema lives in `model.py`. The measured assembly keepout is centred in XY; floor top is Z=3. No separate PCB thickness is invented. Optional foot XY coordinates are relative to the PCB centre. Foot boxes are measured exclusion envelopes, not manufacturer solids. Cable openings are explicit seam-open notches in a selected wall; widths, depths and positions must come from the actual installation. Final strain relief remains blocked until the operator supplies its method/dimensions.

## Independent verification

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/micro-enclosure/check.py --out /private/tmp/ipac-enclosure-fixture
```

This exports STEP/STL for both synthetic printed parts, round-trips the STEP, checks valid connected solids, watertight STL, native/export bounds and volume, cover clearance, straight cover removal, fastener passages and reference-envelope interference. A synthetic configuration never becomes `measurements.json` or a fabrication release. Use `--measurements PATH` for measured geometry; provenance still reports physical fit and fabrication release as unverified.

Four short M3x10 cover screws and inward-loading captive hex nut slots are proposed cover hardware, independent of measured stack height. The 3.4 mm passages, 5.8 mm across-flats pockets and 2.7 mm pocket depth are design allowances, not printer-calibrated fits. Load ordinary M3 nuts from the interior before fitting the cover and screws from above. Nut slots are confined to corner posts outside the PCB keepout, 5 mm below the rim with 2.7 mm pocket depth. The uninterrupted floor under the PCB is 3 mm thick; solder protrusion and material suitability still require inspection.

`missing_measurements()` returns the absent-config checklist for coordinator display. It returns `[]` for a supplied valid actual-measurement configuration. Malformed supplied inputs raise; they are not silently skipped.

Verified November 3, 2026: synthetic shell and cover each exported as a single valid solid; both STEP round trips matched native bounds and volume; both STL meshes were watertight and consistently wound with matching bounds and volume. The separate pending-scene check verified missing-measurement reporting and failure to load absent hardware dimensions. No actual I-PAC fit was established.

The preview may have no cable openings while exit preferences are pending. A closed preview is not a usable wired enclosure release. Optional exits use explicit measured seam-notch dimensions; no connector pose or cable path is guessed. Exact CAPFEET geometry is not displayed without measurements; the assembly keepout uses only the minimum dimensions above.

Measured publication also requires a fresh validation receipt. Run `check.py --measurements hardware/cad/micro-enclosure/measurements.json --out /private/tmp/ipac-measured`, then copy its `receipt.json` to `hardware/cad/micro-enclosure/validation.json`. Both local files are ignored. `load()` checks the measurement file SHA and all three recipe/checker source SHAs before generating the scene. Any measurement or recipe change requires rechecking. The synthetic receipt cannot open this gate. The receipt authorizes a geometry preview only, with physical fit and fabrication release still false.
