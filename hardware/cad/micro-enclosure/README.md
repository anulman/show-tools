# I-PAC enclosure candidate

The candidate has two printed parts: a shell with an undrilled floor and a removable cover. Four short M3 screws close the cover into captive nuts. The open interior has a side bay for the existing daisy chains and spare wire. There is no ballast or printed divider.

## Operator facts and design choices

The operator supplied these measurements on November 4, 2026, through the Hardware Manager:

| Item | Inches | Millimetres | Meaning |
| --- | --- | --- | --- |
| PCB length | 5 3/16 | 131.7625 | Measured footprint |
| PCB width | 2 5/8 | 66.675 | Measured footprint |
| PCB mounting elevation above the inside floor | 5/8 | 15.875 | Nominal reference plane. Top versus underside datum is unconfirmed |
| Interior height | 3 | 76.2 | Operator-selected space budget. Installed component height remains unmeasured |

`candidate.json` records these facts and the proposed geometry. The 3 mm floor places the PCB reference plane at global Z=18.875 mm. The reference is a surface with no invented PCB thickness or feet shape. The closed lid underside is exactly 76.2 mm above the inside floor. The model adds no headroom above that budget.

The shell and cover measure 233.7625 × 108.675 × 82.2 mm assembled, excluding screw heads. The 60 mm side bay and 18 mm lateral margins are design allowances. A translucent region shows a 60 × 70.675 × 64.2 mm storage space clear of the posts. That region represents available design space, not measured cable occupancy. The floor has no guessed mounting holes.

The routing inventory remains the operator's wiring plan: USB to the host, 5 V LED power, four arcade buttons with four wires each, a mushroom with two wires, and a spinner with four wires. The candidate does not shorten the existing daisy chains or change the wiring.

Two openings start at the removable-cover seam. The proposed USB and power opening is 35 × 12 mm at the PCB end. The proposed device-wire opening is 60 × 12 mm at the storage-bay end. The lid lifts clear of both openings. Preterminated leads can be placed into the open notches without threading closed holes. The openings are grouped cable routes, not socket-aligned cutouts or measured bundle fits.

Direct socket access still needs socket positions, plug-body dimensions, and insertion clearance. Separate channels would need each cable's outside dimensions and a strain-relief choice. The first candidate keeps two grouped exits to preserve room for existing leads and avoid unnecessary partitions. The openings provide no strain relief.

Four M3x10 cover screws use 3.4 mm passages. Interior slots load nuts into 5.8 mm across-flats pockets, 2.7 mm deep, near the rim. The checker uses a 5.5 mm across-flats, 2.4 mm thick nut exclusion model and a 6 mm diameter vertical tool corridor. These are declared design envelopes, not hardware or printer fit measurements. The screw heads sit above the cover. The floor remains 3 mm thick below the PCB.

The assembled footprint is under 256 × 256 mm. No printer, material, nozzle, orientation, or support plan has been selected, and the footprint does not establish printability.

## Evidence limits

The [Ultimate I/O product page](https://www.ultimarc.com/control-interfaces/i-pacs/i-pac-ultimate-i-o/) describes USB and barrel-power connections. Its common FAQ links to I-PAC 2 and I-PAC 4 dimensional images, which do not establish Ultimate I/O fit. The [CAPFEET page](https://www.ultimarc.com/output/led-and-output-controller-accessories/pcb-mounting-feet/) confirms four feet and screws but gives no dimensional drawing. The operator's measurements now supply the PCB footprint and nominal mounting elevation.

Physical fit remains unverified. PCB thickness, solder protrusion, exact foot positions, mounting screw offsets, installed plug height, cable bend radii, bundle sizes, and strain relief remain open. The reference plane does not imply top or underside registration. Those facts block their dependent manufacturing details, not inspection of this space-planning candidate.

## Verification and scene contract

`scene.py:load()` returns native millimetre objects, labels, colours, alphas, and provenance. Its four objects are the checked shell, the checked cover, the proposed storage region, and the PCB reference plane. The assembly is grounded at Z=0. The scene does not publish to a viewer.

The checker accepts `--measurements candidate.json` for the actual candidate or uses a synthetic fixture when that option is absent. It requires a new output directory. It checks the exact interior-height budget, nominal PCB elevation and footprint, reference-plane intersection area, storage separation, seam passage continuity, screw passages, nut loading, tool approach, cover removal, and valid connected solids. STEP round trips must match native bounds and volumes. STL meshes must be watertight, consistently wound, and match the native bounds and volumes.

The success receipt records source and configuration hashes. `load()` requires that receipt in local ignored `validation.json`, verifies current hashes, and loads the checked shell and cover through the shared artifact verifier. Changed configuration, changed source, corrupt exports, or a missing receipt block loading. `missing_measurements()` reports missing candidate input; invalid supplied input raises. With the committed candidate it returns an empty list. This geometry preview always reports `physical_fit_verified=false` and `fabrication_release=false`.

The [verification commands](VERIFY.md) regenerate the exports and local validation selection.
