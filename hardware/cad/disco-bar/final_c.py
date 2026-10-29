"""Final-C proposal: independent collar and captive push-turn release pin.

Source mouth Z=0; bar extraction is negative Z. This module owns the proposal's
geometry and pose sequence. Earlier C1/C2/C3 remain immutable comparison studies.
"""
from __future__ import annotations
from dataclasses import replace
from . import couplings as old
from build123d import Axis

c = old.c
POINT = old.xy(38.5, 135)
PIN_TRAVEL = 2.0
LOCAL_ANGLE = 45.0
SPANNER_APPROACH = 89.1
DRIVER_APPROACH = 82.6
FORK_APPROACH = 83.1
STATES = {
    'locked': (90., 0., 0., 0.),
    'pin-pushed': (90., -.8, 0., 0.),
    'pin-turned': (90., -.8, 90., 0.),
    'pin-retracted': (90., PIN_TRAVEL, 90., 0.),
    'collar-midway': (45., PIN_TRAVEL, 90., 0.),
    'released': (0., PIN_TRAVEL, 90., 0.),
    'detached': (0., PIN_TRAVEL, 90., -35.),
}


def baseline(reference):
    """Relief is fixed at construction, never a state-dependent clamp change."""
    base = old.pads.build(reference, .2)
    relief = local(c.box(6.8, 6.8, 4, (*POINT, -1)))
    return replace(base, pieces=tuple(c.Piece(p.name, p.shape-relief if p.role=='body' else p.shape, p.role) for p in base.pieces))


def captive_control():
    """Blind vertical lug channel retains the pin even in the released pose."""
    x, y = POINT
    housing = c.box(6, 6, 4.5, (x, y, 5.75))
    housing -= c.cyl(1.05, 8, (x, y, 5.5))
    # Locked X pocket blocks straight pull and turning. Push into the lower
    # chamber, turn into the Y channel, then pull to the blind upper stop.
    housing -= c.box(4.4, 1.4, .8, (x, y, 5.2))
    housing -= c.cyl(2.4, 1.1, (x, y, 4.35))
    housing -= c.box(1.4, 4.4, 2.7, (x, y, 6.15))
    # Cap recess permits the deliberate inward push without a moving roof stem.
    housing -= c.cyl(1.55, 1., (x, y, 7.6))
    pin = c.cyl(.8, 6.5, (x, y, 4.75))
    pin += c.box(4., 1., .6, (x, y, 5.2))
    pin += c.cyl(1.4, .6, (x, y, 8.3))
    pin -= c.box(.8, 2.6, .5, (x, y, 8.5))
    # A separate fastened roof makes the captive pin installable. Install the
    # pin through the open Y channel, then fit this roof over its cap.
    window = c.box(5., 2.8, 1.3, (x-.5, y, 7.55))
    housing -= window
    roof = housing & c.box(10, 10, .5, (x, y, 7.75))
    housing -= c.box(10, 10, 2, (x, y, 8.5))
    hardware = []
    for sign in (-1, 1):
        point = (x+2.1, y+sign*2.1)
        bore = c.cyl(.75, 5, (*point, 7))
        housing -= bore
        roof -= bore
        housing -= c.hexagon(1.35, 1., (*point, 6.3))
        housing -= c.box(4., 2.7, 1., (x+4.1, point[1], 6.3))
        screw = c.cyl(.6, 2.1, (*point, 6.95)) + c.cyl(1.1, .5, (*point, 8.25))
        nut = c.hexagon(1.25, .8, (*point, 6.3)) - c.cyl(.65, 2, (*point, 6.3))
        hardware.extend([c.Piece(f'captive roof screw {sign}', screw, 'standard fastener envelope'),
                         c.Piece(f'captive roof nut {sign}', nut, 'standard fastener envelope')])
    axis = Axis((*POINT, 0), (0, 0, 1))
    hardware = [c.Piece(p.name, p.shape.rotate(axis, 180+LOCAL_ANGLE), p.role) for p in hardware]
    return housing.rotate(axis, 180+LOCAL_ANGLE), roof.rotate(axis, 180+LOCAL_ANGLE), pin.rotate(axis, 180+LOCAL_ANGLE), hardware


def build(reference, state='locked', *, collar=None, push=None, turn=None, lift=None):
    angle, travel, rotation, shift = STATES[state]
    angle = angle if collar is None else collar
    travel = travel if push is None else push
    rotation = rotation if turn is None else turn
    shift = shift if lift is None else lift
    base, bar, carrier, hardware = old.common(reference)
    base = baseline(reference)
    carrier += old.ring(38.8, 42.8, 0, .5) + old.ring(38.8, 42.8, 3.5, 4)
    collar_shape = old.ring(37.8, 39.5, .8, 3.2)
    for sign in (-1, 1):
        collar_shape += c.box(4.6, 6, 2, (sign*36.3, 0, 1.2))
        # Proposed two-pin spanner: blind holes with 0.5 mm bottom floors.
        collar_shape -= c.cyl(1.2, 1.6, (sign*36.3, 0, 1.5))
    collar_shape -= c.cyl(1.05, 7, (*old.xy(38.5, 45), 2))
    collar_shape = old.radial(collar_shape, angle)
    housing, roof, pin, roof_hardware = captive_control()
    carrier += housing
    carrier -= c.cyl(1.05, 8, (*POINT, 5.5))
    pin = pin.rotate(Axis((*POINT, 0), (0, 0, 1)), rotation).translate((0, 0, travel))
    bar -= c.cyl(1.05, 4, (*POINT, -1))
    moving = [c.Piece('full-height bar', bar, 'bar'),
              c.Piece('fixed-to-bar latch carrier', carrier, 'print'),
              c.Piece('quarter-turn retainer', collar_shape, 'print'),
              c.Piece('captive push-turn pin', pin, 'custom fabricated control proposal'),
              c.Piece('fastened captive roof', roof, 'print')] + hardware + roof_hardware
    parts = [c.Piece('preset / '+p.name, p.shape, p.role) for p in base.pieces]
    parts += [c.Piece(p.name, p.shape.translate((0, 0, shift)), p.role) for p in moving]
    controls = [dict(kind='captive slotted push-turn pin', source_xy_mm=list(POINT),
                     closed_cap_source_z_mm=[8., 8.6], released_cap_source_z_mm=[10., 10.6],
                     push_mm=-.8, turn_degrees=90, pull_from_locked_mm=PIN_TRAVEL),
                dict(kind='opposed blind pin-spanner holes', radius_mm=36.3,
                     hole_diameter_mm=2.4, hole_depth_mm=1.5, separation_mm=72.6,
                     collar_degrees=[0, 90], floor_thickness_mm=.5)]
    return old.Prototype('final-C', state, base, parts, shift, controls)


