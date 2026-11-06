"""Analytic rotary and full-tool gate for the exact frozen compact base.

This gate proves base compatibility only. It never admits a coupling lifecycle.
Part/bar insertion and reversibility remain separate, geometry-bound obligations.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import compact_mount as compact
from build123d import Axis
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common,BRepAlgoAPI_Cut
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.collections import List_TopoDS_Shape
r=compact.r
cad=compact.cad
audit=compact.audit
ear=compact.ear
BASE_SHA='29b85bff87c061eba9569b15b297d6f2109babcf30c14b96ff5576974282801b'
STANDARD_TOOLS={'1.5 mm hex key','2 mm hex key','2.5 mm hex key','3 mm hex key',
                '4 mm hex key','Phillips screwdriver','flat screwdriver','standard long-nose pliers','hand'}
PORTS={
    'lock':dict(radius_mm=38.,canonical_upright_angle_degrees=225.),
    'drive_locked':dict(radius_mm=38.5,canonical_upright_angle_degrees=45.),
    'drive_released':dict(radius_mm=38.5,canonical_upright_angle_degrees=135.),
}


def native_positive_volume(part,name):
    audit.require(not part.wrapped.IsNull(),'Null native input '+name)
    audit.require(BRepCheck_Analyzer(part.wrapped,True).IsValid(),'Invalid native input '+name)
    properties=GProp_GProps();BRepGProp.VolumeProperties_s(part.wrapped,properties)
    volume=properties.Mass()
    audit.require(math.isfinite(volume) and volume>0,'Native input is not positive-volume material: '+name)
    return volume


def native_boolean_volume(first,second,kind):
    """Fail closed on native Boolean failure; never convert an exception to zero."""
    for name,part in (('first',first),('second',second)):
        native_positive_volume(part,name)
    arguments=List_TopoDS_Shape();arguments.Append(first.wrapped)
    tools=List_TopoDS_Shape();tools.Append(second.wrapped)
    audit.require(kind in ('common','cut'),'Unsupported native Boolean')
    operation=BRepAlgoAPI_Common() if kind=='common' else BRepAlgoAPI_Cut()
    operation.SetArguments(arguments);operation.SetTools(tools)
    operation.SetFuzzyValue(0.)
    # OCCT clamps the request to intrinsic Precision::Confusion (1e-7 mm).
    audit.require(operation.FuzzyValue()<=1e-7,'Unexpected extra native fuzzy tolerance')
    operation.SetRunParallel(False);operation.Build()
    audit.require(operation.FuzzyValue()<=1e-7,'Native fuzzy tolerance changed during Boolean')
    audit.require(operation.IsDone(),'Native Boolean did not complete')
    result=operation.Shape()
    audit.require(not result.IsNull(),'Native Boolean returned null')
    audit.require(BRepCheck_Analyzer(result,True).IsValid(),'Native Boolean returned invalid topology')
    properties=GProp_GProps();BRepGProp.VolumeProperties_s(result,properties)
    volume=properties.Mass()
    audit.require(math.isfinite(volume) and volume>=0,'Native Boolean returned invalid volume')
    return volume


def intersection(first,second):return native_boolean_volume(first,second,'common')
def outside_volume(first,second):return native_boolean_volume(first,second,'cut')


def unchanged(data):
    for name,snapshot in data['snapshots'].items():
        snapshot.unchanged()
        audit.require(snapshot.parse()==data['manifests'][name],'Parsed base/tool manifest changed: '+name)
    for name,(path,sha) in data['sources'].items():
        audit.require(audit.digest(path)==sha,'Base gate source changed: '+name)
    data['artifacts'].unchanged()
    for snapshot in data['snapshots'].values():snapshot.unchanged()


def load_base(path):
    paths=(*ear.SOURCE_PATHS.values(),Path(ear.__file__).resolve(),Path(compact.measured.__file__).resolve(),
           Path(compact.previous.__file__).resolve(),Path(compact.__file__).resolve())
    source_paths={p.name:p for p in paths}
    own=Path(__file__).resolve()
    sources={name:(p,audit.digest(p)) for name,p in source_paths.items()}
    sources[own.name]=(own,audit.digest(own))
    snapshot=ear.ReceiptSnapshot.capture(path)
    audit.require(snapshot.sha256==BASE_SHA,'Expected exact frozen compact-base receipt')
    report=snapshot.parse()
    audit.require(set(report['source_code_sha256'])==set(source_paths),'Incomplete compact producer inventory')
    for name,p in source_paths.items():
        audit.require(sources[name][1]==report['source_code_sha256'][name],'Compact source differs: '+name)
    artifacts=audit.Artifacts();data=dict(snapshots={'base':snapshot},sources=sources,artifacts=artifacts,report=report,manifests={'base':report})
    unchanged(data)
    candidate=compact.build()  # Hardware derives from the exact pinned Joint-producing recipe.
    actual={record['name']:artifacts.load(record) for record in report['review_components']}
    audit.require(set(actual)==set(candidate['parts']),'Incomplete default installed base')
    candidate['parts']=actual
    candidate['kit']=dict(candidate['kit'],roof=actual['shell'],spacer=actual['spacer'],buffer=actual['buffer'])
    candidate['keepers']=dict(candidate['keepers'],roof=actual['shell'],tabs=[actual['keeper_tab_0'],actual['keeper_tab_1']])
    candidate['ties']=dict(candidate['ties'],bottom=actual['bottom'])
    shim=artifacts.load(report['optional_components'][0])
    expected_shim=compact.configuration(candidate,7.)['parts']['height_shim']
    audit.require(outside_volume(shim,expected_shim)<1e-6 and outside_volume(expected_shim,shim)<1e-6,
                  'Optional shim differs from pinned recipe')
    data.update(candidate=candidate,shim=shim)
    unchanged(data)
    return data


def bind_input(data,name,path):
    """Capture bytes before parsing. Caller independently validates producer sources."""
    audit.require(name not in data['snapshots'],'Input receipt name is already bound')
    snapshot=ear.ReceiptSnapshot.capture(path);manifest=snapshot.parse()
    data['snapshots'][name]=snapshot;data['manifests'][name]=manifest
    unchanged(data)
    return manifest


def load_records(data,records,expected_names):
    """Expected names must come from the complete actor/tool registry, including hardware."""
    names=[record['name'] for record in records]
    audit.require(len(names)==len(set(names)) and set(names)==set(expected_names),'Incomplete/duplicate geometry inventory')
    parts=[(record['name'],load_candidate_record(data['artifacts'],record)) for record in records]
    unchanged(data)
    return parts


ADAPTIVE_MASS='native adaptive closed-volume Eps1e-10; original rtol1e-6 unchanged'


def adaptive_mass(part):
    audit.require(not part.wrapped.IsNull() and BRepCheck_Analyzer(part.wrapped,True).IsValid(),
                  'Invalid adaptive mass input')
    properties=GProp_GProps()
    error=BRepGProp.VolumeProperties_s(part.wrapped,properties,1e-10,True,False)
    volume=properties.Mass()
    audit.require(math.isfinite(volume) and volume>0 and math.isfinite(error) and 0<=error<=1e-8,
                  'Adaptive closed-volume integration failed')
    return volume


def load_candidate_record(artifacts,record):
    """Match a candidate's declared mass algorithm without changing frozen base loading."""
    if 'mass_integration' not in record:return artifacts.load(record)
    audit.require(record['mass_integration']==ADAPTIVE_MASS,'Unknown candidate mass integration method')
    paths={kind:Path(record[kind]) for kind in ('step','stl')}
    for kind,path in paths.items():
        sha=audit.digest(path)
        audit.require(sha==record[kind+'_sha256'],'Changed '+kind+' artifact: '+record['name'])
        artifacts.files[str(path)]=sha
    key=record['step_sha256']
    if key not in artifacts.shapes:
        imported=audit.import_step(paths['step'])
        audit.require(imported.is_valid and len(imported.solids())==1,'Invalid actual STEP component')
        artifacts.shapes[key]=imported.solids()[0]
    part=artifacts.shapes[key]
    audit.require(part.is_valid and len(part.solids())==1,'Invalid actual STEP component')
    volume=adaptive_mass(part)
    mesh_key=record['stl_sha256']
    if mesh_key not in artifacts.meshes:
        mesh=audit.trimesh.load_mesh(paths['stl'])
        audit.require(isinstance(mesh,audit.trimesh.Trimesh) and mesh.is_watertight and
                      mesh.is_winding_consistent and math.isfinite(mesh.volume) and mesh.volume>0,
                      'Invalid actual STL component')
        artifacts.meshes[mesh_key]=(float(mesh.volume),mesh.bounds.copy())
    mesh_volume,mesh_bounds=artifacts.meshes[mesh_key]
    audit.require(math.isclose(mesh_volume,volume,rel_tol=.005),'Actual STEP/STL volumes disagree')
    bounds=part.bounding_box()
    expected=[[bounds.min.X,bounds.min.Y,bounds.min.Z],[bounds.max.X,bounds.max.Y,bounds.max.Z]]
    audit.require(audit.np.allclose(mesh_bounds,expected,atol=.05,rtol=0),'Actual STEP/STL bounds disagree')
    audit.require(math.isclose(volume,record['volume_mm3'],rel_tol=1e-6),
                  'Actual component disagrees with receipt volume')
    return part


