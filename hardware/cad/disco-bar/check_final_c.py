"""Actual final-C proposal cycle, blocking, engagement and export evidence."""
from __future__ import annotations
import argparse
from dataclasses import replace
import hashlib
import importlib
import json
import math
from pathlib import Path
import sys
from build123d import Axis, extrude
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import disco_bar
m = importlib.import_module('disco-bar.final_c')
p = importlib.import_module('disco-bar.check_couplings')
c = m.c


def named(item):
    return {piece.name: piece.shape for piece in item.parts}


def pose(locked, state, collar=90., push=0., turn=0., lift=0.):
    parts = []
    for piece in locked.parts:
        shape = piece.shape
        if piece.name == 'quarter-turn retainer':
            shape = m.old.radial(shape, collar-90)
        if piece.name == 'captive push-turn pin':
            shape = shape.rotate(Axis((*m.POINT, 0), (0, 0, 1)), turn).translate((0, 0, push))
        if not piece.name.startswith('preset / '):
            shape = shape.translate((0, 0, lift))
        parts.append(c.Piece(piece.name, shape, piece.role))
    return replace(locked, state=state, parts=parts, bar_shift=lift)


def run(step, output):
    output.mkdir(parents=True, exist_ok=True)
    for name in ('receipt.json', 'interface.json'):
        (output/name).unlink(missing_ok=True)
    # Check the STEP-independent service contract before the expensive bar run.
    control = m.control_sweeps()
    for angle in (0, 45, 90):
        for travel in (-.8, 0, 2):
            for index, (_, tool) in enumerate(m.tools(angle, travel, 90)):
                envelope = control[0][1] if index==0 else control[1][1] if index==1 else control[4][1]
                c.assert_empty(tool-envelope, 'Actual tool exceeds its containing sweep')
    for name, shape in control:
        p.export_piece(c.Piece(name, shape, 'temporary containing clearance probe'), output/'access')
    path, reference = disco_bar.load_reference(step)
    disco_bar.verify_full_reference(path, reference)
    locked = m.build(reference)
    expected = locked.baseplate
    original = m.old.pads.build(reference, .2)
    oldbody, newbody = original.pieces[0].shape, expected.pieces[0].shape
    c.assert_empty((oldbody-newbody) & c.cyl(33, 40, (0, 0, -10)), 'Relief altered grip cup')
    for a, b in zip(original.pieces[1:], expected.pieces[1:]):
        c.assert_empty(a.shape-b.shape, 'Clamp component changed')
        c.assert_empty(b.shape-a.shape, 'Clamp component changed')
    checks = []
    exports = {}
    for state, values in m.STATES.items():
        item = pose(locked, state, *values)
        result = p.check_state(reference, item, expected)
        if not all(result[k] for k in ('valid_single_solids', 'inside_original_radius', 'rigid_clearance_pass')):
            raise ValueError(json.dumps(result))
        checks.append(result)
        exports[state] = [p.export_piece(piece, output/'states'/state) for piece in item.parts]
        for record in exports[state]:
            role = record['role']
            record['manufacturing_classification'] = (
                'custom fabricated control proposal' if record['name']=='captive push-turn pin' else
                'stock cut-pad reference envelope' if role=='pad' else
                'standard fastener reference envelope; specification unselected' if 'hardware' in role or 'fastener' in role else
                'printable geometry proposal; material and process unverified')
        print(state, 'PASS', len(item.parts), 'components', flush=True)
    parts = named(locked)
    pin = parts['captive push-turn pin']
    housing = parts['fixed-to-bar latch carrier']
    roof = parts['fastened captive roof']
    collar = parts['quarter-turn retainer']
    axis = Axis((*m.POINT, 0), (0, 0, 1))
    tests = {}
    tests['locked_collar_reverse_blocked'] = c.volume(m.old.radial(collar, -2)&pin)>1e-5
    tests['locked_pin_straight_pull_blocked'] = c.volume(pin.translate((0, 0, .5))&housing)>1e-5
    tests['locked_pin_unpushed_turn_blocked'] = c.volume(pin.rotate(axis, 15)&housing)>1e-5
    openpin = pin.rotate(axis, 90).translate((0, 0, 2))
    tests['released_pin_further_pull_blocked_by_roof'] = c.volume(openpin.translate((0, 0, .25))&roof)>1e-5
    shaftonly = pin-m.local(c.box(4.1, 1.1, .61, (*m.POINT, 5.2)))
    tests['removed_lug_defeats_roof_retention'] = c.volume(shaftonly.rotate(axis, 90).translate((0, 0, 2.25))&roof)<=1e-5
    tests['cap_blocks_excess_push'] = c.volume(pin.translate((0, 0, -1.2))&housing)>1e-5
    pulling = named(pose(locked, 'locked pull attempt', lift=-.4))
    tests['locked_retainer_captures_flange'] = c.volume(pulling['quarter-turn retainer']&newbody)>1e-5
    nofingers = pulling['quarter-turn retainer']&m.old.ring(37.8, 50, -10, 10)
    tests['removed_fingers_defeat_capture'] = c.volume(nofingers&newbody)<=1e-5
    tests['pilot_keys_block_both_torque_directions'] = all(c.volume(parts['full-height bar'].rotate(Axis.Z, a)&newbody)>1e-5 for a in (-2, 2))

    # Continuous containing volumes for every sanctioned pin transition and
    # collar turn. Empty intersections prove clearance between sample points.
    x, y = m.POINT
    shaft = lambda low, high: c.cyl(.8, high-low, (x, y, (low+high)/2))
    cap = lambda low, high: c.cyl(1.4, high-low, (x, y, (low+high)/2))
    pushsweep = shaft(.7, 8) + cap(7.2, 8.6) + m.local(c.box(4, 1, 1.4, (x, y, 4.8)))
    turnsweep = shaft(.7, 7.2) + cap(7.2, 7.8) + c.cyl(math.hypot(2, .5), .6, (x, y, 4.4))
    pullsweep = shaft(.7, 10) + cap(7.2, 10.6) + m.local(c.box(1, 4, 3.4, (x, y, 5.8)))
    collarsweep = m.old.ring(37.8, 39.5, .8, 3.2) + m.old.ring(34, math.hypot(38.6, 3), .2, 2.2)
    continuous = []
    sweeps = [('pin inward push', pushsweep), ('pin pushed quarter turn', turnsweep),
              ('pin outward release', pullsweep), ('collar continuous containing turn', collarsweep)]
    for label, sweep in sweeps:
        targetpose = pose(locked, label, push=2, turn=90) if label.startswith('collar') else locked
        for q in targetpose.parts:
            if q.name in (('quarter-turn retainer',) if label.startswith('collar') else ('captive push-turn pin',)):
                continue
            amount = c.volume(sweep&q.shape)
            if amount>1e-5:
                continuous.append(dict(sweep=label, part=q.name, mm3=amount))
    if continuous:
        raise ValueError('Continuous motion interference '+json.dumps(continuous))
    samples = []
    transitions = [('push', [(90, -.1*i, 0, 0) for i in range(9)], ['captive push-turn pin']),
                   ('turn', [(90, -.8, 5*i, 0) for i in range(19)], ['captive push-turn pin']),
                   ('pull', [(90, -.8+.1*i, 90, 0) for i in range(29)], ['captive push-turn pin']),
                   ('collar', [(2*i, 2, 90, 0) for i in range(46)], ['quarter-turn retainer']),
                   ('withdrawal', [(0, 2, 90, -i) for i in range(36)], None)]
    for label, positions, active in transitions:
        for values in positions:
            item = pose(locked, label, *values)
            p.frozen_preset(item, expected)
            hits = []
            for a in item.parts:
                if active and a.name not in active:
                    continue
                if active is None and a.name.startswith('preset / '):
                    continue
                for b in item.parts:
                    if active is None and not b.name.startswith('preset / '):
                        continue
                    if a.name==b.name:
                        continue
                    amount = c.volume(a.shape&b.shape)
                    if amount>1e-5:
                        hits.append(dict(a=a.name, b=b.name, mm3=amount))
            if hits:
                raise ValueError(label+' '+str(values)+' '+json.dumps(hits))
        samples.append(dict(transition=label, count=len(positions), all_clear=True))
        print(label, len(positions), 'intermediate poses PASS', flush=True)
    # The inward housing is the only carrier material within the flange bound.
    radialbound = c.cyl(37.2, 200, (0, 0, -50))
    housingbox = m.local(c.box(6, 6, 4.5, (*m.POINT, 5.75)))
    c.assert_empty((housing&radialbound)-housingbox, 'Unexpected inward carrier material')
    housingwithdrawal = m.local(c.box(6, 6, 39.5, (*m.POINT, -11.75)))
    c.assert_empty(housingwithdrawal&newbody, 'Continuous housing withdrawal blocked')
    tests['continuous_diagnosed_housing_withdrawal_clear'] = True

    # Operator tool geometry is checked against real solids. Engagement tests
    # deliberately perturb a tool into its intended wall or bearing face.
    tool_exports = []
    tool_checks = []
    for label, values in [('driver locked', (90, 0, 0)), ('driver pushed', (90, -.8, 0)),
                          ('driver turned', (90, -.8, 90)), ('fork pushed', (90, -.8, 90)),
                          ('fork released', (90, 2, 90)), ('spanner locked', (90, 2, 90)),
                          ('spanner midway', (45, 2, 90)), ('spanner released', (0, 2, 90))]:
        angle, travel, rotation = values
        item = pose(locked, label, collar=angle, push=travel, turn=rotation)
        index = 2 if label.startswith('fork') else 1 if label.startswith('spanner') else 0
        name, tool = m.tools(angle, travel, rotation)[index]
        hits = [q.name for q in item.parts if c.volume(q.shape&tool)>1e-5]
        if hits:
            raise ValueError(label+' tool interference '+str(hits))
        tool_exports.append(p.export_piece(c.Piece(label, tool, 'custom temporary tool proposal; fabrication required'), output/'tools'))
        tool_checks.append(dict(pose=label, rigid_clearance=True))
    driver, spanner, fork = [shape for _, shape in m.tools()]
    tests['slot_driver_transmits_torque'] = c.volume(driver.rotate(axis, 8)&pin)>1e-5
    tests['slot_driver_transmits_inward_push'] = c.volume(driver.translate((0, 0, -.1))&pin)>1e-5
    tests['fork_bears_under_cap_for_pull'] = c.volume(fork.translate((0, 0, .1))&pin)>1e-5
    tests['spanner_pin_sidewalls_transmit_torque'] = c.volume(m.old.radial(spanner, 1)&collar)>1e-5
    tests['spanner_hole_floor_rejects_overinsertion'] = c.volume(spanner.translate((0, 0, -.5))&collar)>1e-5
    for dx in (4.5, 3, 1.5, 0):
        tool = m.tools(push=-.8, turn=90)[2][1].translate((dx/math.sqrt(2), dx/math.sqrt(2), 0))
        target = pose(locked, 'fork insertion', push=-.8, turn=90)
        if any(c.volume(tool&q.shape)>1e-5 for q in target.parts):
            raise ValueError('Fork insertion blocked '+str(dx))
    tests['fork_side_insertion_samples_clear'] = True

    # Nut loading is from the explicit side channels, before the screws.
    for sign in (-1, 1):
        nut = parts[f'captive roof nut {sign}']
        for dx in (0, .1, .25, .5, 1, 2, 3, 4):
            c.assert_empty(nut.translate((-dx/math.sqrt(2), -dx/math.sqrt(2), 0))&housing, 'Roof nut insertion blocked')
    for dz in (0, .1, .5, 1, 2, 3):
        c.assert_empty(roof.translate((0, 0, dz))&pin, 'Roof cannot pass over pin cap')
    tests['roof_and_nut_assembly_samples_clear'] = True
    # Continuous temporary-tool sweeps, excluding the actuated part only.
    tool_sweeps = m.control_sweeps()
    for label, sweep, excluded, target in (
        ('driver containing sweep', tool_sweeps[0][1], 'captive push-turn pin', locked),
        ('spanner containing sweep', tool_sweeps[1][1], 'quarter-turn retainer', pose(locked, 'tool turn', push=2, turn=90))):
        for q in target.parts:
            if q.name != excluded:
                c.assert_empty(sweep&q.shape, label+' strikes '+q.name)
    # The fork insertion sweep includes its full U-shaped tip and vertical stem.
    fork_insert, fork_pull = m.fork_sweeps()
    for q in pose(locked, 'fork insertion sweep', push=-.8, turn=90).parts:
        c.assert_empty(fork_insert&q.shape, 'Continuous fork insertion strikes '+q.name)
    for q in locked.parts:
        if q.name != 'captive push-turn pin':
            c.assert_empty(fork_pull&q.shape, 'Continuous fork pull strikes '+q.name)
    tests['continuous_tool_approach_and_motion_clear'] = True

    staging_exports = []
    for index, travel, label in ((0, m.DRIVER_APPROACH, 'driver axial staging'),
                                  (1, m.SPANNER_APPROACH, 'spanner axial staging'),
                                  (2, m.FORK_APPROACH, 'fork axial staging')):
        target = pose(locked, label, push=2, turn=90) if index==1 else locked if index==0 else pose(locked, label, push=-.8, turn=90)
        tool = m.tools(90, 0 if index==0 else 2 if index==1 else -.8, 0 if index==0 else 90)[index][1]
        if index==2:
            tool = tool.translate((4.5/math.sqrt(2), 4.5/math.sqrt(2), 0))
        for dz in (0, .1, 1, 5, 20, 40, travel):
            shifted = tool.translate((0, 0, dz))
            approach_index = (0, 1, 5)[index]
            c.assert_empty(shifted-control[approach_index][1], label+' exceeds full approach envelope')
            for q in target.parts:
                c.assert_empty(shifted&q.shape, label+' strikes '+q.name)
        staging_exports.append(p.export_piece(c.Piece(label, tool.translate((0, 0, travel)), 'complete temporary tool at axial staging start'), output/'tools'))
    tests['full_axial_tool_entry_samples_clear_of_rotor'] = True
    tests['whole_tool_entry_components_inside_containing_sweeps'] = True

    if not all(tests.values()):
        raise ValueError('Failed named checks '+json.dumps(tests))
    # STEP-independent control sweeps are for box validation, not collision-free
    # internal-motion claims: the tools intentionally enter their own holes.
    access = [p.export_piece(c.Piece(name, shape, 'temporary containing clearance probe'), output/'access') for name, shape in m.control_sweeps()]
    motion = [p.export_piece(c.Piece(name, shape, 'continuous moving actor containing sweep'), output/'motion') for name, shape in sweeps]
    contacts = []
    clip = m.old.ring(43, 45.5, -.2, .2)
    for face in parts['full-height bar'].faces():
        bb = face.bounding_box()
        if abs(bb.min.Z)<1e-6 and abs(bb.max.Z)<1e-6:
            patch = face&clip
            if patch:
                for f in patch.faces():
                    if f.area>1e-6:
                        solid = extrude(f, amount=.1 if f.normal_at().Z>0 else -.1)
                        entry = p.export_piece(c.Piece(f'actual contact patch {len(contacts)}', solid, 'contact analysis extrusion'), output/'contact')
                        entry['planar_contact_area_mm2'] = f.area
                        contacts.append(entry)
    report = dict(geometry_review_pass=True, review_components=exports['locked'], concept='final-C', scope='HUMAN_REVIEW_PROPOSAL_NOT_MANUFACTURING_APPROVAL',
                  operation_geometry_pass=True, component_exports_pass=True,
                  states=checks, states_components=exports, checks=tests,
                  continuous_pin_and_collar_containing_sweeps_clear=True,
                  motion_samples=samples, full_withdrawal_continuous_verified=False,
                  tool_engagement_geometry_verified=True, operator_ergonomics_verified=False,
                  tools=tool_exports, full_approach_tool_components=staging_exports, tool_pose_checks=tool_checks,
                  full_tool_approach_source_z_max_mm=219.1,
                  proposed_tool_staging_tip_source_z_min_mm=90.,
                  service_lift_required_from_actual_cover=True,
                  tool_approach_translations_mm=dict(spanner=m.SPANNER_APPROACH, driver=m.DRIVER_APPROACH, fork=m.FORK_APPROACH),
                  controls=locked.controls, control_sweeps=access, moving_actor_sweeps=motion,
                  whole_tool_approach_sweeps=[access[i] for i in (0, 1, 5)],
                  operating_tool_components=tool_exports,
                  tool_staging_start_components=staging_exports,
                  tool_entry_contract=dict(
                      source_axis='positive Z is withdrawal to underside; insertion reverses that motion',
                      starting_tip_reference_source_z_mm=90.,
                      spanner_full_axial_translation_mm=m.SPANNER_APPROACH,
                      driver_full_axial_translation_mm=m.DRIVER_APPROACH,
                      fork_full_axial_translation_mm=m.FORK_APPROACH,
                      fork_side_entry_mm=4.5, fork_side_entry_direction_degrees=m.LOCAL_ANGLE,
                      source_z_max_mm=219.1,
                      lift_rule='source_z_max minus actual cover source Z plus proposed table clearance',
                      ergonomics_verified=False),
                  actual_support_contact_patches=contacts,
                  preset_exact_boolean_identity=True, original_grip_cup_and_all_pad_settings_preserved=True,
                  box_source_transform=dict(rotation_x_degrees=180, mouth_box_z_mm=9),
                  closed_rotation_angles_for_box_check_degrees=list(range(0, 360, 5)),
                  proposed_closed_max_source_z_mm=8.6,
                  reference_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                  source_code_sha256={Path(f).name:hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in
                      (m.__file__, m.old.__file__, m.old.pads.__file__, m.old.pads.previous.__file__, c.__file__, p.__file__, disco_bar.__file__, __file__)},
                  limits='Geometry only. Actual hardware, material, fits, strength, adhesion, service ergonomics and installed knob height remain unverified. All box/stock-hex/keeper/table/tool integration checks are external to this receipt.')
    for filename in ('receipt.json', 'interface.json'):
        (output/filename).write_text(json.dumps(report, indent=2)+'\n')
    return report


if __name__=='__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--step', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = run(args.step, args.output)
    print('final-C geometry checks PASS', result['checks'])
