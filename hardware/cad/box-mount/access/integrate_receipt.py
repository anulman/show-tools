"""Validate actual private latch exports against independent box-access candidates."""
from __future__ import annotations
import argparse
from dataclasses import asdict,replace
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import sys

import numpy as np
import trimesh
from build123d import Align,Axis,Box,import_step
sys.path.insert(0,str(Path(__file__).resolve().parent))
import retention_studies as model
cad=model.cad


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def volume(shape):
    return sum(s.volume for s in shape.solids()) if shape is not None else 0.


def require(condition,message):
    if not condition:
        raise ValueError(message)


def source_revision(worktree,revision,expected):
    require(bool(re.fullmatch('[0-9a-fA-F]{7,40}',revision)),'Use an immutable hexadecimal commit ID')
    commit=subprocess.check_output(['git','-C',str(worktree),'rev-parse','--verify',revision+'^{commit}'],text=True).strip()
    for name,sha in expected.items():
        require(Path(name).name==name,'Source manifest names must be basenames')
        relative='hardware/cad/'+('' if name=='disco_bar.py' else 'disco-bar/')+name
        data=subprocess.check_output(['git','-C',str(worktree),'show',commit+':'+relative])
        require(hashlib.sha256(data).hexdigest()==sha,f'Producer source/receipt mismatch: {name}')
    return commit


class Artifacts:
    def __init__(self):
        self.shapes={}
        self.meshes={}
        self.files={}

    def load(self,record):
        paths={kind:Path(record[kind]) for kind in ('step','stl')}
        for kind,path in paths.items():
            sha=digest(path)
            require(sha==record[kind+'_sha256'],f'Changed {kind} artifact: {record["name"]}')
            self.files[str(path)]=sha
        key=record['step_sha256']
        if key not in self.shapes:
            part=import_step(paths['step'])
            require(part.is_valid and len(part.solids())==1 and part.volume>0,'Invalid actual STEP component')
            # STEP may return an assembly Compound whose child locations are
            # not followed by posed Boolean operations. Normalize before posing.
            self.shapes[key]=part.solids()[0]
        part=self.shapes[key]
        mesh_key=record['stl_sha256']
        if mesh_key not in self.meshes:
            mesh=trimesh.load_mesh(paths['stl'])
            require(isinstance(mesh,trimesh.Trimesh) and mesh.is_watertight and mesh.is_winding_consistent and mesh.volume>0,'Invalid actual STL component')
            self.meshes[mesh_key]=(float(mesh.volume),mesh.bounds.copy())
        mesh_volume,mesh_bounds=self.meshes[mesh_key]
        require(math.isclose(mesh_volume,part.volume,rel_tol=.005),'Actual STEP/STL volumes disagree')
        bounds=part.bounding_box()
        expected=[[bounds.min.X,bounds.min.Y,bounds.min.Z],[bounds.max.X,bounds.max.Y,bounds.max.Z]]
        require(np.allclose(mesh_bounds,expected,atol=.05,rtol=0),'Actual STEP/STL bounds disagree')
        require(math.isclose(part.volume,record['volume_mm3'],rel_tol=1e-6),'Actual component disagrees with receipt volume')
        return part

    def unchanged(self):
        for name,sha in self.files.items():
            require(digest(Path(name))==sha,'Input artifact changed during integration')


def pose(shape,gap,angle=0):
    return shape.rotate(Axis.X,180).translate((0,0,gap)).rotate(Axis.Z,angle)


def intersection(first,second):
    a,b=first.bounding_box(),second.bounding_box()
    if any(getattr(a.max,k)<=getattr(b.min,k)+1e-7 or getattr(b.max,k)<=getattr(a.min,k)+1e-7 for k in ('X','Y','Z')):
        return 0.
    return volume(first & second)


def continuous_closed_check(components,base,study,p):
    fixed=[*study['retainers'],*study['hardware']]
    low=min(s.bounding_box().min.Z for s in fixed)
    high=max(s.bounding_box().max.Z for s in fixed)
    bound=cad.cyl(33,high-low,low)
    require(all(volume(part-bound)<1e-6 for part in fixed),'Fixed keeper escaped R33 envelope')
    annulus=cad.ring(p.contact_inner_radius,p.contact_outer_radius,p.bar_mouth_z)
    checks=[]
    for name,part in components:
        physical=pose(part,p.bar_mouth_z)
        require(physical.bounding_box().min.Z>0,'Closed rotating component crosses roof')
        require(intersection(physical,bound)<1e-6,f'Closed actor enters R33 keeper envelope: {name}')
        require(intersection(physical,annulus)<1e-6,f'Closed actor enters stationary bearing annulus: {name}')
        checks.append(dict(name=name,minimum_z_mm=physical.bounding_box().min.Z))
    return dict(continuous_rotation_degrees=360,roof_clear=True,keeper_bound_clear=True,
                spacer_buffer_bound_clear=True,actor_checks=checks,
                method='Rotation-invariant CAD cylinder/annulus containment and separation; paired STL integrity checked independently')


