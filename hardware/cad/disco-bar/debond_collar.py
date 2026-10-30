"""Separate C2 candidate preserving the original bottom-accessible debond voids.

Source-negative Z is inside the ball; Z0 is the flush lip. Existing producers
stay unchanged. Factory carrier fasteners remain pre-glue assembly only.
"""
from __future__ import annotations
import math
from build123d import Axis, Plane, Keep
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder
from . import standard_collar as standard

c, old = standard.c, standard.old
BORE, CARRIER_OUTER, LIP_INNER = standard.BORE, standard.CARRIER_OUTER, standard.LIP_INNER
RACE_OUTER, LOCK_ANGLE, RELEASE_ANGLE = standard.RACE_OUTER, standard.LOCK_ANGLE, standard.RELEASE_ANGLE
POINT, RETRACTION, STATES = standard.POINT, standard.RETRACTION, standard.STATES
HARDWARE, TOOL, DRIVE_TOOL = standard.HARDWARE, standard.TOOL, standard.DRIVE_TOOL
baseline, nut, button_screw, captive_pair = standard.baseline, standard.nut, standard.button_screw, standard.captive_pair
key, drive_key, control_sweeps = standard.key, standard.drive_key, standard.control_sweeps
CARRIER_ANGLES = (40, 160, 280)


def channel_envelopes(reference):
    """Extract the two actual inner cylindrical faces and their source depth."""
    channels = {}
    for face in reference.faces():
        surface = BRepAdaptor_Surface(face.wrapped)
        if surface.GetType() != GeomAbs_Cylinder:
            continue
        cylinder = surface.Cylinder()
        direction = cylinder.Axis().Direction()
        if abs(cylinder.Radius()-7.9375) > 1e-6 or abs(direction.Z()-1) > 1e-6:
            continue
        location = cylinder.Location()
        center = (location.X(), location.Y())
        key = '+' if center[0] > 0 else '-'
        low = face.bounding_box().min.Z
        previous = channels.get(key)
        if previous is None or low < previous[1]:
            channels[key] = (center, low, cylinder.Radius())
    if set(channels) != {'+', '-'}:
        raise ValueError('Original inner debond cylinder faces missing')
    return {label: c.cyl(radius, -low, (*center, low/2))
            for label, (center, low, radius) in channels.items()}


def original_channel_voids(reference):
    outer_radius = max(BRepAdaptor_Surface(face.wrapped).Cylinder().Radius()
                       for face in reference.faces()
                       if BRepAdaptor_Surface(face.wrapped).GetType() == GeomAbs_Cylinder)
    return {label: (envelope & c.cyl(outer_radius, 40, (0,0,-20)))-reference
            for label, envelope in channel_envelopes(reference).items()}


def anchored_bar(reference, carrier_angles):
    """Rebuild only the original C2 mouth recipe with independently placed anchors."""
    bar = reference-c.cyl(37.5,30,(0,0,-15))
    bar += old.ring(33.4,41,-12,0)
    for angle in carrier_angles:
        bar += old.radial(c.box(12,10,9.2,(40,0,-5.5)),angle)
        bar -= old.radial(c.box(3.4,6.4,10.6,(41.5,0,-5)),angle)
    bar -= c.cyl(37.4,2.3,(0,0,-1.15))
    for sign in (-1,1):
        bar -= c.box(6.6,6.6,8.3,(0,sign*34.75,-4.15))
    return bar


