"""Arcade, rotor, and mushroom box concepts. Physical fit is unverified."""
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
    depth: float = 84.0  # Proposed interior depth preserving the confirmed axial reserve.
    clearance_mm: float = 82.55
    corridor_radius: float = 13.5
    corridor_floor_gap: float = 0.5
    recess: float = 17.5
    tilt: float = 5.0
    width: float = 116.0
    level_length: float = 116.0
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
    tray_y: float = 36.0
    tray_wall: float = 2.0
    tray_height: float = 8.0
    tray_roof: float = 2.0
    tray_bridge_width: float = 5.0
    envelope_gap: float = 0.5
    rotor_body_nominal_diameter: float = 28.0
    rotor_body_diameter_allowance: float = 1.0
    rotor_hex_across_flats: float = 34.0
    rotor_hex_depth: float = 5.0

    @property
    def level_top_z(self):
        angle = math.radians(self.tilt)
        return self.recess/math.cos(angle) + self.tilted_length/2*math.tan(angle)

    @property
    def rotor_passage_diameter(self):
        return self.rotor_body_nominal_diameter + self.rotor_body_diameter_allowance

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
        angle = math.radians(self.tilt)
        required = required_centreline_depth(minimum_mm=self.clearance_mm, tilt_degrees=self.tilt) + self.corridor_radius*math.sin(angle) + self.corridor_floor_gap
        if self.clearance_mm < 82.55 or self.depth < required:
            raise ValueError("interior depth must preserve 82.55 mm axial clearance plus the proposed finite corridor and floor gap")
        if self.corridor_radius >= self.stem_hole_diameter/2:
            raise ValueError("proposed wiring corridor must fit inside the stem opening")
        if not 0 < self.channel_depth < self.bottom_thickness or not 0 < self.head_depth < self.bottom_thickness:
            raise ValueError("channel and head pockets must leave a positive bottom skin")
        if not self.screw_clearance_diameter < self.nut_across_flats < self.head_diameter < 2 * self.boss_radius:
            raise ValueError("clearance, nut, head, and boss diameters must increase")
        if self.nut_across_flats/math.sqrt(3) >= self.boss_radius:
            raise ValueError("nut pocket must leave boss material around its corners")
        if not self.nut_depth < self.boss_height or self.nut_envelope_gap*2 >= self.nut_depth:
            raise ValueError("nut pocket must leave a roof and a positive reference envelope")
        if self.rotor_passage_diameter >= self.rotor_hex_across_flats:
            raise ValueError("rotor hex recess must leave a shelf outside the body passage")
        if self.wall >= self.corner_radius or self.stem_hole_diameter >= self.pocket_diameter:
            raise ValueError("invalid wall/corner or bore/pocket dimensions")
        if self.tray_wall * 2 + self.envelope_gap * 2 >= min(self.tray_width, self.tray_length):
            raise ValueError("ballast envelope has no interior")
        if self.tray_height <= 2 * self.envelope_gap:
            raise ValueError("ballast envelope has no height")
        if self.width <= 2 * self.corner_radius or min(self.level_length, self.tilted_length) <= 2 * self.corner_radius:
            raise ValueError("outer dimensions must exceed twice the corner radius")


ARCADE_CLEARANCE_MM = 3.25 * 25.4


def variant_requirements():
    """Active component identities and unresolved gates, independent of old CAD."""
    return dict(
        print_readiness="NOT_READY",
        variants={
            "arcade-inclined": dict(
                component="100 mm arcade button", inclination_degrees=5,
                geometry_status="parametric concept; physical fit unverified",
                clearance_minimum_mm=ARCADE_CLEARANCE_MM,
                clearance_datum="floor-axis",
                required_facts=["wire and connector bend envelope"],
                low_edge_requires_full_centre_clearance=False),
            "rotor-level": dict(
                component="rotor; SpinTrak-based dimensional study, installation identity pending", inclination_degrees=0,
                geometry_status="form study; fitted release blocked",
                mounting_interface="proposed parametric hex recess; across flats and depth unverified",
                source="https://www.ultimarc.com/trackballs-and-spinners/spinners/spintrak/images/1/spintrakdiag.gif",
                drawing_body_diameter_nominal_mm=28,
                drawing_hex_across_flats_verified=False,
                required_facts=["rotor identity", "mounting hex across flats and thickness",
                                "shaft outside diameter", "attached wire and connector envelope",
                                "final installed height"]),
            "mushroom-level": dict(
                component="mushroom button", inclination_degrees=0,
                geometry_status="uncut housing blank; mounting and wiring remain TBD",
                required_facts=["wiring test", "mounting and attached harness dimensions",
                                "final installed height"]),
        },
        level_height_intent="roughly the same exterior height as the inclined arcade boxes; level dimensions pending",
        historical_comparison=dict(active=False, depth_mm=35.25, recess_mm=17.5,
                                   note="flat Adafruit A is not the rotor or mushroom variant"))


