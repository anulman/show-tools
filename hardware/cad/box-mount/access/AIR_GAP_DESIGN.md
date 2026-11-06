# Air-gap mounting design

## Placement contract

The box roof is Z=0. The default bar root is Z=5 mm. The alternative checked
setting is Z=7 mm, selected through the existing knob adjustment without a
printed cap. The nominal stock hex top is Z=-0.25 mm, so the corresponding
hex-to-knob-underside settings are 5.25 and 7.25 mm. Both lie within the reported
4.7625 to 22.225 mm adjustment range.

The transform is a 180-degree rotation around X, a 280-degree rotation around Z,
and translation along Z by the bar-root height plus the stage's source shift.
The cup's source shift cancels that translation during the bar's seating stroke.

The root-to-roof distance is separate from the minimum clearance inside the
annular well. The collar enters that well. Its complete continuous rotation and
bounded relaxed recovery require their own positive-clearance proofs.

## Geometry and ownership

`air_gap_c_mount.py` owns a new base recipe and export. It reconstructs the roof
before the old PTFE kit drilled its four bores and captive-nut pockets. It keeps
the stock hex well, barrel passage, two keepers, blank bottom, and fixed wiring
eyes. The old bearing, PTFE, support screws and nuts, and optional cap are absent.
Historical sources and exports remain unchanged.

The default inventory is a shell, a bottom, and two keepers. Purchased fasteners
are four M3x10 cover screws, two M3x12 keeper screws, and six M3 nuts.

`air_gap_c_base_admission.py` composes that base with the coupling owner's new
serial-key protocol and recovery-tool evidence. Its `load(path)` returns `base`,
`candidate`, `lifecycle`, `panel_lifecycle`, and `placement`. The publication owner
consumes that result and owns the archive and viewer.

## Design choice

Removing the bearing while retaining the existing 5 mm placement keeps the box
and ball low. Raising the entire collar above the keepers would use more of the
reported knob adjustment and increase overall height. The low placement is the
selected design, provided native well, tool, and service checks pass.

The service sequence holds the ball with one hand and exchanges ordinary AF3 and
AF4 keys with the other. The coupling owner must verify the recovery strokes and
the prohibition on turning a loose collar. The previous simultaneous-key model
does not admit this sequence. No PTFE rest or temporary packing is assumed.

## Verification sequence

1. Verify the pre-buffer roof, fixed stock interfaces, wiring, and twelve
   hardware solids against actual exports.
2. Prove continuous rotation and positive well clearance at both placements.
3. Check whole root keys, including the new recovery travel, with the panel off.
4. Check module withdrawal, grip tools, bounded race recovery, and panel paths.
5. Compose the new coupling protocol with panel service. Reject altered geometry,
   failed proof results, unsafe protocols, and in-memory shape mutations.
6. Commit verified milestones and hand the pinned admission to the publisher.

The knob and spinner now carry the ball's weight. Physical fit, load capacity,
grip, friction, and handling remain unverified.
