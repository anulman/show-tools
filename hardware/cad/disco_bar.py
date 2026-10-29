"""Inspect private disco reference assets locally; never publish or export geometry."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path

import numpy as np
import trimesh
from build123d import Vertex, import_step


def load_reference(step_path: Path | None = None):
    source = step_path or os.environ.get("SHOW_TOOLS_DISCO_STEP")
    if not source:
        raise ValueError("Supply --step PATH or set SHOW_TOOLS_DISCO_STEP to the private STEP")
    path = Path(source).expanduser()
    # build123d normalizes declared STEP length units to millimetres.
    shape = import_step(path)
    if not shape.is_valid or len(shape.solids()) != 1 or shape.volume <= 0:
        raise ValueError("Reference must import as one valid positive-volume solid")
    return path, shape


def preview(step_path: Path | None = None):
    """Return data for the single coordinated publisher; preserve source pose."""
    _, shape = load_reference(step_path)
    return ([shape], ["Darren reference ONLY — mm, original pose; no bar or fit verified"],
            ["#9ea8b4"], [0.65])


def mesh_report(path: Path, scale: float, reference):
    mesh = trimesh.load(path, force="mesh")
    if len(mesh.faces) == 0 or not np.isfinite(mesh.vertices).all():
        raise ValueError(f"Mesh is empty or nonfinite: {path.name}")
    # Test the scale hypothesis against STEP surfaces, not just the bounding box.
    # These deterministic samples are evidence, not a complete equivalence proof.
    vertices = mesh.vertices[np.linspace(0, len(mesh.vertices) - 1, min(128, len(mesh.vertices)), dtype=int)]
    centers = mesh.triangles_center[np.linspace(0, len(mesh.faces) - 1, min(128, len(mesh.faces)), dtype=int)]
    samples = np.concatenate((vertices, centers)) * scale
    distances = np.array([reference.distance_to(Vertex(*point)) for point in samples])
    return {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "raw_bounds": mesh.bounds.tolist(),
        "raw_units": "not established by this mesh inspection",
        "comparison_scale_to_mm": scale,
        "scale_interpretation": "candidate mapping to the STEP, not a mesh unit declaration",
        "scaled_bounds_mm": (mesh.bounds * scale).tolist(),
        "faces": len(mesh.faces), "vertices": len(mesh.vertices),
        "watertight": bool(mesh.is_watertight),
        "winding_consistent": bool(mesh.is_winding_consistent),
        "scaled_signed_volume_mm3": float(mesh.volume * scale**3),
        "sample_count": len(samples),
        "sample_to_step_surface_max_mm": float(distances.max()),
        "sample_to_step_surface_mean_mm": float(distances.mean()),
        "comparison_limit": "One-way sampled point-to-surface distances; not topology or full surface equivalence. Non-watertight mesh volume is diagnostic only.",
    }


def inspect(step_path: Path | None, stl_path: Path | None, obj_path: Path | None):
    path, shape = load_reference(step_path)
    bounds = shape.bounding_box()
    report = {
        "reference_only": True, "fit_verified": False, "units": "mm",
        "step_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "cad_valid": shape.is_valid, "solids": len(shape.solids()),
        "faces": len(shape.faces()), "volume_mm3": shape.volume,
        "bounds_mm": [[bounds.min.X, bounds.min.Y, bounds.min.Z],
                      [bounds.max.X, bounds.max.Y, bounds.max.Z]],
        "surface_types": sorted({str(face.geom_type) for face in shape.faces()}),
        "meshes": {},
    }
    for kind, source, scale in (("stl", stl_path, 25.4), ("obj", obj_path, 1000.0)):
        if source:
            report["meshes"][kind] = mesh_report(source, scale, shape)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--step", type=Path)
    parser.add_argument("--stl", type=Path)
    parser.add_argument("--obj", type=Path)
    parser.add_argument("--output", type=Path, help="Optional local JSON receipt; no source assets copied")
    args = parser.parse_args()
    report = inspect(args.step, args.stl, args.obj)
    result = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(result)
    print(result, end="")


if __name__ == "__main__":
    main()
