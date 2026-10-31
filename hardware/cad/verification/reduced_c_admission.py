"""Fail-closed17-actor C admission; new-base combined admission is mandatory."""
from __future__ import annotations
from dataclasses import asdict
from pathlib import Path
import argparse,hashlib,json,sys
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
import post_glue_lifecycle as life
import candidate_protocol as original_protocol
import reduced_c_protocol as protocol
import rotation_connectivity
import publication_bundle
check_bound_paths=publication_bundle.check_bound_paths
SELF_SOURCE_PIN=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
REQUIRED={'external','root','race','preservation','contacts','module','tools'}


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical(path):
    text=str(Path(path).resolve());marker='/hardware/cad/'
    if text.count(marker)!=1:raise life.Violation('Checker path lacks unique canonical CAD key: '+text)
    return text.split(marker,1)[1]


def sources(mapping):
    keys={}
    for producer,sha in mapping.items():
        key=canonical(producer)
        life.require(key not in keys,'Duplicate canonical checker key: '+key)
        life.require(Path(producer).is_file() and digest(producer)==sha,'Producer checker changed: '+producer)
        current=HERE.parent/key
        life.require(current.is_file() and digest(current)==sha,'Consumer checker differs: '+key)
        keys[key]=sha
    return keys


def pin(root,record):
    path=(root/record['path']).resolve();life.require(path.is_file() and digest(path)==record['sha256'],'Changed pinned file '+str(path))
    return path,json.loads(path.read_text())


def requirements(name,report):
    if name=='external':
        ids={r['id'] for r in report['evidence']}
        life.require({'A lock driver half with preloaded M4 and nuts radial entry and reverse','uncapped M4 head seating and retained threaded pair','integrated B cover assembly and reverse over fixed A driver'}<=ids,'Missing actual partial assembly groups')
        life.require(all(r['access']=='external-module' and r['native_common_mass_with_fixed_parts_mm3']==0. for r in report['evidence']),'Unproved external stroke')
        life.require(report.get('actual_subjects_reimport_unchanged') is True,'Temporary checks did not preserve subjects')
    elif name=='tools':
        rows=report.get('root_tool_operations',[]);life.require(len(rows)==2,'Missing ordinary root tools')
        life.require(all(set(r['phases'])=={'entry','operation','withdrawal'} for r in rows),'Incomplete full-tool phases')
        drive=rows[-1];life.require(drive.get('tip_source_z_mm')==4.5 and drive.get('whole_actual_tool_contained_in_each_phase_bound') is True and drive.get('bottomed_socket_floor_witnesses'),'Missing bottomed full AF4 tool')
        life.require(rows[0].get('socket_floor_contact_witnesses'),'Missing AF3 floor contact')
    elif name=='root':
        life.require(report.get('continuous_root_geometry_verified') is True and report.get('actual_delivered_step_only') is True,'Actual continuous root proof missing')
        life.require(report.get('requires_upper_stop_delta_mm')==-.5 and report.get('head_float_during_turn_source_mm')==[0.,.5] and report.get('requires_head_seated_before_seating_and_clamp') is True,'Root force guards differ')
        life.require(report.get('actual_subjects_reimport_unchanged') is True,'Root subject mutation not excluded')
    elif name=='race':
        life.require(report.get('actual_delivered_step_only') is True and report.get('collar_delta_source_range_mm')==[-.5,.6] and report.get('head_float_source_range_mm')==[0.,.5] and report.get('head_float_motion_verified') is True and report.get('contacts'),'Missing actual race recovery/capture proof')
    elif name=='contacts':
        life.require(report.get('actual_delivered_step_only') is True,'Contacts are not actual subjects')
        rows=report.get('fastener_contacts',[]);life.require(len(rows)==1,'Wrong M4 contact inventory')
        life.require(all(rows[0].get(k) for k in ('nut_axial_floor_seat','nut_anti_rotation','shaft_bearings','head_seats','cover_capture')),'M4 contact chain incomplete')
        life.require(len(report.get('positive_capture_cover_joints',[]))==2 and len(report.get('integral_cover_bridges',[]))==2 and report.get('positive_fixed_cup_bar_keys'),'Reduced collar drive connection incomplete')
        uncapped=report.get('uncapped_M4_pair_capture',{})
        life.require(uncapped.get('continuous_pair_float_checked') is True and uncapped.get('head_float_source_range_mm')==[0.,4.6] and uncapped.get('nut_lower_capture'),'Uncapped pair can escape or cannot recover')
    elif name=='preservation':
        life.require(report.get('protected_profile_difference_mm3')==[0.,0.] and all(v==[0.,0.] for v in report['original_channel_differences_mm3'].values()),'Original bar or channels changed')
        life.require(report.get('actual_delivered_step_only') is True and report.get('bare_bar_channel_access_after_module_withdrawal') is True and all(all(v<=1e-5 for v in row.values()) for row in report['socket_checks'].values()),'Original snug socket/debond access not preserved')
    elif name=='module':
        life.require(report.get('actual_delivered_files') is True and report.get('nominal_knob_path_clear') is True and len(report['checks'])==17 and all(r['rigid_intersection_mm3']<=1e-5 for r in report['checks']),'Nominal OEM module path blocked')
        life.require(report.get('shoe_duplicate_Z180_difference_mm3')==[0.,0.] and report.get('unique_print_manifest_checked') is True,'Two-shoe/one-file quantity claim is unverified')