def detachment_witness(states):
    """Derive a pure axial bar-lift test from actual released/detached artifacts.

    Clear samples cannot certify a full path. An intermediate overlap does refute
    operability despite clear endpoints, independently of producer status flags.
    """
    if not all(name in states for name in ('released','detached')):
        return dict(evaluated=False,continuous_path_verified=False)
    start=dict(states['released']);end=dict(states['detached'])
    require(set(start)==set(end),'Released/detached component identities changed')
    static=[];moving=[];unclassified=[];translations=[]
    def equal(a,b):
        return volume(a-b)<1e-5 and volume(b-a)<1e-5
    for name,part in start.items():
        if equal(part,end[name]):
            static.append((name,part))
            continue
        first,second=part.bounding_box(),end[name].bounding_box()
        delta=tuple((getattr(second.min,k)+getattr(second.max,k)-getattr(first.min,k)-getattr(first.max,k))/2 for k in ('X','Y','Z'))
        if abs(delta[0])<1e-6 and abs(delta[1])<1e-6 and delta[2]<0 and equal(part.translate(delta),end[name]):
            moving.append((name,part));translations.append(delta[2])
        else:
            unclassified.append(name)
    shift=translations[0] if translations else None
    if shift is None or not all(math.isclose(value,shift,abs_tol=1e-6) for value in translations):
        unclassified.append('no single rigid axial translation')
    witnesses=[]
    fractions=(0,1/35,2/35,3/35,4/35,5/35,6/35,7/35,8/35,10/35,15/35,20/35,25/35,30/35,1)
    distances=[-shift*fraction for fraction in fractions] if shift is not None else []
    if not unclassified:
        for distance in distances:
            for name,part in moving:
                moved=part.translate((0,0,-distance))
                for fixed_name,obstacle in static:
                    amount=intersection(moved,obstacle)
                    if amount>1e-5:
                        witnesses.append(dict(source_bar_lift_mm=distance,moving=name,stationary=fixed_name,volume_mm3=amount))
    return dict(evaluated=not unclassified,endpoint_inferred_source_translation_mm=shift,
                sampled_lift_distances_mm=distances,moving_piece_count=len(moving),
                static_piece_count=len(static),unclassified=unclassified,
                intermediate_intersections=witnesses,sampled_path_clear=not witnesses and not unclassified,
                continuous_path_verified=False)


def access_option(p,box_parameters,probes,state_parts,angle,cut_ports):
    base=cad.stack(p,box_parameters)
    study=model.make_study('R2-keeper-tabs',p,base)
    model.verify_study(p,base,study)
    original=study['shell']
    tool_shapes=[(name,pose(shape,p.bar_mouth_z,angle)) for name,shape in probes]
    roof_band=Box(180,180,10.1,align=cad.MIN_Z).translate((0,0,-10))
    roof=original
    if cut_ports:
        for _,tool in tool_shapes:
            roof=roof-(tool & roof_band)
    require(roof.is_valid and len(roof.solids())==1,'Ports disconnected or invalidated the fixed roof')
    # Preserve the entire stationary mounting/keeper region, not just one seat sample.
    centre=cad.cyl(33,12,-10)
    require(volume((original & centre)-roof)<1e-6,'Access ports removed central mount/keeper support')
    bearing=cad.ring(p.contact_inner_radius,p.contact_outer_radius,1,-.5)
    require(volume((original & bearing)-roof)<1e-6,'Access ports removed spacer support')
    changed=dict(study,shell=roof)
    reactions=model.verify_fasteners(changed)
    fixed={'roof':roof,'bottom':base['bottom'],'spacer':base['spacer'],'buffer':base['buffer']}
    fixed.update({f'keeper-{i}':part for i,part in enumerate(study['retainers'])})
    fixed.update({f'keeper-hardware-{i}':part for i,part in enumerate(study['hardware'])})
    state_collisions=[]
    for state,parts in state_parts.items():
        for name,part in parts:
            physical=pose(part,p.bar_mouth_z,angle)
            for fixed_name,obstacle in fixed.items():
                amount=intersection(physical,obstacle)
                if amount>1e-5:
                    state_collisions.append(dict(state=state,actor=name,obstacle=fixed_name,volume_mm3=amount))
    table=Box(200,200,15,align=cad.MIN_Z).translate((0,0,base['underside_z']-15))
    tools=[]
    for name,tool in tool_shapes:
        blocked={key:intersection(tool,part) for key,part in fixed.items() if key!='bottom'}
        blocked.update(cable_envelope=intersection(tool,base['cable_envelope']),
                       ballast_envelope=intersection(tool,base['ballast_envelope']))
        tools.append(dict(name=name,with_bottom_removed_intersections_mm3={k:v for k,v in blocked.items() if v>1e-5},
                          table_intersection_mm3=intersection(tool,table)))
    return dict(service_index_degrees=angle,roof_ports_cut=cut_ports,roof_single_connected_solid=True,
                central_mount_and_spacer_support_preserved=True,fastener_reactions=reactions,
                state_component_collisions=state_collisions,temporary_tool_clearance=tools,
                tooling_clear_inside_open_box=all(not t['with_bottom_removed_intersections_mm3'] for t in tools),
                tabletop_entry_blocked=any(t['table_intersection_mm3']>1e-5 for t in tools),
                actual_tool_engagement_or_operator_reach_verified=False,
                box_parameters_proposed=asdict(box_parameters),
                ballast_parameters_proposed=dict(width=box_parameters.tray_width,length=box_parameters.tray_length,
                                                 centre_y=box_parameters.tray_y,height=box_parameters.tray_height)),base,changed


