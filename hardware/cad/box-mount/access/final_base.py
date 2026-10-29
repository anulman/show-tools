"""Validate and export the final private rotor base against pinned final-C artifacts."""
from __future__ import annotations
import argparse
from dataclasses import asdict, replace
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import lifted_base as prior
from build123d import Axis, Box, Compound, export_step, extrude, import_step
integration = prior.integration
cad = prior.cad
model = prior.model


def routed_stack(p, box):
    """Propose a floor outlet 25 degrees from front; preserve existing channel size and reserve."""
    base = cad.stack(p, box)
    floor = base['floor_z']
    length = box.level_length
    channel = Box(box.channel_width, length/2+8, box.channel_depth+box.exit_height,
                  align=cad.MIN_Z).translate((0, -length/4+1, floor-box.channel_depth))
    footprint = cad.box_cad.rounded(box.width, length, box.corner_radius,
                                   box.bottom_thickness).translate((0, 0, base['underside_z']))
    base['bottom'] += channel & footprint
    wall = Box(box.channel_width, box.wall, box.exit_height,
               align=cad.MIN_Z).translate((0, -length/2+box.wall/2, floor))
    base['shell'] += wall
    proposed = channel.rotate(Axis.Z, 25)
    base['shell'] -= proposed
    base['bottom'] -= proposed
    base['cable_envelope'] = base['cable_envelope'].rotate(Axis.Z, 25)
    for name in ('shell', 'bottom'):
        integration.require(base[name].is_valid and len(base[name].solids()) == 1,
                            'Cable proposal invalidated '+name)
        integration.require(integration.intersection(base[name], base['cable_envelope']) < 1e-6,
                            'Cable proposal obstructed')
    return base


def make_candidate(p, box, probes):
    base = routed_stack(p, box)
    study = model.make_study('R2-keeper-tabs', p, base)
    model.verify_study(p, base, study)
    band = Box(180, 180, 10.1, align=cad.MIN_Z).translate((0, 0, -10))
    roof, bottom = study['shell'], base['bottom']
    for _, probe in probes:
        roof -= probe & band
        bottom -= probe
    scraps = {}
    for name, part in (('roof', roof), ('bottom', bottom)):
        solids = sorted(part.solids(), key=lambda solid: solid.volume, reverse=True)
        scraps[name] = sum(solid.volume for solid in solids[1:])
        integration.require(scraps[name] < 10, 'Ports detached substantial panel material')
        if name == 'roof':
            roof = solids[0]
        else:
            bottom = solids[0]
    return dict(parameters=p, box_parameters=box, original=base,
                study=dict(study, shell=roof), bottom=bottom, posed_probes=probes,
                removed_detached_port_scraps_mm3=scraps)


def obstacles(candidate):
    base, study = candidate['original'], candidate['study']
    fixed = dict(roof=study['shell'], bottom=candidate['bottom'],
                 spacer=base['spacer'], buffer=base['buffer'],
                 stock_hex=base['stock_hex_keepout'], cable=base['cable_envelope'],
                 ballast=base['ballast_envelope'])
    fixed.update({f'keeper-{i}': part for i, part in enumerate(study['retainers'])})
    fixed.update({f'hardware-{i}': part for i, part in enumerate(study['hardware'])})
    return fixed


def clear_against(named_shapes, fixed, label):
    rows = []
    for name, part in named_shapes:
        overlaps = {key: integration.intersection(part, obstacle) for key, obstacle in fixed.items()}
        integration.require(all(amount < 1e-5 for amount in overlaps.values()),
                            f'{label} blocked: {name}: '+str({k:v for k,v in overlaps.items() if v >= 1e-5}))
        rows.append(dict(name=name, intersections_mm3=overlaps))
    return rows