def build(reference, state='locked', *, angle=None, screw_lift=None, lift=None,
          carrier_angles=CARRIER_ANGLES, preserve_channels=True):
    rotation, travel, shift = STATES[state]
    rotation = rotation if angle is None else angle
    travel = travel if screw_lift is None else screw_lift
    shift = shift if lift is None else lift
    base = baseline(reference)
    bar = anchored_bar(reference, carrier_angles)
    # Receiver clearance and new standard hardware pockets in the mouth only.
    bar -= c.cyl(44., 1.5, (0, 0, -.75))
    carrier = old.ring(BORE, CARRIER_OUTER, -1, 5.5)
    carrier += old.ring(LIP_INNER, CARRIER_OUTER, -1, 1)
    carrier += old.ring(LIP_INNER, CARRIER_OUTER, 4, 5.5)
    # Finite overlap connects the end stops to the upper receiver lip.
    stop_delta = math.degrees(math.acos((39**2+38.5**2-6.5**2)/(2*39*38.5)))
    for stop_angle in (225-stop_delta, 315+stop_delta):
        stop = c.cyl(1.5, 2.7, (*old.xy(39,stop_angle),6.65))
        stop += old.radial(c.box(4,2.4,2.7,(41,0,6.65)),stop_angle)
        carrier += stop
        assert carrier.is_valid, "stop"
    hardware = []
    for a in carrier_angles:
        carrier += old.radial(c.box(3, 6, 10, (41.5, 0, -5)), a)
        hole = old.radial(c.cyl(1.8, 13, (41, 0, -7), 'x'), a)
        carrier -= hole; bar -= hole
        assert carrier.is_valid, "tabhole "+str(a)
        bar -= old.radial(c.cyl(3.35, 7, (48, 0, -7), 'x'), a)
        bar -= old.radial(c.hexagon(5.8/math.sqrt(3), 6.9, (36.45, 0, -7), 'x'), a)
        hardware += [c.Piece(f'M3x8 carrier button screw {a}', old.radial(button_screw((44.5, 0, -7)), a), 'standard hardware'),
                     c.Piece(f'M3 carrier nut {a}', old.radial(nut((38.7, 0, -7), 'x'), a), 'standard hardware')]
    # A back-loaded standard nut is closed in by the bar receiver after assembly.
    bracket = c.cyl(4.5, 6.3, (*POINT, -2.25))
    bar -= c.cyl(5., 5.8, (*POINT, -2.9))
    assert carrier.is_valid, "before bracket"
    carrier += bracket
    assert carrier.is_valid, "bracket"
    carrier -= c.hexagon(5.8/math.sqrt(3), 6, (*POINT, -3.5))
    carrier -= c.cyl(1.8, 9, (*POINT, -1))
    assert carrier.is_valid, "after nut bore"
    hardware.append(c.Piece('M3 positive-lock nut', nut((*POINT, -1.7)), 'standard hardware'))
    collar = old.ring(37.7, RACE_OUTER, 1.5, 3.5)
    for sign in (-1, 1):
        collar += c.box(5, 6, 2.5, (sign*36.5, 0, 1.75))
    p = old.xy(38, RELEASE_ANGLE)
    # The lock cap is preassembled with its commercial screw and washer.
    # It lowers onto these open posts; the washer never traverses a shaft bore.
    posts = old.ring(36.,39.4,3.3,6.)
    strips = c.box(15,3,2.7,(38,-5.5,4.65))+c.box(15,3,2.7,(38,5.5,4.65))
    posts &= old.radial(strips,RELEASE_ANGLE)
    upright = old.radial(c.box(4.5,9,10.8,(35.75,6,8.7)),RELEASE_ANGLE)
    clearance = c.cyl(3.4,10.,(*p,10.8))
    upright -= clearance
    shelf=c.cyl(3.7,2.7,(*p,4.65))&old.ring(36.,39.4,3.3,6.)
    collar += posts+upright+shelf
    cap = old.radial(c.box(9,18,2.5,(38,1,7.25)),RELEASE_ANGLE)
    cap -= old.radial(c.box(5,10,14,(35.5,6,9)),RELEASE_ANGLE)
    cap += old.radial(c.box(2.8,9,8.1,(39.4,6,10.05)),RELEASE_ANGLE)
    cap -= c.cyl(1.8,12,(*p,7))
    cap -= c.cyl(3.4,1.7,(*p,6.65))
    cap -= c.cyl(3.25,8.,(*p,12.5))
    # Radial permanent joint, assembled before the collar goes into its race.
    nut_pocket = old.radial(c.hexagon(5.8/math.sqrt(3),4.,(34.,6.,9.4),'x'),RELEASE_ANGLE)
    bolt_hole = old.radial(c.cyl(1.8,12.,(37.,6.,9.4),'x'),RELEASE_ANGLE)
    collar -= nut_pocket+bolt_hole
    cap -= bolt_hole
    cap -= old.radial(c.cyl(3.35,7.,(44.3,6.,9.4),'x'),RELEASE_ANGLE)
    collar_hardware = [
        c.Piece('M3x8 lock-cap button screw',old.radial(button_screw((40.8,6.,9.4)),RELEASE_ANGLE),'standard hardware'),
        c.Piece('M3 lock-cap nut',old.radial(nut((34.8,6.,9.4),'x'),RELEASE_ANGLE),'standard hardware')]
    collar -= c.cyl(1.8,10,(*p,5))
    drive = old.xy(38.5, 225.)
    drive_neck = c.cyl(4., 2.9, (*drive, 4.75)) & old.ring(36., 39.4, 3.3, 6.2)
    collar += drive_neck+c.cyl(5., 9., (*drive, 10.5))
    collar -= c.hexagon(4.35/math.sqrt(3), 7.5, (*drive, 11.75))
    screw, washer = captive_pair()
    collar = old.radial(collar, rotation)
    cap = old.radial(cap,rotation)
    collar_hardware = [c.Piece(q.name,old.radial(q.shape,rotation),q.role) for q in collar_hardware]
    screw = screw.rotate(Axis((*p, 0), (0, 0, 1)), travel/.5*360)
    screw = old.radial(screw.translate((0, 0, travel)), rotation)
    washer = old.radial(washer, rotation)
    if preserve_channels:
        for envelope in channel_envelopes(reference).values():
            # Restore the actual original material in this local region; do not
            # subtract a shared-face compound void from its own source material.
            bar = (bar-envelope) + (reference&envelope)
            carrier -= envelope
    if not carrier.is_valid: raise ValueError('RECEIVER_INVALID_BEFORE_SPLIT')
    if len(carrier.solids())!=1: raise ValueError('Receiver disconnected: '+str([(s.volume) for s in carrier.solids()]))
    carrier = carrier.solids()[0]
    halves = []
    for sign, label in ((1, 'A'), (-1, 'B')):
        normal=(-sign*math.sin(math.radians(25)),sign*math.cos(math.radians(25)),0)
        half=carrier.split(Plane(origin=tuple(.25*v for v in normal),z_dir=normal),Keep.TOP)
        halves.append(c.Piece('fixed receiver half '+label, half, 'print'))
    moving = [c.Piece('full-height bar', bar, 'bar'), *halves,
              c.Piece('standard-screw drive collar', collar, 'print'),
              c.Piece('preassembled captive-lock cap',cap,'print'),
              *collar_hardware,
              c.Piece('WDS 899 captive M3x12 screw', screw, 'purchased captive hardware'),
              c.Piece('WDS 899-M3 retaining washer', washer, 'purchased captive hardware')]+hardware
    parts = [c.Piece('preset / '+p.name, p.shape, p.role) for p in base.pieces]
    parts += [c.Piece(p.name, p.shape.translate((0, 0, shift)), p.role) for p in moving]
    return old.Prototype('debond-preserving-collar-C2', state, base, parts, shift,
                         [dict(kind='ordinary 2.5 mm key operates captive M3 lock', radius_mm=38.,
                               source_angles_degrees=[45., 135.], closed_head_top_source_z_mm=11.5,
                               fully_retracted_head_top_source_z_mm=17.5, retraction_mm=RETRACTION),
                          dict(kind='integral blind 4 mm hex drive', radius_mm=38.5,
                               source_angles_degrees=[225.,315.], outside_diameter_mm=10.,
                               source_z_mm=[6.,15.], socket_across_flats_mm=4.35,
                               socket_depth_mm=7., socket_floor_mm=2., tool_engagement_mm=6.5)])

