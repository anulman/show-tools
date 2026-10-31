# Clean disco prototype print package

The default assembly uses ten printed pieces supplied as eight STL designs. The two stock-hex keepers share one design, and the two grip shoes share another. Print each filename marked `PRINT-2` twice. Print every other file once.

The mounting box has four printed pieces: the shell with integral bearing support, the removable bottom, and two stock-hex keepers. It has no ballast compartment or dedicated ballast hardware. The bar and reduced C collar have six printed pieces: the bar, knob cup, two grip shoes, collar half A, and collar half B with its integral cover.

The reduced collar keeps the existing split. An assembly slot in the fused cover clears the drive socket while the halves join. Two M3 cover joints remain. Every coupling component is installed and removed after the bare bar has been glued inside the ball. The complete assembly has unrestricted normal rotation with the service keys removed.

## Export the admitted prototype

Use the installed CAD Python and a fresh output directory. The combined admission must bind the exact reduced-C geometry, continuous-motion proofs, actual actor inventory, operating protocol, mounting-box geometry, and panel-off service proof.

```sh
python hardware/cad/clean_disco.py prepare --admission /absolute/path/to/admission.json --output /absolute/path/to/new-handoff
python hardware/cad/check_clean_disco.py /absolute/path/to/new-handoff
```

The archive contains only eight default fabrication STL files. Cut-material STEP references and the optional height cap stay outside it. Each STL is translated to the bed without scaling or changing its triangles. The printer chooses orientation and supports. A late admission failure does not expose a final print archive or validation receipt.

The two repeat parts are checked by native Boolean material equality after rotation. The archive checker reads the delivered meshes, checks geometry against their sources, checks quantities, and rejects an omitted actor. Formal lifecycle validation and continuous geometry checks remain separate obligations in the combined admission.

## Select the CAD review

Configure the selection in the checkout that runs the existing CAD desk.

```sh
python hardware/cad/clean_disco.py configure /absolute/path/to/new-handoff/selection.json
python hardware/cad/workspace.py disco-bar --reset-camera
```

The Disco bar page shows the assembled clean mounting box and reduced C bar. The Box mount page retains its separately configured arcade box. Inspect the actual canvas before reporting visual delivery. These commands do not start either service.

## Hardware for one disco assembly

| Item | Quantity |
| --- | ---: |
| ISO 7380-1 M3×10 button-head screws | 4 |
| ISO 7380-1 M3×12 button-head screws | 2 |
| ISO 7380-1 M3×8 button-head screws | 2 |
| ISO 10642 M3×12 countersunk screws | 4 |
| ISO 4026 M3×6 flat-point set screws | 2 |
| DIN 934 M3 plain full nuts, 5.5 across flats × 2.4 thick | 14 |
| ISO 4762 M4×12 fully threaded socket-cap screw | 1 |
| M4 plain full nut, 7 across flats × 3.2 thick | 1 |

M3 pitch is 0.5 mm. M4 pitch is 0.7 mm. Button-head and socket-cap lengths exclude the head. Countersunk lengths include the head. These quantities cover the disco assembly only; the arcade box has its own four M3×10 screws and four M3 nuts.

Reuse the spinner, knob, and adjustable stock hex. Use the existing 1 mm formed PTFE bearing pattern and two 16×8 mm pads cut from nominal 2 mm adhesive-backed neoprene sponge. One 145×2.5 mm cable tie anchors the used wire route. Use ordinary long 1.5, 2, 3, and 4 mm hex keys. The ballast washer requirement disappears with the ballast retention hardware.

The default PTFE contact height is 5 mm. A separate optional profiled cap provides the checked 7 mm setting. Use that cap instead of the old flat shim. The cap is excluded from the default print ZIP.

Use tough engineering resin suited to the printer. Trial-fit fully cured parts with the actual knob and specified hardware before committing to the glue bond. Resin fit, grip, strength, wear, adhesive performance, and stability remain physical checks.
