"""Private closed-cover service ports for the operator-authorized lifted-box workflow."""
from __future__ import annotations
import argparse
from dataclasses import replace
import hashlib
import json
import math
from pathlib import Path
from types import SimpleNamespace
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))
import integrate_receipt as integration
from build123d import Box,Compound,export_step,import_step
cad=integration.cad
model=integration.model


def make_candidate(p,box_parameters,posed_probes):
    base=cad.stack(p,box_parameters)
    study=model.make_study('R2-keeper-tabs',p,base)
    model.verify_study(p,base,study)
    roof=study['shell']
    roof_band=Box(180,180,10.1,align=cad.MIN_Z).translate((0,0,-10))
    bottom=base['bottom']
    for _,probe in posed_probes:
        roof=roof-(probe & roof_band)
        bottom=bottom-probe
    return dict(parameters=p,box_parameters=box_parameters,original=base,
                study=dict(study,shell=roof),bottom=bottom,posed_probes=posed_probes)


def verify_candidate(candidate,lift_mm=None):
    p=candidate['parameters'];box=candidate['box_parameters'];base=candidate['original']
    study=candidate['study'];bottom=candidate['bottom'];roof=study['shell']
    for name,part in (('roof',roof),('bottom',bottom)):
        integration.require(part.is_valid and len(part.solids())==1 and part.volume>0,f'Invalid/disconnected ported {name}')
    # The original cover's four corner mounting regions must be unchanged.
    protected=[]
    for x,y in base['fastener_axes']:
        region=cad.cyl(box.boss_radius,box.bottom_thickness,base['underside_z']).translate((x,y,0))
        removed=integration.volume((base['bottom'] & region)-bottom)
        integration.require(removed<1e-6,'Service ports removed a cover fastener seat')
        protected.append(dict(axis_xy_mm=[x,y],removed_material_mm3=removed))
    floor_region=Box(box.tray_width,box.tray_length,box.bottom_thickness,align=cad.MIN_Z).translate((0,box.tray_y,base['underside_z']))
    integration.require(integration.volume((base['bottom'] & floor_region)-bottom)<1e-6,'Service ports opened the ballast floor')
    centre=cad.cyl(33,12,-10)
    original_roof=model.make_study('R2-keeper-tabs',p,base)['shell']
    integration.require(integration.volume((original_roof & centre)-roof)<1e-6,'Roof ports removed central mounting support')
    bearing=cad.ring(p.contact_inner_radius,p.contact_outer_radius,1,-.5)
    integration.require(integration.volume((original_roof & bearing)-roof)<1e-6,'Roof ports removed spacer support')
    reactions=model.verify_fasteners(study)
    integration.require(integration.intersection(roof,bottom)<1e-6,'Ported bottom interferes with shell')
    integration.require(math.isclose(bottom.bounding_box().max.Z,roof.bounding_box().min.Z,abs_tol=1e-6),'Cover/shell separation plane changed')
    # With the entire cover below the shell's minimum Z, downward withdrawal
    # stays clear for every distance, not just selected endpoint poses.
    fixed={'roof':roof,'bottom':bottom,'spacer':base['spacer'],'buffer':base['buffer']}
    fixed.update({f'keeper-{i}':part for i,part in enumerate(study['retainers'])})
    fixed.update({f'keeper-hardware-{i}':part for i,part in enumerate(study['hardware'])})
    lowest=min(probe.bounding_box().min.Z for _,probe in candidate['posed_probes'])
    minimum=max(0.,base['underside_z']-lowest)
    proposed=math.ceil((minimum+5)/5)*5 if lift_mm is None else lift_mm
    integration.require(math.isfinite(proposed) and proposed>=0,'Lift must be finite and nonnegative')
    table=Box(200,200,15,align=cad.MIN_Z).translate((0,0,base['underside_z']-15))
    lifted_table=table.translate((0,0,-proposed))
    probes=[]
    for name,probe in candidate['posed_probes']:
        blocked={name:integration.intersection(probe,part) for name,part in fixed.items()}
        blocked.update(cable_envelope=integration.intersection(probe,base['cable_envelope']),
                       ballast_envelope=integration.intersection(probe,base['ballast_envelope']))
        integration.require(all(value<1e-5 for value in blocked.values()),'A supplied probe is blocked with the cover installed')
        lifted_overlap=integration.intersection(probe,lifted_table)
        integration.require(lifted_overlap<1e-5,'Proposed lift still leaves a supplied probe inside the table')
        probes.append(dict(name=name,closed_cover_intersections_mm3=blocked,
                           original_cover_intersection_mm3=integration.intersection(probe,base['bottom']),
                           unlifted_table_intersection_mm3=integration.intersection(probe,table),
                           lifted_table_intersection_mm3=lifted_overlap))
    integration.require(any(row['unlifted_table_intersection_mm3']>1e-5 for row in probes),'Baseline tabletop obstruction was not reproduced')
    integration.require(any(row['original_cover_intersection_mm3']>1e-5 for row in probes),'Bottom ports have no measured service-path effect')
    return dict(service_index_degrees=45,operator_allows_lifting=True,
                keeping_cover_installed_is_design_proposal_not_operator_requirement=True,
                cover_single_connected_solid=True,cover_fastener_regions=protected,
                ballast_floor_preserved=True,central_mount_and_spacer_support_preserved=True,
                keeper_fastener_reactions=reactions,cover_downward_withdrawal_clear=True,
                supplied_probes_clear_with_cover_installed=True,baseline_tabletop_still_blocks=True,
                lowest_probe_z_mm=lowest,exterior_bottom_z_mm=base['underside_z'],
                minimum_lift_for_probe_geometry_mm=minimum,proposed_lift_mm=proposed,
                minimum_probe_to_lifted_table_gap_mm=lowest-(base['underside_z']-proposed),
                probes=probes,hand_ergonomics_stability_tool_engagement_verified=False)


