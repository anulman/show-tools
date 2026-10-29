"""Headless A/C box-mount proposals. No physical fit or print approval is implied."""
from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass, fields, replace
import hashlib
from importlib.metadata import version
import json
import math
from pathlib import Path

from build123d import (
    Align, Axis, Box, Compound, Cylinder, ExportSVG, Plane, Polygon, RectangleRounded, RegularPolygon,
    export_step, export_stl, extrude, import_step,
)
import trimesh

HERE = Path(__file__).resolve().parent
MIN_Z = (Align.CENTER, Align.CENTER, Align.MIN)
EPS = 1e-6


@dataclass(frozen=True)
class Proposal:
    # Every value except the requested datums is a provisional geometry input.
    depth: float = 35.25  # Interior floor below the seating-shoulder centre.
    recess: float = 17.5
    tilt: float = 5.0
    width: float = 116.0
    flat_length: float = 116.0
    tilted_length: float = 126.0
    corner_radius: float = 12.0
    wall: float = 5.0
    roof: float = 5.0
    pocket_diameter: float = 100.0
    stem_hole_diameter: float = 28.0
    bottom_thickness: float = 3.0
    boss_radius: float = 6.0
    boss_edge_offset: float = 9.0
    boss_height: float = 12.0
    nut_across_flats: float = 6.0
    nut_depth: float = 2.8
    nut_envelope_gap: float = 0.2
    screw_clearance_diameter: float = 3.4
    head_diameter: float = 6.8
    head_depth: float = 1.5
    channel_width: float = 10.0
    channel_depth: float = 1.5
    exit_height: float = 8.0
    tray_width: float = 76.0
    tray_length: float = 28.0
    tray_y: float = 32.0
    tray_wall: float = 2.0
    tray_height: float = 8.0
    tray_roof: float = 2.0
    tray_bridge_width: float = 5.0
    envelope_gap: float = 0.5

    @property
    def floor_z(self):
        return -self.depth

    @property
    def underside_z(self):
        return self.floor_z - self.bottom_thickness

    def validate(self):
        for field in fields(self):
            value = getattr(self, field.name)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError(f"{field.name} must be a finite number")
            if value <= 0 and field.name not in ("tilt", "recess"):
                raise ValueError(f"{field.name} must be positive")
        if not 0 <= self.tilt <= 5 or not 0 <= self.recess <= 17.5:
            raise ValueError("tilt must be 0..5 degrees and recess 0..17.5 mm")
        if not 35 <= self.depth <= 180:
            raise ValueError("interior depth must be 35..180 mm below the seating centre")
        if not 0 < self.channel_depth < self.bottom_thickness or not 0 < self.head_depth < self.bottom_thickness:
            raise ValueError("channel and head pockets must leave a positive bottom skin")
        if not self.screw_clearance_diameter < self.nut_across_flats < self.head_diameter < 2 * self.boss_radius:
            raise ValueError("clearance, nut, head, and boss diameters must increase")
        if self.nut_across_flats/math.sqrt(3) >= self.boss_radius:
            raise ValueError("nut pocket must leave boss material around its corners")
        if not self.nut_depth < self.boss_height or self.nut_envelope_gap*2 >= self.nut_depth:
            raise ValueError("nut pocket must leave a roof and a positive reference envelope")
        if self.wall >= self.corner_radius or self.stem_hole_diameter >= self.pocket_diameter:
            raise ValueError("invalid wall/corner or bore/pocket dimensions")
        if self.tray_wall * 2 + self.envelope_gap * 2 >= min(self.tray_width, self.tray_length):
            raise ValueError("ballast envelope has no interior")
        if self.tray_height <= 2 * self.envelope_gap:
            raise ValueError("ballast envelope has no height")
        if self.width <= 2 * self.corner_radius or min(self.flat_length, self.tilted_length) <= 2 * self.corner_radius:
            raise ValueError("outer dimensions must exceed twice the corner radius")


def rounded(width, length, radius, height):
    return extrude(RectangleRounded(width, length, radius), amount=height)


def box(width, length, height, x=0, y=0, z=0):
    return Box(width, length, height, align=MIN_Z).translate((x, y, z))


