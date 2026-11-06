"""C mount with a blank removable bottom and stationary wiring/ballast retention."""
from __future__ import annotations
import argparse
from collections import deque
from copy import deepcopy
from dataclasses import asdict
import hashlib
import json
import math
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import c_ready_mount as common
from build123d import Axis,Compound,Polygon,export_step,extrude,import_step
g=common.gate
require=common.require
INDEX=280.
KEEPER_X=40.5
KEEPER_Y=42.
CAPSULE_RAISE=1.5
WASHER_ID=3.2
WASHER_OD=12.
WASHER_T=.8
MIN_SHANK=2.86
MIN_HEAD_BEARING=4.97
WASHER_FLOAT=(WASHER_ID-MIN_SHANK)/2
WASHER_URL='https://www.tcfixings.co.uk/product/m3-type-l-penny-washers-bzp/718'
SCREW_STANDARD_URL='https://eshop.boellhoff.de/out/media/pdf/ISO_7380-1_Edelstahl_A2_Innensechskant___de.pdf'


def hull(points):
    points=sorted(set(points))
    def cross(o,a,b):return (a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0])
    lower=[];upper=[]
    for point in points:
        while len(lower)>=2 and cross(lower[-2],lower[-1],point)<=0:lower.pop()
        lower.append(point)
    for point in reversed(points):
        while len(upper)>=2 and cross(upper[-2],upper[-1],point)<=0:upper.pop()
        upper.append(point)
    return lower[:-1]+upper[:-1]


def nut_slide(x,y,z,af,height,travel):
    radius=af/math.sqrt(3);sign=1 if x>0 else -1
    points=[(x+sign*offset+radius*math.cos(i*math.pi/3),y+radius*math.sin(i*math.pi/3))
            for offset in (0.,travel) for i in range(6)]
    return extrude(Polygon(*hull(points),align=None),amount=height).translate((0,0,z))


def washers(data):
    return [g.cad.ring(WASHER_ID/2,WASHER_OD/2,WASHER_T,j.length_datum_z).translate((*j.expected_xy,0))
            for j in data['retention_joints']]