def fixed_geometry(data,gap):
    audit.require(gap in (5.,7.),'Frozen base only establishes g5 and g7')
    c=compact.configuration(data['candidate'],gap)
    if gap==7:c['parts']['height_shim']=data['shim']
    fixed=compact.obstacles(c)
    # Every standard hardware solid is regenerated from the pinned declared Joint records.
    for name,hardware in fixed.items():
        if name.startswith('hardware-'):
            for other,part in c['parts'].items():
                audit.require(intersection(hardware,part)<1e-6,'Pinned hardware obstructed '+name+'/'+other)
    return c,fixed


def rotary_window(gap,upper_z=120.,outer_radius=100.):
    """Finite axisymmetric superset; containment proves all angles, not samples.

    The upper cylinder can be enlarged to enclose an entire candidate. All fixed
    base material is at/below the passive contact plane, checked independently.
    """
    audit.require(gap in (5.,7.) and upper_z>gap and outer_radius>44,'Invalid rotary envelope bounds')
    lower=cad.ring(33.,43.5,12.5,-12.5)
    above_roof=cad.ring(33.5,43.5,3.5,0)
    above_keepers=cad.ring(30.,43.5,gap-3.5,3.5)
    above_contact=cad.cyl(outer_radius,upper_z-gap,gap)
    return lower+above_roof+above_keepers+above_contact