def cylinder(radius, height, x=0, y=0, z=0):
    return Cylinder(radius, height, align=MIN_Z).translate((x, y, z))


def volume(shape):
    return sum(s.volume for s in shape.solids())


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def build(p: Proposal, tilted: bool):
    length = p.tilted_length if tilted else p.flat_length
    angle = p.tilt if tilted else 0
    slope = math.tan(math.radians(angle))
    top = p.recess / math.cos(math.radians(angle))
    bottom_top = p.floor_z
    half_span = max(p.width, length) + 10
    high = top + half_span * slope + 10
    shell = rounded(p.width, length, p.corner_radius, high - bottom_top).translate((0, 0, bottom_top))

    def below_plane(offset):
        profile = Plane.YZ * Polygon(
            (-half_span, -p.depth - 1), (half_span, -p.depth - 1),
            (half_span, half_span * slope + offset),
            (-half_span, -half_span * slope + offset), align=None)
        return extrude(profile, amount=half_span, both=True)

    shell &= below_plane(top)
    cavity = rounded(p.width - 2*p.wall, length - 2*p.wall,
                     p.corner_radius - p.wall, high + p.depth + 2).translate((0, 0, -p.depth - 1))
    shell -= cavity & below_plane(-p.roof)
    shell -= cylinder(p.stem_hole_diameter/2, 2*(p.depth + high), z=-p.depth-high).rotate(Axis.X, angle)
    if p.recess:
        shell -= cylinder(p.pocket_diameter/2, p.recess + high + 10).rotate(Axis.X, angle)
    plate = rounded(p.width, length, p.corner_radius, p.bottom_thickness).translate((0, 0, p.underside_z))
    screws = [(x, y) for x in (-p.width/2 + p.boss_edge_offset, p.width/2 - p.boss_edge_offset)
              for y in (-length/2 + p.boss_edge_offset, length/2 - p.boss_edge_offset)]
    for x, y in screws:
        shell += cylinder(p.boss_radius, p.boss_height, x, y, bottom_top)
        shell -= cylinder(p.screw_clearance_diameter/2, p.boss_height + .2, x, y, bottom_top - .1)
        nut = extrude(RegularPolygon(p.nut_across_flats/math.sqrt(3), 6), amount=p.nut_depth+.1)
        shell -= nut.translate((x, y, bottom_top-.1))
        plate -= cylinder(p.screw_clearance_diameter/2, p.bottom_thickness + .2, x, y, p.underside_z - .1)
        plate -= cylinder(p.head_diameter/2, p.head_depth + .1, x, y, p.underside_z - .1)

    tray = box(p.tray_width, p.tray_length, p.tray_height+p.tray_roof, y=p.tray_y, z=bottom_top)
    tray -= box(p.tray_width-2*p.tray_wall, p.tray_length-2*p.tray_wall,
                p.tray_height+.1, y=p.tray_y, z=bottom_top-.1)
    # Roofed cup opens downwards. Bottom cover closes it; two ribs join the rear wall.
    rear = p.tray_y+p.tray_length/2
    reach = length/2-p.wall-rear+1
    require(reach > 0, "ballast compartment extends beyond the rear wall")
    for x in (-p.tray_width/2+p.tray_bridge_width/2, p.tray_width/2-p.tray_bridge_width/2):
        tray += box(p.tray_bridge_width, reach+1, p.tray_roof, x=x,
                    y=rear+(reach-1)/2, z=bottom_top+p.tray_height)
    shell += tray
    # Open groove in cover and a matching notch through the -Y shell wall.
    channel = box(p.channel_width, length/2+8, p.channel_depth+p.exit_height,
                  y=-length/4+1, z=bottom_top-p.channel_depth)
    shell -= channel
    plate -= channel
    gap = p.envelope_gap
    cable_envelope = box(p.channel_width-2*gap, length/2+8-2*gap,
                         p.channel_depth+p.exit_height-2*gap,
                         y=-length/4+1, z=bottom_top-p.channel_depth+gap)
    ballast_envelope = box(p.tray_width-2*p.tray_wall-2*gap,
                           p.tray_length-2*p.tray_wall-2*gap,
                           p.tray_height-2*gap, y=p.tray_y, z=bottom_top+gap)
    return shell, plate, screws, cable_envelope, ballast_envelope