def withdrawal_against_base(states, candidate, gap):
    """Prove a positive-Z withdrawal using vertical obstacle bounds and roof ports."""
    fixed = obstacles(candidate)
    base = candidate['original']
    rows = []
    start, end = dict(states['released']), dict(states['detached'])
    for name, source in start.items():
        if integration.volume(source-end[name]) < 1e-5 and integration.volume(end[name]-source) < 1e-5:
            continue
        part = integration.pose(source, gap, 45)
        box = part.bounding_box()
        clearance_travel = max(1., max(obstacle.bounding_box().max.Z for obstacle in fixed.values())-box.min.Z+1)
        # Above-roof obstacles are contained in vertical, rotation-invariant bounds.
        bound = cad.ring(candidate['parameters'].contact_inner_radius,
                         candidate['parameters'].contact_outer_radius, gap+300, -300)
        integration.require(integration.intersection(part, bound) < 1e-6,
                            'Withdrawal enters bearing column: '+name)
        for key, obstacle in fixed.items():
            if key in ('spacer', 'buffer'):
                continue
            top = obstacle.bounding_box().max.Z
            if box.min.Z >= top-1e-7:
                continue
            if key.startswith(('keeper-', 'hardware-')):
                column = cad.cyl(33, top+300, -300)
                integration.require(integration.intersection(part, column) < 1e-6,
                                    'Withdrawal enters keeper column: '+name)
                continue
            # Only the portion initially below this obstacle's top can enter it
            # during positive-Z withdrawal. Sweep its actual profiles, avoiding
            # a rectangular bound that fills the captive pin's reliefs.
            band = Box(180, 180, top-box.min.Z+.0001,
                       align=cad.MIN_Z).translate((0, 0, box.min.Z-.0001))
            clipped = part & band
            sweep = clipped
            for face in clipped.faces():
                if face.normal_at().Z > .01:
                    sweep += extrude(face, amount=clearance_travel, dir=(0, 0, 1))
            integration.require(integration.intersection(sweep, obstacle) < 1e-5,
                                f'Cannot prove continuous withdrawal: {name}/{key}')
        rows.append(dict(name=name, positive_z_translation_clear_for_all_distances=True,
                         swept_travel_until_above_all_fixed_obstacles_mm=clearance_travel))
    integration.require(bool(rows), 'No withdrawn actors identified')
    return rows


