# Mushroom inside-height requirement

The operator requires at least 1⅞ inch (47.625 mm) **inside** the mushroom enclosure and adopts 2 inches (50.8 mm) as the target. This is an interior space budget, not an assertion of exact OEM rear-body height.

The issued Leo STEP assembly already passes without a geometry change. Across the central 45.5×45.5 mm body-study footprint, the actual shell roof underside is Z58 and the actual cover floor is Z3. The usable vertical span is therefore **55 mm (2.165354 inches)**. It exceeds the minimum by 7.375 mm and the adopted target by 4.2 mm. Signed target shortfall is −4.2 mm; unmet shortfall is zero. No shrinking, roof movement, extra counterbore or new export is needed.

`check_inside_height.py` loads the hash-pinned issued STEP/STL pair, reverses the recorded roof-down print transformation, and clips actual solid material to the full component region. Substantial downward-facing roof and upward-facing floor witnesses establish the two datums; a centre ray through the mounting hole does not establish the roof. A native solid corridor over the entire footprint verifies the full 55 mm span and the 50.8 mm target, with boundary-only contacts excluded by 0.00001 mm. A 56 mm corridor penetrates the roof and must fail the same native check.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/mushroom-mount/check_inside_height.py \
  --receipt /private/tmp/mushroom-leo-v1/receipt.json \
  --output /private/tmp/NEW-mushroom-inside-height.json
```

Use a new report path. This check pins receipt SHA256 `2b908fa85febf130e969f0e0c7508fbe9ff52347c7880e6cac872cfe5e2a74e1`; it reads and verifies the actual exported parts and leaves all issued geometry, producer sources, selections and source pins unchanged. It does not publish a viewer.

The verified report `/private/tmp/mushroom-inside-height-v1.json` has SHA256 `211a42f1b281044946c5349616b4da9ed5ffd81584a5b8331d12953444bc0a1e`. Both positive corridors had zero shell/bottom collision. The 56 mm negative probe was rejected with approximately 1651.26 mm³ of shell collision.

The 45.5 mm square remains the existing conservative study footprint; it is not a newly measured hardware width. Actual wire bends, connector passage, hardware fit, slicer behavior and strength remain separate checks. The measured 55 mm enclosure budget does not verify those properties.
