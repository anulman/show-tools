"""Local clamp studies integrated into Darren's complete, measured-fit bar."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path

import numpy as np
import trimesh
from build123d import Axis, Box, Cone, Cylinder, Plane, Polygon, RegularPolygon, export_step, export_stl, extrude, import_step

R = 22.177375  # Original cylindrical pocket, not a measured knob OD.
OUTER = 47.2306651
SPACING = 130.0


@dataclass
class Piece:
    name: str
    shape: object
    role: str


@dataclass
class Variant:
    name: str
    pieces: list[Piece]
    edit_mask: object
    tools: list
    mechanism: str = "screw"
    reference: object | None = None


def box(x, y, z, center):
    return Box(x, y, z).translate(center)


def cyl(r, h, center, axis="z"):
    shape = Cylinder(r, h)
    if axis == "x":
        shape = shape.rotate(Axis.Y, 90)
    elif axis == "y":
        shape = shape.rotate(Axis.X, 90)
    return shape.translate(center)


def hexagon(r, h, center, axis="z"):
    shape = extrude(RegularPolygon(r, 6), amount=h).translate((0, 0, -h / 2))
    if axis == "x":
        shape = shape.rotate(Axis.Y, 90)
    elif axis == "y":
        shape = shape.rotate(Axis.X, 90)
    return shape.translate(center)


def pocket():
    """Source cylindrical void plus its actual entry bevel and blind depth."""
    bore = cyl(R, 24.60625, (0, 0, -13.096875))
    entry = Cone(R, 22.971125, .79375).translate((0, 0, -.396875))
    return bore + entry


def local_mask():
    return cyl(45.5, 21, (0, 0, -13.5))  # z=-24..-3, below preserved entry.


def pad(axis, sign):
    shape = cyl(R + 1.5, 10, (0, 0, -13)) - cyl(R, 12, (0, 0, -13))
    for z in (-17.5, -8.5):
        shape += cyl(R + 2.25, 1, (0, 0, z)) - cyl(R, 3, (0, 0, z))
    clip = box(20, 30, 20, (0, sign * 29, -13)) if axis == "y" else box(30, 20, 20, (sign * 29, 0, -13))
    return shape & clip


def bridge(reference, guided=False):
    rear_pad, moving_pad = pad("y", -1), pad("y", 1)
    rear = box(64, 16, 14, (0, -22, -13)) - cyl(R + 1.5, 18, (0, 0, -13))
    plate = box(64, 16, 14, (0, 22, -13)) - cyl(R + 1.5, 18, (0, 0, -13))
    plate -= moving_pad
    clearance = box(64.6, 16.6, 14.6, (0, 22, -13))
    body = (reference - clearance) + rear
    body -= rear_pad
    mask = local_mask()
    if guided:
        guides = None
        for sign in (-1, 1):
            side = box(3, 57, 18, (sign * 33.5, -.5, -13))
            for z in (-21, -5):
                side += box(4.5, 14, 2, (sign * 32.75, 21, z))
            guides = side if guides is None else guides + side
        guides &= cyl(45.5, 24, (0, 0, -13))
        body += guides
    hardware, tools = [], []
    for x in (-28, 28):
        bore = cyl(1.8, 68, (x, 0, -13), "y")
        body -= bore
        plate -= bore
        body -= hexagon(3.5, 3, (x, -28.5, -13), "y")
        nut = hexagon(3.2, 3, (x, -28.5, -13), "y") - cyl(1.6, 5, (x, -28.5, -13), "y")
        bolt = cyl(1.5, 60.1, (x, 0, -13), "y") + cyl(3, 3, (x, 31.5, -13), "y")
        for sign in (-1, 1):
            port = cyl(3.6, 24, (x, sign * 42, -13), "y")
            body -= port
            mask += port
        # Only the path outside the screw head; the head itself is the target.
        tools.append(cyl(2.8, 18, (x, 42, -13), "y"))
        hardware += [Piece(f"{x:+g} draw screw", bolt, "hardware"), Piece(f"{x:+g} captive hex nut", nut, "hardware")]
    name = "D | guided bridge; historical side access" if guided else "A | removable bridge"
    return Variant(name, [Piece("complete integrated bar", body, "body"), Piece("moving bridge plate", plate, "print"),
                          Piece("fixed pad", rear_pad, "pad"), Piece("moving pad", moving_pad, "pad")] + hardware, mask, tools)


def jaws(reference):
    body, pieces, tools = reference, [], []
    mask = local_mask()
    for sign in (-1, 1):
        cushion = pad("x", sign)
        jaw = box(15, 22, 14, (sign * 21.5, 0, -13)) - cyl(R + 1.5, 18, (0, 0, -13))
        jaw -= cushion
        body -= box(15.6, 22.6, 14.6, (sign * 21.5, 0, -13))
        support = box(6, 30.6, 14, (sign * 34, 0, -13))
        for y in (-13.3, 13.3):
            support += box(19, 4, 14, (sign * 27.5, y, -13))
        for z in (-21, -5):
            support += box(19, 30.6, 2, (sign * 27.5, 0, z)) - cyl(R + 1.5, 5, (0, 0, z))
        body += support
        body -= cyl(1.8, 14, (sign * 34, 0, -10), "x")
        body -= hexagon(3.5, 3, (sign * 35.5, 0, -10), "x")
        nut = hexagon(3.2, 3, (sign * 35.5, 0, -10), "x") - cyl(1.6, 5, (sign * 35.5, 0, -10), "x")
        bolt = cyl(1.5, 9.5, (sign * 33.75, 0, -10), "x") + cyl(3, 3, (sign * 40, 0, -10), "x")
        access = cyl(3.3, 16, (sign * 45, 0, -10), "x")
        body -= access
        mask += access
        pieces += [Piece(f"{sign:+d} guided jaw", jaw, "print"), Piece(f"{sign:+d} captured pad", cushion, "pad"),
                   Piece(f"{sign:+d} pressure screw", bolt, "hardware"), Piece(f"{sign:+d} captive hex nut", nut, "hardware")]
        tools.append(cyl(2.8, 14, (sign * 48.5, 0, -10), "x"))
    return Variant("B | independent guided jaws", [Piece("complete integrated bar", body, "body")] + pieces, mask, tools)


def drawplate(reference):
    body, pieces = reference, []
    frame = cyl(24.2, 2, (0, 0, -22)) - cyl(R + .8, 4, (0, 0, -22))
    for y in (-19, 19):
        frame += box(76, 4, 2, (0, y, -22))
    for x in (-38, 38):
        frame += box(6, 42, 2, (x, 0, -22))
        frame += cyl(4.2, 2, (x, 0, -22))
    frame -= cyl(R + .8, 4, (0, 0, -22))
    frame &= cyl(45.4, 4, (0, 0, -22))
    # Keep the original blind floor, reconnecting its cup with two internal posts.
    body -= cyl(24.5, 3.4, (0, 0, -21.6)) - cyl(R, 5, (0, 0, -21.6))
    for y in (-27, 27):
        body += box(8, 5, 20, (0, y, -14))
        body += box(8, 7, .8, (0, np.sign(y) * 23.5, -23.6))
        body += box(8, 7, 2, (0, np.sign(y) * 23.5, -5))
    for sign in (-1, 1):
        body -= box(16, 20.6, 15.8, (sign * 22, 0, -13.4))
        fixed = Plane.XZ * Polygon((28.8, -19), (33, -19), (33, -5), (27.4, -5), align=None)
        moving = Plane.XZ * Polygon((14, -21), (29, -21), (27.6, -7), (14, -7), align=None)
        seat = extrude(fixed, amount=12, both=True)
        shoe = extrude(moving, amount=10, both=True) - cyl(R + 1.5, 18, (0, 0, -14))
        cushion = pad("x", 1)
        shoe -= cushion
        if sign == -1:
            seat, shoe, cushion = [p.rotate(Axis.Z, 180) for p in (seat, shoe, cushion)]
        body += seat
        for y in (-13, 13):
            body += box(14, 3, 14, (sign * 27, y, -12))
        body += box(10, 8, 6, (sign * 34, 0, -6))
        body += cyl(4, 7, (sign * 38, 0, -5.5))
        pieces += [Piece(f"{sign:+d} taper shoe", shoe, "print"), Piece(f"{sign:+d} captured pad", cushion, "pad")]
    mask = local_mask()
    tools = []
    for x in (-38, 38):
        well = cyl(3.3, 8, (x, 0, -1))
        body -= well
        body -= cyl(1.8, 25, (x, 0, -13))
        mask += cyl(4.1, 8, (x, 0, -4))
        frame -= cyl(1.8, 5, (x, 0, -22))
        frame -= hexagon(3.5, 1.8, (x, 0, -22.1))
        nut = hexagon(3.2, 1.8, (x, 0, -22.1)) - cyl(1.6, 4, (x, 0, -22.1))
        bolt = cyl(1.5, 17.1, (x, 0, -13.5)) + cyl(3, 3, (x, 0, -3.5))
        pieces += [Piece(f"{x:+g} axial screw", bolt, "hardware"), Piece(f"{x:+g} drawframe hex nut", nut, "hardware")]
        tools.append(cyl(2.8, 14, (x, 0, 5)))
    return Variant("C | inboard axial drawplate", [Piece("complete integrated bar", body, "body"), Piece("moving drawframe", frame, "print")] + pieces, mask, tools)


DEFAULT_VARIANTS = ("C", "D")


def full_variants(reference, selected=DEFAULT_VARIANTS):
    builders = {"A": lambda: bridge(reference), "B": lambda: jaws(reference),
                "C": lambda: drawplate(reference), "D": lambda: bridge(reference, guided=True)}
    if len(set(selected)) != len(selected) or any(key not in builders for key in selected):
        raise ValueError("Select unique known disco variants")
    variants = [builders[key]() for key in selected]
    for variant in variants:
        variant.pieces[0].shape -= pocket()
    return variants


def volume(shape):
    return float(shape.volume) if shape else 0.


def assert_empty(shape, label, tolerance=1e-5):
    amount = volume(shape)
    if amount > tolerance:
        raise ValueError(f"{label}: {amount:.8g} mm3")
    return amount


def moved_pieces(variant, travel):
    if variant.mechanism != "screw":
        if travel != 0 or getattr(variant, "state", None) != "locked":
            raise ValueError("Latch studies support static locked-state review only")
        return list(variant.pieces)
    moved = []
    for piece in variant.pieces:
        shift = (0, 0, 0)
        if variant.name.startswith(("A", "D")):
            if piece.name in ("moving bridge plate", "moving pad") or "draw screw" in piece.name:
                shift = (0, travel, 0)
        elif variant.name.startswith("B"):
            if any(term in piece.name for term in ("guided jaw", "captured pad", "pressure screw")):
                shift = ((-1 if piece.name.startswith("-1") else 1) * travel, 0, 0)
        else:
            if piece.name == "moving drawframe" or "drawframe hex nut" in piece.name:
                shift = (0, 0, travel)
            elif "taper shoe" in piece.name or "captured pad" in piece.name:
                sign = -1 if piece.name.startswith("-1") else 1
                shift = (-sign * .1 * travel, 0, travel)
        moved.append(Piece(piece.name, piece.shape.translate(shift), piece.role))
    return moved


def preserved_geometry(reference, variant):
    body = variant.pieces[0].shape
    if variant.mechanism == "screw":
        assert_empty((reference - body) - variant.edit_mask, "Protected source material removed")
        assert_empty((body - reference) - variant.edit_mask, "Addition outside bounded edit region")
    else:
        # Equivalent protected-region comparison avoids an OCCT null-result
        # failure when subtracting the complete complex bayonet body.
        protected_source = reference - variant.edit_mask
        protected_body = body - variant.edit_mask
        assert_empty(protected_source - protected_body, "Protected source material removed")
        assert_empty(protected_body - protected_source, "Addition outside bounded edit region")
    # Protect the exact blind floor and the complete far-end attachment region.
    far = box(120, 120, 80, (0, 0, -70))  # z<-30.
    stop = cyl(R + .5, 1, (0, 0, -25.9))
    entry = cyl(25.5, 3, (0, 0, -1.5))
    for name, region in (("far end and full hollow length", far), ("blind floor", stop), ("original entry", entry)):
        assert_empty((reference & region) - body, f"Changed {name}")
        assert_empty((body & region) - reference, f"Added material in {name}")
    if not body.is_valid or len(body.solids()) != 1:
        raise ValueError("Full body and fixed clamp supports must form one valid connected solid")
    bounds = body.bounding_box()
    if not np.allclose([bounds.min.X, bounds.min.Y, bounds.min.Z, bounds.max.X, bounds.max.Y, bounds.max.Z],
                       [-OUTER, -OUTER, -109.22, OUTER, OUTER, 0], atol=1e-5, rtol=0):
        raise ValueError("Full-height measured insertion bounds changed")
    return {"source_outside_edit_mask_unchanged": True, "original_entry_and_stop_unchanged": True,
            "far_end_and_hollow_length_unchanged": True, "connected_full_body": True,
            "body_volume_mm3": body.volume, "source_volume_mm3": reference.volume,
            "height_mm": bounds.size.Z, "source_outer_diameter_mm": 2 * OUTER}


def check_assembly(variant, travel):
    pieces = moved_pieces(variant, travel)
    # All modifications and hardware live above z=-30 where the source outer
    # wall is cylindrical. The original lower toroidal/end geometry is unchanged.
    envelope = cyl(OUTER, 30, (0, 0, -15))
    full_envelope = cyl(OUTER, 109.22, (0, 0, -54.61))
    void = pocket()
    max_overlap, compression = 0., 0.
    for index, piece in enumerate(pieces):
        if not piece.shape.is_valid or len(piece.shape.solids()) != 1 or piece.shape.volume <= 0:
            raise ValueError(f"Invalid actual assembly piece: {piece.name}")
        if piece.role == "body":
            assert_empty(piece.shape - full_envelope, f"Full body exceeds circular insertion envelope at {travel}")
        else:
            assert_empty(piece.shape - envelope, f"Insertion envelope exceeded: {piece.name} at {travel}")
        overlap = volume(piece.shape & void)
        if piece.role == "pad" and (travel != 0 or variant.mechanism != "screw"):
            compression += overlap
        elif overlap > 1e-5:
            raise ValueError(f"Original released insertion path blocked: {piece.name}: {overlap}")
        for second in pieces[index + 1:]:
            amount = assert_empty(piece.shape & second.shape, f"Rigid assembly overlap: {piece.name}/{second.name} at {travel}")
            max_overlap = max(max_overlap, amount)
    return {"travel_mm": travel, "all_hardware_inside_source_insertion_radius": True,
            "max_piece_pair_intersection_mm3": max_overlap,
            "pad_compression_envelope_mm3": compression,
            "motion": "axial closure with 0.1 mm/mm radial shoe motion" if variant.name.startswith("C") else "negative closes, positive releases"}


def verify_integrated(reference, output):
    variants = full_variants(reference)
    output.mkdir(parents=True, exist_ok=True)
    results = []
    original_void = cyl(23.5, 25.4, (0, 0, -12.7)) - reference
    assert_empty(reference & pocket(), "Incorrect source pocket reconstruction")
    assert_empty(original_void - pocket(), "Pocket reconstruction lost source clearance")
    assert_empty(pocket() - original_void, "Pocket reconstruction exceeds source clearance")
    for variant in variants:
        preserved = preserved_geometry(reference, variant)
        samples = (0., .5, 1.) if variant.name.startswith("C") else (-.25, 0., .5)
        motion = [check_assembly(variant, distance) for distance in samples]
        for tool in variant.tools:
            for piece in variant.pieces:
                if piece.role != "hardware":
                    assert_empty(tool & piece.shape, f"Blocked proposed driver path: {variant.name}/{piece.name}")
        exports = []
        folder = output / variant.name[0].lower()
        folder.mkdir(exist_ok=True)
        for index, piece in enumerate(variant.pieces):
            if not piece.shape.is_valid or len(piece.shape.solids()) != 1 or piece.shape.volume <= 0:
                raise ValueError(f"Invalid piece: {variant.name}/{piece.name}")
            if piece.role not in ("body", "print"):
                continue
            stem = f"{index:02d}-{piece.name.replace(' ', '-').replace('+', 'plus')}"
            step, stl = folder / f"{stem}.step", folder / f"{stem}.stl"
            if not export_step(piece.shape, step) or not export_stl(piece.shape, stl, tolerance=.03):
                raise ValueError("Export failed")
            restored = import_step(step)
            mesh = trimesh.load_mesh(stl)
            if not restored.is_valid or len(restored.solids()) != 1 or not np.isclose(restored.volume, piece.shape.volume, rtol=1e-6):
                raise ValueError(f"STEP round trip failed: {piece.name}")
            assert_empty(piece.shape - restored, "STEP lost material")
            assert_empty(restored - piece.shape, "STEP added material")
            if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume <= 0 or not np.isclose(mesh.volume, piece.shape.volume, rtol=.005):
                raise ValueError(f"STL validation failed: {piece.name}")
            exports.append({"piece": piece.name, "role": piece.role, "volume_mm3": piece.shape.volume,
                            "step_boolean_roundtrip": True, "step_volume_mm3": restored.volume, "step_volume_relative_tolerance": 1e-6, "stl_watertight": True,
                            "stl_winding_consistent": True, "stl_volume_mm3": float(mesh.volume)})
        results.append({"variant": variant.name, "preservation": preserved, "exports": exports,
                        "motion_samples": motion, "proposed_driver_paths_clear": True,
                        "limits": "Not continuous motion proof, elastic/contact analysis, print strength, hardware selection, or physical assembly/service access verification"})
    receipt = {"status": "FULL_HEIGHT_INTEGRATED_CONCEPTS", "units": "mm", "new_fit_verified": False,
               "source_pocket": "operator-confirmed snug baseline; actual knob OD not independently measured",
               "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "variants": results}
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt
