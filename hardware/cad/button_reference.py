"""Inspect Adafruit's unmodified 1185 STEP as a visual reference, not a print."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from build123d import import_step

CAD_DIR = Path(__file__).parent
REFERENCE = CAD_DIR / "components" / "adafruit-1185"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--show", action="store_true")
    parser.add_argument("--four", action="store_true", help="Show RGBY copies at illustrative 120 mm spacing")
    parser.add_argument("--reset-camera", action="store_true")
    parser.add_argument("--port", type=int, default=3939)
    args = parser.parse_args()
    provenance = json.loads((REFERENCE / "source.json").read_text())
    step_path = REFERENCE / "button.step"
    digest = hashlib.sha256(step_path.read_bytes()).hexdigest()
    if digest != provenance["sha256"]:
        raise RuntimeError("Reference STEP differs from the pinned manufacturer asset")
    shape = import_step(step_path)
    solids = list(shape.solids())
    if not solids or any(s.volume <= 0 for s in solids):
        raise RuntimeError("Reference import has no solids or a nonpositive body volume")
    bounds = shape.bounding_box()
    receipt = {
        "reference_only": True,
        "fit_verified": False,
        "units": "mm",
        "asset_sha256": digest,
        "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "solid_count": len(solids),
        "cad_valid": shape.is_valid,
        "solid_validity": [s.is_valid for s in solids],
        "bounds_mm": dict(x=bounds.size.X, y=bounds.size.Y, z=bounds.size.Z),
        "warning": "Upstream geometry may be invalid or overlapping. Do not use as printable geometry or a verified clearance envelope.",
    }
    output = CAD_DIR / "build" / "button-reference"
    output.mkdir(parents=True, exist_ok=True)
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))
    if args.show:
        from ocp_viewer import Camera, show
        colours = ["#d63b35", "#36a15c", "#367fd4", "#e7bd31"] if args.four else ["#d63b35"]
        positions = [(-60, 60), (60, 60), (-60, -60), (60, -60)] if args.four else [(0, 0)]
        names = ["Red", "Green", "Blue", "Yellow"] if args.four else ["Red"]
        show(
            *[shape.translate((x, y, 0)) for x, y in positions],
            names=[f"{name}: 1185 reference ONLY; upstream CAD invalid; no fit verified" for name in names],
            colors=colours,
            port=args.port,
            reset_camera=Camera.ISO if args.reset_camera else Camera.KEEP,
            axes=True,
            grid=(True, False, False),
        )
        print(f"Viewer: http://127.0.0.1:{args.port}/")


if __name__ == "__main__":
    main()
