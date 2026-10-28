# CAD workspace verification

Verified on this arm64 Mac with Homebrew Python 3.12.10, build123d 0.13.0, ocp-viewer 1.2.0, and trimesh 4.12.2. The environment is `~/.local/share/show-tools/cad/venv`, separate from app dependencies. The pinned setup command completed and `python -m pip check` reported no broken requirements.

## Actual model and export checks

`hardware/cad/cad check --angle 25` and `hardware/cad/cad demo --angle 25` passed. The resulting `build/demo-25deg/receipt.json` records one valid solid, positive CAD volume, a matching STEP re-import, and a watertight, consistently wound STL with matching volume. Bounds were 80 × 60 × 23.921845 mm. Source SHA-256 was `a9575cddd6458d2f8434dcdf0d48a33521dabe9d2329e8ada5e527102ab35bdd`.

The synthetic model was also generated and exported at 15 degrees before the parameter-specific output directories were introduced. Generated files are ignored. No printer was connected or commanded.

## Actual browser checks

The standalone viewer served on `127.0.0.1:3939`. A new Safari window displayed the blue demo mount, transparent reference wood, and gold placeholder with explicit synthetic labels.

Native UI interaction orbited the model. Publishing a 15-to-25-degree parameter change updated the geometry and tree label while retaining the observed camera angle and reference-wood projection. The Clip panel cut through the assembly at the centre plane. Resetting the clipping planes restored the full model. The viewer was left running with the 25-degree assembly and clipping reset.

These observations used the real local server and browser, not a mocked viewer or an image render. The model's dimensions do not establish actual component fit or manufacturing suitability.

## Scrawl boundary

The installed `/Applications/Scrawl.app` CLI responded to `--help`. No screen or microphone capture was started. The first operator-recorded Scrawl is still needed to verify feedback capture and delivery to the intended conversation. The guide explicitly directs the operator to send or paste it into the CAD session rather than assume automatic routing.

`bash -n hardware/cad/cad`, local Markdown target checks, and `git diff --check` passed. No audio engine, Sheets helper, Chrome CDP, or USB processes were started or changed.

The dependency review inspected the installed SciPy 1.18.1 wheel's `METADATA`, licence notice, and `.dylibs/libgfortran.5.dylib`, `libgcc_s.1.1.dylib`, and `libquadmath.0.dylib`. `otool -L` confirmed the bundled runtime linkage. The README flags GPL-3.0-or-later with the GCC Runtime Library Exception 3.1 and LGPL-2.1-or-later alongside the OpenCascade runtime notice. No dependency or viewer process changed during this documentation correction.

## Manufacturer button reference

`hardware/cad/cad button` imported the pinned, unmodified Adafruit 1185 STEP and verified SHA-256 `85d61649551b187a005b07ad21950e92f5aec3fa457825805bab1994058c46d6`. The import contained five positive-volume solids. Validity was `[true, false, true, true, true]`; aggregate validity was false. Bounds were approximately 98.5 × 98.5 × 68.5 mm. The command reports this condition and creates no manufacturing exports. These checks describe the upstream asset, not physical fit.

`hardware/cad/cad button --show --four --reset-camera` published four coloured copies to the existing viewer. Safari initially retained the old demo after sleeping. Reloading its page and publishing again displayed the RGBY reference models and their explicit reference-only, invalid-CAD labels. The viewer process was preserved. No Scrawl recording, hardware IO, or printer job was started.

The upstream MIT license is included beside the STEP. `source.json` records its repository revision and asset hash. The published manufacturer drawing was downloaded separately and inspected visually for the 98.5 mm body and M24 × 2 thread labels; it is linked rather than redistributed. Bash syntax passed. The committed upstream STEP preserves trailing whitespace on lines 4 and 12. `git diff --check` reports those two upstream lines. The authored source and documentation pass when only this vendored asset is excluded:

```sh
git diff --check 6178145 HEAD -- . ":(exclude)hardware/cad/components/adafruit-1185/button.step"
```