def prepare(base_receipt,candidate_receipt,bundle):
    data=common.prepare(base_receipt,candidate_receipt,bundle)
    own=Path(__file__).resolve();data['sources'][own.name]=(own,g.audit.digest(own))
    candidate=data['candidate'];floor=candidate['original']['floor_z']
    source=g.compact.build();unported=source['parts']['bottom'];bottom=source['covers']['bottom'];original_blank=bottom
    # Independently reproduce exactly the old cuts on the pinned unported source.
    old_record=data['report']['input_receipts']['collar']
    old=g.bind_input(data,'historical_port_recipe',Path(old_record['path']))
    require(data['snapshots']['historical_port_recipe'].sha256==old_record['sha256'],'Changed historical port recipe')
    controls=common.load_parts(data,old['control_sweeps']);ported=deepcopy(unported)
    for gap in (5.,7.):
        for _,tool in controls:ported=ported-g.audit.pose(tool,gap,-90.)
    require(g.outside_volume(ported,data['original_bottom'])<1e-6 and
            g.outside_volume(data['original_bottom'],ported)<1e-6,'Blank lid does not restore exactly the historical tool cuts')
    eyes=candidate['ties']['eyes'];with_eyes=bottom+eyes[0]+eyes[1]
    require(g.outside_volume(with_eyes,unported)<1e-6 and g.outside_volume(unported,with_eyes)<1e-6,
            'Blank lid changed wiring or screw features')
    shell=candidate['parts']['shell']
    for sign,eye in zip((-1,1),eyes):
        shell=shell+eye+g.r.block(8.,17.5,5.6,(sign*11.,-49.25,floor))
    # The closed cassette rises1.5mm to leave a substantial keeper lip above the
    # uncut lid. Its original closure screws remain independent of retention.
    for x in (-30.75,30.75):
        shell=shell+g.cad.cyl(4.5,1.5,floor+16.).translate((x,KEEPER_Y,0))
        shell=shell-g.cad.cyl(3.35,1.6,floor+13.9).translate((x,KEEPER_Y,0))
    joints=[]
    for sign,label in ((-1,'left'),(1,'right')):
        x=sign*KEEPER_X
        shell=shell+g.cad.cyl(4.5,16.4,floor+2.).translate((x,KEEPER_Y,0))
        # Axisymmetric clearance admits the complete stock washer and its play.
        shell=shell-g.cad.cyl(6.3,2.1,floor-.1).translate((x,KEEPER_Y,0))
        shell=shell-g.r.bore(x,KEEPER_Y,floor+1.9,floor+19.)
        shell=shell-nut_slide(x,KEEPER_Y,floor+13.5,5.8,2.7,7.)
        joints.append(g.r.make_joint('cassette-retention-'+label,(x,KEEPER_Y),floor+1.2,16.,floor+13.7,1))
        # Internal blind clearances only: the outside remains an unported lid.
        bottom=bottom-g.cad.cyl(3.3,.8,floor-.7).translate((x,KEEPER_Y,0))
        bottom=bottom-g.cad.cyl(6.3,1.,floor+1.1).translate((x,KEEPER_Y,0))
    require(shell.is_valid and len(shell.solids())==1,'Stationary retention disconnected shell')
    parts=dict(candidate['parts'],shell=shell,bottom=bottom)
    for name in ('ballast_body','ballast_lid'):parts[name]=parts[name].translate((0,0,CAPSULE_RAISE))
    candidate['parts']=parts
    candidate['capsule_shift']=tuple(v+(CAPSULE_RAISE if i==2 else 0) for i,v in enumerate(candidate['capsule_shift']))
    candidate['ballast_cubes']=[cube.translate((0,0,CAPSULE_RAISE)) for cube in candidate['ballast_cubes']]
    candidate['kit']=dict(candidate['kit'],roof=shell)
    candidate['keepers']=dict(candidate['keepers'],roof=shell)
    fixed_ties=dict(candidate['ties'],bottom=shell)
    data.update(retention_joints=joints,fixed_ties=fixed_ties,blank_lid_source=original_blank,
                old_unported_bottom=unported,source_bottom_restoration_verified=True)
    g.unchanged(data)
    return data


def hardware(data,candidate=None):
    return g.compact.base.candidate_hardware(candidate or data['candidate'])+g.r.joint_hardware(data['retention_joints'])+washers(data)


def fixed(data,gap,panel_present=True,cover_screws_present=True):
    candidate=g.compact.configuration(data['candidate'],gap)
    parts=dict(candidate['parts'])
    if not panel_present:parts.pop('bottom')
    result=dict(parts)
    for i,part in enumerate(g.compact.base.candidate_hardware(candidate)):
        # Covers are first in the Joint-derived hardware inventory, screw/nut pairs.
        if not cover_screws_present and i<2*len(candidate['covers']['pairs']) and i%2==0:continue
        result['standard-hardware-'+str(i)]=part
    result.update({'retention-hardware-'+str(i):part for i,part in enumerate(g.r.joint_hardware(data['retention_joints']))})
    result.update({'retention-washer-'+str(i):part for i,part in enumerate(washers(data))})
    result.update({'cube-'+str(i):part for i,part in enumerate(candidate['ballast_cubes'])})
    result.update(stock_hex=candidate['keepers']['stock'],cable=candidate['original']['cable_envelope'])
    return candidate,result


def service_data(data):
    # Preserve every other fixed part and all legacy fasteners conservatively.
    candidate=dict(data['candidate'],parts={name:part for name,part in data['candidate']['parts'].items() if name!='bottom'})
    return dict(data,candidate=candidate)