def certify_window(data,gap,upper_z=120.,outer_radius=100.):
    unchanged(data);_,fixed=fixed_geometry(data,gap)
    window=rotary_window(gap,upper_z,outer_radius);rows=[]
    for name,part in fixed.items():
        audit.require(part.bounding_box().max.Z<=gap+1e-6,'Fixed part above passive contact plane: '+name)
        overlap=intersection(window,part)
        audit.require(overlap<1e-6,'Rotary envelope intersects fixed base: '+name)
        rows.append(dict(name=name,envelope_intersection_mm3=overlap))
    unchanged(data)
    return dict(gap_mm=gap,analytic_all_angle_clearance=True,
                radial_Z_bands=[dict(z_mm=[-12.5,0],r_mm=[33,43.5]),
                                dict(z_mm=[0,3.5],r_mm=[33.5,43.5]),
                                dict(z_mm=[3.5,gap],r_mm=[30,43.5]),
                                dict(z_mm=[gap,upper_z],r_mm=[0,outer_radius])],
                nominal_floor_clearance_mm=.5,nominal_below_roof_radial_clearance_mm=.5,
                intended_contact='Only named passive bar/PTFE bearing faces may touch at Z=gap',
                fixed_geometry=rows,angular_samples_used=0,
                sufficient_envelope_not_a_claim_of_maximum_usable_space=True)


