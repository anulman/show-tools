"""Axially operated latch studies. Geometry only; preload and strength are untuned."""
from __future__ import annotations

import math
from . import full_height as b
from build123d import Axis, Circle, Plane, Polygon, extrude

TOGGLE_CLOSED = 155.0
KEY_NAMES = ("axial safety key",)


def capsule(first, second, radius, width):
    dx, dz = second[0] - first[0], second[2] - first[2]
    length = math.hypot(dx, dz)
    plane = Plane(origin=first, x_dir=(dx / length, 0, dz / length), z_dir=(0, 1, 0))
    face = Polygon((0, -radius), (length, -radius), (length, radius), (0, radius), align=None)
    face += Circle(radius)
    face += Circle(radius).translate((length, 0, 0))
    return extrude(plane * face, amount=width / 2, both=True)


def common(reference):
    initial = b.drawplate(reference)
    parts = {p.name: p for p in initial.pieces}
    body = parts['complete integrated bar'].shape
    frame = parts['moving drawframe'].shape
    pads = [p for p in initial.pieces if p.role == 'pad']
    shoes = [p for p in initial.pieces if 'taper shoe' in p.name]
    # Replace the screw drive with two integral guided pull posts. The lower
    # feet capture the frame independently of the retired nut-pocket roofs.
    for x in (-38, 38):
        frame += b.cyl(2, 18, (x, 0, -15))
        frame += b.cyl(3.8, 1, (x, 0, -23.5))
        body += b.cyl(3.6, 4, (x, 0, -18))
        body += b.box(8, 8, 3, (math.copysign(34, x), 0, -18))
        body -= b.cyl(2.3, 24, (x, 0, -13))
    return body, frame, pads, shoes, initial.edit_mask


def safety_key(body, point, cage_top, cap_top, state='locked', lift=6, width=7):
    """Push, quarter-turn, then lift. Closed cross-lug has a keyed roof pocket."""
    x, y = point
    body += b.box(width, 7, 3.8, (x, y, cage_top - 1.9))
    body -= b.cyl(1.1, 7, (x, y, cage_top - 1.5))
    body -= b.box(4.4, 1.4, .8, (x, y, cage_top - 1.2))
    body -= b.cyl(2.5, 1.4, (x, y, cage_top - 2.3))
    body -= b.box(1.4, 4.4, 4, (x, y, cage_top - 1))
    shaft_bottom = cage_top - 3.2
    cap_bottom = cap_top - .5
    key = b.cyl(.9, cap_bottom - shaft_bottom, (x, y, (cap_bottom + shaft_bottom) / 2))
    key += b.cyl(1.5, .5, (x, y, cap_top - .25))
    key += b.box(4, 1, .6, (x, y, cage_top - 1.2))
    axis = Axis((x, y, 0), (0, 0, 1))
    if state == 'pushed':
        key = key.translate((0, 0, -1.2))
    elif state == 'turned':
        key = key.translate((0, 0, -1.2)).rotate(axis, 90)
    elif state == 'withdrawn':
        key = key.rotate(axis, 90).translate((0, 0, lift))
    return body, key


def toggle_kinematics(angle):
    theta = math.radians(angle)
    pivot = (34., 0., -8.)
    crank = (34 + 3 * math.cos(theta), 0., -8 + 3 * math.sin(theta))
    output_z = crank[2] - math.sqrt(8**2 - (38 - crank[0])**2)
    return pivot, crank, (38., 0., output_z)