def run(args):
    args.output.mkdir(parents=True, exist_ok=True)
    target = args.output/'receipt.json'
    target.unlink(missing_ok=True)
    receipt_sha = integration.digest(args.receipt)
    producer = json.loads(args.receipt.read_text())
    integration.require(producer['concept'] == 'final-C', 'Expected final-C producer')
    integration.require(producer['reference_sha256'] == 'f0a21384179b69eff79205032dad536bfa1350e358c25ed0fe01de4189f2e003', 'Wrong source reference')
    for state in producer['states']:
        integration.require(all(state[key] is True for key in
                            ('valid_single_solids', 'preset_exact_boolean_identity',
                             'full_bar_reach_and_far_end', 'inside_original_radius', 'rigid_clearance_pass')),
                            'Producer reports a failed state')
    for key in ('geometry_review_pass', 'operation_geometry_pass', 'component_exports_pass',
                'continuous_pin_and_collar_containing_sweeps_clear', 'tool_engagement_geometry_verified'):
        integration.require(producer[key] is True, 'Failed producer gate: '+key)
    integration.require(bool(producer['checks']) and all(value is True for value in producer['checks'].values()),
                        'Producer operation check failed')
    commit = integration.source_revision(args.source_worktree, args.source_revision, producer['source_code_sha256'])
    transform = producer['box_source_transform']
    integration.require(transform['rotation_x_degrees'] == 180, 'Unsupported frame')
    gap = float(transform['mouth_box_z_mm'])
    p = cad.StackProposal(spacer_height=gap-1)
    box = replace(cad.box_cad.Proposal(), tray_length=20, tray_y=42)
    artifacts = integration.Artifacts()
    states = {state: [(r['name'], artifacts.load(r)) for r in records]
              for state, records in producer['states_components'].items()}
    controls = [(r['name'], integration.pose(artifacts.load(r), gap, 45)) for r in producer['control_sweeps']]
    approaches = [(r['name'], integration.pose(artifacts.load(r), gap, 45))
                  for r in producer['whole_tool_approach_sweeps']]
    integration.require(bool(approaches), 'Complete whole-tool approach required')
    candidate = make_candidate(p, box, controls+approaches)
    checks = prior.verify_candidate(candidate)
    checks['removed_detached_port_scraps_mm3'] = candidate['removed_detached_port_scraps_mm3']
    fixed = obstacles(candidate)
    for key in ('operating_tool_components', 'tool_staging_start_components'):
        actual_tools = [(r['name'], integration.pose(artifacts.load(r), gap, 45)) for r in producer[key]]
        checks[key] = clear_against(actual_tools, fixed, 'Actual '+key)
    checks['whole_tool_entry_and_operation'] = clear_against(controls+approaches, fixed, 'Tool workflow')
    checks['states'] = {state: clear_against([(name, integration.pose(part, gap, 45)) for name,part in parts],
                                            fixed, 'State '+state) for state,parts in states.items()}
    motions = [(r['name'], integration.pose(artifacts.load(r), gap, 45)) for r in producer['moving_actor_sweeps']]
    checks['moving_actor_containing_sweeps'] = clear_against(motions, fixed, 'Moving actor')
    checks['continuous_closed_rotation'] = integration.continuous_closed_check(states['locked'], candidate['original'], candidate['study'], p)
    witness = integration.detachment_witness(states)
    integration.require(witness['evaluated'] and witness['sampled_path_clear'], 'Actual withdrawal witness failed')
    checks['actual_internal_withdrawal_samples'] = witness
    checks['continuous_withdrawal_vs_fixed_base'] = withdrawal_against_base(states, candidate, gap)
    area = 0.
    for record in producer['actual_support_contact_patches']:
        patch = integration.pose(artifacts.load(record), gap)
        integration.require(integration.volume(patch-candidate['original']['buffer']) < 1e-6,
                            'Contact patch escapes buffer')
        area += record['planar_contact_area_mm2']
    checks['actual_contact_area_mm2'] = area
    base, study = candidate['original'], candidate['study']
    parts = dict(shell=study['shell'], bottom=candidate['bottom'], spacer=base['spacer'], buffer=base['buffer'],
                 keeper_tab_0=study['retainers'][0], keeper_tab_1=study['retainers'][1])
    records = []
    for name, part in parts.items():
        stem = args.output/(name+'-PRIVATE-PROPOSAL')
        record = cad.export_part(part, stem)
        for kind in ('step', 'stl'):
            path = stem.with_suffix('.'+kind).resolve()
            record[kind] = str(path)
            record[kind+'_sha256'] = integration.digest(path)
        record.update(name=name, role='unselected low-drag material envelope' if name=='buffer' else 'proposed print geometry')
        records.append(record)
    exported = integration.Artifacts()
    for record in records:
        exported.load(record)
    assembly = Compound(children=[part.solids()[0] for part in [*parts.values(), *study['hardware']]])
    assembly_path = args.output/'assembly-PRIVATE-PROPOSAL.step'
    integration.require(export_step(assembly, assembly_path), 'Assembly export failed')
    restored = import_step(assembly_path)
    integration.require(restored.is_valid and len(restored.solids()) == 10, 'Assembly round trip invalid')
    integration.require(integration.volume(assembly-restored)<1e-6 and integration.volume(restored-assembly)<1e-6,
                        'Assembly STEP material changed')
    artifacts.unchanged()
    exported.unchanged()
    integration.require(integration.digest(args.receipt) == receipt_sha, 'Producer receipt changed')
    sources = (Path(__file__), Path(prior.__file__), Path(integration.__file__), Path(model.__file__),
               Path(cad.__file__), Path(cad.box_cad.__file__))
    report = dict(concept='final-rotor-base', geometry_review_pass=True, review_components=records,
                  scope='HUMAN_REVIEW_PROPOSAL_NOT_MANUFACTURING_APPROVAL', print_readiness='NOT_READY', units='mm',
                  producer_receipt_sha256=receipt_sha, producer_commit=commit,
                  source_code_sha256={path.name:integration.digest(path) for path in sources},
                  proposed_stack_parameters=asdict(p), proposed_box_parameters=asdict(box),
                  cable_exit_direction_proposed='25 degrees from -Y toward +X; routing, cable size and strain relief unconfirmed',
                  box_roof_local_z_mm=0, box_page_translation_z_mm=box.level_top_z,
                  service_lift_mm_proposed=checks['proposed_lift_mm'], checks=checks,
                  validated_input_files=artifacts.files,
                  assembly_step=str(assembly_path.resolve()), assembly_step_sha256=integration.digest(assembly_path),
                  complete_nominal_fixed_base_geometry_pass=True, physical_fit_loads_operator_access_verified=False,
                  upstream_full_withdrawal_continuous_verified=producer['full_withdrawal_continuous_verified'],
                  limits='Full tool entry determines proposed lifting height. Hand access, supported lifting, actual knob/stock-hex fit, material, adhesion, loads and wear require physical review. High-grip cut-stock pads and low-drag buffer are separate unselected materials.')
    target.write_text(json.dumps(report, indent=2)+'\n')
    print(target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt', type=Path, required=True)
    parser.add_argument('--source-worktree', type=Path, required=True)
    parser.add_argument('--source-revision', required=True)
    parser.add_argument('--output', type=Path, required=True)
    run(parser.parse_args())
