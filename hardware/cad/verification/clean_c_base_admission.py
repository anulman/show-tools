"""Bind the frozen four-print base to a freshly admitted reduced C coupling.

The base's older coupling receipt remains construction history. Only this new
compatibility proof admits the reduced coupling with that base.
"""
from __future__ import annotations
import argparse
import json
import math
import hashlib
import io
from copy import deepcopy
from contextlib import contextmanager
from pathlib import Path
import sys

HERE=Path(__file__).resolve()
sys.path.insert(0,str(HERE.parents[1]/'box-mount/access'))
import c_mount_no_ballast as base_cad
from candidate_protocol import negative_controls
from publication_bundle import check_bound_paths
import publication_bundle
from build123d import extrude,import_step
from OCP.BRepTools import BRepTools
from OCP.TopTools import TopTools_FormatVersion

g=base_cad.g
common=base_cad.common
panel=base_cad.panel
require=base_cad.require
BASE_SHA='a3d5d88da0eaf7db7155a125e651cdc6a879917293f68171a1720b47da43cb2e'
VARIANT='reduced-cover-B'
CHECKS={'support_fusion','structure','rotors_with_blank_panel_closed',
        'root_tools_panel_off','module_and_grip_service','relaxed_C_recovery',
        'panel_removal_refit','panel_service_lifecycle'}


@contextmanager
def detached_booleans():
    """Retain strict native checks while protecting actual operands from OCCT."""
    native=g.native_boolean_volume;legacy=g.audit.intersection
    def detached(first,second,kind):return native(deepcopy(first),deepcopy(second),kind)
    g.native_boolean_volume=detached
    g.audit.intersection=lambda first,second:detached(first,second,'common')
    try:yield
    finally:g.native_boolean_volume=native;g.audit.intersection=legacy


def fingerprint(shape):
    stream=io.BytesIO()
    BRepTools.Write_s(shape.wrapped,stream,False,False,TopTools_FormatVersion.TopTools_FormatVersion_VERSION_3)
    return hashlib.sha256(stream.getvalue()).hexdigest()


def unchanged_subjects(data):
    """Compare current delivered subjects with fresh imports, excluding meshes.

    Historical source shapes used to construct the base are not delivered
    subjects. Their recipe may change them while producing the new parts.
    """
    def records(value):
        if isinstance(value,dict):
            if {'step','step_sha256','stl','stl_sha256'}<=set(value):yield value
            for child in value.values():yield from records(child)
        elif isinstance(value,list):
            for child in value:yield from records(child)
    current=[]
    if 'C' in data:current.extend(records(data['C']))
    if 'four_print_base' in data.get('manifests',{}):
        base=data['manifests']['four_print_base']
        current.extend(base['review_components']+base['optional_components'])
    current.extend(records(data.get('proofs',{})))
    selected={record['step_sha256'] for record in current} if current else set(data['artifacts'].shapes)
    paths={sha:path for path,sha in data['artifacts'].files.items() if Path(path).suffix.lower()=='.step'}
    for sha,shape in data['artifacts'].shapes.items():
        if sha not in selected:continue
        require(sha in paths,'Cached actual solid has no pinned STEP')
        fresh=import_step(paths[sha]).solids()[0]
        require(shape.is_valid and fingerprint(shape)==fingerprint(fresh),'Actual subject mutated: '+paths[sha])


def verify_bearing_detached(data,candidate):
    """Clip detached faces so temporary bearing witnesses cannot alter the bar."""
    bar=common.load_parts(data,[data['C']['environment']])[0][1];before=fingerprint(bar)
    ring=g.cad.ring(44,45.5,1,-1)
    band=next(face for face in ring.faces() if abs(face.bounding_box().min.Z)<1e-7 and abs(face.bounding_box().max.Z)<1e-7)
    patches=[]
    for face in bar.faces():
        box=face.bounding_box()
        if abs(box.min.Z)<1e-7 and abs(box.max.Z)<1e-7:patches.extend((deepcopy(face)&deepcopy(band)).faces())
    area=sum(patch.area for patch in patches);require(area>0,'Actual reduced C bar has no passive bearing patch')
    for patch in patches:
        witness=g.audit.pose(extrude(deepcopy(patch),amount=.1,dir=(0,0,1)),candidate['gap'],panel.INDEX)
        require(g.outside_volume(witness,candidate['parts']['buffer'])<1e-6,'Reduced C bar patch escapes PTFE')
        require(g.outside_volume(witness.translate((0,0,-1)),candidate['parts']['spacer'])<1e-6,'Reduced C bar patch lacks rigid backing')
    require(bar.is_valid and fingerprint(bar)==before,'Temporary bearing witness mutated actual reduced C bar')
    return dict(actual_C_planar_patch_area_mm2=area,selected_radii_mm=[44,45.5],
                selected_patches_fully_backed_by_PTFE_and_support=True,passive_support_only=True,
                no_rotor_to_box_joint=True,physical_drag_and_load_capacity_verified=False)


