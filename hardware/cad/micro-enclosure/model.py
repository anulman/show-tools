"""Measured envelopes and a two-part enclosure; never infer hardware dimensions."""
import math
from build123d import Align, Box, Cylinder, RegularPolygon, extrude

MIN = (Align.CENTER, Align.CENTER, Align.MIN)


def box(x, y, z, at=(0, 0, 0)):
    return Box(x, y, z, align=MIN).translate(at)


def bore(diameter, height, at):
    return Cylinder(diameter / 2, height, align=MIN).translate(at)


def positive(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
        raise ValueError('Missing positive measured dimension: ' + name)
    return value


def build(m):
    """Hardware dimensions are required; shell allowances below are design choices.

    board_length_mm/board_width_mm: measured PCB plan dimensions;
    installed_top_mm: feet bottom to highest connected component.
    Optional feet: four {xy_mm:[x,y], size_mm:[length,width]} envelopes
    plus foot_height_mm. No floor screw or PCB holes are inferred.
    exits: [{wall:'x+'|'x-'|'y+'|'y-', offset_mm, width_mm, depth_mm}].
    """
    if not isinstance(m.get('source'), str) or not m['source'].strip():
        raise ValueError('Record measurement source')
    l = positive(m['board_length_mm'], 'board_length_mm')
    w = positive(m['board_width_mm'], 'board_width_mm')
    top = positive(m['installed_top_mm'], 'installed_top_mm')
    feet = m.get('feet', [])
    if feet and len(feet) != 4:
        raise ValueError('Supply all four measured CAPFEET envelopes together')
    floor, wall, cover_t, margin, headroom = 3., 3., 3., 18., 8.
    ix, iy = l + 2*margin, w + 2*margin
    for f in feet:
        a, b = [positive(v, 'foot size') for v in f['size_mm']]
        x, y = f['xy_mm']
        if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (x, y)):
            raise ValueError('Finite foot position required')
        ix = max(ix, 2*(abs(x) + a/2 + margin))
        iy = max(iy, 2*(abs(y) + b/2 + margin))
    ox, oy, z = ix + 2*wall, iy + 2*wall, floor + top + headroom
    shell = box(ox, oy, z) - box(ix, iy, z, (0, 0, floor))
    # Short M3x10 cover screws meet inward-loading captive nuts near the rim.
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
        width = positive(e['width_mm'], 'exit width')
        depth = positive(e['depth_mm'], 'exit depth')
        if side not in ('x+', 'x-', 'y+', 'y-'):
            raise ValueError('Unknown exit wall')
        span = iy if side[0] == 'x' else ix
        if not math.isfinite(offset) or abs(offset)+width/2 >= span/2-12 or depth >= z-floor:
            raise ValueError('Exit intersects corner posts or floor')
        if side[0] == 'x':
            cutter = box(wall+2, width, depth+1, ((1 if side[1]=='+' else -1)*(ox/2-wall/2), offset, z-depth))
        else:
            cutter = box(width, wall+2, depth+1, (offset, (1 if side[1]=='+' else -1)*(oy/2-wall/2), z-depth))
        shell -= cutter
    refs = []
    if feet:
        fh = positive(m.get('foot_height_mm'), 'foot_height_mm')
        if fh >= top:
            raise ValueError('Feet height must be below installed top')
        for f in feet:
            refs.append(box(*f['size_mm'], fh, (*f['xy_mm'], floor)))
    # Measured total height, without invented PCB thickness or connector poses.
    envelope = box(l, w, top, (0, 0, floor))
    return shell, cover, refs, envelope, dict(outer_mm=[ox, oy, z+cover_t],
        shell_top_mm=z, floor_mm=floor, screw_centres_mm=centres,
        screw_clearance_mm=3.4, screw_length_mm=10., nut_top_below_rim_mm=5., nut_pocket_across_flats_depth_mm=[5.8, 2.7],
        design_choices_mm=dict(wall=wall, cover=cover_t, lateral_margin=margin, headroom=headroom),
        floor_mounting='undrilled; measured installed feet required for drilling',
        strain_relief='unselected; openings alone provide no strain relief')