def check_rotor(data,named_box_parts,gap):
    """Call for every state in which whole-assembly indexing is permitted.

    Include immutable glued bar geometry and EVERY co-rotating hardware solid.
    The caller must prove mechanical co-rotation and complete actor inventory.
    """
    audit.require(bool(named_box_parts) and len({n for n,_ in named_box_parts})==len(named_box_parts),'Missing/duplicate rotor inventory')
    maximum=max(p.bounding_box().max.Z for _,p in named_box_parts)+1
    radius=max(math.hypot(max(abs(p.bounding_box().min.X),abs(p.bounding_box().max.X)),
                          max(abs(p.bounding_box().min.Y),abs(p.bounding_box().max.Y))) for _,p in named_box_parts)+1
    radius=max(radius,45.)
    certificate=certify_window(data,gap,max(maximum,gap+1),radius)
    window=rotary_window(gap,max(maximum,gap+1),radius);rows=[]
    for name,part in named_box_parts:
        audit.require(part.is_valid and len(part.solids())==1,'Invalid rotor component: '+name)
        residual=outside_volume(part,window)
        audit.require(residual<1e-6,'Rotor escapes analytic all-angle envelope: '+name)
        rows.append(dict(name=name,outside_rotary_envelope_mm3=residual))
    unchanged(data)
    return dict(scope='BASE_ROTARY_COMPATIBILITY_ONLY',arbitrary_revolutions_geometrically_clear=True,
                angular_samples_used=0,certificate=certificate,components=rows,
                part_assembly_tool_access_and_lifecycle_not_admitted=True)


def port_point(port):
    definition=PORTS[port];angle=definition['canonical_upright_angle_degrees']-90
    radians=math.radians(angle);radius=definition['radius_mm']
    return radius*math.cos(radians),radius*math.sin(radians)


def service_index(source_target_point,port):
    """Index the WHOLE rotor; canonical upright means X180 before service Z-90."""
    x,y,_=source_target_point
    audit.require(math.hypot(x,y)>1e-6,'Actuator lies on main axis')
    target_angle=math.degrees(math.atan2(-y,x))
    station=PORTS[port]['canonical_upright_angle_degrees']-90
    return (station-target_angle+180)%360-180


def bind_axis(target,tool):
    def unit(v):
        norm=math.sqrt(sum(x*x for x in v));audit.require(norm>0,'Zero tool/target axis')
        return tuple(x/norm for x in v)
    first=unit(target['direction']);second=unit(tool['direction'])
    dot=abs(sum(a*b for a,b in zip(first,second)))
    delta=tuple(a-b for a,b in zip(tool['point'],target['point']))
    along=sum(a*b for a,b in zip(delta,first))
    distance=math.sqrt(sum((a-along*b)**2 for a,b in zip(delta,first)))
    audit.require(dot>=1-1e-9 and distance<1e-6,'Tool is not on declared actuator axis')
    audit.require(tool['AF_mm']==target['AF_mm'],'Tool AF differs from actual fastener/socket')
    return dict(axis_line_distance_mm=distance,axis_parallel_abs_dot=dot,AF_mm=tool['AF_mm'])


