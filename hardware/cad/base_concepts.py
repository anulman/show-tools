"""Four enclosure form studies. Dimensions are design inputs, not measured fit."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from build123d import (
    Align, Axis, Box, Cone, Cylinder, Plane, Polygon, RectangleRounded,
    SlotOverall, export_step, export_stl, extrude, import_step,
)
import trimesh

CAD_DIR = Path(__file__).parent
CENTRE_MIN = (Align.CENTER, Align.CENTER, Align.MIN)


def rounded_box(width, length, radius, height):
    return extrude(RectangleRounded(width, length, radius), amount=height)


def concepts(depth: float, tilt: float):
    """Mounting face is z=0. Open-bottom bodies extend downward by depth."""
    roof = 5.0
    # All holes and cavities are conceptual, deliberately independent of invalid STEP.
    square = rounded_box(116, 116, 12, depth).translate((0, 0, -depth))
    square -= rounded_box(106, 106, 8, depth - roof).translate((0, 0, -depth - .1))

    flared = Cone(70, 55, depth, align=CENTRE_MIN).translate((0, 0, -depth))
    flared += Cylinder(72, 5, align=CENTRE_MIN).translate((0, 0, -depth))
    flared -= Cone(64, 49, depth - roof, align=CENTRE_MIN).translate((0, 0, -depth - .1))

    # Button normal leans toward -Y. Floor remains flat; roof and hole share tilt.
    slope = math.tan(math.radians(tilt))
    shell = rounded_box(116, 126, 12, depth + 12).translate((0, 0, -depth))
    profile = Plane.YZ * Polygon((-80, -depth - 1), (80, -depth - 1),
                                 (80, 80 * slope), (-80, -80 * slope), align=None)
    shell &= extrude(profile, amount=180, both=True)
    cavity = rounded_box(106, 116, 8, depth + 12).translate((0, 0, -depth - .1))
    inner = Plane.YZ * Polygon((-80, -depth - 1), (80, -depth - 1),
                               (80, 80 * slope - roof), (-80, -80 * slope - roof), align=None)
    shell -= cavity & extrude(inner, amount=180, both=True)

    capsule = extrude(SlotOverall(156, 112), amount=depth).translate((18, 0, -depth))
    capsule -= extrude(SlotOverall(146, 102), amount=depth - roof).translate((18, 0, -depth - .1))
    # Rear service opening gives a visibly different cable-access approach.
    capsule -= Box(42, 34, depth - 14, align=CENTRE_MIN).translate((92, 0, -depth - .1))

    bodies = [square, flared, shell, capsule]
    for index, body in enumerate(bodies):
        bore = Cylinder(14, depth + 40, align=CENTRE_MIN).translate((0, 0, -depth - 20))
        if index == 2:
            bore = bore.rotate(Axis.X, tilt)
        bodies[index] = body - bore
    return bodies


def verify(body, directory: Path):
    if not body.is_valid or len(body.solids()) != 1 or body.volume <= 0:
        raise RuntimeError(f"Invalid concept body: {directory.name}")
    directory.mkdir(parents=True, exist_ok=True)
    step, stl = directory / "concept-NOT-FIT-VERIFIED.step", directory / "concept-NOT-FIT-VERIFIED.stl"
    if not export_step(body, step) or not export_stl(body, stl, tolerance=.05):
        raise RuntimeError("Concept export failed")
    restored = import_step(step)
    if not restored.is_valid or len(restored.solids()) != 1 or not math.isclose(restored.volume, body.volume, rel_tol=1e-8):
        raise RuntimeError("Concept STEP round trip failed")
    mesh = trimesh.load_mesh(stl)
    if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume <= 0:
        raise RuntimeError("Concept STL integrity failed")
    if not math.isclose(float(mesh.volume), body.volume, rel_tol=.005):
        raise RuntimeError("Concept mesh volume differs from CAD")
    bounds = body.bounding_box().size
    return dict(cad_valid=True, solid_count=1, cad_volume_mm3=body.volume,
                stl_watertight=True, bounds_mm=[bounds.X, bounds.Y, bounds.Z])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--depth", type=float, required=True, help="Concept depth below mounting-face centre, mm; not a measured clearance")
    parser.add_argument("--tilt", type=float, default=5, help="Third concept tilt toward -Y, 0..5 degrees")
    parser.add_argument("--show", action="store_true")
    parser.add_argument("--reset-camera", action="store_true")
    parser.add_argument("--port", type=int, default=3939)
    args = parser.parse_args()
    if not math.isfinite(args.depth) or not 35 <= args.depth <= 180:
        parser.error("Concept depth must be finite and between 35 and 180 mm")
    if not math.isfinite(args.tilt) or not 0 <= args.tilt <= 5:
        parser.error("Tilt must be finite and between 0 and 5 degrees")
    names = ["A rounded square", "B flared cylinder", "C tilted square", "D capsule with rear access"]
    bodies = concepts(args.depth, args.tilt)
    output = CAD_DIR / "build" / f"base-concepts-{args.depth:g}mm-{args.tilt:g}deg"
    records = {name: verify(body, output / name[0]) for name, body in zip(names, bodies)}
    receipt = dict(concept_only=True, fit_verified=False, units="mm", depth_mm=args.depth,
                   tilt_degrees=args.tilt, mounting_hole_diameter_mm=28, roof_thickness_mm=5,
                   source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), bodies=records)
    if args.show:
        from ocp_viewer import Camera, show
        source = CAD_DIR / "components" / "adafruit-1185"
        provenance = json.loads((source / "source.json").read_text())
        digest = hashlib.sha256((source / "button.step").read_bytes()).hexdigest()
        if digest != provenance["sha256"]:
            raise RuntimeError("Manufacturer reference asset changed")
        button = import_step(source / "button.step")
        objects, labels, colours, alphas = [], [], [], []
        positions = [(-105, 110), (105, 110), (-105, -110), (105, -110)]
        for index, (name, body, (x, y), colour) in enumerate(zip(names, bodies, positions, ["#d63b35", "#36a15c", "#367fd4", "#e7bd31"])):
            reference = button.rotate(Axis.X, args.tilt) if index == 2 else button
            objects.extend([body.translate((x, y, 0)), reference.translate((x, y, 0))])
            labels.extend([f"{name}: CONCEPT ONLY, {args.depth:g}mm depth" + (f", {args.tilt:g}deg toward -Y" if index == 2 else ""),
                           f"{name[0]} button REF: upstream invalid, no measured fit"])
            colours.extend(["#b8a084", colour])
            alphas.extend([.72, 1])
        show(*objects, names=labels, colors=colours, alphas=alphas, port=args.port,
             reset_camera=Camera.ISO if args.reset_camera else Camera.KEEP,
             axes=True, grid=(True, False, False))
        receipt["reference_asset_sha256"] = digest
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