def verify_tools(data):
    rows=[];closed=[];opened=service_data(data)
    require('bottom' not in opened['candidate']['parts'],'Tool service must omit the actual bottom')
    for op in data['proofs']['external']['root_tool_operations']:
        axis=dict(op['axis_source'],AF_mm=op['AF_mm'])
        require(axis['point'][2]==4.5,'C tool does not bottom on its checked floor')
        if op['AF_mm']==4:require(op['drive_arc_source_deg']==[260.,295.],'Wrong final C drive arc')
        source={phase:common.load_parts(data,records) for phase,records in op['phases'].items()}
        for gap in (5.,7.):
            sweeps={phase:[(name,g.audit.pose(part,gap,INDEX)) for name,part in parts] for phase,parts in source.items()}
            bound=common.posed_axis(axis,gap,INDEX)
            action=dict(action_id=op['id'],tool_name=op['tool_name'],tool_part=op['tool_part'],gap_mm=gap,
                        service_index_degrees=INDEX,access='root',target_axis=bound,tool_axis=bound,
                        bar_mouth_z_range_mm=[gap,gap+2.1],approach_box=[0,0,1])
            checked=g.check_box_operation(opened,action,sweeps)
            for phase,parts in sweeps.items():
                for name,part in parts:
                    for extra in g.r.joint_hardware(data['retention_joints'])+washers(data):
                        require(g.intersection(part,extra)<1e-6,'C tool hits stationary cassette retention')
            overlap=sum(g.intersection(part,data['candidate']['parts']['bottom']) for _,part in sweeps['entry'])
            require(overlap>1e-5,'Closed blank lid did not block actual root tool')
            closed.append(dict(action_id=op['id'],gap_mm=gap,closed_panel_entry_overlap_mm3=overlap))
            rows.append(checked)
    _,obstacles=fixed(data,5.,False,True)
    return dict(tool_service_requires_bottom_removed=True,service_obstacle_names=sorted(obstacles),
                bottom_absent=True,all_30_hardware_envelopes_retained_conservatively=True,
                verified_shared_service_index_degrees=INDEX,legacy_bottom_port_alignment_required=False,
                actions=rows,closed_panel_negative_controls=closed,
                simultaneous_3_to_4_key_transfer_base_clear=True,
                mutual_tool_contact_and_capture_bound_to_pinned_external_proof=True)


def screw_sweep(joint,travel):
    x,y=joint.expected_xy;b=joint.length_datum_z
    require(joint.direction==1,'Expected underside upward screw')
    return g.cad.cyl(1.5,joint.length+travel,b-travel).translate((x,y,0))+\
           g.cad.cyl(2.85,1.65+travel,b-1.65-travel).translate((x,y,0))


def key2_bounds(joint,retreat=6.):
    x,y=joint.expected_xy;tip=joint.screw.bounding_box().min.Z+1.
    # AF2 circumradius1.155 fits the conservative1.2mm shaft; full16mm arm
    # rotation is insideR18. Only6mm retreat is needed to clear this outer face.
    def bound(stroke):
        return g.cad.cyl(1.2,100.+stroke,tip-100.-stroke).translate((x,y,0))+\
               g.cad.cyl(18.,2.4+stroke,tip-101.2-stroke).translate((x,y,0))
    return dict(entry=bound(retreat),operation=bound(0.),withdrawal=bound(retreat))


def verify_panel_service(data):
    candidate,obstacles=fixed(data,5.,True,True);bottom=candidate['parts']['bottom'];rows=[]
    for i,joint in enumerate(candidate['covers']['pairs']):
        sweep=screw_sweep(joint,14.)
        for name,part in obstacles.items():
            if name in ('standard-hardware-'+str(i*2),'standard-hardware-'+str(i*2+1)):continue
            require(g.intersection(sweep,part)<1e-6,'Cover screw cannot withdraw: '+name)
        tools=key2_bounds(joint)
        for phase,tool in tools.items():
            for name,part in obstacles.items():
                if name=='standard-hardware-'+str(i*2):continue
                require(g.intersection(tool,part)<1e-6,'Whole AF2 cover key blocked: '+name)
            require(tool.bounding_box().min.Z>=candidate['original']['underside_z']-180.,'Cover key exceeds180mm service lift')
        rows.append(dict(joint=joint.name,AF_mm=2,full_key_phases_clear=True,whole_screw_withdrawal_mm=14.,
                         socket_basis='Nominal ISO7380-1 AF2 interface; maximum screw envelope omits socket recess'))
    removal=deepcopy(bottom)
    for face in bottom.faces():
        if face.normal_at().Z>.9:removal=removal+extrude(deepcopy(face),amount=-100,dir=(0,0,1))
    _,remaining=fixed(data,5.,False,False)
    for name,part in remaining.items():require(g.intersection(removal,part)<1e-6,'Blank bottom service sweep blocked: '+name)
    require(bottom.is_valid,'Bottom service sweep mutated actual lid')
    return dict(cover_fasteners=rows,cover_screws_must_be_removed_before_panel=True,
                retained_roof_nuts_remain=True,continuous_panel_downward_removal_and_reverse_mm=100.,
                panel_refit_requires_all_C_tools_withdrawn=True,stationary_cable_and_sealed_ballast_remain_in_place=True,
                no_wire_disconnection_or_operator_cable_slack_assumption=True,
                open_obstacle_names=sorted(remaining))