def verify_structure_detached(data):
    # This process runs checks synchronously. Keep the frozen producer unchanged
    # and restore its dependency even when native geometry raises an exception.
    previous=common.verify_bearing
    common.verify_bearing=verify_bearing_detached
    try:return base_cad.verify_structure(detached_base_data(data))
    finally:common.verify_bearing=previous


def detached_base_data(data):
    # Legacy structural checks also form unions with base parts. Their entire
    # working base must be detached, not just operands passed to the native gate.
    return dict(data,candidate=deepcopy(data['candidate']),shim=deepcopy(data['shim']))


def source_modules(sources):
    """Canonical repo paths allow consumers in another identical checkout."""
    modules={}
    for source,sha in sources.items():
        marker='/hardware/cad/'
        require(marker in source,'Checker source is outside CAD tree: '+source)
        relative='hardware/cad/'+source.split(marker,1)[1]
        require(relative not in modules,'Duplicate canonical checker source: '+relative)
        modules[relative]=sha
    return modules


def pin(path):
    path=Path(path).resolve()
    return dict(path=str(path),sha256=g.audit.digest(path))


def read_pin(record):
    path=Path(record['path'])
    require(path.is_absolute() and path.is_file() and g.audit.digest(path)==record['sha256'],
            'Changed/missing admission input: '+str(path))
    return json.loads(path.read_bytes())


def check_relative_bindings(value,root):
    resolved=deepcopy(value)
    def resolve(item):
        if isinstance(item,dict):
            if {'path','sha256'}<=set(item):item['path']=str((root/item['path']).resolve())
            for child in item.values():resolve(child)
        elif isinstance(item,list):
            for child in item:resolve(child)
    resolve(resolved);check_bound_paths(resolved)


def coupling(record):
    from reduced_c_admission import load as load_c
    config=read_pin(record)
    require(config['schema']==1 and config['variant']==VARIANT,'Wrong reduced coupling variant')
    result=load_c(Path(record['path']))
    read_pin(record)
    require(result['requires_combined_base_admission'] is True,'Unexpected reduced C admission scope')
    require(len(result['inventory'])==17,'Reduced C does not have seventeen removable actors')
    return result


def panel_lifecycle(admitted):
    model=admitted['model'];result=panel.panel_product(model)
    lifecycle=admitted['lifecycle']
    count=lifecycle['reachable_states'] if isinstance(lifecycle,dict) else lifecycle.reachable_states
    require(result['C_projection_states']==count,'Panel product omitted reduced C states')
    controls={}
    for name,options in (
        ('bottom-off root guard removed',dict(require_open=False)),
        ('keys-out panel guard removed',dict(require_keys_out=False)),
        ('panel opening removed',dict(can_open=False)),
        ('panel refit removed',dict(can_close=False))):
        try:panel.panel_product(model,**options)
        except ValueError as error:controls[name]=str(error)
        else:raise ValueError('Unsafe reduced C panel protocol admitted: '+name)
    controls.update(negative_controls(model,admitted['inventory']))
    result.update(C_protocol_model_sha256=admitted['model_sha256'],negative_controls=controls,
                  panel_is_exterior_box_environment_not_a_new_ball_coupling_actor=True)
    # The historical generic product calls stationary ballast part of its panel
    # action label. No ballast exists in this base; correct the witness prose.
    for key in ('assembly_trace','removal_trace'):
        result[key]=[step.replace('wiring and sealed ballast stay fixed','wiring stays fixed') for step in result[key]]
    return result


def verify_rotors(data,admitted):
    manifest=data['C'];bar=common.load_parts(data,[manifest['environment']]);rows={};anchor=None
    names=set(admitted['inventory'])
    require(set(manifest['stages'])=={'outside','inserted','turned','nuts-seated','locked'},'Incomplete reduced C stage inventory')
    for stage,definition in manifest['stages'].items():
        parts=g.load_records(data,definition['components'],names)
        cup=dict(parts)['removable padded knob cup'].translate((0,0,-definition['source_pose']['shift']))
        if anchor is None:anchor=cup
        require(g.outside_volume(cup,anchor)<1e-6 and g.outside_volume(anchor,cup)<1e-6,'Reduced C fixed cup anchor changed')
        rows[stage]={}
        for gap in (5.,7.):
            mouth=gap+definition['source_pose']['shift']
            rows[stage][str(int(gap))]=g.check_rotor(data,[(n,g.audit.pose(s,mouth,-90)) for n,s in bar+parts],gap)
    return rows


