"""C2 first-article proposal: purchased captive M3 lock and integral 4 mm hex drive.

Earlier producers stay unchanged. Source-negative Z is inside the original ball
opening; every added below-mouth feature is source-positive or inside R47.230665.
Metal threads are purchased interfaces, not printable thread instructions.
"""
from __future__ import annotations
from dataclasses import replace
import math
from . import couplings as old
from build123d import Axis, Plane, Keep
c = old.c
RACE_OUTER = 41.0
BORE = 41.5
LIP_INNER = 40.0
CARRIER_OUTER = 43.5
LOCK_ANGLE = 135.
RELEASE_ANGLE = 45.
POINT = old.xy(38., LOCK_ANGLE)
HEAD_SEAT = 8.5
RETRACTION = 6.0
GAP_PROPOSED = 19.
STATES = {
    'locked': (90., 0., 0.),
    'screw-clear': (90., 4., 0.),
    'screw-captive-stop': (90., RETRACTION, 0.),
    'collar-midway': (45., RETRACTION, 0.),
    'released': (0., RETRACTION, 0.),
    'detached': (0., RETRACTION, -35.),
}
HARDWARE = {
    'captive screw': dict(part='WDS 899-M3-12M3', url='https://www.wdscomponents.com/en-gb/m3-x-12-captive-socket-cap-screw-with-threaded-washer', thread='M3 x 0.5', under_head_mm=12., threaded_end_mm=4., reduced_shank_diameter_mm=2.2, head_diameter_mm=5.5, head_height_mm=3., hex_mm=2.5),
    'captive washer': dict(part='WDS 899-M3', url='https://www.wdscomponents.com/en-gb/m3-threaded-captive-washer-stainless-steel', outside_diameter_mm=6., thickness_mm=1., thread='M3'),
    'permanent button screw': dict(part='Accu SSB-M3-8-A2',url='https://www.accu.co.uk/socket-button-screws/8102-SSB-M3-8-A2',standard='ISO 7380-1',thread='M3 x 0.5',length_mm=8.,head_max_diameter_mm=5.7,head_max_height_mm=1.65,hex_mm=2.),
    'preset grub screw': dict(part='Accu SSF-M3-6-A2',url='https://www.accu.co.uk/flat-point-set-screws/4514-SSF-M3-6-A2',standard='DIN 913 / ISO 4026',thread='M3 x 0.5',length_mm=6.,hex_mm=1.5,end_diameter_mm=2.,model='conservative full nominal thread cylinder; actual end chamfer not modeled'),
    'M3 nut': dict(part='Harrison Silverdale 10401 M3 SS', url='https://www.harrisonsilverdale.com/products/details/standard-thread-full-nuts.html', across_flats_mm=5.5, thickness_mm=2.4),
}


def nut(center, axis='z'):
    return c.hexagon(5.5/math.sqrt(3), 2.4, center, axis)-c.cyl(1.25, 4, center, axis)


def button_screw(center, axis='x'):
    # ISO7380-1 M3x8 maximum cylindrical head envelope, not a printed screw.
    x, y, z = center
    shape = c.cyl(1.5, 8, (x-4, y, z), axis)+c.cyl(2.85, 1.65, (x+.825, y, z), axis)
    return shape-c.hexagon(2/math.sqrt(3), 1.5, (x+1.3, y, z), axis)


def baseline(reference, setting=.2):
    base = old.pads.build(reference, setting)
    pieces = []
    for p in base.pieces:
        shape = p.shape
        if p.role=='body':
            # Rebuild the shell before cutting the selected 5.8 AF nut pockets;
            # swapping a smaller real nut into the old larger pocket is unsafe.
            shape = c.cyl(33, 26.9875, (0, 0, -13.49375))-c.pocket()
            channel=old.radial(c.cyl(2.,31,(32.8,6,-13.5)),RELEASE_ANGLE)
            shape -= channel
            assert shape.is_valid, "cup early channel"
            for sign in (-1, 1):
                shape -= c.box(14, 23, 15, (sign*20.5, 0, -13))
                for y in (-12, 12):
                    shape -= c.box(4, 3, 11, (sign*25.5, y, -13))
                shape -= c.hexagon(5.8/math.sqrt(3), 3.6, (sign*28.5, 0, -13), 'x')
                shape -= c.cyl(1.8, 10, (sign*31, 0, -13), 'x')
            flange = old.ring(30, 37, -2, 0)
            for sign in (-1, 1):
                flange -= c.box(5, 7.2, 4, (sign*35.5, 0, -1))
                shape += c.box(6, 5, 6, (0, sign*34.5, -5))
            shape += flange
            # The known socket, entry and blind stop remain unchanged.
            for angle in (RELEASE_ANGLE, LOCK_ANGLE, 225.):
                shape -= c.cyl(5.5 if angle==225. else 5., 4, (*old.xy(38.5 if angle==225. else 38., angle), -1))
            assert shape.is_valid, "cup before cap relief"
            # Released cap ears pass through this open flange sector.
            relief = old.radial(c.box(12,21,4,(38,1.5,-1)),RELEASE_ANGLE)
            shape -= relief
            assert shape.is_valid, "cup cap relief"
            # Shallow exterior channel clears the standard cap-bolt tip by >.5.

        elif 'captive nut envelope'  in p.name:
            sign = -1 if p.name.startswith('-1') else 1
            shape = nut((sign*29.1, 0, -13), 'x')
        elif 'preset set-screw envelope' in p.name:
            sign = -1 if p.name.startswith('-1') else 1
            shape = c.cyl(1.5, 6, (sign*(30-setting), 0, -13), 'x')
            shape -= c.hexagon(1.5/math.sqrt(3), 2., (sign*(32.6-setting), 0, -13), 'x')
        pieces.append(c.Piece(p.name, shape, p.role))
    return replace(base, pieces=tuple(pieces))


