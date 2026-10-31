"""Actual air-gap base, positive all-angle clearance, and serial-key service."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
from copy import deepcopy
import json,math
from pathlib import Path
import sys
import clean_c_base_admission as old
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'box-mount/access'))
import air_gap_c_mount as box
from build123d import extrude
from OCP.BRepExtrema import BRepExtrema_DistShapeShape

HERE=Path(__file__).resolve()
g=box.g
require=box.require
VARIANT='air-gap-C-serial-service'
CHECKS={'rotors','positive_all_angle_clearance','root_tools','module_and_grip_service',
        'bounded_race_recovery','panel_service','panel_lifecycle'}


@contextmanager
def native_context():
    previous=g.fixed_geometry
    g.fixed_geometry=lambda data,height:box.fixed(data,height,panel_present='bottom' in data['candidate']['parts'])
    try:
        with old.detached_booleans():yield
    finally:g.fixed_geometry=previous


def read_coupling(record):
    from airgap_c_admission import load as load_c
    config=old.read_pin(record)
    require(config.get('variant')==VARIANT,'Old bearing protocol cannot admit air-gap service')
    admitted=load_c(Path(record['path']));old.read_pin(record)
    require(admitted['requires_no_rotor_to_base_contact_or_joint'] is True and len(admitted['inventory'])==17,
            'Air-gap coupling inventory or support contract differs')
    return admitted,config


def validate_base(report):
    require(report.get('scope')==box.SCOPE and report.get('geometry_checks_pass') is True,'Wrong or failed air-gap base')
    require(report.get('no_passive_bearing_support') is True and report.get('no_ballast_or_retention_hardware') is True,
            'Air-gap base retains support or ballast')
    require(report.get('physical_fit_verified') is False and report.get('manufacturing_approved') is False,'Unverified physical claim')
    records=report['review_components'];require(len(records)==4 and {r['name'] for r in records}==box.PARTS,'Wrong air-gap printed inventory')
    require(report['optional_components']==[] and report['material_patterns']==[] and report['printed_parts_default']==4,'Retired material or cap remains')
    require(report['hardware_BOM']==dict(button_M3x10=4,button_M3x12=2,DIN934_M3_nuts=6),'Wrong air-gap fastener BOM')
    checks=report['checks']
    for key in ('actual_four_parts_valid_disjoint','actual_shell_matches_pre_buffer_roof','no_material_above_roof_z0',
                'retired_support_holes_and_nut_pockets_filled','no_bearing_PTFE_adapter_or_support_fasteners','no_ballast'):
        require(checks.get(key) is True,'Failed air-gap base check: '+key)
    require(checks['hardware_solid_count']==12 and len(checks['joints']['cover'])==4 and len(checks['joints']['keeper'])==2,
            'Incomplete air-gap base joints')
    for joint in checks['joints']['cover']+checks['joints']['keeper']:
        for key in ('screw_and_nut_on_declared_axis','nut_up_reaction','min_envelope_nut_30deg_rotation_blocked',
                    'head_bearing_reaction','full_nominal_nut_span_plus_one_pitch'):
            require(joint.get(key) is True,'Failed air-gap fastener reaction: '+key)
    require(len(checks['stock_hex']['keepers'])==2 and checks['stock_hex']['stock_down_0p1_overlap_mm3']>0
            and checks['stock_hex']['stock_5degree_rotation_overlap_mm3']>0
            and all(row['stock_up_0p1_overlap_mm3']>0 for row in checks['stock_hex']['keepers']), 'Missing stock hex reactions')
    web=checks['lower_web'];require(len(web)==2 and {r['angle_degrees'] for r in web}=={90,270}
            and all(r['thickness_mm']==5 and 0<=r['missing_material_mm3']<1e-6 for r in web),'Failed stock well web')
    for name in ('cover_nut_loading','keeper_nut_loading'):
        require(checks[name]['nuts_insert_from_below_before_mating_part_fitted'] is True and checks[name]['entry_sweep_mm']==30,'Missing standard nut loading path')
    ties=checks['fixed_cable_tiedowns'];require(ties['ordinary_tail_threading_verified'] is True
            and len(ties['finite_whole_loop_routing_witnesses'])==2
            and all(r['complete_loop_and_head_clear'] is True for r in ties['finite_whole_loop_routing_witnesses']), 'Failed fixed wiring eyes')


@old.detached_booleans()
def prepare(base_pin,coupling_pin):
    base=old.read_pin(base_pin);validate_base(base)
    original=base['gate_provenance']['input_receipts']['four_print_base']
    data=box.prepare(Path(original['path']))
    bound=g.bind_input(data,'air_gap_base',Path(base_pin['path']))
    old.check_bound_paths(bound)
    actual=dict(g.load_records(data,base['review_components'],box.PARTS))
    for name,part in actual.items():
        expected=data['candidate']['parts'][name]
        require(g.outside_volume(part,expected)<1e-6 and g.outside_volume(expected,part)<1e-6,'Air-gap base differs from source: '+name)
    data['candidate']['parts']=actual;data['air_gap_records']=base['review_components']
    data['candidate']['keepers']=dict(data['candidate']['keepers'],roof=actual['shell'])
    data['fixed_ties']=dict(data['fixed_ties'],bottom=actual['shell'])
    admitted,config=read_coupling(coupling_pin);data['C']=admitted['candidate'];data['proofs']=admitted['proofs']
    g.bind_input(data,'air_gap_coupling_admission',Path(coupling_pin['path']))
    root=Path(coupling_pin['path']).parent
    for name,record in dict(protocol=config['protocol'],**config['proofs']).items():
        parsed=g.bind_input(data,'air_gap_C_'+name,(root/record['path']).resolve())
        require(data['snapshots']['air_gap_C_'+name].sha256==record['sha256'],'Changed air-gap evidence: '+name)
        old.check_relative_bindings(parsed,root)
    data['sources'][HERE.name]=(HERE,g.audit.digest(HERE))
    box.unchanged_subjects(data);old.unchanged_subjects(data)
    return data,base,admitted


def positive_clearance(data):
    result={}
    for height in box.HEIGHTS:
        window=g.rotary_window(height,200.,150.);_,fixed=box.fixed(data,height);rows=[]
        for name,shape in fixed.items():
            distance=BRepExtrema_DistShapeShape(deepcopy(window).wrapped,deepcopy(shape).wrapped)
            distance.Perform();require(distance.IsDone(),'Native clearance distance failed: '+name)
            amount=distance.Value();require(math.isfinite(amount) and amount>1e-7,'No positive all-angle air gap: '+name)
            rows.append(dict(name=name,minimum_envelope_distance_mm=amount))
        result[str(int(height))]=dict(minimum_all_angle_fixed_clearance_mm=min(r['minimum_envelope_distance_mm'] for r in rows),
                                     fixed_geometry=rows,angular_samples_used=0,continuous_axisymmetric_envelope=True)
    return result


def root_tools(data):
    opened=dict(data,candidate=dict(data['candidate'],parts={n:p for n,p in data['candidate']['parts'].items() if n!='bottom'}))
    rows=[];closed=[]
    groups={'normal':data['proofs']['tools']['root_tool_operations'],
            'serial-recovery':data['proofs']['serial-service']['root_tool_operations']}
    require(len(groups['normal'])==2 and len(groups['serial-recovery'])==3,'Incomplete normal/recovery root tools')
    for group,operations in groups.items():
        for op in operations:
            source={phase:old.common.load_parts(data,records) for phase,records in op['phases'].items()}
            for height in box.HEIGHTS:
                axis=dict(op['axis_source'],AF_mm=op.get('AF_mm',3 if op['tool_name']=='3 mm hex key' else 4))
                bound=old.common.posed_axis(axis,height,280.)
                sweeps={phase:[(name,g.audit.pose(part,height,280.)) for name,part in parts] for phase,parts in source.items()}
                action=dict(action_id=op['id'],tool_name=op['tool_name'],tool_part=op['tool_part'],gap_mm=height,
                            service_index_degrees=280.,access='root',target_axis=bound,tool_axis=bound,
                            bar_mouth_z_range_mm=[height,height+2.1] if group=='normal' else [height,height],approach_box=[0,0,1])
                row=g.check_box_operation(opened,action,sweeps);row['group']=group;rows.append(row)
                overlap=sum(g.intersection(part,data['candidate']['parts']['bottom']) for _,part in sweeps['entry'])
                require(overlap>1e-5,'Closed panel does not reject actual root tool')
                closed.append(dict(group=group,action_id=op['id'],gap_mm=height,closed_panel_entry_overlap_mm3=overlap))
    return dict(actions=rows,closed_panel_negative_controls=closed,all_12_hardware_solids_retained=True,
                bottom_removed=True,shared_service_index_degrees=280.,simultaneous_keys_permitted=False)


def panel_service(data):
    c,obstacles=box.fixed(data,5.);bottom=deepcopy(c['parts']['bottom']);rows=[]
    for i,joint in enumerate(c['covers']['pairs']):
        sweep=old.panel.screw_sweep(joint,14.)
        for name,shape in obstacles.items():
            if name not in {'hardware-'+str(i*2),'hardware-'+str(i*2+1)}:
                require(g.intersection(sweep,shape)<1e-6,'Air-gap cover screw withdrawal blocked: '+name)
        for tool in old.panel.key2_bounds(joint).values():
            for name,shape in obstacles.items():
                if name!='hardware-'+str(i*2):require(g.intersection(tool,shape)<1e-6,'Air-gap cover key blocked: '+name)
            require(tool.bounding_box().min.Z>=c['original']['underside_z']-180.,'Cover key exceeds service lift')
        rows.append(dict(joint=joint.name,AF_mm=2,full_key_phases_clear=True,whole_screw_withdrawal_mm=14.))
    removal=deepcopy(bottom)
    for face in bottom.faces():
        if face.normal_at().Z>.9:removal+=extrude(deepcopy(face),amount=-100,dir=(0,0,1))
    _,remaining=box.fixed(data,5.,False,False)
    for name,shape in remaining.items():require(g.intersection(removal,shape)<1e-6,'Air-gap bottom path blocked: '+name)
    return dict(cover_fasteners=rows,continuous_panel_downward_removal_and_reverse_mm=100.,
                wiring_stays_on_shell=True,panel_refit_requires_all_keys_withdrawn=True)


def verify(data,admitted):
    with native_context():
        box.unchanged_subjects(data);old.unchanged_subjects(data)
        rotors=old.verify_rotors(data,admitted)
        for heights in rotors.values():
            for row in heights.values():row['certificate']['intended_contact']='None; positive base clearance required'
        checks=dict(rotors=rotors,positive_all_angle_clearance=positive_clearance(data),root_tools=root_tools(data),
                    module_and_grip_service=old.common.verify_service(data),bounded_race_recovery=old.common.verify_race_base(data),
                    panel_service=panel_service(data),panel_lifecycle=old.panel_lifecycle(admitted))
        box.unchanged_subjects(data);old.unchanged_subjects(data)
        return checks


def validate_checks(checks,admitted):
    require(set(checks)==CHECKS,'Incomplete air-gap compatibility checks')
    names=set(admitted['inventory'])|{admitted['candidate']['environment']['name']}
    require(set(checks['rotors'])==set(admitted['candidate']['stages']),'Incomplete air-gap rotation stages')
    fixed_names=box.PARTS|{'hardware-'+str(i) for i in range(12)}|{'stock_hex','cable'}
    for heights in checks['rotors'].values():
        require(set(heights)=={'5','7'},'Missing air-gap rotation height')
        for height,row in heights.items():
            require(row['arbitrary_revolutions_geometrically_clear'] is True and row['angular_samples_used']==0,'Failed all-angle rotor proof')
            parts=row['components'];require(len(parts)==18 and {p['name'] for p in parts}==names,'Incomplete air-gap rotor inventory')
            require(all(math.isfinite(p['outside_rotary_envelope_mm3']) and 0<=p['outside_rotary_envelope_mm3']<1e-6 for p in parts),'Rotor escapes air-gap envelope')
            certificate=row['certificate'];fixed=certificate['fixed_geometry']
            require(certificate['analytic_all_angle_clearance'] is True and certificate['angular_samples_used']==0
                    and certificate['gap_mm']==float(height) and len(fixed)==18 and {r['name'] for r in fixed}==fixed_names
                    and all(math.isfinite(r['envelope_intersection_mm3']) and 0<=r['envelope_intersection_mm3']<1e-6 for r in fixed),'Failed air-gap envelope certificate')
    clearances=checks['positive_all_angle_clearance'];require(set(clearances)=={'5','7'},'Missing positive clearance height')
    for row in clearances.values():
        distances=row['fixed_geometry'];require(len(distances)==18 and {r['name'] for r in distances}==fixed_names and row['continuous_axisymmetric_envelope'] is True and row['angular_samples_used']==0,'Incomplete positive clearance proof')
        require(all(math.isfinite(r['minimum_envelope_distance_mm']) and r['minimum_envelope_distance_mm']>1e-7 for r in distances),'Zero or failed air gap')
        require(row['minimum_all_angle_fixed_clearance_mm']==min(r['minimum_envelope_distance_mm'] for r in distances),'Air-gap minimum differs from distances')
    tools=checks['root_tools'];require(len(tools['actions'])==10 and len(tools['closed_panel_negative_controls'])==10
            and tools['all_12_hardware_solids_retained'] is True and tools['bottom_removed'] is True
            and tools['simultaneous_keys_permitted'] is False,'Incomplete serial root tool coverage')
    operations={('normal',r['id']):r for r in admitted['proofs']['tools']['root_tool_operations']}
    operations.update({('serial-recovery',r['id']):r for r in admitted['proofs']['serial-service']['root_tool_operations']})
    expected={(group,identifier,height) for group,identifier in operations for height in (5.,7.)}
    require(len(operations)==5 and {(r['group'],r['action_id'],r['fixed_base_gap_mm']) for r in tools['actions']}==expected,'Missing specific serial tool/height')
    require({(r['group'],r['action_id'],r['gap_mm']) for r in tools['closed_panel_negative_controls']}==expected,'Missing closed-panel recovery control')
    for row in tools['actions']:
        require(row['whole_tool_sweep_vs_base_clear'] is True and row['minimum_table_clearance_mm']>=0,'Failed whole root key')
        phases=row['clearance_rows'];require({p['name'].split('/',1)[0] for p in phases}=={'entry','operation','withdrawal'},'Missing root key phase')
        op=operations[(row['group'],row['action_id'])]
        expected_phases={phase+'/'+part['name'] for phase,parts in op['phases'].items() for part in parts}
        require(len(phases)==len(expected_phases) and {p['name'] for p in phases}==expected_phases,'Incomplete whole key phase bounds')
        for phase in phases:
            values=phase['intersections_mm3'];require(set(values)==fixed_names-{'bottom'} and all(math.isfinite(v) and 0<=v<1e-6 for v in values.values()),'Failed or missing root obstacles')
    require(all(r['closed_panel_entry_overlap_mm3']>1e-5 for r in tools['closed_panel_negative_controls']),'Closed-panel negative control failed')
    module=checks['module_and_grip_service'];require(set(module)=={'5','7'} and all(r['arbitrary_rotational_index_clear'] is True and r['whole_grip_tool_phases']==6 and r['module_continuous_upward_stroke_mm']==100 and r['angular_samples_used']==0 for r in module.values()),'Failed module or grip service')
    race=checks['bounded_race_recovery'];require(race['internal_free_race_rotation_admitted'] is False,'Loose collar rotation admitted')
    require(set(race['base_clear_for_bounded_recovery'])=={'inserted','turned'} and race['collar_delta_source_range_mm']==[-.5,.6]
            and race['captured_head_float_range_mm']==[0,.5] and race['internal_collar_turn_requires_upper_stop_delta_mm']==-.5,'Changed race recovery bounds')
    for stage,heights in race['base_clear_for_bounded_recovery'].items():
        require(set(heights)=={'5','7'},'Incomplete race recovery heights')
        require(all(rows and all(r['arbitrary_whole_assembly_index_clear'] is True and r['angular_samples_used']==0 for r in rows) for rows in heights.values()),'Failed race recovery')
        expected_race={r['name'] for r in admitted['proofs']['race']['continuous_bounds'][stage]}
        for rows in heights.values():
            require(len(rows)==len(expected_race) and {r['name'] for r in rows}==expected_race,'Missing race actor')
            require(all(r['continuous_downward_stroke_mm']==(1.6 if r['name'].startswith(('axial M4','threaded M4')) else 1.1) for r in rows),'Truncated race stroke')
    service=checks['panel_service'];require(len(service['cover_fasteners'])==4 and all(r['full_key_phases_clear'] is True and r['whole_screw_withdrawal_mm']==14 for r in service['cover_fasteners']) and service['continuous_panel_downward_removal_and_reverse_mm']==100 and service['wiring_stays_on_shell'] is True
            and service['panel_refit_requires_all_keys_withdrawn'] is True,'Failed panel path')
    require(checks['panel_lifecycle']==old.panel_lifecycle(admitted),'Air-gap panel protocol differs')


def load(path):
    config=json.loads(Path(path).read_bytes());require(config.get('schema')==1 and config.get('variant')==VARIANT,'Wrong combined air-gap admission')
    base=old.read_pin(config['base']);validate_base(base)
    admitted,_=read_coupling(config['coupling_admission']);proof=old.read_pin(config['compatibility'])
    require(proof['scope']=='AIR_GAP_C_BASE_COMPATIBILITY' and proof['base']==config['base'] and proof['coupling_admission']==config['coupling_admission'],'Air-gap proof binds other inputs')
    for key in ('physical_fit_verified','physical_spindle_load_capacity_verified','manufacturing_approved'):
        require(proof.get(key) is False,'Unsupported air-gap physical claim: '+key)
    modules=old.source_modules(proof['checker_sources']);require(modules==proof['checker_modules'],'Air-gap checker inventory differs')
    require(modules.get('hardware/cad/verification/'+HERE.name)==g.audit.digest(HERE),'Actually loaded air-gap checker differs')
    for relative,sha in modules.items():require(g.audit.digest(HERE.parents[3]/relative)==sha,'Consumer air-gap source differs: '+relative)
    for source,sha in proof['checker_sources'].items():require(g.audit.digest(Path(source))==sha,'Producer air-gap source differs')
    old.check_bound_paths(base);old.check_bound_paths(proof);validate_checks(proof['checks'],admitted)
    placement=proof['placement'];require(placement['bar_root_above_roof_mm']==5. and placement['required_hex_to_knob_underside_mm']==5.25
            and placement['minimum_all_angle_fixed_clearance_mm']==proof['checks']['positive_all_angle_clearance']['5']['minimum_all_angle_fixed_clearance_mm'],'Wrong air-gap placement')
    references=proof['base_reference_components']
    require(len(references)==13 and {r['name'] for r in references}=={'hardware-'+str(i) for i in range(12)}|{'stock_hex'}
            and all(r['role']=='hardware-reference' for r in references),'Incomplete purchased-hardware viewer references')
    return dict(base=base,candidate=admitted['candidate'],lifecycle=admitted['lifecycle'],
                panel_lifecycle=proof['checks']['panel_lifecycle'],placement=placement,base_reference_components=references)


def export_references(data,output):
    shapes={**{'hardware-'+str(i):shape for i,shape in enumerate(box.hardware(data['candidate']))},
            'stock_hex':data['candidate']['keepers']['stock']}
    records=[];directory=output/'hardware-reference';directory.mkdir()
    with old.detached_booleans():
        for name,shape in shapes.items():
            stem=directory/name;record=g.cad.export_part(deepcopy(shape),stem)
            record.update(name=name,role='hardware-reference',not_a_print_part=True)
            if name=='stock_hex':record['basis']='Existing nominal stock-hex model from operator estimates; actual fit unverified'
            for kind in ('step','stl'):
                record[kind]=str(stem.with_suffix('.'+kind).resolve());record[kind+'_sha256']=g.audit.digest(Path(record[kind]))
            actual=g.load_candidate_record(data['artifacts'],record)
            require(g.outside_volume(actual,shape)<1e-6 and g.outside_volume(shape,actual)<1e-6,'Purchased hardware reference export changed: '+name)
            records.append(record)
    return records


def build(base_path,coupling_path,output):
    base_pin=old.pin(base_path);coupling_pin=old.pin(coupling_path);data,_,admitted=prepare(base_pin,coupling_pin)
    checks=verify(data,admitted);validate_checks(checks,admitted)
    placement=dict(bar_root_above_roof_mm=5.,checked_bar_root_heights_mm=[5.,7.],nominal_hex_top_z_mm=-.25,
                   required_hex_to_knob_underside_mm=5.25,minimum_all_angle_fixed_clearance_mm=checks['positive_all_angle_clearance']['5']['minimum_all_angle_fixed_clearance_mm'],
                   root_to_roof_gap_is_not_global_minimum=True)
    sources={str(p):sha for p,sha in data['sources'].values()}
    g.require_fresh_namespace(output);g.unchanged(data);output.mkdir(parents=True,exist_ok=False)
    references=export_references(data,output)
    proof=dict(scope='AIR_GAP_C_BASE_COMPATIBILITY',base=base_pin,coupling_admission=coupling_pin,checks=checks,placement=placement,
               checker_sources=sources,checker_modules=old.source_modules(sources),validated_input_files=dict(data['artifacts'].files),
               base_reference_components=references,
               physical_fit_verified=False,physical_spindle_load_capacity_verified=False,manufacturing_approved=False)
    target=output/'compatibility.json';target.write_text(json.dumps(proof,indent=2)+'\n')
    config=dict(schema=1,variant=VARIANT,base=base_pin,coupling_admission=coupling_pin,compatibility=old.pin(target))
    admission=output/'admission.json';admission.write_text(json.dumps(config,indent=2)+'\n')
    try:g.unchanged(data);load(admission)
    except Exception:
        admission.rename(output/'admission.INVALID.json');raise
    print(admission);print(g.audit.digest(admission))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('base-receipt','coupling-admission','output'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();build(args.base_receipt,args.coupling_admission,args.output)
