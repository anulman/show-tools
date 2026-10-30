"""Fail-closed loader for a frozen three-candidate human-review publication.

No producer endpoint flag, old collar receipt, or presentation selector alone is
sufficient. Recheck exact artifact hashes and the bound operating protocol.
"""
from __future__ import annotations
import hashlib,json
from pathlib import Path
from candidate_protocol import expected_inventory,negative_controls
from post_glue_lifecycle import verify_inventory,verify_evidence,Violation,require

REQUIRED_PROOFS={'external','root','module','preservation','contacts','base','tools'}


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pinned(path,sha):
    path=Path(path)
    require(path.is_file() and digest(path)==sha,'Changed/missing frozen file: '+str(path))
    return json.loads(path.read_text())


def check_bound_paths(value):
    """Check every serialized STEP/STL record, including inspection envelopes."""
    if isinstance(value,dict):
        for kind in ('step','stl'):
            if kind in value and kind+'_sha256' in value:
                require(digest(value[kind])==value[kind+'_sha256'],'Changed '+kind+' artifact: '+value[kind])
        for key in ('input_files','input_artifact_sha256','base_input_artifacts','validated_input_files'):
            if key in value:
                for path,sha in value[key].items():require(digest(path)==sha,'Changed proof input: '+path)
        if set(('path','sha256'))<=set(value):
            require(digest(value['path'])==value['sha256'],'Changed receipt input: '+value['path'])
        for child in value.values():check_bound_paths(child)
    elif isinstance(value,list):
        for child in value:check_bound_paths(child)



def proof_requirements(name,report,concept):
    """Read substantive checker outputs; success flags from endpoint exports do not count."""
    if name=='root':
        key='continuous_root_geometry_verified' if concept=='C' else 'continuous_insertion_turn_seating_tightening_and_reverse_clear'
        require(report.get(key) is True,'Continuous motion proof did not pass')
        if concept!='C':require(report.get('connected_fin_control_rejected') is True,'Missing real collision negative control')
        else:
            require(report.get('requires_upper_stop_delta_mm')==-.5 and report.get('requires_head_seated_before_turn') is True,
                    'C load/stop assumptions changed')
    elif name=='external':
        require(len(report.get('evidence',[]))>=25 and len(report.get('root_tool_operations',[]))>=2,
                'Incomplete exterior assembly/tool evidence')
        for row in report['evidence']:
            require(row.get('access')=='external-module' and row.get('native_common_mass_with_fixed_parts_mm3')==0.,
                    'Exterior operation has not passed strict clearance checks')
    elif name=='module':
        require(report.get('actual_delivered_files') is True and set(report['base'])=={'5','7'},'Missing module service variants')
        require(all(row['rigid_intersection_mm3']<=1e-5 for row in report['checks']),'OEM knob path blocked')
        require(all(row['arbitrary_rotational_index_clear'] is True for row in report['base'].values()),'Module withdrawal not all-angle clear')
    elif name=='preservation':
        require(report.get('actual_delivered_step_only') is True and report.get('bare_bar_channel_access_after_module_withdrawal') is True,
                'Post-removal debond access not proved')
        require(report['protected_profile_difference_mm3']==[0.,0.], 'Original bar profile changed')
        require(all(v==[0.,0.] for v in report['original_channel_differences_mm3'].values()),'Original channel changed')
        require(all(all(v<=1e-5 for v in row.values()) for row in report['socket_checks'].values()),'Original snug socket changed')
    elif name=='contacts':
        require(report.get('actual_delivered_step_only') is True,'Contacts are not actual delivered geometry')
        require(len(report['fastener_contacts'])==(3 if concept=='A' else 1),'Missing M4 contact chain')
        for row in report['fastener_contacts']:
            require(row.get('nut_axial_floor_seat'),'Missing positive axial floor reaction')
            require(row.get('nut_anti_rotation') and row.get('shaft_bearings') and row.get('head_seats') and row.get('cover_capture'),
                    'Missing positive nut/head/shaft capture')
        if concept=='C':
            require(len(report['positive_capture_cover_joints'])==4 and report.get('positive_fixed_cup_bar_keys'),
                    'Missing split collar cover or bar torque contact')
    elif name=='base':
        require(report.get('all_provided_stages_base_rotary_clear') is True and report.get('angular_samples_used')==0,
                'Every-angle base clearance not proved')
    elif name=='tools':require(report.get('all_root_tools_base_clear') is True,'Whole root tools do not clear base')

def candidate(record,root):
    concept=record['concept'];require(concept in ('A','B','C'),'Unexpected candidate')
    admission=pinned(root/record['path'],record['sha256'])
    require(admission.get('schema')==1 and admission.get('concept')==concept,'Admission identity differs')
    require(admission.get('human_review_candidate') is True and admission.get('manufacturing_approved') is False,
            'Publication is not an unapproved human-review candidate')
    require(admission.get('physical_fit_verified') is False,'Physical fit cannot be certified by CAD')
    require(set(admission['proofs'])==REQUIRED_PROOFS,'Missing or extra mandatory proof category')
    receipt=pinned(admission['candidate_receipt']['path'],admission['candidate_receipt']['sha256'])
    require(receipt['concept']=='post-glue '+concept and receipt['bar_already_glued'] is True
            and receipt['above_root_exterior_access'] is False,'Wrong candidate environment')
    require(receipt['reference_sha256']=='f0a21384179b69eff79205032dad536bfa1350e358c25ed0fe01de4189f2e003',
            'Original source reference differs')
    check_bound_paths(receipt)
    for name,proof in admission['proofs'].items():
        report=pinned(root/proof['path'],proof['sha256']);check_bound_paths(report)
        proof_requirements(name,report,concept)
        sha=report.get('candidate_receipt_sha256',report.get('source_receipt_sha256'))
        if sha is None:
            sha=report['gate_provenance']['input_receipts']['candidate']['sha256']
        require(sha==admission['candidate_receipt']['sha256'],'Proof for different candidate: '+name)
    model=pinned(root/admission['protocol']['path'],admission['protocol']['sha256'])
    require(model['concept']==concept,'Protocol identity differs')
    require(not model.get('pending_C_force_transfer_refinement'),'Incomplete force-transfer protocol')
    result=verify_inventory(model,expected_inventory(concept));verify_evidence(model,root)
    negative_controls(model,expected_inventory(concept))
    require(result.model_sha256==admission['model_sha256'],'Protocol digest differs')
    require(admission.get('verified_requirements')==[
        'post-glue assembly and complete reversal under the instructed protocol',
        'ordinary tools and root-only installed access',
        'continuous motion and every-angle base rotation clearance',
        'full source profile, socket and post-removal debond passages',
        'complete actual printed and purchased component inventory'], 'Missing required publication claim')
    return admission,receipt,result


def load(selector):
    selector=Path(selector).resolve();data=json.loads(selector.read_text())
    require(data.get('schema')==1 and data.get('presentation')=='three-post-glue-review-candidates','Unapproved presentation')
    require([q['concept'] for q in data['candidates']]==['A','B','C'],'Exactly three ordered candidates required')
    return [(q['concept'],)+candidate(q,selector.parent) for q in data['candidates']]