@detached_booleans()
def prepare_base(base_pin):
    report=read_pin(base_pin)
    require(base_pin['sha256']==BASE_SHA,'Expected frozen four-print base')
    provenance=report['gate_provenance']['input_receipts']
    data=base_cad.prepare(Path(provenance['base']['path']),Path(provenance['C']['path']),
                          Path(provenance['C_admission']['path']).parents[1])
    actual=g.bind_input(data,'four_print_base',Path(base_pin['path']))
    require(data['snapshots']['four_print_base'].sha256==BASE_SHA,'Changed frozen base')
    check_bound_paths(actual)
    records=actual['review_components']
    parts=dict(g.load_records(data,records,{'shell','bottom','buffer','keeper_tab_0','keeper_tab_1'}))
    for name,part in parts.items():
        expected=data['candidate']['parts'][name]
        require(g.outside_volume(part,expected)<1e-6 and g.outside_volume(expected,part)<1e-6,'Frozen base differs from recipe: '+name)
    data['candidate']['parts'].update(parts)
    data['shim']=g.load_records(data,actual['optional_components'],{'height_shim'})[0][1]
    c=data['candidate'];c['kit']=dict(c['kit'],roof=parts['shell'],buffer=parts['buffer'])
    c['keepers']=dict(c['keepers'],roof=parts['shell']);data['fixed_ties']=dict(data['fixed_ties'],bottom=parts['shell'])
    return data,actual


def prepare(base_pin,coupling_pin):
    data,actual=prepare_base(base_pin)
    admitted=coupling(coupling_pin)
    data['C']=admitted['candidate'];data['proofs']=admitted['proofs']
    # Keep historical captured manifests immutable; new C gets separate bindings.
    config=g.bind_input(data,'reduced_C_admission',Path(coupling_pin['path']))
    root=Path(coupling_pin['path']).parent
    for name,record in dict(candidate=config['candidate'],protocol=config['protocol'],**config['proofs']).items():
        parsed=g.bind_input(data,'reduced_C_'+name,(root/record['path']).resolve())
        require(data['snapshots']['reduced_C_'+name].sha256==record['sha256'],'Changed reduced C proof: '+name)
        check_relative_bindings(parsed,root)
    data['sources'][HERE.name]=(HERE,g.audit.digest(HERE))
    publication_source=Path(publication_bundle.__file__).resolve()
    data['sources'][publication_source.name]=(publication_source,g.audit.digest(publication_source))
    g.unchanged(data)
    return data,admitted,actual


@detached_booleans()
def verify(data,admitted):
    unchanged_subjects(data)
    root=panel.verify_tools(data)
    root.pop('all_30_hardware_envelopes_retained_conservatively')
    root['all_20_hardware_envelopes_retained_conservatively']=True
    require(len(root['actions'])==4,'Both complete root tools must be checked at both heights')
    service=panel.verify_panel_service(data)
    service.pop('stationary_cable_and_sealed_ballast_remain_in_place')
    service.update(stationary_cable_remains_in_place=True,no_ballast_present=True)
    checks=dict(support_fusion=base_cad.verify_support_fusion(detached_base_data(data)),structure=verify_structure_detached(data),
                rotors_with_blank_panel_closed=verify_rotors(data,admitted),root_tools_panel_off=root,
                module_and_grip_service=common.verify_service(data),relaxed_C_recovery=common.verify_race_base(data),
                panel_removal_refit=service,panel_service_lifecycle=panel_lifecycle(admitted))
    unchanged_subjects(data)
    return checks