def tools(collar=90., push=0., turn=0.):
    """Proposed actual tools; positive engagement solids, not just probes."""
    driver = c.box(.6, 2.4, .7, (*POINT, 8.6))
    driver += c.cyl(1.4, 86.1, (*POINT, 51.95))
    driver = driver.rotate(Axis((*POINT, 0), (0, 0, 1)), turn+LOCAL_ANGLE).translate((0, 0, push))
    # Bridge and handle stay below the closed box cover. Only the two
    # long off-axis pins enter the box; no tool occupies the encoder axis.
    spanner = c.box(76.4, 3.6, 6, (0, 0, 103.))
    for sign in (-1, 1):
        spanner += c.cyl(1., 100.1, (sign*36.3, 0, 50.95))
    spanner += c.cyl(1.5, 25., (36.3, 0, 117.5))
    fork = c.box(.5, 2.6, .25, (POINT[0]-2.25, POINT[1], 7.875))
    for sign in (-1, 1):
        fork += c.box(3.75, .4, .25, (POINT[0]-.625, POINT[1]+sign*1.1, 7.875))
    fork += c.cyl(.65, 87., (POINT[0]-2.25, POINT[1], 51.25))
    fork = fork.rotate(Axis((*POINT, 0), (0, 0, 1)), 180+LOCAL_ANGLE).translate((0, 0, push))
    return [('slotted pin driver', driver), ('two-pin collar spanner', old.radial(spanner, collar)),
            ('under-head pull fork', fork)]


def access_sweeps():
    # Containing sweeps include actual tools, motion and approach at every pose.
    driver = c.cyl(1.5, 172.15, (*POINT, 93.525))
    spanner = c.cyl(38.25, 95.1, (0, 0, 147.55))
    handle = old.ring(34.8, 37.8, 105., 219.1) & c.box(100, 100, 140, (50, 50, 162.05))
    for angle in (0, 90):
        handle += c.cyl(1.5, 114.1, (*old.xy(36.3, angle), 162.05))
    spanner += handle
    arc = old.ring(35.3, 37.3, .9, 190.1) & c.box(100, 100, 200, (50, 50, 95.5))
    for angle in (0, 90):
        arc += c.cyl(1., 189.2, (*old.xy(36.3, angle), 95.5))
    spanner += arc + old.radial(arc, 180)
    pin_motion = c.box(4.8, 4.8, 11.4, (*POINT, 5.7))
    return [('pin driver motion and approach', driver),
            ('collar spanner motion and approach', spanner),
            ('captive pin containing motion', pin_motion),
            ('fork inward insertion containing sweep', fork_sweeps()[0]),
            ('fork outward pull containing sweep', fork_sweeps()[1]),
            ('fork full axial staging containing sweep', fork_staging_sweep())]


def control_sweeps():
    """STEP-independent box contract for the proposed tools and control travel."""
    return access_sweeps()


def fork_sweeps():
    """Box bounds retain the fork's U opening and avoid round-trip seam ambiguity."""
    x, y = POINT
    insertion = c.box(5., 2.6, .25, (x+4.5, y, 7.075))
    for sign in (-1, 1):
        insertion += c.box(8.25, .4, .25, (x+2.875, y+sign*1.1, 7.075))
    insertion += c.box(5.8, 1.3, 87, (x+4.5, y, 50.45))
    pull = c.box(.5, 2.6, 3.05, (x+2.25, y, 8.475))
    for sign in (-1, 1):
        pull += c.box(3.75, .4, 3.05, (x+.625, y+sign*1.1, 8.475))
    pull += c.box(1.3, 1.3, 89.8, (x+2.25, y, 51.85))
    return local(insertion), local(pull)


def local(shape):
    return shape.rotate(Axis((*POINT, 0), (0, 0, 1)), LOCAL_ANGLE)


def fork_staging_sweep():
    x, y = POINT
    sweep = c.box(5., 2.6, 86.15, (x+4.5, y, 50.025))
    for sign in (-1, 1):
        sweep += c.box(8.25, .4, 86.15, (x+2.875, y+sign*1.1, 50.025))
    sweep += c.box(5.8, 1.3, 172.9, (x+4.5, y, 93.4))
    return local(sweep)
