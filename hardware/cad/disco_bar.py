"""Compare the complete original disco bar with selected integrated variants."""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path

import numpy as np
import trimesh
from build123d import Axis, Box, Vertex, import_step

REFERENCE_SHA256 = "f0a21384179b69eff79205032dad536bfa1350e358c25ed0fe01de4189f2e003"
ORIGINAL_LABEL = "ORIGINAL | complete unchanged bar | original pose, mm"


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


def verify_full_reference(path, shape):
    """Preserve the measured insertion width and full top-attachment reach."""
    bounds = shape.bounding_box()
    actual = [[bounds.min.X, bounds.min.Y, bounds.min.Z],
              [bounds.max.X, bounds.max.Y, bounds.max.Z]]
    expected = [[-47.2306651, -47.2306651, -109.22],
                [47.2306651, 47.2306651, 0.0]]
    if hashlib.sha256(path.read_bytes()).hexdigest() != REFERENCE_SHA256:
        raise ValueError("Use Darren's original full-height STEP; a replacement requires fit review")
    if not np.allclose(actual, expected, atol=1e-5, rtol=0):
        raise ValueError("Preserve the full 109.22 mm top-attachment reach and measured opening-fit width")
    if not np.isclose(shape.volume, 75384.7502, atol=.001, rtol=0):
        raise ValueError("Full-bar geometry changed; cropped or replacement carriers are not approved")
    return {"complete_reference": True, "source_hash_matches": True,
            "bounds_mm": actual, "volume_mm3": shape.volume,
            "height_role": "full reach to top attachment",
            "width_role": "operator-confirmed measured fit through disco-ball opening"}


def integrated_module():
    return importlib.import_module("disco-bar.full_height")


def full_variants(reference):
    return integrated_module().full_variants(reference)


def verify_integrated(reference, output):
    report = integrated_module().verify_integrated(reference, output)
    report["entrypoint_sha256"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    (output / "receipt.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def verify_preview_scene(path, scene):
    objects, names, colors, alphas = scene
    if not objects or not len(objects) == len(names) == len(colors) == len(alphas):
        raise ValueError("Preview objects and attributes must have matching nonzero lengths")
    if hashlib.sha256(Path(path).read_bytes()).hexdigest() != REFERENCE_SHA256:
        raise ValueError("Use the pinned complete original source asset")
    _, reference = load_reference(path)
    verify_full_reference(path, reference)
    if names.count(ORIGINAL_LABEL) != 1 or names[0] != ORIGINAL_LABEL:
        raise ValueError("Keep one unchanged original first, labelled and in its original pose")
    verify_full_reference(path, objects[0])
    model = integrated_module()
    model.assert_empty(reference - objects[0], "Original preview lost source material")
    model.assert_empty(objects[0] - reference, "Original preview gained or displaced material")
    variants = full_variants(reference)
    if len(objects) != 1 + sum(len(variant.pieces) for variant in variants):
        raise ValueError("Preview must contain only the original and selected complete assemblies")
    for index, variant in enumerate(variants, start=1):
        prefix = variant.name + " / "
        matches = [(shape.translate((-index * model.SPACING, 0, 0)), name)
                   for shape, name in zip(objects, names) if name.startswith(prefix)]
        if len(matches) != len(variant.pieces):
            raise ValueError(f"Missing complete assembly: {variant.name}")
        bodies = [shape for shape, name in matches if name == prefix + "complete integrated bar"]
        if len(bodies) != 1:
            raise ValueError(f"Keep one full body per variant: {variant.name}")
        for piece in variant.pieces:
            actual = [shape for shape, name in matches if name == prefix + piece.name]
            if len(actual) != 1:
                raise ValueError(f"Missing or duplicate preview piece: {prefix}{piece.name}")
            piece.shape = actual[0]
        model.preserved_geometry(reference, variant)
        model.check_assembly(variant, 0.)
    return {"complete_original_unchanged": True, "original_pose_preserved": True,
            "complete_variants": list(model.DEFAULT_VARIANTS), "source_pocket_entry_depth_preserved": True}


def box(x, y, z, center):
    return Box(x, y, z).translate(center)


def preview(step_path: Path | None = None):
    """Show the unchanged original and only the selected complete variants."""
    path, reference = load_reference(step_path)
    verify_full_reference(path, reference)
    model = integrated_module()
    objects, names, colors, alphas = [reference], [ORIGINAL_LABEL], ["#9ea8b4"], [1.]
    palette = {"body": "#2880b8", "print": "#187ac9", "pad": "#efa028", "hardware": "#a0abb8"}
    for index, variant in enumerate(full_variants(reference), start=1):
        model.preserved_geometry(reference, variant)
        for piece in variant.pieces:
            objects.append(piece.shape.translate((index * model.SPACING, 0, 0)))
            names.append(variant.name + " / " + piece.name)
            colors.append(palette[piece.role])
            alphas.append(.18 if piece.role == "body" else 1.)
    return objects, names, colors, alphas


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
        "integrated_source_sha256": hashlib.sha256(Path(integrated_module().__file__).read_bytes()).hexdigest(),
        "cad_valid": shape.is_valid, "solids": len(shape.solids()),
        "faces": len(shape.faces()), "volume_mm3": shape.volume,
        "bounds_mm": [[bounds.min.X, bounds.min.Y, bounds.min.Z],
                      [bounds.max.X, bounds.max.Y, bounds.max.Z]],
        "surface_types": sorted({str(face.geom_type) for face in shape.faces()}),
        "meshes": {},
        "preserved_functional_envelope": verify_preview_scene(path, preview(path)),
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
    parser.add_argument("--concepts", type=Path, help="Export and verify four full-height integrated variants using the private STEP")
    args = parser.parse_args()
    if args.concepts:
        path, reference = load_reference(args.step)
        verify_full_reference(path, reference)
        report = verify_integrated(reference, args.concepts)
        report["reference_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        (args.concepts / "receipt.json").write_text(json.dumps(report, indent=2) + "\n")
    else:
        report = inspect(args.step, args.stl, args.obj)
    result = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(result)
    print(result, end="")


if __name__ == "__main__":
    main()