def toggle(reference, state='locked'):
    angle = {'released': 90., 'closing': 120., 'dead-centre': math.degrees(math.acos(-.8)),
             'locked': TOGGLE_CLOSED, 'key-pushed': TOGGLE_CLOSED,
             'key-turned': TOGGLE_CLOSED, 'key-withdrawn': TOGGLE_CLOSED}[state]
    key_state = {'key-pushed': 'pushed', 'key-turned': 'turned'}.get(state, 'locked' if state == 'locked' else 'withdrawn')
    pivot, crank, output = toggle_kinematics(angle)
    released_z = toggle_kinematics(90)[2][2]
    rise = output[2] - released_z
    body, frame, pads, shoes, mask = common(reference)
    pads = [b.Piece(p.name, p.shape.translate((0, 0, -3)), 'pad') for p in pads]
    shoes = []
    for sign in (-1, 1):
        profile = Plane.XZ * Polygon((14, -21), (29, -21), (27.9, -10), (14, -10), align=None)
        shoe = extrude(profile, amount=10, both=True) - b.cyl(b.R + 1.5, 18, (0, 0, -14))
        if sign == -1:
            shoe = shoe.rotate(Axis.Z, 180)
        shoe -= next(p.shape for p in pads if p.name.startswith(f'{sign:+d}'))
        if sign == 1:
            shoe -= b.box(6.8, 7.6, 6, (28.5, 0, -11.1))
        shoes.append(b.Piece(f'{sign:+d} taper shoe', shoe, 'print'))

    # The output eye/yoke lifts both guided posts, avoiding independently
    # latched rods that would constrain the rigid drawframe to two heights.
    yoke = b.cyl(42, 2, (0, 0, -13.6)) - b.cyl(40, 4, (0, 0, -13.6))
    for x in (-38, 38):
        yoke += b.box(6, 5, 2, (x, 0, -13.6))
    eye = b.cyl(2.1, 4, (38, 0, released_z), 'y') - b.cyl(1.15, 7, (38, 0, released_z), 'y')
    # Remove the unused upper post lengths so they cannot protrude into the
    # operating lever. The posts still pass through both lower guides.
    for x in (-38, 38):
        frame -= b.cyl(2.2, 10, (x, 0, -8.6))
    frame += yoke + eye
    frame -= b.cyl(1.15, 15, (38, 0, released_z), 'y')
    frame -= b.cyl(2, 4, (38, 5.5, released_z), 'y')
    # The yoke needs clearance through the old alcohol-channel inner walls.
    clearance = b.cyl(42.5, 5, (0, 0, -12.5)) - b.cyl(39.5, 7, (0, 0, -12.5))
    body -= clearance
    body -= b.box(18, 4.6, 14.4, (33, 0, -8.8))
    body -= b.box(14, 3, 14.4, (35, 5.5, -8.8))
    access = b.box(16, 6, 3, (34, 0, -1.5))
    body -= access
    mask += access
    mask += b.box(14, 3, 1.4, (35, 5.5, -2.3))
    for y in (-3, 3):
        ear = b.box(6, 1, 6, (34, y, -8))
        ear -= b.cyl(1.15, 10, pivot, 'y')
        body += ear
    # Closed lever, with pin holes fixed in the lever's own geometry.
    theta = math.radians(TOGGLE_CLOSED)
    tip = (34 + 8 * math.cos(theta), 0, -8 + 8 * math.sin(theta))
    closed_crank = toggle_kinematics(TOGGLE_CLOSED)[1]
    lever = capsule(pivot, tip, 1.8, 4)
    for point in (pivot, closed_crank):
        lever -= b.cyl(1.15, 8, point, 'y')
    lever -= b.cyl(1.1, 15, (28.5, 0, -6))
    lever -= b.cyl(1.65, 2.1, (28.5, 0, -3.05))
    lever = lever.rotate(Axis(pivot, (0, 1, 0)), TOGGLE_CLOSED - angle)
    link_first, link_second = (crank[0], 5.5, crank[2]), (output[0], 5.5, output[2])
    link = capsule(link_first, link_second, 1.8, 2.4)
    for point in (link_first, link_second):
        link -= b.cyl(1.15, 6, point, 'y')
    stop = (tip[0] - 3 * math.sin(theta), 0, tip[2] + 3 * math.cos(theta))
    body += b.cyl(1.2, 4, stop, 'y')
    body += b.box(1.5, 15, 1, (stop[0], -6.5, -7.5))
    key_well = b.cyl(2, 5, (28.5, 0, -1))
    body -= key_well
    mask += key_well
    body, key = safety_key(body, (28.5, 0), -9.3, -2.0, key_state, lift=16, width=6)
    body -= b.cyl(1.15, 12, pivot, 'y')
    for degrees in range(90, 157, 3):
        point = toggle_kinematics(degrees)[1]
        body -= b.cyl(1.2, 9.2, (point[0], 2.3, point[2]), 'y')
    body -= b.pocket()
    pieces = [b.Piece('complete integrated bar', body, 'body'),
              b.Piece('guided drawframe and output yoke', frame.translate((0, 0, rise)), 'print'),
              b.Piece('over-centre operating lever', lever, 'print'), b.Piece('coupling link', link, 'print')]
    for p in shoes + pads:
        sign = -1 if p.name.startswith('-1') else 1
        pieces.append(b.Piece(p.name, p.shape.translate((-sign * .1 * rise, 0, rise)), p.role))
    for name, point, length in (('fixed pivot pin', pivot, 7.8), ('crank pin', (crank[0], 2.3, crank[2]), 9.2), ('output pin', (output[0], 2.3, output[2]), 9.2)):
        pieces.append(b.Piece(name, b.cyl(1, length, point, 'y'), 'hardware'))
    pieces.append(b.Piece('axial safety key', key, 'hardware'))
    variant = b.Variant("A′ | axial over-centre draw latch", pieces, mask, [], mechanism='toggle', reference=reference)
    variant.state = state
    variant.rise = rise
    return variant


