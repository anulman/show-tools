# C2 with a ported resin base

This consumer integrates the actual 25-part standard-hardware C2 exports from commit `4903640` with a new resin-base proposal. It leaves the seven existing base producers and frozen ear-trial outputs unchanged. The 19 mm mouth gap and 28–36 mm pad contact band above the roof remain provisional until the operator supplies spinner hex AF, hex thickness and hex-top-to-knob-top height. The result is private review geometry, not a manufacturing release.

The bar remains glued inside the ball. The removable connection is baseplate-to-bar, operated from below, as described in the [operator's mounting contract](../../disco-bar/standard-collar-proposal.md#operators-mounting-contract). The box retains the spinner's stock hex. Its proposed outer bearing is passive support and must not become a second bar-to-box retaining joint. The full installation order and keeper-fastener access remain unverified; the separate C2 and base clearance checks do not establish them.

The proposed service index is −90 degrees after the source-to-box 180-degree X rotation. This puts the drive quarter arc on the right and the lock behind the left side. A front cable outlet and front tiedowns replace the prior 25-degree route. The existing shortened rear ballast cassette, closed cover, standard fasteners, keepers, formed PTFE and developed cut pattern remain part of the checked assembly.

The consumer validates every paired STEP/STL record in the review assembly, all six states and all four operating/staging tool sweeps. It normalizes imported single-solid compounds before posing or Boolean operations. Producer source hashes must match the complete eight-file inventory in the immutable Git revision. Both input receipts are captured as bytes and hashed before parsing; receipts, local generating sources and all loaded input/output artifacts are rechecked before a success receipt survives export.

The actual tool sweeps cut matching ports through the roof and cover. Both panels remain connected. Checks preserve the central roof within R33, bearing support at R44–46, all cover seats, the ballast floor, nut-loading paths and fastener reactions. Every state and tool sweep clears the fixed parts, hardware, ballast cubes, cable reserve and illustrative stock-hex keepout. The complete fixed geometry above the roof must fit two checked rotation-invariant bounds: the central keeper cylinder and outer bearing band. Actor separation from those bounds establishes clearance against the base during rotation and positive-Z withdrawal. It does not independently certify C2's internal assembly sequence or physical strength.

The full 4 mm key staging envelope reaches box Z −221 mm. With the cover underside at −80.055061 mm, the minimum geometric lift is 140.944939 mm. The proposed 160 mm lift leaves 19.055061 mm below the supplied tool envelope. A table at the unlifted underside still blocks entry. Grasp, hand clearance, support and stability during service remain unverified.

Two exact planar patches are derived from the exported bar's mouth faces within the selected R44–45.5 bearing band. Their total area is 353.734235 mm², or 83.8712% of that full annulus. Extruded witnesses establish that the complete selected contact patches sit over purchased PTFE and spacer material. This area is not a load capacity, acceptable unsupported-span limit, drag measurement or wear result.

`check_resin_c2.py` restores unported panels and the old 25-degree tiedown position and requires collisions with the actual tools. It rejects a 100 mm lift, an extra fixed part outside the clearance bounds, an omitted producer source and a changed receipt. The complete original source parts are used for these checks; no cropped collar substitutes for the installed envelopes.

```sh
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/resin_c2.py \
  --collar-receipt "$C2_RECEIPT" --base-receipt "$RESIN_V4_KNOB_RECEIPT" \
  --source-worktree "$SOURCE_WORKTREE" --output /tmp/resin-c2-proposal
~/.local/share/show-tools/cad/venv/bin/python hardware/cad/box-mount/access/check_resin_c2.py \
  --collar-receipt "$C2_RECEIPT" --base-receipt "$RESIN_V4_KNOB_RECEIPT" \
  --source-worktree "$SOURCE_WORKTREE"
```

The output separates seven resin print candidates from formed and flat PTFE references and includes the complete combined locked assembly STEP. No viewer, service, printer job or publication is started. Actual spinner installation, outer shell fit, resin/process allowances, PTFE forming and creep, physical hardware cycling, encoder loading and ball stability remain separate gates.