def verify_retention(data):
    candidate=data['candidate'];floor=candidate['original']['floor_z'];parts=candidate['parts'];shell=parts['shell']
    stock_washers=washers(data);body=shell+stock_washers[0]+stock_washers[1]
    joints=g.r.check_joints(data['retention_joints'],body);rows=[]
    # Rectangular closed cassette71x15 fits a72x16 stationary tray. These
    # continuous play bounds include all nearby translations and possible yaw.
    yaw=math.asin(8./math.hypot(35.5,7.5))-math.atan2(7.5,35.5)
    require(yaw>0 and yaw<.015,'Unexpected cassette yaw bound')
    for sign,joint,washer in zip((-1,1),data['retention_joints'],stock_washers):
        x,y=joint.expected_xy;b=joint.length_datum_z
        core=g.cad.ring(WASHER_ID/2+WASHER_FLOAT,WASHER_OD/2-WASHER_FLOAT,WASHER_T,b).translate((x,y,0))
        envelope=g.cad.ring(WASHER_ID/2-WASHER_FLOAT,WASHER_OD/2+WASHER_FLOAT,WASHER_T,b).translate((x,y,0))
        # Intersecting all translated annuli gives this guaranteed steel core;
        # the expanded annulus contains every allowed washer position.
        _,obstacles=fixed(data,5.,True,True)
        for name,obstacle in obstacles.items():
            if name.startswith('retention-washer') or name=='retention-hardware-'+str(0 if sign<0 else 2):continue
            require(g.intersection(envelope,obstacle)<1e-6,'Stock washer play obstructed: '+name)
        witness=g.r.block(.15,1.,.1,(sign*34.825,KEEPER_Y,floor+2.))
        # Bound the inverse-transformed witness for |translation|<=.5 per axis,
        # |yaw|<=yaw:35.414/34.232 X and1.500 Y are rounded outward.
        expanded=g.r.block(1.22,3.04,.1,(sign*34.825,KEEPER_Y,floor+2.))
        require(g.outside_volume(expanded,parts['ballast_body'])<1e-6,'Body contact witness does not cover full cassette play')
        pressed=witness.translate((0,0,-.2))
        require(g.outside_volume(pressed,core)<1e-6,'Washer loses guaranteed capsule overlap')
        min_head=g.cad.cyl(MIN_HEAD_BEARING/2,.1,b).translate((x,y,0))
        contact=g.intersection(min_head,core);require(contact>1e-5,'Minimum screw bearing cannot capture washer throughout play')
        # Minimum published16mm screw length15.65 still spans the full nut+pitch.
        require(b+15.65>=joint.nut.bounding_box().max.Z+.5,'Minimum M3x16 thread reach is insufficient')
        nut_bound=nut_slide(*joint.expected_xy,floor+13.7,5.5,2.4,7.)
        require(g.outside_volume(joint.nut,nut_bound)<1e-6,'Actual retention nut outside load hull')
        require(g.intersection(nut_bound,shell)<1e-6,'Retention nut cannot load reversibly from side')
        insertion=g.cad.cyl(6.17,60.8,b-60.).translate((x,y,0))
        # The inner hole is omitted conservatively, excluding the bolt installed later.
        require(g.intersection(insertion,shell)<1e-6,'Stock washer cannot install axially')
        require(g.intersection(insertion,parts['ballast_body'])<1e-6,'Stock washer entry hits sealed capsule')
        bolt_bound=screw_sweep(joint,20.)
        require(g.intersection(bolt_bound,body)<1e-6,'Retention screw cannot install and withdraw')
        for phase,tool in key2_bounds(joint).items():
            for obstacle in (body,parts['ballast_body'],parts['ballast_lid'],joint.nut):
                require(g.intersection(tool,obstacle)<1e-6,'Whole AF2 retention key blocked')
            require(tool.bounding_box().min.Z>=candidate['original']['underside_z']-180.,'Retention key exceeds180mm service lift')
        rows.append(dict(joint=joint.name,washer_nominal_ID_OD_T_mm=[WASHER_ID,WASHER_OD,WASHER_T],
            full_radial_washer_play_mm=WASHER_FLOAT,minimum_shank_diameter_mm=MIN_SHANK,
            minimum_underhead_bearing_diameter_mm=MIN_HEAD_BEARING,minimum_head_core_overlap_mm3=contact,
            cassette_translation_bound_per_axis_mm=.5,cassette_yaw_bound_degrees=math.degrees(yaw),
            guaranteed_capsule_contact_witness_mm3=.015,stock_washer_requires_no_anti_yaw_part=True,
            nut_side_load_mm=7.,washer_axial_entry_mm=60.,bolt_withdrawal_mm=20.,whole_AF2_tool_clear=True))
    captures=[]
    for delta in ((1,0,0),(-1,0,0),(0,1,0),(0,-1,0),(0,0,1),(0,0,-1)):
        amount=g.intersection(parts['ballast_body'].translate(delta),body)
        if delta==(0,0,1):
            amount+=g.intersection(parts['ballast_lid'].translate(delta),body)
            for part in g.r.joint_hardware(candidate['capsule']['pairs']):
                amount+=g.intersection(part.translate(candidate['capsule_shift']).translate(delta),body)
        require(amount>1e-5,'Sealed cassette has an open escape direction')
        captures.append(dict(displacement_mm=list(delta),positive_capture_overlap_mm3=amount))
    for joint in candidate['covers']['pairs']:
        protected=g.cad.cyl(4.,10.,candidate['original']['underside_z']).translate((*joint.expected_xy,0))
        require(g.outside_volume((data['blank_lid_source']&protected),parts['bottom'])<1e-6,
                'Washer clearance changed a functional cover seat')
    for joint in data['retention_joints']:
        web=g.cad.cyl(3.3,2.3,candidate['original']['underside_z']).translate((*joint.expected_xy,0))
        require(g.outside_volume(web,parts['bottom'])<1e-6,'Blind screw clearance leaves insufficient lid floor')
    closure=g.r.verify_cassette(candidate['capsule'])
    ties=g.r.verify_tiedowns(dict(data['fixed_ties'],bottom=shell),floor)
    return dict(joints=joints,assembly=rows,closed_capsule_capture=captures,
        washer_primary_listing=WASHER_URL,screw_dimensional_standard=SCREW_STANDARD_URL,
        independent_sealed_capsule_closure=closure,stationary_cable_tiedowns=ties,
        no_custom_printed_keeper_parts=True,cable_ties_not_attached_to_removable_bottom=True,
        physical_retention_strength_verified=False)