def validate_checks(checks,base,admitted):
    """Require successful geometry results and exact coverage, beyond file pins."""
    require(set(checks)==CHECKS,'Incomplete combined base checks')
    def same_base_result(actual,expected):
        if isinstance(expected,dict):
            return isinstance(actual,dict) and set(actual)==set(expected) and all(same_base_result(actual[k],v) for k,v in expected.items())
        if isinstance(expected,list):
            return isinstance(actual,list) and len(actual)==len(expected) and all(same_base_result(a,b) for a,b in zip(actual,expected))
        if isinstance(expected,bool):return actual is expected
        if isinstance(expected,float) and isinstance(actual,float) and expected!=0:
            # Detached native intersections change positive reaction volumes by
            # ~1e-12 mm3. Compare their serialization with relative1e-12 only;
            # zero residuals remain exact and native collision limits stay1e-6.
            return math.isfinite(actual) and math.isclose(actual,expected,rel_tol=1e-12,abs_tol=0.)
        return type(actual) is type(expected) and actual==expected
    # These base-only checks use identical actual parts and paths. Require every
    # recorded field, including positive reaction and backing witnesses.
    for name in ('support_fusion','structure','panel_removal_refit'):
        require(same_base_result(checks[name],base['checks'][name]),'Changed or failed base check: '+name)
    def clear(value):
        return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and 0<=value<1e-6
    manifest=admitted['candidate'];names=set(admitted['inventory'])|{manifest['environment']['name']}
    rotors=checks['rotors_with_blank_panel_closed']
    require(set(rotors)==set(manifest['stages']),'Incomplete all-stage rotor proof')
    for stage,heights in rotors.items():
        require(set(heights)=={'5','7'},'Incomplete rotor support heights: '+stage)
        for height,row in heights.items():
            require(row.get('arbitrary_revolutions_geometrically_clear') is True and row.get('angular_samples_used')==0,
                    'Failed analytic rotor proof: '+stage)
            parts=row['components'];actual=[part['name'] for part in parts]
            require(len(actual)==len(names) and set(actual)==names,'Incomplete rotor actor coverage: '+stage)
            require(all(clear(part['outside_rotary_envelope_mm3']) for part in parts),'Rotor escapes analytic envelope')
            certificate=row['certificate']
            require(certificate.get('analytic_all_angle_clearance') is True and certificate.get('angular_samples_used')==0
                    and certificate.get('gap_mm')==float(height),'Failed rotary envelope certificate')
            fixed=certificate['fixed_geometry'];fixed_names=[part['name'] for part in fixed]
            required={'shell','bottom','buffer','keeper_tab_0','keeper_tab_1','stock_hex','cable'}|{'hardware-'+str(i) for i in range(20)}
            require(len(fixed_names)==len(set(fixed_names)) and required<=set(fixed_names),'Incomplete fixed rotor obstacles')
            require(all(clear(part['envelope_intersection_mm3']) for part in fixed),'Rotary envelope intersects base')
    root=checks['root_tools_panel_off'];operations=admitted['proofs']['external']['root_tool_operations']
    require(root.get('tool_service_requires_bottom_removed') is True and root.get('bottom_absent') is True
            and root.get('all_20_hardware_envelopes_retained_conservatively') is True
            and root.get('simultaneous_3_to_4_key_transfer_base_clear') is True
            and root.get('verified_shared_service_index_degrees')==280.,'Failed root tool service proof')
    expected={(op['id'],height) for op in operations for height in (5.,7.)}
    require(len(operations)==2 and {op['AF_mm'] for op in operations}=={3,4},'Incomplete root tool inventory')
    actions=root['actions'];keys=[(row['action_id'],row['fixed_base_gap_mm']) for row in actions]
    require(len(keys)==4 and set(keys)==expected,'Incomplete root tool/height coverage')
    for row in actions:
        op=next(op for op in operations if op['id']==row['action_id'])
        require(row.get('whole_tool_sweep_vs_base_clear') is True and row['axis_binding']['AF_mm']==op['AF_mm']
                and clear(row['axis_binding']['axis_line_distance_mm'])
                and row['axis_binding']['axis_parallel_abs_dot']>=1-1e-8
                and row['minimum_table_clearance_mm']>=0,'Failed whole root tool clearance')
        phases=row['clearance_rows'];phase_names=[q['name'] for q in phases]
        expected_names={phase+'/'+part['name'] for phase,parts in op['phases'].items() for part in parts}
        require(set(op['phases'])=={'entry','operation','withdrawal'} and all(op['phases'].values())
                and len(phase_names)==len(expected_names) and set(phase_names)==expected_names,'Incomplete whole tool phases')
        for phase in phases:
            overlaps=phase['intersections_mm3']
            require({'shell','buffer','keeper_tab_0','keeper_tab_1'}|{'hardware-'+str(i) for i in range(20)}<=set(overlaps),
                    'Incomplete tool base obstacles')
            require(all(clear(v) for v in overlaps.values()),'Root tool intersects base')
    closed=root['closed_panel_negative_controls']
    require(len(closed)==4 and {(r['action_id'],r['gap_mm']) for r in closed}==expected
            and all(r['closed_panel_entry_overlap_mm3']>1e-5 for r in closed),'Missing closed-panel tool rejection')
    module=checks['module_and_grip_service']
    require(set(module)=={'5','7'},'Incomplete module/grip support heights')
    require(all(row==dict(module_continuous_upward_stroke_mm=100,whole_grip_tool_phases=6,
                         arbitrary_rotational_index_clear=True,angular_samples_used=0) for row in module.values()),
            'Failed module or whole grip-tool service proof')
    race=checks['relaxed_C_recovery']
    require(race.get('internal_free_race_rotation_admitted') is False
            and race.get('collar_delta_source_range_mm')==[-.5,.6]
            and race.get('captured_head_float_range_mm')==[0,.5]
            and race.get('internal_collar_turn_requires_upper_stop_delta_mm')==-.5,'Changed bounded race assumptions')
    bounds=admitted['proofs']['race']['continuous_bounds'];results=race['base_clear_for_bounded_recovery']
    require(set(bounds)=={'inserted','turned'} and set(results)==set(bounds),'Incomplete race stages')
    for stage,heights in results.items():
        require(set(heights)=={'5','7'},'Incomplete race support heights')
        expected_names={row['name'] for row in bounds[stage]};require(bool(expected_names),'Empty race inventory')
        for rows in heights.values():
            require(len(rows)==len(expected_names) and {row['name'] for row in rows}==expected_names,'Incomplete race actor coverage')
            for row in rows:
                stroke=1.6 if row['name'].startswith(('axial M4','threaded M4')) else 1.1
                require(row.get('arbitrary_whole_assembly_index_clear') is True and row.get('angular_samples_used')==0
                        and row.get('continuous_downward_stroke_mm')==stroke,'Failed bounded race clearance')
    require(checks['panel_service_lifecycle']==panel_lifecycle(admitted),'Combined panel model differs')


