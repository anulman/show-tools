"""Private C1-C3 geometry/operation evidence. Findings precede final CAD selection."""
from __future__ import annotations
import argparse
import hashlib
import importlib
import json
from pathlib import Path
import sys
import math
import numpy as np
import trimesh
from build123d import Axis,export_step,export_stl,import_step,extrude
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import disco_bar
m=importlib.import_module('disco-bar.couplings')


def overlaps(parts):
    found=[]
    for i,p in enumerate(parts):
        for q in parts[i+1:]:
            amount=m.c.volume(p.shape&q.shape)
            if amount>1e-5:found.append({'a':p.name,'b':q.name,'mm3':amount})
    return found


def frozen_preset(prototype,expected):
    actual={p.name.removeprefix('preset / '):p.shape for p in prototype.parts if p.name.startswith('preset / ')}
    if prototype.baseplate.setting_mm!=expected.setting_mm or set(actual)!={p.name for p in expected.pieces}:
        raise ValueError('Preset knob-joint identities/setting changed')
    for piece in expected.pieces:
        m.c.assert_empty(piece.shape-actual[piece.name],f'Preset changed: {piece.name}')
        m.c.assert_empty(actual[piece.name]-piece.shape,f'Preset changed: {piece.name}')


def check_state(reference,prototype,expected):
    frozen_preset(prototype,expected)
    invalid=[p.name for p in prototype.parts if not p.shape.is_valid or len(p.shape.solids())!=1 or p.shape.volume<=0]
    envelope=m.c.cyl(m.c.OUTER+1e-7,200,(0,0,-50))
    outside=[p.name for p in prototype.parts if m.c.volume(p.shape-envelope)>1e-5]
    body=next(p.shape for p in prototype.parts if p.name=='full-height bar').translate((0,0,-prototype.bar_shift))
    protected=m.c.box(120,120,80,(0,0,-70))
    m.c.assert_empty((reference&protected)-body,'Far-end source material lost')
    m.c.assert_empty((body&protected)-reference,'Far-end source geometry added')
    bounds=body.bounding_box()
    if not np.isclose(bounds.min.Z,-109.22,atol=1e-5) or not np.isclose(bounds.max.Z,0,atol=1e-5):
        raise ValueError('Original full bar reach shortened or extended')
    interference=overlaps(prototype.parts)
    return {'state':prototype.state,'valid_single_solids':not invalid,'invalid_parts':invalid,
            'preset_exact_boolean_identity':True,'full_bar_reach_and_far_end':True,
            'inside_original_radius':not outside,'outside_radius':outside,
            'intersections':interference,'rigid_clearance_pass':not interference}


def export_piece(piece,folder):
    folder.mkdir(parents=True,exist_ok=True)
    stem=piece.name.replace(' / ','--').replace(' ','-').replace('+','plus')
    step,stl=folder/(stem+'.step'),folder/(stem+'.stl')
    if not export_step(piece.shape,step) or not export_stl(piece.shape,stl,tolerance=.03):raise ValueError('Export failed '+piece.name)
    restored=import_step(step);mesh=trimesh.load_mesh(stl)
    solid=restored.is_valid and len(restored.solids())==1 and np.isclose(restored.volume,piece.shape.volume,rtol=1e-6)
    if not solid:raise ValueError('STEP invalid '+piece.name)
    m.c.assert_empty(piece.shape-restored,'STEP lost material')
    m.c.assert_empty(restored-piece.shape,'STEP gained material')
    if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume<=0 or not np.isclose(mesh.volume,piece.shape.volume,rtol=.005):raise ValueError('STL invalid '+piece.name)
    return {'name':piece.name,'role':piece.role,'step':str(step.resolve()),'stl':str(stl.resolve()),
            'step_sha256':hashlib.sha256(step.read_bytes()).hexdigest(),'stl_sha256':hashlib.sha256(stl.read_bytes()).hexdigest(),
            'step_roundtrip':True,'stl_watertight':True,'volume_mm3':piece.shape.volume}