def captive_pair():
    point = old.xy(38, RELEASE_ANGLE)
    # Actual catalog regions: reduced neck [.5,8.5], thread [-3.5,.5].
    screw = c.cyl(1.1, 8, (*point, 4.5))
    screw += c.cyl(1.5, 4, (*point, -1.5))
    screw += c.cyl(2.75, 3, (*point, 10.))
    screw -= c.hexagon(2.5/math.sqrt(3), 2.1, (*point, 10.7))
    washer = c.cyl(3, 1, (*point, 7.0))-c.cyl(1.25, 3, (*point, 7.0))
    return screw, washer


def build(reference, state='locked', *, angle=None, screw_lift=None, lift=None):
    rotation, travel, shift = STATES[state]
    rotation = rotation if angle is None else angle
    travel = travel if screw_lift is None else screw_lift
    shift = shift if lift is None else lift
    base = baseline(reference)
    _, bar, oldcarrier, _ = old.common(reference)
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
    for a in (0, 120, 240):
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
    return old.Prototype('standard-collar-C2', state, base, parts, shift,
                         [dict(kind='ordinary 2.5 mm key operates captive M3 lock', radius_mm=38.,
                               source_angles_degrees=[45., 135.], closed_head_top_source_z_mm=11.5,
                               fully_retracted_head_top_source_z_mm=17.5, retraction_mm=RETRACTION),
                          dict(kind='integral blind 4 mm hex drive', radius_mm=38.5,
                               source_angles_degrees=[225.,315.], outside_diameter_mm=10.,
                               source_z_mm=[6.,15.], socket_across_flats_mm=4.35,
                               socket_depth_mm=7., socket_floor_mm=2., tool_engagement_mm=6.5)])


TOOL = dict(manufacturer='Wera', part='05021610001', name='950 L, 2.5 x 112 x 18 mm',
            source='https://cdn.hoffmann-group.com/derivatives/3483504/originalpdf/05021610001_en.pdf',
            modeled='conservative full L-shaped envelope with nominal hex working end; not proprietary Hex-Plus surface CAD')


def key(angle=90., screw_lift=0., axial=0.):
    p = old.xy(38, RELEASE_ANGLE)
    shape = c.hexagon(2.5/math.sqrt(3), 4., (*p, 12.))
    shape += c.cyl(1.5, 110., (*p, 67.))
    shape += c.cyl(1.5, 18., (p[0]+9., p[1], 120.5), 'x')
    shape = shape.rotate(Axis((*p, 0), (0, 0, 1)), screw_lift/.5*360)
    return old.radial(shape, angle).translate((0, 0, screw_lift+axial))


def drive_key(angle=90., axial=0.):
    p = old.xy(38.5, 225.)
    shape = c.hexagon(4/math.sqrt(3), 7., (*p, 12.))
    shape += c.cyl(2.5, 133., (*p, 82.))
    shape += c.cyl(2.5, 25., (p[0]+12.5, p[1], 146.), 'x')
    return old.radial(shape, angle).translate((0, 0, axial))


DRIVE_TOOL = dict(manufacturer='Wera', part='05021620001', name='950 L, 4 x 140 x 25 mm',
                  source=TOOL['source'], modeled=TOOL['modeled'])


def control_sweeps():
    # Separate ordinary tool paths. Screw is not used as a side-loaded lever.
    p = POINT
    lock_work = c.cyl(2., 118., (*p, 69.))+c.cyl(20., 9., (*p, 123.5))
    lock_full = c.cyl(2., 202., (*p, 111.))+c.cyl(20., 93., (*p, 165.5))
    wedge = c.box(100, 100, 250, (50, 50, 120)).rotate(Axis.Z, 225)
    drive_work = old.ring(35.5, 41.5, 8.5, 148.5)&wedge
    drive_full = old.ring(35.5, 41.5, 8.5, 240.)&wedge
    for a in (225.,315.):
        drive_work += c.cyl(3., 140., (*old.xy(38.5,a),78.5))
        drive_full += c.cyl(3., 231.5, (*old.xy(38.5,a),124.25))
    drive_work += old.ring(10., 67., 143.5, 148.5)
    drive_full += old.ring(10., 67., 143.5, 240.)
    return [('2.5 mm lock key operating envelope', lock_work),
            ('2.5 mm lock key full axial staging', lock_full),
            ('4 mm collar key operating quarter arc', drive_work),
            ('4 mm collar key full axial staging', drive_full)]