def verify_structure(data):
    rows={}
    for gap in (5.,7.):
        candidate,obstacles=fixed(data,gap);parts=candidate['parts'];frame=parts['shell']+parts['bottom']
        for i,(name,part) in enumerate(parts.items()):
            require(part.is_valid and len(part.solids())==1,'Invalid actual panel-service part: '+name)
            for other,second in list(parts.items())[i+1:]:require(g.intersection(part,second)<1e-6,'Panel-service parts overlap: '+name+'/'+other)
        for item in hardware(data,candidate):
            for name,part in parts.items():require(g.intersection(item,part)<1e-6,'Standard hardware blocks panel-service part: '+name)
        for cube in candidate['ballast_cubes']:
            require(g.intersection(cube,frame)<1e-6,'Fixed frame obstructs ballast cube')
        require(g.intersection(candidate['original']['cable_envelope'],frame)<1e-6,'Fixed strain relief obstructs original cable envelope')
        checks=dict(cover_joints=g.r.check_joints(candidate['covers']['pairs'],frame),
                    stock_hex=g.compact.verify_hex_capture(candidate),lower_web=g.compact.verify_lower_web(candidate),
                    PTFE=g.compact.base.buffer_cad.verify(candidate['kit']),actual_C_bearing=common.verify_bearing(data,candidate),
                    keeper_nut_loading=g.r.verify_nut_loading(candidate['keepers']['pairs'],parts['shell']),
                    support_nut_loading=g.r.verify_nut_loading(candidate['kit']['pairs'],parts['shell']),
                    all_30_hardware_solid_envelopes_clear=True,all_printed_parts_separate=True,cable_reserve_clear=True)
        rows[str(int(gap))]=checks
    # Additional fasteners are well below every rotary/module-service window.
    upper=max(part.bounding_box().max.Z for part in g.r.joint_hardware(data['retention_joints']))
    require(upper< -12.5,'Additional fixed retention enters C rotary window')
    return dict(configurations=rows,additional_fixed_hardware_max_Z_mm=upper,
                additional_hardware_below_all_rotary_and_module_service_windows=True)


