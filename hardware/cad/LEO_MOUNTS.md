# Leo's internal ledge revision

The operator approved sloped undersides for the circled internal nut-seat and cable-tie ledges on November 4, 2026. These opt-in candidates retain the earlier sources and exports. They add no printed pieces or hardware.

| Enclosure | Revision | Planning print pose |
| --- | --- | --- |
| Inclined arcade | Four nut-end ramps and two elevated wall-eye ramps | Roof down, X175 degrees |
| Spinner mounting box | Four nut-end ramps and two wall-eye ramps | Roof down, X180 degrees |
| Mushroom | Eight ramp faces over four corner bosses | Roof down, X180 degrees |
| I-PAC | Existing floor-to-rim posts have no analogous external ledge | Floor down |

The ramps retain flat nut bearing faces, pockets, cover joints, cable passages, and hardware clearances. The arcade's outside lower-rim chamfer and 2.5-inch button-axis reserve remain. The mushroom retains its approved 23 mm straight hole through a 4 mm roof, with no counterbore.

The box candidate checks transform actual face normals into the selected print frame. They reject all six original flat ledge ends in each box. Maximum revised overhang is about 44.806 degrees from vertical for arcade ramps and 45 degrees for spinner ramps. The mushroom check rejects its four original caps and requires eight 45-degree slope faces. All three candidates check actual STEP/STL files and preserve functional assembly datums.

These are local ledge checks, not a claim that every surface prints without supports. The preserved tie tunnels span 3.2 mm; ramp interruptions span at most 2.5 mm. The arcade rear outlet retains a 5 mm wall-depth ledge. The spinner's wide exterior foot needs separate orientation/support review. Material, printer settings, strength and physical fit remain unverified.

## Select checked candidates

The coordinator owns publication. Workers remain headless.

- `build/arcade-leo/current.json` selects a checked box receipt for the Arcade button page. Without it, the existing arcade selector remains active.
- `build/mushroom-leo/current.json` selects the checked mushroom candidate through its separate `leo_scene.py`. Without it, the original mushroom scene remains active.
- The spinner uses a separately pinned scene manifest. Its `leo_box_revision` identifies the checked receipt and the two exact displayed box actors. The scene loader verifies that correspondence before publication.

The corrected I-PAC nut seat comes from the separately reviewed measured-enclosure work. It retains the chosen M3x10 button-head screws and provides full nominal nut coverage plus one pitch across the documented 9.7–10.3 mm geometric test range. That range is a design check, not a claim about the operator's screw tolerances or formed thread strength.

See [box features and checks](box-mount/LEO_BOX_LEDGES.md) and [mushroom features and checks](mushroom-mount/LEO.md) for the candidate recipes and receipts. Existing manufacturing packets remain separate; selecting a preview does not update their admission gates or approve a new print release.

Run `hardware/cad/check_leo_selectors.py` with the CAD Python environment after selecting the checked candidates. It uses private temporary markers to verify that truly absent selectors retain the baseline, while dangling symlinks and directories fail closed. It also reloads the real checked selections after the isolated checks; it never edits the live selector files.