def _check_operation(data,operation,named_source_sweeps,frame):
    """Base side of one lifecycle action; bar/aperture collisions are separate.

    Call with source-Z-negative-inside-bar geometry. Index ALL affected actors
    identically elsewhere in the mechanism checker; no actuator-only reposing.
    """
    for key in ('action_id','tool_name','tool_part','gap_mm','service_index_degrees','access','target_axis','tool_axis'):
        audit.require(key in operation,'Missing tool binding field: '+key)
    audit.require(operation['action_id'] and operation['tool_name'] and operation['tool_part'],'Tool action lacks identity')
    audit.require(operation['tool_name'] in STANDARD_TOOLS,'Nonstandard tool is not admitted')
    height_key='mouth_z_mm' if frame=='source' else 'bar_mouth_z_range_mm'
    approach_key='approach_source' if frame=='source' else 'approach_box'
    audit.require(height_key in operation and approach_key in operation,'Missing tool binding field: '+height_key+' / '+approach_key)
    if frame=='source':
        audit.require(math.isfinite(operation['mouth_z_mm']),'Invalid physical bar mouth height')
        mouth_range=[operation['mouth_z_mm']]*2
    else:
        mouth_range=operation['bar_mouth_z_range_mm']
        audit.require(len(mouth_range)==2 and all(math.isfinite(v) for v in mouth_range) and mouth_range[0]<=mouth_range[1],
                      'Invalid physical bar mouth range')
    audit.require(operation['access'] in ('root','external-module'),'Above-root side access is forbidden')
    axis=bind_axis(operation['target_axis'],operation['tool_axis'])
    if operation['access']=='root':
        dx,dy,dz=operation[approach_key]
        correct_sign=dz<0 if frame=='source' else dz>0
        audit.require(abs(dx)<1e-9 and abs(dy)<1e-9 and correct_sign,'Root entry must approach axially from underside')
    audit.require(isinstance(named_source_sweeps,dict) and set(named_source_sweeps)=={'entry','operation','withdrawal'},
                  'Explicit entry/operation/withdrawal sweep phases required')
    audit.require(all(bool(rows) for rows in named_source_sweeps.values()),'Empty complete-tool sweep phase')
    for phase,rows in named_source_sweeps.items():
        for name,part in rows:
            audit.require(part.is_valid and len(part.solids())==1,'Whole-tool sweep requires a valid single solid: '+phase+'/'+name)
            native_positive_volume(part,name)
    _,fixed=fixed_geometry(data,operation['gap_mm'])
    posed=[(phase+'/'+name,audit.pose(part,operation['mouth_z_mm'],operation['service_index_degrees']) if frame=='source' else part)
           for phase,rows in named_source_sweeps.items() for name,part in rows]
    rows=[]
    for name,part in posed:
        overlaps={key:intersection(part,obstacle) for key,obstacle in fixed.items()}
        audit.require(all(v<1e-6 for v in overlaps.values()),'Bound lifecycle tool against compact base blocked: '+name)
        rows.append(dict(name=name,intersections_mm3=overlaps))
    lowest=min(part.bounding_box().min.Z for _,part in posed)
    bottom=data['candidate']['original']['underside_z']
    audit.require(lowest>=bottom-180,'Complete tool staging exceeds proposed 180 mm lift')
    unchanged(data)
    return dict(action_id=operation['action_id'],fixed_base_gap_mm=operation['gap_mm'],
                geometry_frame=frame,bar_mouth_z_range_mm=mouth_range,scope='ACTUAL_BASE_AND_TOOL_BINDING_ONLY',axis_binding=axis,
                whole_tool_sweep_vs_base_clear=True,clearance_rows=rows,
                lift_mm=180,minimum_table_clearance_mm=lowest-(bottom-180),
                mechanism_bar_aperture_capture_and_reverse_require_separate_evidence=True)


def check_operation(data,operation,named_source_sweeps):
    """SOURCE sweeps use one fixed source-to-box reference mouth throughout the action."""
    return _check_operation(data,operation,named_source_sweeps,'source')


def check_box_operation(data,operation,named_box_sweeps):
    """Use actual BOX sweeps for actions with coupled/time-varying source transforms.

    Compose each instantaneous physical transform BEFORE taking the swept union.
    Target/tool axes and approach_box are BOX coordinates; no transform is applied.
    """
    return _check_operation(data,operation,named_box_sweeps,'box')


