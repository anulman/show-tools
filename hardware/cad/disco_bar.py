"""Compare screw-clamp concepts and inspect private disco reference assets locally."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import trimesh
from build123d import (Axis, Box, Cylinder, Plane, Polygon, RegularPolygon,
                      Vertex, export_step, export_stl, extrude, import_step)


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


# Concept dimensions are deliberately illustrative. Only the reference crop and
# channel positions come from Darren's STEP. None of these parts is fit-ready.
@dataclass
class Piece:
    name: str
    shape: object
    role: str  # print, pad, hardware, knob, or context


@dataclass
class Concept:
    name: str
    pieces: list[Piece]
    pad_contacts: list[tuple[str, str]]


KNOB_RADIUS = 20.0
CHANNEL_X = (-45.643165, 45.996683776)


def box(x, y, z, center):
    return Box(x, y, z).translate(center)


def cylinder(radius, height, center, axis="z"):
    part = Cylinder(radius, height)
    if axis == "x":
        part = part.rotate(Axis.Y, 90)
    elif axis == "y":
        part = part.rotate(Axis.X, 90)
    return part.translate(center)


def carrier():
    part = cylinder(47.230665, 6, (0, 0, 3)) - cylinder(22.5, 8, (0, 0, 3))
    for x in CHANNEL_X:
        part -= cylinder(7.9375, 8, (x, 0, 3))
    return part


def pad_sector(axis, sign, wide=False):
    # Flanged elastomer envelope, retained behind the jaw's inner lip.
    pad = cylinder(22, 10, (0, 0, 13)) - cylinder(20, 12, (0, 0, 13))
    for z in (8.5, 17.5):
        pad += cylinder(23, 1, (0, 0, z)) - cylinder(20, 3, (0, 0, z))
    if wide:
        clip = box(90, 40, 20, (0, sign * 22, 13))
    elif axis == "y":
        clip = box(20, 30, 20, (0, sign * 29, 13))
    else:
        clip = box(30, 20, 20, (sign * 29, 0, 13))
    return pad & clip


def screw(axis, center, length):
    shaft = cylinder(1.5, length, center, axis)
    location = list(center)
    index = 0 if axis == "x" else 1
    location[index] += length / 2 + 1.5
    return shaft + cylinder(3, 3, location, axis)


def concept_bridge():
    rear_pad, front_pad = pad_sector("y", -1), pad_sector("y", 1)
    rear = box(68, 18, 14, (0, -23, 13)) - cylinder(22, 18, (0, 0, 13))
    front = box(68, 18, 14, (0, 23, 13)) - cylinder(22, 18, (0, 0, 13))
    rear -= rear_pad
    front -= front_pad
    base = carrier() + rear
    pieces = [Piece("carrier with fixed rear saddle", base, "print"),
              Piece("removable front bridge plate", front, "print"),
              Piece("rear captured pad", rear_pad, "pad"),
              Piece("front captured pad", front_pad, "pad")]
    for x in (-29, 29):
        bore = cylinder(1.8, 80, (x, 0, 13), "y")
        pieces[0].shape -= bore
        pieces[1].shape -= bore
        # A loose nut reference shows that the printed clearance bore is not a thread.
        pieces[0].shape -= hex_prism(3.5, 3, (x, -30.5, 13), "y")
        nut = hex_prism(3.2, 3, (x, -30.5, 13), "y") - cylinder(1.6, 5, (x, -30.5, 13), "y")
        pieces += [Piece(f"{x:+g} screw envelope, not a hardware specification", screw("y", (x, -1, 13), 66), "hardware"),
                   Piece(f"{x:+g} nut envelope", nut, "hardware")]
    return Concept("A | two-screw padded bridge", pieces,
                   [("carrier with fixed rear saddle", "rear captured pad"),
                    ("removable front bridge plate", "front captured pad")])


def concept_jaws():
    base = carrier()
    pieces = []
    for sign in (-1, 1):
        pad = pad_sector("x", sign)
        jaw = (box(16, 24, 14, (sign * 23, 0, 13)) - cylinder(22, 18, (0, 0, 13))) - pad
        # Two cheeks guide each shoe radially. A fixed outer boss receives a nut.
        for y in (-14, 14):
            base += box(22, 3, 14, (sign * 34, y, 13))
            base += box(22, 7, 2, (sign * 34, y - (2 if y > 0 else -2), 21))
        base += box(8, 31, 14, (sign * 43, 0, 13))
        base -= cylinder(1.8, 20, (sign * 43, 0, 13), "x")
        base -= hex_prism(3.5, 3, (sign * 45.5, 0, 13), "x")
        nut = hex_prism(3.2, 3, (sign * 45.5, 0, 13), "x") - cylinder(1.6, 5, (sign * 45.5, 0, 13), "x")
        # Each pressure screw terminates at the shoe's outer flat face, not the knob.
        stem = cylinder(1.5, 20, (sign * 41, 0, 13), "x")
        stem += cylinder(3, 3.2, (sign * 52.5, 0, 13), "x")
        pieces += [Piece(f"{sign:+d} guided jaw", jaw, "print"),
                   Piece(f"{sign:+d} captured pad", pad, "pad"),
                   Piece(f"{sign:+d} pressure screw envelope", stem, "hardware"),
                   Piece(f"{sign:+d} nut envelope", nut, "hardware")]
    pieces.insert(0, Piece("carrier with reinforced side bosses and guides", base, "print"))
    return Concept("B | independent padded jaws", pieces,
                   [(f"{s:+d} guided jaw", f"{s:+d} captured pad") for s in (-1, 1)])


def hex_prism(radius, height, center, axis="z"):
    shape = extrude(RegularPolygon(radius, 6), amount=height).translate((0, 0, -height / 2))
    if axis == "x":
        shape = shape.rotate(Axis.Y, 90)
    elif axis == "y":
        shape = shape.rotate(Axis.X, 90)
    return shape.translate(center)


def concept_drawplate():
    # Fixed planar ramps narrow by 2 mm per side over 20 mm of rise.
    # Separate shoes can move radially on the drawplate; a rigid ring cannot.
    top = cylinder(47.230665, 6, (0, 0, 25)) - cylinder(23.5, 8, (0, 0, 25))
    plate = cylinder(23.25, 4, (0, 0, -2)) - cylinder(20.8, 6, (0, 0, -2))
    for y in (-18, 18):
        plate += box(92, 5, 4, (0, y, -2))
    for x in CHANNEL_X:
        plate += box(8, 40, 4, (x, 0, -2))
    plate -= cylinder(20.8, 8, (0, 0, -2))
    pieces = []
    for sign in (-1, 1):
        fixed_profile = Plane.XZ * Polygon((27, 0), (32, 0), (32, 20), (25, 20), align=None)
        jaw_profile = Plane.XZ * Polygon((14, 0), (27, 0), (25, 20), (14, 20), align=None)
        ramp = extrude(fixed_profile, amount=12, both=True)
        jaw = extrude(jaw_profile, amount=10, both=True) - cylinder(22, 24, (0, 0, 10))
        pad = pad_sector("x", 1).translate((0, 0, -3))
        jaw -= pad
        if sign == -1:
            ramp = ramp.rotate(Axis.Z, 180)
            jaw = jaw.rotate(Axis.Z, 180)
            pad = pad.rotate(Axis.Z, 180)
        # Fixed cheeks retain each shoe tangentially, with a proposed 0.5 mm gap.
        for y in (-12, 12):
            top += box(13, 3, 22, (sign * 27.5, y, 11))
        top += ramp
        pieces += [Piece(f"{sign:+d} taper shoe", jaw, "print"),
                   Piece(f"{sign:+d} captured pad", pad, "pad")]
    for x in CHANNEL_X:
        top += cylinder(7, 6, (x, 0, 25))
        plate += cylinder(7, 4, (x, 0, -2))
        bore = cylinder(1.8, 40, (x, 0, 10))
        top -= bore
        plate -= bore
        plate -= hex_prism(3.5, 3, (x, 0, -2.5))
        nut = hex_prism(3.2, 3, (x, 0, -2.5)) - cylinder(1.6, 5, (x, 0, -2.5))
        bolt = cylinder(1.5, 32.1, (x, 0, 12)) + cylinder(3, 3, (x, 0, 29.5))
        pieces += [Piece(f"{x:+.2f} axial draw screw envelope", bolt, "hardware"),
                   Piece(f"{x:+.2f} captured drawplate nut envelope", nut, "hardware")]
    pieces = [Piece("fixed upper carrier with planar taper seats", top, "print"),
              Piece("lower drawplate with captive nut seats", plate, "print")] + pieces
    return Concept("C | channel-aligned axial drawplate", pieces,
                   [(f"{s:+d} taper shoe", f"{s:+d} captured pad") for s in (-1, 1)])


def concepts():
    return [concept_bridge(), concept_jaws(), concept_drawplate()]


def preview(step_path: Path | None = None):
    """Return three concept assemblies to the sole coordinated publisher."""
    _, reference = load_reference(step_path)
    # Upper 28 mm only. Preserve original axes and z=0 reference plane.
    context = reference & box(110, 110, 28, (0, 0, -14))
    colors = {"print": "#247bc1", "pad": "#eea541", "hardware": "#bfc9d1", "knob": "#57616b", "context": "#aeb5bc"}
    objects, names, shades, alphas = [], [], [], []
    for i, concept in enumerate(concepts()):
        items = concept.pieces + [Piece("ILLUSTRATIVE knob Ø40 mm; not measured", cylinder(20, 34, (0, 0, 5)), "knob"),
                                  Piece("Darren upper28mm reference crop; display z=-35 offset, NOT assembled", context.translate((0, 0, -35)), "context")]
        for piece in items:
            display_shape = piece.shape
            if i == 2 and piece.name == "fixed upper carrier with planar taper seats":
                display_shape -= box(70, 60, 40, (0, -33, 14))
                piece = Piece(piece.name + " DISPLAY CUTAWAY; export is complete", display_shape, piece.role)
            objects.append(display_shape.translate(((i - 1) * 140, 0, 0)))
            names.append(f"{concept.name} / {piece.name} / CONCEPT ONLY, mm")
            shades.append(colors[piece.role])
            alphas.append(.18 if piece.role == "context" else .5 if piece.role == "knob" else 1.)
    return objects, names, shades, alphas


def check_motion(concept, index):
    """Sample release and closure; rigid pieces may touch but cannot intersect."""
    samples = []
    knob = cylinder(20, 34, (0, 0, 5))
    for travel in ((0., .5, 1.) if index == 2 else (-.5, -.25, 0., .5, 1.)):
        moved = []
        for piece in concept.pieces:
            offset = (0, 0, 0)
            if index == 0 and piece.name in ("removable front bridge plate", "front captured pad"):
                offset = (0, travel, 0)
            elif index == 1 and ("guided jaw" in piece.name or "captured pad" in piece.name):
                offset = ((-1 if piece.name.startswith("-1") else 1) * travel, 0, 0)
            elif index == 2:
                if piece.name == "lower drawplate with captive nut seats":
                    offset = (0, 0, travel)
                elif "taper shoe" in piece.name or "captured pad" in piece.name:
                    sign = -1 if piece.name.startswith("-1") else 1
                    offset = (-sign * .1 * travel, 0, travel)
            if piece.role in ("print", "pad"):
                moved.append(Piece(piece.name, piece.shape.translate(offset), piece.role))
        max_overlap = 0.
        for number, first in enumerate(moved):
            for second in moved[number + 1:]:
                overlap = first.shape & second.shape
                volume = overlap.volume if overlap else 0.
                max_overlap = max(max_overlap, volume)
                if volume > 1e-5:
                    raise RuntimeError(f"Motion collision at {travel}: {first.name}/{second.name}: {volume}")
        pad_compression_envelope = 0.
        for piece in moved:
            overlap = piece.shape & knob
            volume = overlap.volume if overlap else 0.
            if piece.role == "print" and volume > 1e-5:
                raise RuntimeError(f"Rigid knob collision at {travel}: {piece.name}")
            if piece.role == "pad":
                pad_compression_envelope += volume
        samples.append({"travel_mm": travel, "direction": "axial closure" if index == 2 else "radial release" if travel >= 0 else "radial closure",
                        "radial_shoe_closure_mm": .1 * travel if index == 2 else None,
                        "max_rigid_or_pad_pair_overlap_mm3": max_overlap,
                        "pad_knob_compression_envelope_mm3": pad_compression_envelope})
    return {"samples": samples, "limit": "Discrete geometry checks, not continuous collision proof, rubber deformation, preload, or operating stroke validation"}


def verify_concepts(output: Path):
    """Export only proposed print parts, with roundtrip and assembly checks."""
    reports = []
    for index, concept in enumerate(concepts()):
        part_reports = []
        for number, piece in enumerate(concept.pieces):
            shape = piece.shape
            if not shape.is_valid or len(shape.solids()) != 1 or shape.volume <= 0:
                raise RuntimeError(f"Invalid concept piece: {concept.name}/{piece.name}")
            if piece.role != "print":
                continue
            folder = output / chr(97 + index)
            folder.mkdir(parents=True, exist_ok=True)
            stem = f"{number:02d}-{piece.name.replace(' ', '-').replace('+', 'plus')}"
            step_path, stl_path = folder / f"{stem}.step", folder / f"{stem}.stl"
            if not export_step(shape, step_path) or not export_stl(shape, stl_path, tolerance=.03):
                raise RuntimeError(f"Export failed: {piece.name}")
            restored = import_step(step_path)
            mesh = trimesh.load_mesh(stl_path)
            if not restored.is_valid or len(restored.solids()) != 1 or not np.isclose(restored.volume, shape.volume, rtol=1e-8):
                raise RuntimeError(f"STEP roundtrip failed: {piece.name}")
            if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume <= 0 or not np.isclose(mesh.volume, shape.volume, rtol=.005):
                raise RuntimeError(f"STL check failed: {piece.name}")
            part_reports.append({"name": piece.name, "volume_mm3": shape.volume, "valid_solid": True,
                                 "step_roundtrip": True, "stl_watertight": True,
                                 "stl_volume_mm3": float(mesh.volume)})
        collisions = []
        for a, first in enumerate(concept.pieces):
            for second in concept.pieces[a + 1:]:
                # Hardware envelopes include unmodelled thread/nut contact.
                if first.role == "hardware" or second.role == "hardware":
                    continue
                intersection = first.shape & second.shape
                volume = intersection.volume if intersection else 0
                if volume > 1e-5:
                    collisions.append([first.name, second.name, volume])
        if collisions:
            raise RuntimeError(f"Unintended assembly intersections: {collisions}")
        lookup = {p.name: p.shape for p in concept.pieces}
        contacts = []
        for jaw, pad in concept.pad_contacts:
            distance = lookup[jaw].distance_to(lookup[pad])
            if distance > 1e-5:
                raise RuntimeError(f"Pad has no seat: {pad}")
            contacts.append({"jaw": jaw, "pad": pad, "distance_mm": distance})
        knob = cylinder(20, 34, (0, 0, 5))
        for piece in concept.pieces:
            if piece.role not in ("print", "pad"):
                continue
            intersection = piece.shape & knob
            if intersection and intersection.volume > 1e-5:
                raise RuntimeError(f"Knob envelope collision: {piece.name}")
        # Hardware contact is checked separately from nut/thread approximations.
        for piece in concept.pieces:
            if piece.role != "hardware":
                continue
            for printed in (p for p in concept.pieces if p.role == "print"):
                overlap = piece.shape & printed.shape
                if overlap and overlap.volume > 1e-5:
                    raise RuntimeError(f"Hardware penetrates print: {piece.name}/{printed.name}")
        reports.append({"concept": concept.name, "print_parts": part_reports,
                        "motion": check_motion(concept, index),
                        "print_and_pad_collisions": collisions, "intentional_pad_seats": contacts,
                        "knob_radius_mm_ILLUSTRATIVE": KNOB_RADIUS,
                        "hardware_limit": "Screw/nut envelopes only; threads, torque, fastener selection and retention not verified"})
    receipt = {"concept_only": True, "fit_verified": False, "units": "mm", "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "concepts": reports}
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


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
    parser.add_argument("--concepts", type=Path, help="Export and verify proposed print parts to a local directory")
    args = parser.parse_args()
    report = verify_concepts(args.concepts) if args.concepts else inspect(args.step, args.stl, args.obj)
    result = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(result)
    print(result, end="")


if __name__ == "__main__":
    main()