def bayonet(reference, state='locked'):
    settings = {'released': (0., 0., 'withdrawn'), 'lifting': (.5, 0., 'withdrawn'),
                'raised': (1., 0., 'withdrawn'), 'turning': (1., 45., 'withdrawn'),
                'aligned': (1., 90., 'withdrawn'), 'locked': (.9, 90., 'locked'),
                'key-pushed': (.9, 90., 'pushed'), 'key-turned': (.9, 90., 'turned'),
                'key-withdrawn': (.9, 90., 'withdrawn')}
    rise, angle, key_state = settings[state]
    body, frame, pads, shoes, mask = common(reference)
    # Non-rotating yoke fits outside the collar sleeve. Two captive flanges
    # provide lift and manual return; the 0.2 mm gap is proposed running play.
    yoke = b.cyl(34, 1.5, (0, 0, -5.25)) - b.cyl(32.3, 4, (0, 0, -5.25))
    for x in (-38, 38):
        yoke += b.box(8, 5, 1.5, (x - math.copysign(2, x), 0, -5.25))
    frame += yoke
    collar = b.cyl(31.5, 5, (0, 0, -4.5)) - b.cyl(26, 8, (0, 0, -4.5))
    for z, h in ((-6.5, 1), (-3.9, .8)):
        collar += b.cyl(34, h, (0, 0, z)) - b.cyl(26, h + 2, (0, 0, z))
    for x in (-35, 35):
        collar += b.box(8, 4, 2, (x, 0, -2.5))
    # The ring's lock hole rotates into alignment with the axial safety key.
    collar -= b.cyl(1.1, 8, (37.5, 0, -3))
    collar -= b.cyl(1.65, 1.3, (37.5, 0, -2.15))
    collar = collar.rotate(Axis.Z, angle).translate((0, 0, rise))
    space = b.cyl(43, 7.1, (0, 0, -3.55)) - b.cyl(26, 10, (0, 0, -3.55))
    body -= space
    mask += b.cyl(45.62, 10, (0, 0, -5)) - b.cyl(25.6, 12, (0, 0, -5))
    ledge = b.cyl(40, 2.4, (0, 0, -3.8)) - b.cyl(35, 4, (0, 0, -3.8))
    ledge -= b.box(85, 7, 6, (0, 0, -3.8))
    body += ledge
    for sign in (-1, 1):
        for y in (-8, 8):
            body += b.box(14, 4, 2.8, (sign * 37, y, -8.6))
            body += b.box(10, 4, 2, (sign * 39.5, y, -4))
            body += b.box(2, 4, 8.6, (sign * 43.5, y, -5.7))
    body, key = safety_key(body, (0, 37.5), -2.6, 0, key_state, lift=5.5)
    body -= b.pocket()
    pieces = [b.Piece('complete integrated bar', body, 'body'),
              b.Piece('guided drawframe and annular yoke', frame.translate((0, 0, rise)), 'print'),
              b.Piece('lift-and-quarter-turn collar', collar, 'print')]
    for p in shoes + pads:
        sign = -1 if p.name.startswith('-1') else 1
        pieces.append(b.Piece(p.name, p.shape.translate((-sign * .1 * rise, 0, rise)), p.role))
    pieces.append(b.Piece('axial safety key', key, 'hardware'))
    variant = b.Variant("B′ | axial lift-and-turn bayonet latch", pieces, mask, [], mechanism='bayonet', reference=reference)
    variant.state = state
    variant.rise = rise
    return variant