def reference_report(data,worktree):
    """Check the current ports with frozen tool geometry, never admit old C2."""
    receipt=Path(data['report']['input_receipts']['collar']['path'])
    snapshot=ear.ReceiptSnapshot.capture(receipt);producer=snapshot.parse()
    audit.require(snapshot.sha256==data['report']['input_receipts']['collar']['sha256'],'Changed reference tool receipt')
    audit.require(set(producer['source_code_sha256'])==compact.previous.COLLAR_SOURCES,'Incomplete reference tool sources')
    audit.source_revision(worktree,producer['source_commit'],producer['source_code_sha256'])
    data['snapshots']['reference_tools']=snapshot;data['manifests']['reference_tools']=producer
    tools=[(rec['name'],data['artifacts'].load(rec)) for rec in producer['control_sweeps']]
    audit.require({name for name,_ in tools}==compact.previous.CONTROLS,'Incomplete reference whole-tool inventory')
    rows={}
    for gap in (5.,7.):
        _,fixed=fixed_geometry(data,gap)
        posed=[(name,audit.pose(part,gap,-90)) for name,part in tools]
        checks=[]
        for name,part in posed:
            overlaps={key:intersection(part,obstacle) for key,obstacle in fixed.items()}
            audit.require(all(v<1e-6 for v in overlaps.values()),'Reference port tool blocked: '+name)
            checks.append(dict(name=name,intersections_mm3=overlaps))
        rows[str(int(gap))]=checks
    unchanged(data)
    return dict(scope='FROZEN_BASE_ADMISSIBLE_ENVELOPE_AND_PORT_REFERENCE',
                base_receipt_sha256=BASE_SHA,
                input_receipts={name:dict(path=str(s.path),sha256=s.sha256) for name,s in data['snapshots'].items()},
                reference_tool_source_commit=producer['source_commit'],reference_tool_sources_sha256=producer['source_code_sha256'],
                native_boolean_policy=dict(completion_required=True,nonnull_required=True,valid_topology_required=True,
                                           requested_fuzzy_mm=0,effective_intrinsic_kernel_fuzzy_mm=1e-7,
                                           intersection_volume_tolerance_mm3=1e-6,exceptions_never_become_zero=True),
                old_C2_lifecycle_status='REJECTED: no post-glue lifecycle admitted by this gate',
                source_frame='Original source Z negative inside ball/bar',
                source_to_box=dict(rotation_x_degrees=180,service_rotation_z_degrees=-90,mouth_z_mm=[5,7]),
                ports={name:dict(value,installed_box_xy_mm=port_point(name)) for name,value in PORTS.items()},
                certificates={str(int(g)):certify_window(data,g) for g in (5.,7.)},
                reference_whole_tool_paths=rows,
                new_candidate_lifecycle_status='NOT_EVALUATED',
                allowed_indexing='Whole rotor, after tool withdrawal, only in separately certified retained states',
                lifecycle_admission_requires='Bare glued bar, every other part outside, full reversible CAD-bound transitions',
                validated_input_files=data['artifacts'].files,
                source_code_sha256={name:sha for name,(_,sha) in data['sources'].items()})



def require_fresh_namespace(path):
    audit.require(not path.exists() and not path.is_symlink(),'Proof namespace already exists')


def freeze_report(data,report,output):
    require_fresh_namespace(output)
    report=dict(report,gate_provenance=dict(
        base_receipt_sha256=BASE_SHA,
        input_receipts={name:dict(path=str(s.path),sha256=s.sha256) for name,s in data['snapshots'].items()},
        validated_input_files=dict(data['artifacts'].files),
        checker_sources_sha256={name:sha for name,(_,sha) in data['sources'].items()}))
    payload=(json.dumps(report,indent=2)+'\n').encode()
    expected=hashlib.sha256(payload).hexdigest()
    unchanged(data)  # Recheck captured source/input bytes immediately before any write.
    output.mkdir(parents=True,exist_ok=False)
    target=output/'receipt.json'
    created=False
    try:
        with target.open('xb') as stream:
            created=True
            stream.write(payload)
        unchanged(data)
        audit.require(audit.digest(target)==expected,'Frozen proof changed during write')
    except Exception:
        # Preserve failed evidence while removing its success name. No old namespace is touched.
        if created:target.rename(output/'receipt.INVALID.json')
        raise
    return target,expected


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-receipt',type=Path,required=True)
    parser.add_argument('--source-worktree',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();require_fresh_namespace(args.output)
    data=load_base(args.base_receipt);report=reference_report(data,args.source_worktree)
    target,digest=freeze_report(data,report,args.output)
    print(target);print(digest)
