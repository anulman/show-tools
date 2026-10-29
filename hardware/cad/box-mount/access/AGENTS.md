# Mechanical verification

| Rule | Enforcement |
| --- | --- |
| Bind each screw and nut to its declared seat; another valid seat is not equivalent. | `resin_retention.Joint`, `check_axes`, `check_joints`; `check_resin_retention.py` swaps nuts and relocates complete pairs in helpers and full candidates. |
| Export hardware from Joint records; do not maintain a separate mutable hardware list. | `joint_hardware` and `resin_base.candidate_hardware` derive the actual exported solids. |
| An internal bar radius does not establish outer ball-shell clearance. | `below_plane_buffer.below_root_guard` checks every fixed solid against the operator-confirmed opening plane; the whole-candidate old-cap mutant must fail. Physical fit remains a separate gate. |
| Keep at least 0.5 mm PTFE under every seated countersunk head, and derive trials from the exact full source. | `below_plane_buffer.verify_seated_head_tolerances`, material-web guard, old 0.09 mm recipe regression, and `buffer_ear_trial` two-way source material checks. |
| Bind trial provenance to captured receipt bytes and the complete producer set. | `ReceiptSnapshot`, exact `SOURCE_PATHS` inventory, repeated input/output checks; `check_buffer_ear_trial.py` rejects omitted sources and receipt/artifact mutations across build, verification and export. |
| Derive C2 ports and service clearance from the actual paired exports, including whole-tool staging. | `resin_c2` validates the immutable eight-source producer and all states/sweeps, bounds every above-roof fixed part, and checks actual planar support. `check_resin_c2.py` restores unported panels/old tiedowns and rejects insufficient lift and unbounded fixed material. |