def integrate(args):
    args.output.mkdir(parents=True,exist_ok=True)
    target=args.output/'receipt.json'
    target.unlink(missing_ok=True)
    receipt_hash=digest(args.receipt)
    producer=json.loads(args.receipt.read_text())
    require(producer['reference_sha256']=='f0a21384179b69eff79205032dad536bfa1350e358c25ed0fe01de4189f2e003','Wrong original source')
    commit=source_revision(args.source_worktree,args.source_revision,producer['source_code_sha256'])
    for state in producer['states']:
        require(all(state[key] is True for key in ('valid_single_solids','preset_exact_boolean_identity','full_bar_reach_and_far_end','inside_original_radius','rigid_clearance_pass')),'Producer reports a failed actual state')
    for name in ('locked_pull_off_rejected','locked_reverse_action_rejected','pilot_keys_block_both_torque_directions'):
        require(producer[name] is True,f'Producer required operation check failed: {name}')
    transform=producer['box_source_transform']
    require(transform['rotation_x_degrees']==180,'Unsupported source frame')
    gap=float(transform['mouth_box_z_mm'])
    p=cad.StackProposal(spacer_height=gap-1)
    artifacts=Artifacts()
    states={state:[(r['name'],artifacts.load(r)) for r in records] for state,records in producer['states_components'].items()}
    probes=[(r['name'],artifacts.load(r)) for r in producer['control_sweeps']]
    contacts=[(r,artifacts.load(r)) for r in producer['actual_support_contact_patches']]
    nominal=cad.box_cad.Proposal()
    base=cad.stack(p,nominal)
    keeper=model.make_study('R2-keeper-tabs',p,base)
    closed=continuous_closed_check(states['locked'],base,keeper,p)
    lift=detachment_witness(states)
    patch_area=0.
    for record,patch in contacts:
        placed=pose(patch,gap)
        require(volume(placed-base['buffer'])<1e-6,'Actual contact patch escapes buffer footprint or plane')
        patch_area+=record['planar_contact_area_mm2']
    annular_area=math.pi*(p.contact_outer_radius**2-p.contact_inner_radius**2)
    options={}
    definitions=(('unported-nominal',nominal,0,False),('ports-index0',nominal,0,True),
                 ('ports-index45-ballast-shortened',replace(nominal,tray_length=20,tray_y=42),45,True))
    for name,box_parameters,angle,cut in definitions:
        record,option_base,option_study=access_option(p,box_parameters,probes,states,angle,cut)
        options[name]=record
        if cut:
            record['roof_export']=cad.export_part(option_study['shell'],args.output/name/'roof-PRIVATE-PROPOSAL')
    artifacts.unchanged()
    require(digest(args.receipt)==receipt_hash,'Producer receipt changed during integration')
    report=dict(scope='PRIVATE_ACTUAL_LATCH_BOX_INTEGRATION',concept=producer['concept'],print_readiness='NOT_READY',
        producer_commit=commit,producer_receipt_sha256=receipt_hash,source_code_sha256=producer['source_code_sha256'],
        integration_sources_sha256={path.name:digest(path) for path in (Path(__file__),Path(model.__file__),Path(cad.__file__),Path(cad.box_cad.__file__))},
        box_stack_parameters_proposed=asdict(p),units='mm',
        validated_input_files=artifacts.files,actual_STEP_STL_records=sum(len(v) for v in producer['states_components'].values())+len(probes)+len(contacts),
        geometry_clearance_basis='Actual STEP normalized to single-solid handles before posing; every paired STL hash, watertightness, winding, volume and bounds independently checked',
        producer_validation_scope='posed states and reported operation tests; continuous release path not established',
        continuous_latch_operation_verified=False,complete_workflow_approved=False,
        actual_endpoint_derived_lift_witness=lift,
        closed_rotation=closed,contact=dict(actual_patch_area_mm2=patch_area,annular_area_mm2=annular_area,
            partial_contact_fraction=patch_area/annular_area,all_supplied_patches_on_buffer=True,
            buffer_bottom_fully_backed_by_spacer_geometry=True,retained_buffer_and_loads_verified=False),
        access_options=options,physical_fit_loads_operator_access_verified=False,
        limits='Tool sweeps are clearance probes, not verified engagement. Full tabletop entry remains blocked unless an access/support arrangement is chosen. No source assets copied or viewer published.')
    target.write_text(json.dumps(report,indent=2)+'\n')
    print(target)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt',type=Path,required=True)
    parser.add_argument('--source-worktree',type=Path,required=True)
    parser.add_argument('--source-revision',required=True)
    parser.add_argument('--output',type=Path,required=True)
    integrate(parser.parse_args())


if __name__=='__main__':main()
