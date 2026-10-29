# Mechanical verification

| Rule | Enforcement |
| --- | --- |
| Bind each screw and nut to its declared seat; another valid seat is not equivalent. | `resin_retention.Joint`, `check_axes`, `check_joints`; `check_resin_retention.py` swaps nuts and relocates complete pairs in helpers and full candidates. |
| Export hardware from Joint records; do not maintain a separate mutable hardware list. | `joint_hardware` and `resin_base.candidate_hardware` derive the actual exported solids. |
| An internal bar radius does not establish outer ball-shell clearance. | Separate `actual_outer_ball_shell_clearance_verified` gate and final integration requirement. |
