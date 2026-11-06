# Export and review the four prototype assemblies

The handoff contains the inclined arcade box, the Option C knob box, Darren's original full-height bar, and the Option C bar with its removable cup and collar. The original bar and C bar are separate alternatives. Historical candidates remain on disk and in Git.

Use the installed CAD Python from `requirements.lock`. Supply the frozen C selector, the checked arcade receipt, and the exact bottom-panel-service box receipt with its SHA-256. Supply Darren's pinned original STEP. The output directory must not exist.

```sh
python hardware/cad/print_handoff.py prepare \
  --selector /absolute/path/to/selector.json \
  --arcade /absolute/path/to/arcade/receipt.json \
  --box /absolute/path/to/panel-service/receipt.json \
  --box-sha256 EXACT_RECEIPT_SHA256 \
  --step '/absolute/path/to/Disco Ball.step' \
  --output /absolute/path/to/new-print-handoff
python hardware/cad/check_print_handoff.py /absolute/path/to/new-print-handoff
```

The ZIP contains 20 STL parts, each printed once. There are four arcade parts, seven knob-box parts plus one optional height shim, one original bar, and seven Option C parts. The export centres each part in XY and places its lowest point at Z=0 using translation only. The printer still chooses orientation and supports. Steel hardware, soft pads, and PTFE references remain outside the ZIP. The separate validation report records the source and delivered hashes.

Publish through the existing viewer without starting services.

```sh
python hardware/cad/print_handoff.py configure /absolute/path/to/new-print-handoff/selection.json
python hardware/cad/workspace.py disco-bar --reset-camera
```

With this selection configured, **Disco bar** shows all four requested assemblies together and **Box mount** shows the two boxes. The configuration is local and ignored by Git. Publication rechecks the pinned inputs and actual artifact hashes. Inspect the real canvas and its four groups before reporting visual delivery.

## Send this note to the printer

Print one of each STL in this archive using a tough engineering resin suited to your machine; the optional 2 mm shim is marked separately. Check the fully cured mating parts with our listed hardware and actual knob before committing to the remaining large prints or gluing the bar. Darren's original bar is a separate comparison piece; the PTFE bearing and foam grip pads are purchased and cut separately.

See the [shopping list](PROTOTYPE_SHOPPING.md) for exact hardware quantities and product links. See the frozen receipts for geometric proof scope. Physical fit, strength, grip, wear, glue adhesion, and sufficient ballast remain unverified until tested.