def run(args):
    args.output.mkdir(parents=True,exist_ok=True)
    target=args.output/'receipt.json';target.unlink(missing_ok=True)
    # Reproduce and preserve all earlier open-cover/table-blocked comparisons.
    baseline_dir=args.output/'baseline'
    integration.integrate(SimpleNamespace(receipt=args.receipt,source_worktree=args.source_worktree,
                                          source_revision=args.source_revision,output=baseline_dir))
    baseline_path=baseline_dir/'receipt.json';baseline=json.loads(baseline_path.read_text())
    producer=json.loads(args.receipt.read_text());artifacts=integration.Artifacts()
    p=cad.StackProposal(**baseline['box_stack_parameters_proposed'])
    box=replace(cad.box_cad.Proposal(),tray_length=20,tray_y=42)
    probes=[(record['name'],integration.pose(artifacts.load(record),p.bar_mouth_z,45)) for record in producer['control_sweeps']]
    candidate=make_candidate(p,box,probes)
    checks=verify_candidate(candidate)
    baseline_roof=import_step(baseline_dir/'ports-index45-ballast-shortened'/'roof-PRIVATE-PROPOSAL.step').solids()[0]
    integration.require(integration.volume(candidate['study']['shell']-baseline_roof)<1e-6 and integration.volume(baseline_roof-candidate['study']['shell'])<1e-6,'Closed-cover candidate changed the checked roof')
    original=candidate['original'];study=candidate['study']
    parts=dict(shell=study['shell'],bottom=candidate['bottom'],spacer=original['spacer'],buffer=original['buffer'],
               keeper_tab_0=study['retainers'][0],keeper_tab_1=study['retainers'][1])
    records={name:cad.export_part(part,args.output/f'{name}-PRIVATE-PROPOSAL') for name,part in parts.items()}
    records['buffer']['role']='material envelope; printing not recommended by this study'
    assembly=Compound(children=[part.solids()[0] for part in [*parts.values(),*study['hardware']]])
    path=args.output/'assembly-PRIVATE-PROPOSAL.step'
    integration.require(export_step(assembly,path),'Lifted-base assembly export failed')
    restored=import_step(path)
    integration.require(restored.is_valid and len(restored.solids())==10,'Lifted-base assembly round trip invalid')
    integration.require(integration.volume(assembly-restored)<1e-6 and integration.volume(restored-assembly)<1e-6,'Lifted-base STEP material changed')
    for file,sha in baseline['validated_input_files'].items():
        integration.require(integration.digest(Path(file))==sha,'Actual input changed after baseline validation')
    artifacts.unchanged()
    integration.require(integration.digest(args.receipt)==baseline['producer_receipt_sha256'],'Producer receipt changed after baseline validation')
    report=dict(scope='PRIVATE_LIFTED_CLOSED_COVER_BASE_CANDIDATE',units='mm',print_readiness='NOT_READY',
                producer_receipt_sha256=baseline['producer_receipt_sha256'],producer_commit=baseline['producer_commit'],
                baseline_receipt_sha256=integration.digest(baseline_path),baseline_comparisons=baseline['access_options'],
                upstream_latch_lift_witness=baseline['actual_endpoint_derived_lift_witness'],
                complete_latch_workflow_approved=False,checks=checks,parts=records,
                assembly_step_sha256=integration.digest(path),
                source_sha256={path.name:integration.digest(path) for path in (Path(__file__),Path(integration.__file__),Path(model.__file__),Path(cad.__file__),Path(cad.box_cad.__file__))},
                proposed_box_parameters=integration.asdict(box),proposed_stack_parameters=integration.asdict(p),
                limits='Authorized lifting resolves the table-entry geometry gate for the proposed lift only. Actual hand access, grasp/stability, tool engagement, stock-hex/knob fit and upstream latch operation remain unverified. No viewer published.')
    target.write_text(json.dumps(report,indent=2)+'\n');print(target)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt',type=Path,required=True)
    parser.add_argument('--source-worktree',type=Path,required=True)
    parser.add_argument('--source-revision',required=True)
    parser.add_argument('--output',type=Path,required=True)
    run(parser.parse_args())


if __name__=='__main__':main()
