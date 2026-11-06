# Reduced C with the four-print base

`clean_c_base_admission.py` generates a new compatibility proof for the reduced
`reduced-cover-B` coupling and the frozen four-print mounting base. The base
receipt remains unchanged; its older C geometry is construction history.

Run with the isolated CAD Python environment after the reduced C producer has
frozen its complete admission configuration:

```sh
python hardware/cad/verification/clean_c_base_admission.py \
  --base-receipt /private/tmp/c-mount-no-ballast-fused-v3/verification/receipt.json \
  --coupling-admission /absolute/path/to/reduced-C/admission.json \
  --output /absolute/path/to/fresh-combined-proof
```

The output directory must be new. `compatibility.json` binds native checks of
actual exported parts, both support heights, every coupling stage, complete root
and grip tools, module withdrawal, bounded race recovery, and bottom-panel
service. The service model is freshly composed from the admitted reduced actor
inventory and protocol, with unsafe protocol mutations required to fail.

The combined checker copies actual faces before clipping or extrusion. Its
native Boolean checks use detached operands, and the legacy structural checks
receive a detached working base. Non-mesh BREP fingerprints compare the current
delivered subjects with fresh STEP imports before and after verification.
Historical construction shapes remain separate from those delivered subjects.

`admission.json` pins that proof, the base receipt and reduced C configuration.
`load(path)` checks their bytes, checker sources and artifact bindings, then
recomputes the service model. Its result contains `base`, `candidate`,
`lifecycle` and `panel_lifecycle` for the publication owner. A partial or failed
build does not provide an admitted configuration.

After a successful build, run the altered-proof checks:

```sh
python hardware/cad/verification/check_clean_c_base_admission.py \
  --admission /absolute/path/to/fresh-combined-proof/admission.json
```

The checker rewrites twelve copies of the proof and updates their configuration
hashes. The loader must reject failed fusion, missing backing, incomplete
rotation or tool coverage, failed service paths, and an empty panel graph.
These checks do not repeat native geometry operations.

Checker fixture regressions and an old-model baseline exercise the verifier;
they do not admit the reduced geometry. A successful run against the actual
frozen reduced C configuration is required before publication. Actual fit,
strength, grip, adhesive compatibility and manufacturing remain unverified.
