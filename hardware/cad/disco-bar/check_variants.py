"""Export C2/C3 even when functional checks fail; never label failures as approval."""
from __future__ import annotations
import argparse,hashlib,importlib,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import disco_bar
from build123d import Axis
proof=importlib.import_module('disco-bar.check_couplings')
m=importlib.import_module('disco-bar.coupling_variants')


def run(path,output,concept):
    output.mkdir(parents=True,exist_ok=True)
    destination=output/(concept+'-receipt.json')
    destination.unlink(missing_ok=True)
    overcentre=importlib.import_module('disco-bar.overcentre')
    builder={'C2':m.c2,'C3':m.c3,'C2-overcentre':overcentre.build}[concept]
    source,reference=disco_bar.load_reference(path);disco_bar.verify_full_reference(source,reference)
    expected=m.common.pads.build(reference,.2)
    stock=[m.common.pads.verify(reference,m.common.pads.build(reference,s)) for s in (0.,.2)]
    states=('locked','key-pushed','key-turned','key-removed','opening','released','detached') if concept=='C2' else ('locked','key-pushed','key-turned','opening','released','detached')
    if concept=='C2-overcentre':states=('locked','key-pushed','key-turned','key-removed','dead-centre','opening','released','detached')
    checks=[];files={};export_failures=[];kinematic_states={}
    for state in states:
        item=builder(reference,state)
        checks.append(proof.check_state(reference,item,expected))
        if hasattr(item,'kinematics'):kinematic_states[state]=item.kinematics
        exported=[]
        for piece in item.parts:
            try:exported.append(proof.export_piece(piece,output/concept/state))
            except Exception as error:
                export_failures.append({'state':state,'piece':piece.name,'error':str(error)})
        files[state]=exported
        print(concept,state,'parts',len(item.parts),'intersections',len(checks[-1]['intersections']),flush=True)
    locked=builder(reference)
    pulling=builder(reference,bar_shift=getattr(locked,'holding_test_shift',-.4))
    pull={p.name:p.shape for p in pulling.parts}
    names=([name for name in pull if name.startswith('hook ') and not name.startswith('hook pivot')]) if concept in ('C2','C2-overcentre') else [name for name in pull if name.startswith('rigid dog ')]
    holding={name:m.c.volume(pull[name]&pull['preset / knob baseplate cup'])>1e-5 for name in names}
    locked_clear=not proof.overlaps(locked.parts)
    lock_checks={'valid_locked_assembly':locked_clear}
    if concept=='C2' and locked_clear:
        bad=builder(reference,angle_override=5)
        badparts={p.name:p.shape for p in bad.parts}
        unkeyed=builder(reference,angle_override=5,key_override='removed')
        reverse=[m.c.volume(badparts[f'hook {a}']&badparts[f'positive safety key {a}'])>1e-5 for a in (90,270)]
        pairs={p.name:p.shape for p in locked.parts}
        roof=next(p.shape for p in locked.parts if p.name.startswith('fixed-to-bar latch carrier'))
        keytests=[]
        for a in (90,270):
            key=pairs[f'positive safety key {a}'];point=m.common.xy(40,a)
            keytests.append(m.c.volume(key.translate((0,0,.5))&roof)>1e-5)
            keytests.append(m.c.volume(key.rotate(Axis((*point,0),(0,0,1)),15)&roof)>1e-5)
        lug_removed={name:m.c.volume((pull[name]&m.common.ring(37.4,60,-50,50))&pull['preset / knob baseplate cup'])<=1e-5 for name in names}
        lock_checks.update({'named_reverse_key_hook_contacts':reverse,'removed_keys_defeat_reverse_block':not proof.overlaps(unkeyed.parts),
                            'removed_hook_noses_defeat_holding':lug_removed,'positive_key_retention_tests':keytests})
    elif not locked_clear:
        lock_checks['holding_checks_not_proof']='Locked assembly already intersects; secure holding cannot be established.'
    report={'concept':concept,'scope':'PRIVATE_COMPARATIVE_PROTOTYPE_NOT_FINAL_C',
            'reference_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
            'stock_pad_joint_checks':stock,'states':checks,'states_components':files,
            'export_failures':export_failures,'all_component_exports_pass':not export_failures,
            'named_axial_holding_contacts_DIAGNOSTIC':holding,'positive_lock_checks':lock_checks,
            'original_C2_overcentre_requirement_met':concept=='C2-overcentre' if concept.startswith('C2') else None,
            'kinematic_states':kinematic_states,
            'physical_hard_stop_and_secondary_key_function_verified':False,
            'overcentre_crossing_verified':(kinematic_states.get('locked',{}).get('signed_overcentre',0)>0 and abs(kinematic_states.get('dead-centre',{}).get('signed_overcentre',1))<1e-9 and kinematic_states.get('opening',{}).get('signed_overcentre',0)<0) if kinematic_states else None,
            'disconnected_solids_automatically_split':False,'operator_tool_engagement_verified':False,
            'operation_pass':all(c['rigid_clearance_pass'] and c['valid_single_solids'] and c['inside_original_radius'] for c in checks),
            'box_source_transform':{'rotation_x_degrees':180,'mouth_box_z_mm':9},
            'closed_rotation_angles_for_box_check_degrees':list(range(0,360,5)),
            'controls':locked.controls,'source_code_sha256':{Path(f).name:hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (m.__file__,m.common.__file__,m.common.pads.__file__,m.common.pads.previous.__file__,m.c.__file__,proof.__file__,disco_bar.__file__,importlib.import_module('disco-bar.latches').__file__,overcentre.__file__,__file__)},
            'limits':'Part validity/export success does not establish operability. Intersections and access failures remain findings; no publication or manufacturing approval.'}
    destination.write_text(json.dumps(report,indent=2)+'\n')
    return report


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--step',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--concept',choices=['C2','C3','C2-overcentre'],required=True)
    a=p.parse_args();r=run(a.step,a.output,a.concept)
    print(json.dumps({'concept':r['concept'],'exports_pass':r['all_component_exports_pass'],'operation_pass':r['operation_pass'],'failures':r['export_failures'],'states':[{k:v for k,v in state.items() if k not in ('intersections',)}|{'intersection_count':len(state['intersections'])} for state in r['states']]},indent=2))


if __name__=='__main__':main()