def required_centreline_depth(*, minimum_mm=ARCADE_CLEARANCE_MM, tilt_degrees=5.0):
    """Project the confirmed counterbore-floor axial reserve onto world -Z."""
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
               for v in (minimum_mm, tilt_degrees)):
        raise ValueError("clearance dimensions must be finite numbers")
    if minimum_mm < ARCADE_CLEARANCE_MM or not 0 <= tilt_degrees <= 5:
        raise ValueError("clearance must retain at least 82.55 mm along the button axis")
    return minimum_mm*math.cos(math.radians(tilt_degrees))


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


def build(p: Proposal, variant="arcade-inclined"):
    if variant not in variant_requirements()["variants"]:
        raise ValueError(f"unknown box variant: {variant}")
    arcade = variant == "arcade-inclined"
    rotor = variant == "rotor-level"
    length = p.tilted_length if arcade else p.level_length
    angle = p.tilt if arcade else 0
    slope = math.tan(math.radians(angle))
    top = p.recess / math.cos(math.radians(angle)) if arcade else p.level_top_z
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
    ceiling = -p.roof if arcade else top-p.roof-(p.rotor_hex_depth if rotor else 0)
    shell -= cavity & below_plane(ceiling)
    if arcade:
        shell -= cylinder(p.stem_hole_diameter/2, 2*(p.depth + high), z=-p.depth-high).rotate(Axis.X, angle)
        if p.recess:
            shell -= cylinder(p.pocket_diameter/2, p.recess + high + 10).rotate(Axis.X, angle)
    elif rotor:
        shell -= cylinder(p.rotor_passage_diameter/2, high+p.depth+2, z=-p.depth-1)
        recess = extrude(RegularPolygon(p.rotor_hex_across_flats/math.sqrt(3), 6), amount=p.rotor_hex_depth+1)
        shell -= recess.translate((0, 0, top-p.rotor_hex_depth))
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


def verify_assembly(p, variant, parts):
    shell, plate, screws, cable, ballast = parts
    for label, body in (("shell", shell), ("bottom", plate)):
        require(body.is_valid and len(body.solids()) == 1 and body.volume > 0,
                f"{label} must be one valid positive-volume solid")
    overlap = volume(shell & plate)
    require(overlap < EPS, "shell and bottom interfere")
    require(math.isclose(plate.bounding_box().min.Z, p.underside_z, abs_tol=EPS), "exterior underside datum changed")
    require(math.isclose(plate.bounding_box().max.Z, p.floor_z, abs_tol=EPS), "interior floor datum changed")
    require(math.isclose(shell.bounding_box().min.Z, p.floor_z, abs_tol=EPS), "shell split consumed interior reserve")
    require(math.isclose(shell.bounding_box().max.Z, p.level_top_z, abs_tol=EPS), "variant exterior heights differ")
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
    mount_checks = {}
    if variant == "arcade-inclined":
        angle = p.tilt
        radians = math.radians(angle)
        # Check the complete axial pocket and central stem opening, not upstream geometry.
        stem = cylinder(p.stem_hole_diameter/2-.2, p.depth+p.bottom_thickness+10, z=p.underside_z-5).rotate(Axis.X, angle)
        require(volume(shell & stem) < EPS, "stem bore obstructed")
        axis_available = p.depth/math.cos(radians)
        require(axis_available >= p.clearance_mm, "centreline reserve is too short")
        corridor_lowest = -p.clearance_mm*math.cos(radians) - p.corridor_radius*math.sin(radians)
        require(corridor_lowest-p.floor_z >= p.corridor_floor_gap-EPS, "finite corridor loses its floor allowance")
        corridor = cylinder(p.corridor_radius, p.clearance_mm, z=-p.clearance_mm).rotate(Axis.X, angle)
        require(volume(shell & corridor) < EPS and volume(plate & corridor) < EPS,
                "proposed finite wiring corridor is obstructed")
        if p.recess:
            pocket = cylinder(p.pocket_diameter/2-.2, p.recess, z=0).rotate(Axis.X, angle)
            require(volume(shell & pocket) < EPS, "counterbore obstructed")
        shoulder = (p.stem_hole_diameter/2 + 10, 2*math.sin(radians), -2*math.cos(radians))
        require(shell.is_inside(shoulder), "support shoulder absent")
        mount_checks = dict(shoulder_sample_present=True, counterbore_clear=True,
            axial_clearance_start="counterbore floor centre / seating-shoulder centre",
            axial_clearance_direction="negative tilted button axis",
            required_axis_clearance_mm=p.clearance_mm, available_axis_to_floor_mm=axis_available,
            proposed_corridor_radius_mm=p.corridor_radius, proposed_corridor_length_mm=p.clearance_mm,
            proposed_corridor_unobstructed=True, corridor_floor_gap_mm=corridor_lowest-p.floor_z)
    elif variant == "rotor-level":
        floor = p.level_top_z-p.rotor_hex_depth
        passage = cylinder(p.rotor_passage_diameter/2-.2, floor-p.floor_z, z=p.floor_z+.1)
        require(volume(shell & passage) < EPS and volume(plate & passage) < EPS, "rotor body passage obstructed")
        pocket = extrude(RegularPolygon((p.rotor_hex_across_flats-.2)/math.sqrt(3), 6), amount=p.rotor_hex_depth)
        require(volume(shell & pocket.translate((0,0,floor+.1))) < EPS, "rotor hex pocket obstructed")
        shelf_x = (p.rotor_passage_diameter+p.rotor_hex_across_flats)/4
        require(shell.is_inside((shelf_x,0,floor-p.roof/2)), "rotor recess shelf absent")
        mount_checks = dict(rotor_hex_across_flats_proposed_mm=p.rotor_hex_across_flats,
            rotor_hex_depth_proposed_mm=p.rotor_hex_depth, rotor_hex_fit_verified=False,
            body_nominal_diameter_mm=p.rotor_body_nominal_diameter,
            body_diameter_allowance_proposed_mm=p.rotor_body_diameter_allowance,
            proposed_body_passage_diameter_mm=p.rotor_passage_diameter,
            body_passage_clear=True, hex_pocket_clear=True, shelf_sample_present=True,
            proposed_centre_wiring_space_to_floor_mm=floor-p.floor_z)
    elif variant == "mushroom-level":
        roof = box(28,28,p.roof-.2,z=p.level_top_z-p.roof+.1)
        require(math.isclose(volume(shell & roof), roof.volume, rel_tol=1e-7), "mushroom blank has an invented opening")
        mount_checks = dict(mounting_opening_present=False, mounting_and_wiring_status="TBD")
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
                usable_floor_z_mm=bottom_top, external_underside_z_mm=p.underside_z,
                internal_reserve_mm=p.depth, withdrawal_checked_mm=withdrawal,
                highest_roof_z_mm=shell.bounding_box().max.Z,
                exterior_height_mm=shell.bounding_box().max.Z-p.underside_z,
                mount_checks=mount_checks,
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



