# Lifted-box service with the cover installed

The operator authorized lifting the box for underside access. This separate private candidate extends the selected 45-degree service ports through the removable bottom as well as the roof. Keeping the cover installed for routine bar release is a proposed simplification, not an additional operator requirement.

The candidate retains the shortened rear ballast tray at Y=42 mm, compact 3 mm keeper tabs, and proposed 9 mm bar-mouth spacing. It does not change existing box models, published previews, or latch controls. No final scene is rendered or published.

## Checks against the actual supplied probes

The command first reproduces the pinned C1 artifact checks and the original three access comparisons. It then cuts the same supplied clearance probes through the cover at the 45-degree service index.

Both ported panels remain valid single solids. Exact material comparisons preserve all four cover-fastener mounting regions and the complete ballast-floor footprint. The roof's central mounting/keeper region and spacer support remain unchanged, and keeper fastener reactions are rechecked. The cover still separates downward from the shell.

All supplied full-length probes clear the installed cover, roof, keeper hardware, spacer, buffer, cable envelope, and ballast envelope. Restoring the old unported cover produces an obstruction again. The new holes do not open the ballast compartment, so this proposed release procedure does not require opening that compartment.

The unlifted table-contact baseline remains blocked. The lowest probe reaches Z=-86 mm, while the box underside is Z=-80.0551 mm. Pure geometric entry therefore needs a lift greater than 5.9449 mm. The proposed 15 mm lift leaves approximately 9.0551 mm between the lowest probe and the modeled table. This is clearance for the supplied probe envelopes, not a verified hand, handle, or grasp arrangement.

The negative checks reject an unported cover, zero lift, a removed fastener seat, and an opened ballast floor. They use the actual supplied probe artifacts rather than substitute hole cylinders.

## Reproduce the private candidate

Use the same preserved C1 source and receipt variables as the earlier integration check:

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/lifted_base.py \
  --receipt "$C1_RECEIPT" --source-worktree "$C1_WORKTREE" \
  --source-revision 8c46422 --output /tmp/C1-lifted-base
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_lifted_base.py \
  --receipt "$C1_RECEIPT"
```

The output contains six exported CAD pieces: five proposed print parts and a separate buffer envelope with unselected material. It also contains a ten-solid assembly STEP and a receipt with source/input provenance, preserved baseline findings, port checks, lift geometry, and output hashes. STEP material equality and STL integrity are checked.

This checkpoint uses the original C1 probe set and preserves that version's internal latch-lift failure as upstream evidence. The coordinator's later housing-relief validation is a separate result. The base-access check does not certify a complete latch workflow or actual tool engagement.

Installed knob engagement, stock-hex dimensions, fastener fit, physical tool/hand access, lifting stability, loads, wear, material, and printer preparation remain unverified. Print readiness remains `NOT_READY`.