def graph():
    nodes={n:'rotor' for n in ('bar','cup','knob','lock-half','integrated-half')};nodes['box']='stationary'
    joints=[dict(id='cup bar keys',actors=['bar','cup'],kind='positive-drive',geometry_evidence='contacts',angular_limit_degrees=None),dict(id='M4 lock chain',actors=['bar','lock-half'],kind='positive-drive',geometry_evidence='contacts',angular_limit_degrees=None),dict(id='two M3 cover joints and two integral bridges',actors=['lock-half','integrated-half'],kind='positive-drive',geometry_evidence='contacts',angular_limit_degrees=None),dict(id='stock pad grip',actors=['cup','knob'],kind='pad-grip',geometry_evidence='external + module',angular_limit_degrees=None,physical_slip_resistance_verified=False),dict(id='passive support; combined-base proof required',actors=['bar','box'],kind='unlimited-bearing',geometry_evidence='combined base REQUIRED',angular_limit_degrees=None)]
    return dict(nodes=nodes,joints=joints)


def load(config_path:Path):
    config_path=Path(config_path).resolve();root=config_path.parent;config=json.loads(config_path.read_text())
    life.require(config.get('schema')==1 and config.get('variant')=='reduced-cover-B','Wrong reduced admission schema')
    keys=sources(config['checker_sources'])
    life.require(keys.get(canonical(__file__))==SELF_SOURCE_PIN==digest(__file__),'Actually loaded admission source differs')
    for module in (life,original_protocol,protocol,rotation_connectivity,publication_bundle):
        key=canonical(module.__file__);life.require(keys.get(key)==digest(module.__file__),'Actually loaded checker differs: '+key)
    candidate_path,candidate=pin(root,config['candidate']);life.require(candidate.get('variant')=='reduced-cover-B' and candidate['concept']=='post-glue C' and candidate['bar_already_glued'] is True and candidate['above_root_exterior_access'] is False,'Wrong candidate environment')
    sources(candidate['source_files']);check_bound_paths(candidate)
    life.require(candidate['manufacturing']['detachable_actor_count']==17 and candidate['manufacturing']['printed_physical_count']==6 and candidate['manufacturing']['unique_print_designs']==5,'Physical/file counts differ')
    life.require(set(config['proofs'])==REQUIRED,'Missing/extra reduced C proof category')
    reports={}
    for name,record in config['proofs'].items():
        _,report=pin(root,record);check_bound_paths(report)
        life.require(report.get('source_receipt_sha256',report.get('candidate_receipt_sha256'))==config['candidate']['sha256'],'Proof binds a different candidate: '+name)
        # Recheck every producer source pin and equivalent current canonical path.
        py={path:sha for path,sha in report.get('input_files',{}).items() if path.endswith('.py') and '/hardware/cad/' in path}
        if py:sources(py)
        if report.get('source_files'):sources(report['source_files'])
        requirements(name,report);reports[name]=report
    _,controls_report=pin(root,config['controls']);check_bound_paths(controls_report)
    life.require(controls_report.get('source_receipt_sha256')==config['candidate']['sha256'],'Negative controls bind different candidate')
    life.require(set(controls_report['actual_geometry_negative_controls'])=={'shortened bar','blocked original channel','obstructed original socket','connected collision fin'} and all(q['rejected'] is True for q in controls_report['actual_geometry_negative_controls'].values()),'Missing real geometry negative controls')
    life.require(all(controls_report['memory_mutation_guard'].values()),'Actual memory mutation guard controls failed')
    control_sources={p:s for p,s in controls_report['input_files'].items() if p.endswith('.py') and '/hardware/cad/' in p}
    sources(control_sources)
    _,restored=pin(root,controls_report['restored_positive_root']);check_bound_paths(restored);requirements('root',restored)
    protocol_path,model=pin(root,config['protocol']);expected,inventory=protocol.build(candidate,config['proofs'])
    life.require(model==expected,'Protocol differs from independently reconstructed17-actor model')
    for action in model['actions']:
        if action['geometry_evidence']=='external':life.require(set(action['evidence_checks'])<={r['id'] for r in reports['external']['evidence']},'Unproved exterior action')
    result=life.verify_inventory(model,inventory);life.verify_evidence(model,root)
    controls=original_protocol.negative_controls(model,inventory)
    rotation=graph();rotation_connectivity.verify(**rotation)
    return dict(candidate=candidate,model=model,inventory=inventory,lifecycle=asdict(result),model_sha256=result.model_sha256,proofs=reports,rotation_graph=rotation,negative_controls=controls,requires_combined_base_admission=True,physical_fit_verified=False)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('config',type=Path);args=parser.parse_args();loaded=load(args.config);print(json.dumps(dict(lifecycle=loaded['lifecycle'],actors=len(loaded['inventory']),combined_base_required=True),indent=2))