def verify_assembly(p, tilted, parts):
    shell, plate, screws, cable, ballast = parts
    for label, body in (("shell", shell), ("bottom", plate)):
        require(body.is_valid and len(body.solids()) == 1 and body.volume > 0,
                f"{label} must be one valid positive-volume solid")
    overlap = volume(shell & plate)
    require(overlap < EPS, "shell and bottom interfere")
    require(math.isclose(plate.bounding_box().min.Z, p.underside_z, abs_tol=EPS), "exterior underside datum changed")
    require(math.isclose(plate.bounding_box().max.Z, p.floor_z, abs_tol=EPS), "interior floor datum changed")
    require(math.isclose(shell.bounding_box().min.Z, p.floor_z, abs_tol=EPS), "shell split consumed interior reserve")
    for name, envelope in (("cable", cable), ("ballast", ballast)):
        require(volume(shell & envelope) < EPS and volume(plate & envelope) < EPS,
                f"{name} proposal envelope is obstructed")
    # The entire downward swept volume, not just an endpoint sample.
    # All cover additions are vertical extrusions; the union spans one cover height.
    withdrawal = p.depth + p.bottom_thickness
    removal_sweep = plate + plate.translate((0, 0, -withdrawal))
    for face in plate.faces().filter_by(Axis.Z):
        if face.normal_at().Z > .9:
            removal_sweep += extrude(face, amount=-withdrawal)
    removal_overlap = volume(shell & removal_sweep)
    require(removal_overlap < EPS, "bottom cannot withdraw vertically")
    angle = p.tilt if tilted else 0
    radians = math.radians(angle)
    # Check the complete axial pocket and central stem opening, not upstream geometry.
    stem = cylinder(p.stem_hole_diameter/2-.2, p.depth+p.bottom_thickness+10, z=p.underside_z-5).rotate(Axis.X, angle)
    require(volume(shell & stem) < EPS, "stem bore obstructed")
    if p.recess:
        pocket = cylinder(p.pocket_diameter/2-.2, p.recess, z=0).rotate(Axis.X, angle)
        require(volume(shell & pocket) < EPS, "counterbore obstructed")
    shoulder = (p.stem_hole_diameter/2 + 10, 2*math.sin(radians), -2*math.cos(radians))
    require(shell.is_inside(shoulder), "support shoulder absent")
    bottom_top = p.floor_z
    for x, y in screws:
        screw = cylinder(p.screw_clearance_diameter/2-.1, p.boss_height+p.bottom_thickness,
                         x, y, p.underside_z)
        require(volume(shell & screw) < EPS and volume(plate & screw) < EPS,
                "screw axes are obstructed or misaligned")
        # Nuts enter from below with the bottom removed. The complete insertion
        # sweep ends inside the pocket, and remains clear of shell material.
        nut = extrude(RegularPolygon((p.nut_across_flats-2*p.nut_envelope_gap)/math.sqrt(3), 6),
                      amount=p.nut_depth+p.depth-p.nut_envelope_gap)
        nut = nut.translate((x, y, bottom_top-p.depth))
        require(volume(shell & nut) < EPS, "hex nut insertion from below is obstructed")
        require(shell.is_inside((x+p.screw_clearance_diameter/2+.2, y, bottom_top+(p.boss_height+p.nut_depth)/2)),
                "nut pocket has no surrounding roof")
        require(plate.is_inside((x+p.screw_clearance_diameter/2+.2, y, p.underside_z+(p.bottom_thickness+p.head_depth)/2)),
                "screw head has no seating ledge")
    # Ballast side walls form a complete ring in the proposed CAD assembly.
    wall_ring = box(p.tray_width, p.tray_length, p.tray_height-2*p.envelope_gap,
                    y=p.tray_y, z=bottom_top+p.envelope_gap)
    wall_ring -= box(p.tray_width-2*p.tray_wall, p.tray_length-2*p.tray_wall,
                     p.tray_height, y=p.tray_y, z=bottom_top)
    require(math.isclose(volume(shell & wall_ring), wall_ring.volume, rel_tol=1e-7), "ballast side wall is open")
    # Ballast roof and cover are material across the interior footprint.
    ballast_floor = box(p.tray_width-2*p.tray_wall, p.tray_length-2*p.tray_wall,
                        .1, y=p.tray_y, z=bottom_top-.2)
    ballast_roof = ballast_floor.translate((0, 0, p.tray_height+.4))
    require(math.isclose(volume(plate & ballast_floor), ballast_floor.volume, rel_tol=1e-7), "ballast floor is open")
    require(math.isclose(volume(shell & ballast_roof), ballast_roof.volume, rel_tol=1e-7), "ballast roof is open")
    shell_seats = [f for f in shell.faces() if abs(f.center().Z-bottom_top) < EPS and f.normal_at().Z < -.9]
    plate_seats = [f for f in plate.faces() if abs(f.center().Z-bottom_top) < EPS and f.normal_at().Z > .9]
    contact = sum(face.area for a in shell_seats for b in plate_seats for face in (a.intersect(b) or []))
    require(contact > 0, "bottom has no contact with shell")
    return dict(overlap_mm3=overlap, removal_sweep_overlap_mm3=removal_overlap,
                planar_contact_area_mm2=contact, cable_envelope_unobstructed=True,
                ballast_envelope_unobstructed=True, screw_axis_count=len(screws),
                screw_axes_clear=True, hex_nut_insertion_clear=True,
                ballast_floor_and_roof_closed=True, ballast_side_walls_closed=True,
                shoulder_sample_present=True, counterbore_clear=True,
                usable_floor_z_mm=bottom_top, external_underside_z_mm=p.underside_z,
                internal_reserve_mm=p.depth, withdrawal_checked_mm=withdrawal,
                physical_harness_clearance_verified=False)