def load(path):
    """Recheck frozen actual bytes and freshly enumerate the reduced service model."""
    config=json.loads(Path(path).read_bytes())
    require(config['schema']==1 and config['variant']==VARIANT,'Unsupported combined admission')
    base=read_pin(config['base']);require(config['base']['sha256']==BASE_SHA,'Unexpected base')
    admitted=coupling(config['coupling_admission']);proof=read_pin(config['compatibility'])
    require(proof['scope']=='REDUCED_C_FOUR_PRINT_BASE_COMPATIBILITY','Wrong compatibility scope')
    require(proof['base']==config['base'] and proof['coupling_admission']==config['coupling_admission'],
            'Compatibility proof belongs to other inputs')
    modules=source_modules(proof['checker_sources'])
    require(modules==proof['checker_modules'],'Checker module inventory differs')
    require(modules.get('hardware/cad/verification/'+HERE.name)==g.audit.digest(HERE),'Combined checker source differs')
    for relative,sha in modules.items():
        require(g.audit.digest(HERE.parents[3]/relative)==sha,'Loaded checker module differs: '+relative)
    for source,sha in proof['checker_sources'].items():
        require(g.audit.digest(Path(source))==sha,'Changed combined checker source: '+source)
    check_bound_paths(base);check_bound_paths(proof)
    validate_checks(proof['checks'],base,admitted)
    product=panel_lifecycle(admitted)
    require(product==proof['checks']['panel_service_lifecycle'],'Combined panel model differs')
    for record in (config['base'],config['coupling_admission'],config['compatibility']):read_pin(record)
    return dict(base=base,candidate=admitted['candidate'],lifecycle=admitted['lifecycle'],panel_lifecycle=product)


def build(base_path,coupling_path,output):
    base_pin=pin(base_path);coupling_pin=pin(coupling_path)
    data,admitted,base=prepare(base_pin,coupling_pin)
    checks=verify(data,admitted)
    validate_checks(checks,base,admitted)
    proof=dict(scope='REDUCED_C_FOUR_PRINT_BASE_COMPATIBILITY',base=base_pin,coupling_admission=coupling_pin,
               checks=checks,checker_sources={str(p):sha for p,sha in data['sources'].values()},
               validated_input_files=dict(data['artifacts'].files),physical_fit_verified=False,manufacturing_approved=False)
    proof['checker_modules']=source_modules(proof['checker_sources'])
    g.require_fresh_namespace(output);g.unchanged(data);output.mkdir(parents=True,exist_ok=False)
    target=output/'compatibility.json';target.write_text(json.dumps(proof,indent=2)+'\n')
    config=dict(schema=1,variant=VARIANT,base=base_pin,coupling_admission=coupling_pin,compatibility=pin(target))
    admission=output/'admission.json';admission.write_text(json.dumps(config,indent=2)+'\n')
    try:g.unchanged(data);load(admission)
    except Exception:
        admission.rename(output/'admission.INVALID.json')
        raise
    print(admission);print(g.audit.digest(admission))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('base-receipt','coupling-admission','output'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();build(args.base_receipt,args.coupling_admission,args.output)
