"""New serial-key air-gap protocol on the unchanged, pinned17-actor C geometry."""
from __future__ import annotations
import argparse,hashlib,json,sys
from dataclasses import asdict
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import reduced_c_admission as geometry
import airgap_c_protocol as protocol
import post_glue_lifecycle as life
import rotation_connectivity
SELF_SOURCE_PIN=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
VARIANT='air-gap-C-serial-service'


def require_service(report,candidate_sha):
    life.require(report.get('variant')==VARIANT and report.get('source_receipt_sha256')==candidate_sha,'Serial recovery binds different geometry')
    for flag in ('actual_subjects_reimport_unchanged','actual_delivered_step_only','serial_key_recovery_verified','requires_other_hand_on_ball','requires_upper_stop_before_rotation','requires_head_seated_before_seating_and_clamp'):life.require(report.get(flag) is True,'Missing serial recovery requirement '+flag)
    life.require(report.get('simultaneous_keys_permitted') is False,'Serial service requires third hand')
    rows=report['root_tool_operations'];life.require(len(rows)==3,'Wrong serial recovery tool inventory')
    expected={('inserted','4 mm hex key'):(1.1,0.),('turned','4 mm hex key'):(1.1,0.),('turned','3 mm hex key'):(1.6,.5)}
    actual={(r['stage'],r['tool_name']):r for r in rows};life.require(set(actual)==set(expected),'Incomplete serial recovery poses')
    for key,(total,relative) in expected.items():
        r=actual[key];life.require(r['fixed_frame_additional_axial_range_mm']==[0.,total] and r['collar_relative_additional_axial_range_mm']==[0.,relative],'Recovery stroke was truncated')
        life.require(set(r['phases'])=={'entry','operation','withdrawal'} and r['whole_actual_key_contained'] is True and r['fixed_and_relative_frames_native_clear'] is True and r['nominal_key_socket_clear'] is True and r['socket_floor_contacts'],'Whole ordinary key/floor recovery unproved')
    geometry.check_bound_paths(report)
    geometry.sources({p:s for p,s in report['input_files'].items() if p.endswith('.py') and '/hardware/cad/' in p})


def graph():
    result=geometry.graph()
    result['joints']=[j for j in result['joints'] if j['actors']!=['bar','box']]
    return result


def load(path):
    path=Path(path).resolve();root=path.parent;config=json.loads(path.read_text())
    life.require(config.get('schema')==1 and config.get('variant')==VARIANT,'Wrong air-gap admission')
    keys=geometry.sources(config['checker_sources'])
    life.require(keys.get(geometry.canonical(__file__))==SELF_SOURCE_PIN==geometry.digest(__file__),'Actually loaded air-gap admission differs')
    for module in (geometry,protocol,life,rotation_connectivity):life.require(keys.get(geometry.canonical(module.__file__))==geometry.digest(module.__file__),'Loaded air-gap checker differs')
    old_path,old_config=geometry.pin(root,config['geometry_admission']);old=geometry.load(old_path)
    sha=old_config['candidate']['sha256'];candidate=old['candidate']
    life.require(set(config['proofs'])==geometry.REQUIRED|{'serial-service'},'Incomplete air-gap evidence inventory')
    reports={}
    for name,record in config['proofs'].items():
        _,report=geometry.pin(root,record)
        if name=='serial-service':require_service(report,sha)
        else:
            life.require(record['sha256']==old_config['proofs'][name]['sha256'],'Changed immutable C geometry proof')
            geometry.check_bound_paths(report);geometry.requirements(name,report)
        reports[name]=report
    _,control=geometry.pin(root,config['controls']);geometry.check_bound_paths(control)
    life.require(control.get('source_receipt_sha256')==sha and control.get('original_subjects_unchanged') is True,'Controls do not bind unchanged C')
    obstruction=control['connected_AF4_socket_obstruction'];life.require(obstruction['rejected'] is True and obstruction['native_actual_key_collision_mm3']>1e-5,'Missing real serial recovery obstruction negative')
    geometry.sources({p:s for p,s in control['input_files'].items() if p.endswith('.py') and '/hardware/cad/' in p})
    _,restored=geometry.pin(root,control['restored_positive']);require_service(restored,sha)
    _,model=geometry.pin(root,config['protocol']);expected,inventory=protocol.build(candidate,config['proofs'])
    life.require(model==expected,'Air-gap protocol differs from independently reconstructed serial-key model')
    result=protocol.verify(model,inventory);life.verify_evidence(model,root);negative=protocol.negative_controls(model,inventory)
    ids={r['id'] for r in reports['serial-service']['root_tool_operations']}
    for action in model['actions']:
        if action['geometry_evidence']=='serial-service':life.require(set(action['evidence_checks'])<=ids,'Unproved serial recovery action')
    rotation=graph();rotation_connectivity.verify(**rotation)
    return dict(candidate=candidate,model=model,inventory=inventory,lifecycle=asdict(result),model_sha256=result.model_sha256,proofs=reports,rotation_graph=rotation,negative_controls=negative,requires_combined_base_admission=True,physical_fit_verified=False,physical_spindle_load_capacity_verified=False,requires_no_rotor_to_base_contact_or_joint=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('config',type=Path);args=parser.parse_args();result=load(args.config)
    print(json.dumps(dict(actors=len(result['inventory']),states=result['lifecycle']['reachable_states'],edges=result['lifecycle']['enabled_transitions'],model_sha256=result['model_sha256'],combined_base_required=True)))