def export_part(body, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    step, stl = path.with_suffix(".step"), path.with_suffix(".stl")
    require(export_step(body, step) and export_stl(body, stl, tolerance=.05), "part export failed")
    restored = import_step(step)
    require(restored.is_valid and len(restored.solids()) == 1 and
            math.isclose(restored.volume, body.volume, rel_tol=1e-8), "STEP round trip failed")
    mesh = trimesh.load_mesh(stl)
    require(mesh.is_watertight and mesh.is_winding_consistent and mesh.volume > 0, "STL integrity failed")
    require(math.isclose(float(mesh.volume), body.volume, rel_tol=.005), "STL volume mismatch")
    bounds = body.bounding_box()
    return dict(valid=True, solids=1, volume_mm3=body.volume,
                bounds_mm=[[bounds.min.X, bounds.min.Y, bounds.min.Z],
                           [bounds.max.X, bounds.max.Y, bounds.max.Z]],
                step_roundtrip=True, stl_watertight=True, stl_winding_consistent=True,
                files={f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in (step, stl)})



def preview(parameters: Proposal | None = None, *, explode: float = 0, include_reference: bool = True):
    """Return viewer payload only. Never connect, publish, or start a service."""
    p = parameters if parameters is not None else Proposal()
    p.validate()
    if not math.isfinite(explode) or explode < 0:
        raise ValueError("explode must be finite and nonnegative")
    reference = None
    if include_reference:
        source = HERE / "components" / "adafruit-1185"
        provenance = json.loads((source / "source.json").read_text())
        asset = source / "button.step"
        require(hashlib.sha256(asset.read_bytes()).hexdigest() == provenance["sha256"], "reference asset hash changed")
        reference = import_step(asset)
    objects, names, colors, alphas = [], [], [], []
    for label, tilted, x, color in (("A flat red", False, -85, "#d63b35"),
                                   ("C tilted blue", True, 85, "#367fd4")):
        parts = build(p, tilted)
        verify_assembly(p, tilted, parts)
        shell, bottom = parts[:2]
        objects.extend((shell.translate((x, 0, 0)), bottom.translate((x, 0, -explode))))
        names.extend((f"{label} shell PROPOSAL, fit unknown", f"{label} removable bottom PROPOSAL, fit unknown"))
        colors.extend(("#b8a084", "#d4c3a8"))
        alphas.extend((.75, 1))
        if reference is not None:
            button = reference.rotate(Axis.X, p.tilt if tilted else 0)
            objects.append(button.translate((x, 0, 0)))
            names.append(f"{label} button REFERENCE, upstream invalid, fit unknown")
            colors.append(color)
            alphas.append(1)
    return objects, names, colors, alphas


def export_inspection(body, path, origin):
    visible, _hidden = body.project_to_viewport(origin)
    drawing = ExportSVG(margin=5, line_weight=.25)
    drawing.add_shape(visible)
    drawing.write(path)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parameters", type=Path, help="JSON overrides of Proposal fields; all remain proposals")
    parser.add_argument("--output", type=Path, default=HERE / "build" / "box-mount-proposal")
    args = parser.parse_args()
    try:
        overrides = json.loads(args.parameters.read_text()) if args.parameters else {}
        if not isinstance(overrides, dict):
            raise ValueError("parameter JSON must be an object")
        p = replace(Proposal(), **overrides)
        p.validate()
    except (OSError, TypeError, ValueError) as error:
        parser.error(str(error))
    args.output.mkdir(parents=True, exist_ok=True)
    # Remove stale success evidence before a build that can fail.
    receipt_path = args.output / "receipt.json"
    receipt_path.unlink(missing_ok=True)
    receipt = dict(print_readiness="NOT_READY", depth_datum="seating-shoulder centre to interior floor; cover extends below",
                   release_gates=["measured button/nut/switch/harness and moving-part clearance",
                                  "cable size, exit direction and strain relief",
                                  "actual screw/nut/head dimensions, length and engagement",
                                  "ballast dimensions, mass, retention and service procedure",
                                  "printer, material, orientation, allowances and fit coupon"],
                   nominal_sections_mm={"shell_wall": p.wall, "vertical_shoulder": p.roof,
                     "bottom_under_channel": p.bottom_thickness-p.channel_depth,
                     "bottom_under_head": p.bottom_thickness-p.head_depth,
                     "ballast_wall": p.tray_wall, "ballast_roof": p.tray_roof,
                     "radial_boss_beyond_hex_corner": p.boss_radius-p.nut_across_flats/math.sqrt(3)},
                   concept_only=True, fit_verified=False, printability_verified=False,
                   strength_verified=False, units="mm", parameters=asdict(p),
                   source_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                   versions={name: version(name) for name in ("build123d", "trimesh", "cadquery-ocp-novtk")},
                   concepts={})
    for name, tilted, colour in (("A-flat-red", False, "#d63b35"), ("C-tilted-blue", True, "#367fd4")):
        parts = build(p, tilted)
        checks = verify_assembly(p, tilted, parts)
        directory = args.output / name
        records = {label: export_part(part, directory / f"{label}-PROPOSAL-NOT-FIT-VERIFIED")
                   for label, part in zip(("shell", "bottom"), parts[:2])}
        assembly = Compound(children=list(parts[:2]))
        assembly_path = directory / "assembly-PROPOSAL-NOT-FIT-VERIFIED.step"
        require(export_step(assembly, assembly_path), "assembly export failed")
        restored = import_step(assembly_path)
        require(restored.is_valid and len(restored.solids()) == 2 and
                math.isclose(restored.volume, assembly.volume, rel_tol=1e-8), "assembly roundtrip failed")
        drawings = {f"{label}-inside-PROPOSAL.svg": export_inspection(part,
                        directory / f"{label}-inside-PROPOSAL.svg", origin)
                    for label, part, origin in (("shell", parts[0], (160, -240, -300)),
                                                ("bottom", parts[1], (160, -240, 300)))}
        receipt["concepts"][name] = dict(inspection_svg_sha256=drawings, comparison_colour=colour, tilt_degrees=p.tilt if tilted else 0,
            parts=records, assembly_checks=checks, screw_centres_xy_mm=parts[2],
            assembly_step_sha256=hashlib.sha256(assembly_path.read_bytes()).hexdigest())
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(receipt_path)


if __name__ == "__main__":
    main()