def run(reference,output,concept='C1',reference_sha256=None):
    output.mkdir(parents=True,exist_ok=True)
    for stale in (output/(concept+'-receipt.json'),output/'interface.json'):
        stale.unlink(missing_ok=True)
    builder={'C1':m.c1}.get(concept)
    if builder is None:raise ValueError('Prototype not implemented yet')
    states=('locked','key-pushed','key-turned','key-removed','turning','released','detached')
    expected=m.pads.build(reference,.2)
    stock_checks=[m.pads.verify(reference,m.pads.build(reference,setting)) for setting in (0.,.2)]
    results=[];meshes={}
    for state in states:
        item=builder(reference,state)
        result=check_state(reference,item,expected)
        results.append(result)
        # First unit exports every actual posed component; no final scene render.
        meshes[state]=[export_piece(p,output/concept/state) for p in item.parts]
    locked=builder(reference)
    bad_pull=builder(reference,bar_shift=-.4)
    bad_turn=builder(reference,angle_override=88)
    pull_parts={p.name:p.shape for p in bad_pull.parts}
    turn_parts={p.name:p.shape for p in bad_turn.parts}
    holding=m.c.volume(pull_parts['quarter-turn retainer']&pull_parts['preset / knob baseplate cup'])>1e-5
    reverse=m.c.volume(turn_parts['positive safety key']&turn_parts['quarter-turn retainer'])>1e-5
    no_lugs=pull_parts['quarter-turn retainer']&m.ring(37.8,50,-5,10)
    removed_lugs_defeat=m.c.volume(no_lugs&pull_parts['preset / knob baseplate cup'])<=1e-5
    key_removed_turn=builder(reference,angle_override=88,key_override='removed')
    removed_key_defeats=not overlaps(key_removed_turn.parts)
    named={p.name:p.shape for p in locked.parts}
    point=m.xy(38.5,45)
    key=named['positive safety key'];housing=named['fixed-to-bar latch carrier']
    key_pull=m.c.volume(key.translate((0,0,.5))&housing)>1e-5
    key_turn=m.c.volume(key.rotate(Axis((*point,0),(0,0,1)),15)&housing)>1e-5
    plate=named['preset / knob baseplate cup'];body=named['full-height bar']
    torque_blocks=[m.c.volume(body.rotate(Axis.Z,a)&plate)>1e-5 for a in (-2,2)]
    print(concept,'locked axial removal blocked:',holding,'reverse collar blocked:',reverse,flush=True)
    contact=[]
    clip=m.ring(43,45.5,-.2,.2)
    for face in named['full-height bar'].faces():
        bb=face.bounding_box()
        if abs(bb.min.Z)<1e-6 and abs(bb.max.Z)<1e-6:
            patch=face&clip
            if patch:
                for f in patch.faces():
                    if f.area>1e-6:
                        solid=extrude(f,amount=.1 if f.normal_at().Z>0 else -.1)
                        entry=export_piece(m.c.Piece(f'actual contact patch {len(contact)}',solid,'actual contact face extruded 0.1mm for analysis'),output/concept/'contact')
                        entry['planar_contact_area_mm2']=f.area
                        contact.append(entry)
    access=[export_piece(m.c.Piece(name,shape,'temporary clearance probe'),output/concept/'access') for name,shape in m.c1_access_sweeps()]
    result={'concept':concept,'scope':'PRIVATE_PROTOTYPE_NOT_FINAL_C','states':results,
            'reference_sha256':reference_sha256,'stock_pad_joint_checks':stock_checks,
            'locked_pull_off_rejected':holding,'locked_reverse_action_rejected':reverse,
            'holding_contact_pair':['quarter-turn retainer','preset / knob baseplate cup'],
            'reverse_blocking_pair':['positive safety key','quarter-turn retainer'],
            'negative_removed_lugs_defeat_capture':removed_lugs_defeat,'negative_removed_key_allows_reverse':removed_key_defeats,
            'operator_tool_engagement_verified':False,'tool_sweeps_are_clearance_only':True,
            'safety_key_straight_pull_rejected':key_pull,'safety_key_unpushed_turn_rejected':key_turn,
            'pilot_keys_block_both_torque_directions':all(torque_blocks),'actual_support_contact_patches':contact,
            'closed_rotation_angles_for_box_check_degrees':list(range(0,360,5)),
            'rotating_group':'all coupler components, including preset knob clamp; stationary box/stock hex/buffer are not in this model',
            'preset_setting_mm_PROPOSED':.2,'pad_bond_strength_verified':False,
            'box_source_transform':{'rotation_x_degrees':180,'mouth_box_z_mm':m.GAP_STUDY},
            'operation_workflow':'rotate whole assembly to service index before temporary underside access; collar operator follows the explicit quarter-arc window; no permanent moving stem through roof',
            'encoder_mount':'stationary stock hex in top roof well; no additional encoder retaining nut modelled',
            'support_contact':'actual interrupted planar bar faces require box/washer overlap check; a complete annulus is not assumed',
            'controls':locked.controls,'control_sweeps':access,'states_components':meshes,'source_code_sha256':{Path(p).name:hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in (m.__file__,m.pads.__file__,m.pads.previous.__file__,m.c.__file__,disco_bar.__file__,__file__)}}
    output.mkdir(parents=True,exist_ok=True)
    (output/(concept+'-receipt.json')).write_text(json.dumps(result,indent=2)+'\n')
    (output/'interface.json').write_text(json.dumps(result,indent=2)+'\n')
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--step',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--concept',default='C1')
    args=parser.parse_args();path,reference=disco_bar.load_reference(args.step);disco_bar.verify_full_reference(path,reference)
    report=run(reference,args.output,args.concept,hashlib.sha256(path.read_bytes()).hexdigest())
    print(json.dumps({'concept':report['concept'],'states':[{k:v for k,v in s.items() if k in ('state','rigid_clearance_pass','intersections')} for s in report['states']]},indent=2))


if __name__=='__main__':main()