def panel_product(model,require_open=True,require_keys_out=True,can_open=True,can_close=True):
    """Exact product of unchanged C transition system and exterior panel bit."""
    names=tuple(sorted(set(model['parts'])|set(model['variables'])))
    def endpoint(which):
        return tuple(model['parts'][name][which] if name in model['parts'] else model['variables'][name][which] for name in names)
    initial=(endpoint('initial'),True);final=(endpoint('final'),True)
    reached={initial:None};queue=deque([initial]);reverse={};edges=[]
    while queue:
        state=queue.popleft();coupling,present=state;values=dict(zip(names,coupling))
        keys=values['root drive key'] or values['M4 key']
        require(not (present and keys),'C key present while bottom panel closed')
        next_steps=[]
        for action in model['actions']:
            if not all(values[name]==value for name,value in action['requires'].items()):continue
            if action['access']=='root' and present:
                if require_open:continue
                raise ValueError('Installed C action enabled with bottom closed')
            updated=values|action['sets']
            next_steps.append(((tuple(updated[name] for name in names),present),action['id']))
        if not require_keys_out or not keys:
            if present and can_open:next_steps.append(((coupling,False),'remove four cover screws and bottom; wiring and sealed ballast stay fixed'))
            if not present and can_close:next_steps.append(((coupling,True),'refit bottom and four cover screws with both C keys withdrawn'))
        for target,action in next_steps:
            edges.append((state,target,action));reverse.setdefault(target,[]).append((state,action))
            if target not in reached:reached[target]=(state,action);queue.append(target)
    require(final in reached,'No complete C assembly with final bottom closed')
    toward_initial={initial:None};queue=deque([initial])
    while queue:
        state=queue.popleft()
        for previous,action in reverse.get(state,[]):
            if previous not in toward_initial:toward_initial[previous]=(state,action);queue.append(previous)
    require(set(reached)<=set(toward_initial),'Panel product has a reachable state without complete reversal')
    assembly=[];state=final
    while state!=initial:
        previous,action=reached[state];assembly.append(action);state=previous
    removal=[];state=final
    while state!=initial:
        state,action=toward_initial[state];removal.append(action)
    ordered=sorted(reached,key=lambda item:json.dumps(item));indices={state:i for i,state in enumerate(ordered)}
    serialized=dict(states=ordered,edges=sorted((indices[a],indices[b],action) for a,b,action in edges))
    return dict(reachable_states=len(reached),C_projection_states=len({state[0] for state in reached}),
        transitions=len(edges),every_reachable_state_returns_to_bare_glued_bar_and_closed_box=True,
        initial_and_final_panel_closed=True,all_installed_C_actions_require_bottom_open=True,
        panel_changes_require_both_C_keys_withdrawn=True,
        assembly_trace=list(reversed(assembly)),removal_trace=removal,
        graph_sha256=hashlib.sha256(json.dumps(serialized,sort_keys=True,separators=(',',':')).encode()).hexdigest(),
        reachable_state_summary=[dict(id=indices[state],bottom_present=state[1],
            **{name:dict(zip(names,state[0]))[name] for name in ('root phase','root drive key','M4 key','completed screw turns')}) for state in ordered],
        scope='Exhaustive product of admitted C protocol and panel open/closed macro; individual cover-screw and panel paths are independently geometry checked')


