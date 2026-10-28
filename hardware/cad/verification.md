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