def key_pose(shape, mechanism, mode):
    point, lift = ((28.5, 0), 16) if mechanism == 'toggle' else ((0, 37.5), 5.5)
    axis = Axis((*point, 0), (0, 0, 1))
    if mode == 'pushed':
        return shape.translate((0, 0, -1.2))
    if mode == 'turned':
        return shape.translate((0, 0, -1.2)).rotate(axis, 90)
    if mode == 'withdrawn':
        return shape.rotate(axis, 90).translate((0, 0, lift))
    if mode == 'parked':
        shift = (10, 8, lift) if mechanism == 'toggle' else (8, 0, lift)
        return shape.rotate(axis, 90).translate(shift)
    return shape


def pose_toggle(locked, angle, key_mode='parked', state='sweep'):
    pivot, crank, output = toggle_kinematics(angle)
    _, old_crank, old_output = toggle_kinematics(TOGGLE_CLOSED)
    change = output[2] - old_output[2]
    pieces = []
    for piece in locked.pieces:
        shape = piece.shape
        if piece.name == 'guided drawframe and output yoke':
            shape = shape.translate((0, 0, change))
        elif 'taper shoe' in piece.name or piece.role == 'pad':
            sign = -1 if piece.name.startswith('-1') else 1
            shape = shape.translate((-sign * .1 * change, 0, change))
        elif piece.name == 'over-centre operating lever':
            shape = shape.rotate(Axis(pivot, (0, 1, 0)), TOGGLE_CLOSED - angle)
        elif piece.name == 'coupling link':
            old = math.atan2(old_output[2] - old_crank[2], 38 - old_crank[0])
            new = math.atan2(output[2] - crank[2], 38 - crank[0])
            shape = shape.rotate(Axis((old_crank[0], 5.5, old_crank[2]), (0, 1, 0)), math.degrees(old - new))
            shape = shape.translate((crank[0] - old_crank[0], 0, crank[2] - old_crank[2]))
        elif piece.name == 'crank pin':
            shape = shape.translate((crank[0] - old_crank[0], 0, crank[2] - old_crank[2]))
        elif piece.name == 'output pin':
            shape = shape.translate((0, 0, change))
        elif piece.name == 'axial safety key':
            shape = key_pose(shape, 'toggle', key_mode)
        pieces.append(b.Piece(piece.name, shape, piece.role))
    result = b.Variant(locked.name, pieces, locked.edit_mask, [], mechanism='toggle', reference=locked.reference)
    result.state, result.rise = state, output[2] - toggle_kinematics(90)[2][2]
    return result


def pose_bayonet(locked, rise, angle, key_mode='parked', state='sweep'):
    change = rise - .9
    pieces = []
    for piece in locked.pieces:
        shape = piece.shape
        if piece.name == 'guided drawframe and annular yoke':
            shape = shape.translate((0, 0, change))
        elif 'taper shoe' in piece.name or piece.role == 'pad':
            sign = -1 if piece.name.startswith('-1') else 1
            shape = shape.translate((-sign * .1 * change, 0, change))
        elif piece.name == 'lift-and-quarter-turn collar':
            shape = shape.translate((0, 0, -.9)).rotate(Axis.Z, angle - 90).translate((0, 0, rise))
        elif piece.name == 'axial safety key':
            shape = key_pose(shape, 'bayonet', key_mode)
        pieces.append(b.Piece(piece.name, shape, piece.role))
    result = b.Variant(locked.name, pieces, locked.edit_mask, [], mechanism='bayonet', reference=locked.reference)
    result.state, result.rise = state, rise
    return result
