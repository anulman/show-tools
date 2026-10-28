"""Synthetic fit-review exercise. No dimensions describe installed hardware."""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path

from build123d import Align, Axis, Box, Cylinder, Plane, Polygon, export_step, export_stl, extrude, import_step
import trimesh


def assembly(angle: float):
    if not math.isfinite(angle) or not 0 <= angle <= 45:
        raise ValueError("Demo angle must be between 0 and 45 degrees")
    base = Box(80, 60, 5, align=(Align.CENTER, Align.CENTER, Align.MIN))
    top_back = 9 + 32 * math.tan(math.radians(angle))
    profile = Plane.YZ * Polygon((-16, 4.5), (16, 4.5), (16, top_back), (-16, 9), align=None)
    wedge = extrude(profile, amount=50).translate((-25, 0, 0))
    mount = base + wedge
    for x in (-30, 30):
        for y in (-20, 20):
            bore = Cylinder(2.5, 7, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate((x, y, -1))
            mount -= bore
    wood = Box(100, 80, 15, align=(Align.CENTER, Align.CENTER, Align.MIN)).translate((0, 0, -15))
    seat_z = 9 + 16 * math.tan(math.radians(angle))
    placeholder = Cylinder(10, 8, align=(Align.CENTER, Align.CENTER, Align.MIN)).rotate(Axis.X, angle).translate((0, 0, seat_z))
    if not mount.is_valid or len(mount.solids()) != 1 or mount.volume <= 0:
        raise RuntimeError("Demo mount must be one valid positive-volume solid")
    return mount, wood, placeholder


def verify_exports(mount, angle: float, output: Path):
    output.mkdir(parents=True, exist_ok=True)
    step_path, stl_path = output / "demo-mount.step", output / "demo-mount.stl"
    if not export_step(mount, step_path) or not export_stl(mount, stl_path, tolerance=.02):
        raise RuntimeError("CAD export failed")
    imported = import_step(step_path)
    if not imported.is_valid or len(imported.solids()) != 1 or not math.isclose(imported.volume, mount.volume, rel_tol=1e-8):
        raise RuntimeError("STEP round trip changed the solid")
    mesh = trimesh.load_mesh(stl_path)
    if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume <= 0:
        raise RuntimeError("STL must be watertight, consistently wound, and positive-volume")
    if not math.isclose(float(mesh.volume), mount.volume, rel_tol=.005):
        raise RuntimeError("STL volume diverges from the CAD solid")
    bounds = mount.bounding_box()
    receipt = {
        "demo_only": True,
        "units": "mm",
        "angle_degrees": angle,
        "solid_count": len(mount.solids()),
        "cad_valid": mount.is_valid,
        "cad_volume_mm3": mount.volume,
        "stl_watertight": bool(mesh.is_watertight),
        "stl_volume_mm3": float(mesh.volume),
        "bounds_mm": {"x": bounds.size.X, "y": bounds.size.Y, "z": bounds.size.Z},
        "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "packages": {name: importlib.metadata.version(name) for name in ("build123d", "ocp-viewer", "trimesh")},
    }
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--angle", type=float, default=15, help="Synthetic demo tilt in degrees, 0..45")
    parser.add_argument("--show", action="store_true", help="Publish the assembly to the already-running viewer")
    parser.add_argument("--reset-camera", action="store_true", help="Return to the isometric view instead of keeping the current camera")
    parser.add_argument("--port", type=int, default=3939)
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "build")
    args = parser.parse_args()
    mount, wood, placeholder = assembly(args.angle)
    verify_exports(mount, args.angle, args.output / f"demo-{args.angle:g}deg")
    if args.show:
        from ocp_viewer import Camera, show
        show(
            mount, wood, placeholder,
            names=[f"DEMO mount: {args.angle:g} deg (synthetic dimensions)", "Reference wood only", "Placeholder only: not a real component"],
            colors=["#2674d9", "#b28b61", "#efb93f"],
            alphas=[1, .35, .8],
            port=args.port,
            reset_camera=Camera.ISO if args.reset_camera else Camera.KEEP,
            axes=True,
            grid=(True, False, False),
        )
        print(f"Viewer: http://127.0.0.1:{args.port}/")


if __name__ == "__main__":
    main()