def preview(parameters: Proposal | None = None, *, explode: float = 0, include_reference: bool = True, variant="all"):
    """Return viewer payload only. Never connect, publish, or start a service."""
    p = parameters if parameters is not None else Proposal()
    p.validate()
    if not math.isfinite(explode) or explode < 0:
        raise ValueError("explode must be finite and nonnegative")
    reference = None
    if include_reference and variant in ("all", "arcade-inclined"):
        source = HERE / "components" / "adafruit-1185"
        provenance = json.loads((source / "source.json").read_text())
        asset = source / "button.step"
        require(hashlib.sha256(asset.read_bytes()).hexdigest() == provenance["sha256"], "reference asset hash changed")
        reference = import_step(asset)
    objects, names, colors, alphas = [], [], [], []
    selected = list(variant_requirements()["variants"]) if variant == "all" else [variant]
    for index, label in enumerate(selected):
        parts = build(p, label)
        verify_assembly(p, label, parts)
        shell, bottom = parts[:2]
        x = (index-(len(selected)-1)/2)*160
        objects.extend((shell.translate((x, 0, 0)), bottom.translate((x, 0, -explode))))
        note = (f"{p.clearance_mm:g} mm axial reserve" if label == "arcade-inclined" else
                f"hex {p.rotor_hex_across_flats:g} AF x {p.rotor_hex_depth:g} depth PROPOSED" if label == "rotor-level" else
                "UNCUT BLANK; mounting and wiring TBD")
        names.extend((f"{label} shell PROPOSAL, {note}; fit unknown", f"{label} removable bottom PROPOSAL, fit unknown"))
        colors.extend(("#b8a084", "#d4c3a8"))
        alphas.extend((.75, 1))
        if reference is not None and label == "arcade-inclined":
            objects.append(reference.rotate(Axis.X, p.tilt).translate((x, 0, 0)))
            names.append(f"{label} button REFERENCE, upstream invalid, fit unknown")
            colors.append("#367fd4")
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
    parser.add_argument("--variant", choices=("all", *variant_requirements()["variants"]), default="all")
    parser.add_argument("--requirements", action="store_true", help="Report active variants and unresolved facts without exporting geometry")
    args = parser.parse_args()
    if args.requirements:
        print(json.dumps(variant_requirements(), indent=2))
        return
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
    receipt = dict(variant_requirements=variant_requirements(),
                   print_readiness="NOT_READY", depth_datum="seating-shoulder centre to interior floor; cover extends below",
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
    selected = list(variant_requirements()["variants"]) if args.variant == "all" else [args.variant]
    for name in selected:
        parts = build(p, name)
        checks = verify_assembly(p, name, parts)
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
                                                ("shell-top", parts[0], (160, -240, 300)),
                                                ("bottom", parts[1], (160, -240, 300)))}
        receipt["concepts"][name] = dict(inspection_svg_sha256=drawings, tilt_degrees=p.tilt if name == "arcade-inclined" else 0,
            parts=records, assembly_checks=checks, screw_centres_xy_mm=parts[2],
            assembly_step_sha256=hashlib.sha256(assembly_path.read_bytes()).hexdigest())
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(receipt_path)


if __name__ == "__main__":
    main()
