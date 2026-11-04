"""PCB reference plane and declared enclosure space; no invented hardware stack."""
import math
from build123d import Align, Box, Cylinder, Rectangle, RegularPolygon, extrude

MIN = (Align.CENTER, Align.CENTER, Align.MIN)


def box(x, y, z, at=(0, 0, 0)):
    return Box(x, y, z, align=MIN).translate(at)


def bore(diameter, height, at):
    return Cylinder(diameter / 2, height, align=MIN).translate(at)


def positive(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError('Missing positive dimension: ' + name)
    return value


def build(m):
    """PCB L/W and nominal mounting elevation are operator-reported; face datum unknown. Interior height/bay/exits are design choices.

    No measured installed-top height, PCB thickness, feet XY or connector pose is
    available. The reference is a surface, never an invented board/feet solid.
    """
    if not isinstance(m.get('source'), str) or not m['source'].strip():
        raise ValueError('Record measurement source')
    if 'installed_top_mm' in m:
        raise ValueError('Use interior_height_mm for design budget, not installed_top_mm')
    l = positive(m['board_length_mm'], 'board_length_mm')
    w = positive(m['board_width_mm'], 'board_width_mm')
    face_height = positive(m['pcb_mounting_elevation_above_inside_floor_mm'], 'pcb_mounting_elevation_above_inside_floor_mm')
    height = positive(m['interior_height_mm'], 'interior_height_mm')
    bay = positive(m['cable_bay_length_mm'], 'cable_bay_length_mm')
    if height <= face_height + 12 or bay < 24:
        raise ValueError('Interior needs board headroom and cable bay must clear corner posts')
    floor, wall, cover_t, margin = 3., 3., 3., 18.
    ix, iy = l + 2*margin + bay, w + 2*margin
    ox, oy, z = ix + 2*wall, iy + 2*wall, floor + height
    board_x = -bay/2
    shell = box(ox, oy, z) - box(ix, iy, z, (0, 0, floor))
    centres = [(sx*(ix/2-5), sy*(iy/2-5)) for sx in (-1, 1) for sy in (-1, 1)]
    for x, y in centres:
        shell += box(11, 11, z, (x, y, 0))
        shell -= bore(3.4, 9., (x, y, z-8))
        shell -= extrude(RegularPolygon(5.8/math.sqrt(3), 6), amount=2.7).translate((x, y, z-7.7))
        shell -= box(7., 5.8, 2.7, (x-(3.5 if x>0 else -3.5), y, z-7.7))
    cover = box(ox, oy, cover_t, (0, 0, z))
    for x, y in centres:
        cover -= bore(3.4, cover_t+2, (x, y, z-1))
    for e in m.get('exits', []):
        side, offset = e['wall'], e['offset_mm']
        width = positive(e['width_mm'], 'design exit width')
        depth = positive(e['depth_mm'], 'design exit depth')
        if side not in ('x+', 'x-', 'y+', 'y-'):
            raise ValueError('Unknown exit wall')
        span = iy if side[0] == 'x' else ix
        if not math.isfinite(offset) or width <= 2 or depth <= 2 or abs(offset)+width/2 >= span/2-12 or depth >= height:
            raise ValueError('Exit intersects corner posts or floor')
        if side[0] == 'x':
            cutter = box(wall+2, width, depth+1, ((1 if side[1]=='+' else -1)*(ox/2-wall/2), offset, z-depth))
        else:
            cutter = box(width, wall+2, depth+1, (offset, (1 if side[1]=='+' else -1)*(oy/2-wall/2), z-depth))
        shell -= cutter
    # The nominal mounting plane carries no top/underside or thickness claim.
    pcb_face = Rectangle(l, w).translate((board_x, 0, floor+face_height))
    # This volume illustrates a proposed storage region, not occupied wire geometry.
    bay_x = ix/2 - bay/2
    storage = box(bay, iy-32, height-12, (bay_x, 0, floor+6))
    return shell, cover, [storage], pcb_face, dict(outer_mm=[ox, oy, z+cover_t],
        inner_mm=[ix, iy, height], shell_top_mm=z, floor_mm=floor,
        pcb_centre_xy_mm=[board_x, 0], pcb_reference_z_mm=floor+face_height,
        pcb_mounting_elevation_above_inside_floor_mm=face_height,
        screw_centres_mm=centres, screw_clearance_mm=3.4, screw_length_mm=10.,
        nut_top_below_rim_mm=5., nut_pocket_across_flats_depth_mm=[5.8, 2.7],
        design_choices_mm=dict(wall=wall, cover=cover_t, lateral_margin=margin,
                               interior_height=height, cable_bay_length=bay),
        storage_region_mm=dict(size=[bay, iy-32, height-12], centre_xy=[bay_x, 0], bottom=floor+6),
        floor_mounting='undrilled; CAPFEET positions and floor screw offsets unmeasured',
        strain_relief='unselected; proposed seam opening alone provides no strain relief',
        installed_hardware_height_measured=False,
        pcb_thickness_measured=False, pcb_face_datum_confirmed=False, feet_footprints_measured=False)
