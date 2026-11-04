# Clean two-part arcade button box

The current arcade export contains only the inclined shell and removable bottom. The internal ballast tray, its interior joining ribs, separate capsule/lid/cubes, and capsule-only fasteners are removed. The operator will arrange ballast separately.

The original 5° roof, 17.5 mm counterbore recess, 63.5 mm button-axis reserve, four cover joints, low/front and elevated/rear wire exits, and both tiedown routes remain. The bottom's physical geometry is unchanged. Both delivery STLs are translated to Z=0 without scaling; the receipt records the inverse assembly translations.

The tall-side exit has two small closed tie eyes directly joined to the rear wall. Their centres are at Y55 mm, with 1 mm of wall overlap; there is no shelf or separate support pad. Full tie-loop/head clearance and nominal 3/8 mm cable gauges are checked through the unchanged rear outlet. Cable ties are optional strain relief for a used exit, not part of mounting the button.

`arcade-button-box-STL.zip` contains exactly:

- `arcade-box-shell.stl`
- `arcade-box-bottom.stl`

STEP files and verification receipts stay outside the print archive. No ballast, washers, PTFE, hardware meshes, or other models belong in this ZIP. The enclosure needs four ISO 7380-1 M3×10 button screws and four DIN 934 M3 nuts, plus the button's own mounting nut. One cable tie serves each two-eye pair for a used wire route.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/arcade_two_part.py \
  --receipt /Users/anulman/dev/show-tools/hardware/cad/build/arcade-dual-exit-v4/receipt.json \
  --output /tmp/NEW-two-part-arcade
```

Use a fresh output namespace. The recipe loads the exact frozen dual-exit source, removes material only inside the original tray/rib region up to the inner back-wall plane, and checks actual exported STEP/STL pairs. It verifies protected interfaces, cable reserves and tiedowns, cover hardware, full ordinary 2 mm cover-key access, continuous bottom removal/refit, valid meshes and exactly two grounded archive members.

`load_review(receipt_path, expected_sha)` returns the two actual checked shapes in assembled coordinates. Viewer code which loads records directly must negate each `source_to_print_translation_mm` before displaying the assembly. The worker does not publish the shared viewer.

All old sources and exports are retained. This cleanup does not establish physical resin fit/strength, actual cable-connector passage, support orientation, or the operator's future ballast arrangement.


## Outside bottom chamfer and STEP handoff

The printer's STEP handoff uses a 1 mm (0.03937 inch), 45° chamfer on the shell's outside lower rim. The operator confirmed the outside edge; the printer supplied no size. `arcade_bottom_chamfer.py` derives this revision from the exact successful two-part export. It checks that the change removes material only from that lower outer band and preserves the inner mating rim, all four cover-fastener regions, and the entire bottom. Existing empty cable and removal paths remain clear because the changed shell is a material subset of the checked original.

The ZIP contains only `arcade-box-shell.step` and `arcade-box-bottom.step`. STEP declares inches explicitly. The writer converts native millimetre geometry to inch coordinates. Every assigned STEP length context must declare INCH with a 0.0254 metre conversion, and reimport must recover the same physical millimetre geometry. Internal millimetre STL pairs and validation receipts stay outside the human ZIP. Previous exports remain retained. The new chamfer has geometry checks; it has not yet been physically printed.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/arcade_bottom_chamfer.py   --receipt /absolute/path/to/printed-two-part/receipt.json   --output /absolute/path/to/fresh/chamfer-step-export --chamfer-mm 1
```
