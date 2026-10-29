"""Check the actual floor and cover bounds independently of derived datums."""
from dataclasses import replace
import importlib.util
import math
from pathlib import Path
import sys

# Optional source path lets reviewers run this same check against an earlier file.
source = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parents[1] / "box_mount.py"
spec = importlib.util.spec_from_file_location("box_mount_under_check", source)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

for thickness in (3.0, 5.0):
    parameters = replace(module.Proposal(), bottom_thickness=thickness)
    for tilted in (False, True):
        shell, cover, *_ = module.build(parameters, tilted)
        label = "C" if tilted else "A"
        checks = (
            ("interior floor", cover.bounding_box().max.Z, -35.25),
            ("shell split", shell.bounding_box().min.Z, -35.25),
            ("external underside", cover.bounding_box().min.Z, -35.25-thickness),
        )
        for datum, actual, expected in checks:
            assert math.isclose(actual, expected, abs_tol=1e-6), f"{label} {thickness}mm cover {datum}: {actual} != {expected}"
print("A/C preserve 35.25 mm interior depth with both 3 mm and 5 mm covers")