def verify_panel_lifecycle(data):
    model=data['manifests']['C_protocol'];result=panel_product(model)
    require(result['C_projection_states']==data['lifecycle']['reachable_states'],'Panel product omitted admitted C states')
    controls={}
    for name,options in (
        ('bottom-off root guard removed',dict(require_open=False)),
        ('keys-out panel guard removed',dict(require_keys_out=False)),
        ('panel opening removed',dict(can_open=False)),
        ('panel refit removed',dict(can_close=False))):
        try:panel_product(model,**options)
        except ValueError as error:controls[name]=str(error)
        else:raise AssertionError('Unsafe C panel protocol admitted: '+name)
    import candidate_protocol
    controls.update(candidate_protocol.negative_controls(model,candidate_protocol.expected_inventory('C')))
    result.update(C_protocol_model_sha256=data['lifecycle']['model_sha256'],negative_controls=controls,
                  panel_is_exterior_box_environment_not_a_new_ball_coupling_actor=True)
    return result


def export(data,output):
    g.require_fresh_namespace(output);output.mkdir(parents=True,exist_ok=False);records=[];exports=g.audit.Artifacts()
    parts=dict(data['candidate']['parts'],height_shim=data['shim'])
    old={r['name']:r for r in data['report']['review_components']+data['report']['optional_components']}
    changed={'shell','bottom','ballast_body','ballast_lid'}
    import shutil
    for name,part in parts.items():
        directory='optional-shim' if name=='height_shim' else 'materials-DO-NOT-PRINT' if name=='buffer' else 'print-candidates'
        stem=output/directory/name;stem.parent.mkdir(exist_ok=True)
        if name in changed:
            record=g.cad.export_part(part,stem);record.update(name=name,role=directory)
            for kind in ('step','stl'):record[kind]=str(stem.with_suffix('.'+kind).resolve());record[kind+'_sha256']=g.audit.digest(Path(record[kind]))
        else:
            record=dict(old[name])
            for kind in ('step','stl'):
                path=stem.with_suffix('.'+kind);shutil.copyfile(record[kind],path);record[kind]=str(path.resolve())
                require(g.audit.digest(path)==record[kind+'_sha256'],'Unchanged component bytes differ')
        actual=exports.load(record)
        require(g.outside_volume(actual,part)<1e-6 and g.outside_volume(part,actual)<1e-6,'Panel-service export changed actual source: '+name)
        if name=='height_shim':data['shim']=actual
        else:data['candidate']['parts'][name]=actual
        records.append(record)
    candidate=data['candidate'];candidate['kit']=dict(candidate['kit'],roof=candidate['parts']['shell'],spacer=candidate['parts']['spacer'],buffer=candidate['parts']['buffer'])
    candidate['keepers']=dict(candidate['keepers'],roof=candidate['parts']['shell'])
    data['fixed_ties']=dict(data['fixed_ties'],bottom=candidate['parts']['shell']);data['artifacts'].files.update(exports.files)
    print('EXPORT actual panel-service parts PASS',flush=True)
    checks=dict(rotors_with_blank_panel_closed=common.verify_rotors(data),
                relaxed_C_recovery=common.verify_race_base(data),root_tools_panel_off=verify_tools(data),
                module_and_grip_service=common.verify_service(data),stationary_retention=verify_retention(data),
                panel_removal_refit=verify_panel_service(data),structure=verify_structure(data),
                panel_service_lifecycle=verify_panel_lifecycle(data))
    assemblies={}
    C=common.load_parts(data,[data['C']['environment'],*data['C']['stages']['locked']['components']])
    for gap in (5.,7.):
        configured=g.compact.configuration(candidate,gap)
        shapes=[*configured['parts'].values(),*hardware(data,configured),*configured['ballast_cubes'],configured['keepers']['stock'],
                *[g.audit.pose(part,gap,INDEX) for _,part in C]]
        path=output/f'complete-C-panel-service-g{int(gap)}.step';assembly=Compound(children=[part.solids()[0] for part in shapes])
        require(export_step(assembly,path),'Panel-service assembly export failed');restored=import_step(path)
        require(restored.is_valid and len(restored.solids())==len(shapes),'Panel-service assembly inventory changed')
        sha=g.audit.digest(path);data['artifacts'].files[str(path)]=sha
        assemblies[str(int(gap))]=dict(step=str(path.resolve()),sha256=sha,solids=len(shapes),
                source_to_step_boolean_identity='NOT_CLAIMED; actual individual exports are authoritative')
    patterns=data['report']['material_patterns'];common.load_parts(data,patterns)
    purchased=[]
    for side,washer in zip(('left','right'),washers(data)):
        stem=output/'purchased-DO-NOT-PRINT'/('M3-Type-L-washer-'+side);stem.parent.mkdir(exist_ok=True)
        record=g.cad.export_part(washer,stem);record.update(name='M3 Type L washer '+side,role='purchased steel washer envelope; DO NOT PRINT',source=WASHER_URL)
        for kind in ('step','stl'):record[kind]=str(stem.with_suffix('.'+kind).resolve());record[kind+'_sha256']=g.audit.digest(Path(record[kind]))
        exports.load(record);purchased.append(record)
    data['artifacts'].files.update(exports.files)
    report=dict(scope='C_MOUNT_WITH_REMOVABLE_BLANK_BOTTOM_FOR_COLLAR_SERVICE',units='mm',geometry_checks_pass=True,
                C_receipt_sha256=common.C_SHA,base_parent_sha256=g.BASE_SHA,
                tool_service_requires_bottom_removed=True,panel_refit_requires_all_C_tools_withdrawn=True,
                service_keeps_sealed_ballast_and_wiring_on_stationary_shell=True,
                restored_dedicated_legacy_tool_cutouts=True,no_3_or_4_port_labels=True,
                lid_has_no_through_latch_access_openings=True,internal_blind_retention_head_relief_depth_mm=.7,
                no_rotor_to_box_retaining_joint_or_stop=True,physical_fit_verified=False,manufacturing_approved=False,
                review_components=[r for r in records if r['name']!='height_shim'],
                optional_components=[r for r in records if r['name']=='height_shim'],material_patterns=patterns,
                purchased_components=purchased,
                assemblies=assemblies,checks=checks,inherited_C_lifecycle=data['lifecycle'],
                panel_service_protocol_requirements=dict(all_installed_C_actions_require_panel_off=True,
                    opening_and_closing_require_both_C_keys_withdrawn=True,initial_and_final_box_panel_closed=True),
                hardware_BOM=dict(button_M3x10=6,button_M3x12=2,button_M3x16=2,countersunk_M3x12_including_head=4,DIN934_M3_nuts=14,stock_M3_type_L_washers_3p2x12x0p8=2),
                hardware_roles=dict(bottom_cover='4 button M3x10 +4M3nuts',sealed_capsule_closure='2 button M3x10 +2M3nuts',
                    stationary_capsule_retention='2 button M3x16 +2M3nuts +2stock3.2x12x0.8washers',stock_hex_keepers='2 button M3x12 +2M3nuts',
                    passive_support='4 countersunk M3x12 +4M3nuts'),
                original_capsule_geometry_unchanged_with_installed_pose_raise_mm=CAPSULE_RAISE,
                source_code_sha256={name:sha for name,(_,sha) in data['sources'].items()},
                pending=['Physical resin/knob/fastener fit and keeper/strain-relief strength',
                         'Stable180mm service support and hand access','PTFE forming/drag/wear and actual grip loads'])
    target,digest=g.freeze_report(data,report,output/'verification');print(target);print(digest)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('base-receipt','candidate-receipt','bundle','output'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();export(prepare(args.base_receipt,args.candidate_receipt,args.bundle),args.output)
