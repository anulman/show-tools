# Validate the I-PAC candidate

Run from the repository root with the existing CAD environment. Choose a fresh absolute output directory for each check.

1. Export and check the candidate:

   ```sh
   ~/.local/share/show-tools/cad/venv/bin/python hardware/cad/micro-enclosure/check.py --measurements hardware/cad/micro-enclosure/candidate.json --out /private/tmp/ipac-candidate-check
   ```

2. Copy the successful receipt into the local scene selection:

   ```sh
   cp /private/tmp/ipac-candidate-check/receipt.json hardware/cad/micro-enclosure/validation.json
   ```

3. Hand `hardware/cad/micro-enclosure/scene.py` to the coordinator. The coordinator owns viewer publication.

The checker prints `geometry_checks_pass: true` after both parts pass. A failed check does not write a success receipt. Keep failed fresh directories separate from prior successful exports. Do not reuse a synthetic-fixture receipt for the actual scene.

After a source or configuration change, rerun the check into a fresh directory and replace `validation.json` with the new success receipt. Neither a successful check nor viewer publication approves manufacturing or physical fit.
