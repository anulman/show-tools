"""C-specific compact mount, derived from frozen installed base artifacts.

Only shallow underside identifiers change material. All structural interfaces,
ports and purchased hardware remain those of the checked compact mount.
"""
from __future__ import annotations
import argparse
from copy import deepcopy
import json
import math
from pathlib import Path
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import post_glue_base_gate as gate
from build123d import Axis,Compound,export_step,import_step
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder

C_SHA='8d483074030cab6ffaeeaa4464259b1fa221faa140dff14c1b4ad958632b26e4'
ADMISSION_SHA='df5e87ecd6f2168db4719d089a3d65cced50c6e68be4b7aa873d66a0e05fe5c8'
EXTERNAL_SHA='090154872b2e4194f7de3b509756a6c9bb285a14a1acbd1b7cdacfaef6be759d'
INDEX=280.
DEPTH=.4
LABELS={'3':(-36.,30.),'4':(48.,0.),'C':(-48.,0.)}
SEGMENTS={
    'top':(0.,3.,4.6,.6),'middle':(0.,0.,4.6,.6),'bottom':(0.,-3.,4.6,.6),
    'upper_left':(-2.,1.5,.6,3.),'lower_left':(-2.,-1.5,.6,3.),
    'upper_right':(2.,1.5,.6,3.),'lower_right':(2.,-1.5,.6,3.)}
GLYPHS={'3':('top','middle','bottom','upper_right','lower_right'),
        '4':('middle','upper_left','upper_right','lower_right'),
        'C':('top','bottom','upper_left','lower_left')}


def require(value,message):gate.audit.require(value,message)


def markers(bottom_z):
    result={}
    for glyph,(x,y) in LABELS.items():
        strokes=[]
        for segment in GLYPHS[glyph]:
            dx,dy,width,height=SEGMENTS[segment]
            # Mirror local Y so the digits read from below, with +X to the right.
            strokes.append(gate.r.block(width,height,DEPTH+.05,(x+dx,y-dy,bottom_z-.05)))
        shape=strokes[0]
        for stroke in strokes[1:]:shape+=stroke
        result[glyph]=shape
    return result


def mark_bottom(original,bottom_z):
    masks=markers(bottom_z);changed=original
    for mask in masks.values():changed-=mask
    require(changed.is_valid and len(changed.solids())==1,'Identifiers disconnect bottom')
    return changed,masks


def verify_marks(original,changed,bottom_z,masks):
    require(gate.outside_volume(changed,original)<1e-6,'C bottom adds material')
    union=next(iter(masks.values()))
    for mask in list(masks.values())[1:]:union+=mask
    expected=original-union
    require(gate.outside_volume(changed,expected)<1e-6 and gate.outside_volume(expected,changed)<1e-6,
            'C bottom differs outside declared shallow identifiers')
    rows={}
    for glyph,mask in masks.items():
        cut=gate.intersection(original,mask)
        require(cut>1.,'Identifier missing from actual underside: '+glyph)
        # Same stroke footprint must retain the rest of the original 3 mm floor.
        from build123d import extrude
        faces=[face for face in mask.faces() if abs(face.bounding_box().min.Z-bottom_z+.05)<1e-6
               and abs(face.bounding_box().max.Z-bottom_z+.05)<1e-6]
        require(bool(faces),'Identifier footprint missing')
        for face in faces:
            witness=extrude(face,amount=2.55,dir=(0,0,1)).translate((0,0,DEPTH+.05))
            require(gate.outside_volume(witness,changed)<1e-6,'Identifier leaves insufficient floor web: '+glyph)
        rows[glyph]=dict(center_xy_mm=list(LABELS[glyph]),depth_mm=DEPTH,
                         removed_material_mm3=cut,remaining_floor_witness_mm=2.55)
    return rows


def prepare(base_receipt,candidate_receipt,bundle):
    data=gate.load_base(base_receipt)
    own=Path(__file__).resolve();data['sources'][own.name]=(own,gate.audit.digest(own))
    manifest=gate.bind_input(data,'C',candidate_receipt)
    require(data['snapshots']['C'].sha256==C_SHA,'Expected exact final C geometry')
    expected_sources={'post_glue_cassette.py','post_glue_couplings.py','check_post_glue_candidates.py',
                      'full_height.py','standard_collar.py','couplings.py','debond_checks.py','check_couplings.py','disco_bar.py'}
    require(set(manifest['source_code_sha256'])==expected_sources,'Incomplete C producer source inventory')
    gate.audit.source_revision(own.parents[4],'456665c',manifest['source_code_sha256'])
    admission=gate.bind_input(data,'C_admission',bundle/'C/admission.json')
    require(data['snapshots']['C_admission'].sha256==ADMISSION_SHA,'Expected reviewed C admission')
    require(admission['candidate_receipt']['sha256']==C_SHA,'Admission uses another C')
    proofs={}
    for name,record in admission['proofs'].items():
        proofs[name]=gate.bind_input(data,'C_'+name,bundle/record['path'])
        require(data['snapshots']['C_'+name].sha256==record['sha256'],'Changed C proof: '+name)
    require(data['snapshots']['C_external'].sha256==EXTERNAL_SHA,'Unexpected C tool proof')
    gate.audit.source_revision(own.parents[4],'94057a1',proofs['external']['source_code_sha256'])
    protocol=gate.bind_input(data,'C_protocol',bundle/admission['protocol']['path'])
    require(data['snapshots']['C_protocol'].sha256==admission['protocol']['sha256'],'Changed C protocol')
    for name in ('post_glue_lifecycle','candidate_protocol'):
        sys.path.insert(0,str(own.parents[2]/'verification'))
        module=__import__(name);path=Path(module.__file__).resolve()
        data['sources'][path.name]=(path,gate.audit.digest(path))
    import post_glue_lifecycle
    import candidate_protocol
    lifecycle=post_glue_lifecycle.verify_evidence(protocol,bundle)
    post_glue_lifecycle.verify_inventory(protocol,candidate_protocol.expected_inventory('C'))
    require(lifecycle.model_sha256==admission['model_sha256'],'C lifecycle differs from reviewed model')
    original=data['candidate']['parts']['bottom'];bottom_z=data['candidate']['original']['underside_z']
    changed,masks=mark_bottom(original,bottom_z)
    marks=verify_marks(original,changed,bottom_z,masks)
    candidate=data['candidate']
    candidate['parts']=dict(candidate['parts'],bottom=changed)
    candidate['ties']=dict(candidate['ties'],bottom=changed)
    data.update(C=manifest,proofs=proofs,original_bottom=original,marks=marks,
                lifecycle=dict(reachable_states=lifecycle.reachable_states,model_sha256=lifecycle.model_sha256))
    gate.unchanged(data)
    return data


def posed_axis(axis,gap,index):
    x,y,z=axis['point'];a=math.radians(index)
    return dict(point=[x*math.cos(a)+y*math.sin(a),x*math.sin(a)-y*math.cos(a),gap-z],
                direction=[0,0,1],AF_mm=axis['AF_mm'])


def load_parts(data,records):
    return gate.load_records(data,records,{record['name'] for record in records})


def verify_rotors(data):
    manifest=data['C'];bar=load_parts(data,[manifest['environment']]);rows={}
    names={r['name'] for r in manifest['stages']['outside']['components']}
    require(len(names)==22,'Incomplete final C actor inventory')
    anchor=None
    for stage,definition in manifest['stages'].items():
        parts=gate.load_records(data,definition['components'],names)
        cup=dict(parts)['removable padded knob cup'].translate((0,0,-definition['source_pose']['shift']))
        if anchor is None:anchor=cup
        require(gate.outside_volume(cup,anchor)<1e-6 and gate.outside_volume(anchor,cup)<1e-6,
                'C fixed cup anchor changed')
        rows[stage]={}
        for gap in (5.,7.):
            mouth=gap+definition['source_pose']['shift']
            rows[stage][str(int(gap))]=gate.check_rotor(data,[(n,gate.audit.pose(s,mouth,-90)) for n,s in bar+parts],gap)
    return rows


def verify_tools(data):
    operations=data['proofs']['external']['root_tool_operations']
    require({op['AF_mm'] for op in operations}=={3,4} and len(operations)==2,'Incomplete C root tools')
    locked={r['name']:r for r in data['C']['stages']['locked']['components']};rows=[]
    for op in operations:
        require(op['axis_source']['point'][2]==4.5,'Tool is not at final bottomed C floor')
        axis=dict(op['axis_source'],AF_mm=op['AF_mm'])
        if op['AF_mm']==3:
            actor=op['id'].removesuffix(' clamp and reverse');part=load_parts(data,[locked[actor]])[0][1]
            axes=[]
            for face in part.faces():
                surface=BRepAdaptor_Surface(face.wrapped)
                if surface.GetType()==GeomAbs_Cylinder:
                    cylinder=surface.Cylinder();v=cylinder.Axis().Direction();p=cylinder.Location()
                    if abs(cylinder.Radius()-2)<1e-6 and abs(v.Z())>1-1e-8:axes.append([p.X(),p.Y()])
            require(bool(axes) and all(math.dist(p,axis['point'][:2])<1e-6 for p in axes),'M4 shaft/tool axis differs')
            require(abs((gate.service_index(axis['point'],'lock')-INDEX)%360)<1e-6,'Wrong C lock index')
        else:require(op['drive_arc_source_deg']==[260.,295.],'Wrong C drive arc')
        source={phase:load_parts(data,records) for phase,records in op['phases'].items()}
        for gap in (5.,7.):
            sweeps={phase:[(name,gate.audit.pose(part,gap,INDEX)) for name,part in parts] for phase,parts in source.items()}
            box_axis=posed_axis(axis,gap,INDEX)
            operation=dict(action_id=op['id'],tool_name=op['tool_name'],tool_part=op['tool_part'],gap_mm=gap,
                           service_index_degrees=INDEX,access='root',target_axis=box_axis,tool_axis=box_axis,
                           bar_mouth_z_range_mm=[gap,gap+2.1],approach_box=[0,0,1])
            rows.append(gate.check_box_operation(data,operation,sweeps))
    return dict(actions=rows,simultaneous_transfer_base_clear_same_index=INDEX,
                tool_to_tool_and_socket_contact_evidence='pinned C external proof; unchanged actual tools and coupling')


def verify_service(data):
    result={};external=data['proofs']['external'];selected=[row for row in external['evidence']
             if row['id'] in {sign+' grip key '+phase for sign in ('-1','+1') for phase in ('entry','operation','withdrawal')}]
    require(len(selected)==6,'Incomplete actual AF1.5 grip tool phases')
    grip=[(row['id']+'/'+name,part.translate((0,0,-50))) for row in selected for name,part in load_parts(data,row['sweeps'])]
    module=load_parts(data,data['C']['stages']['inserted']['components'])
    for gap in (5.,7.):
        window=gate.cad.ring(33.5,43.5,16.,-12.5)+gate.cad.ring(30.,43.5,gap-3.5,3.5)+gate.cad.cyl(100.,200.-gap,gap)
        grip_window=gate.cad.cyl(150.,200.-gap-12,gap+12)+gate.cad.ring(119.,150.,30.,gap-2)
        _,fixed=gate.fixed_geometry(data,gap)
        for name,part in fixed.items():
            require(gate.intersection(window,part)<1e-6,'Module withdrawal envelope blocked: '+name)
            require(gate.intersection(grip_window,part)<1e-6,'Grip tool all-angle envelope blocked: '+name)
        for name,part in module:require(gate.outside_volume(gate.audit.pose(part,gap,-90),window)<1e-6,'Module escapes service envelope: '+name)
        for name,part in grip:require(gate.outside_volume(gate.audit.pose(part,gap,-90),grip_window)<1e-6,'Grip tool escapes all-angle envelope: '+name)
        result[str(int(gap))]=dict(module_continuous_upward_stroke_mm=100,whole_grip_tool_phases=6,
                                  arbitrary_rotational_index_clear=True,angular_samples_used=0)
    return result


def verify_race_base(data):
    """Check bounded relaxed-race recovery against the base without admitting free rotation."""
    rows={}
    for stage,actors in data['proofs']['race']['continuous_bounds'].items():
        require(stage in ('inserted','turned'),'Unexpected C race stage')
        actual=dict(load_parts(data,data['C']['stages'][stage]['components']));rows[stage]={}
        for gap in (5.,7.):
            _,fixed=gate.fixed_geometry(data,gap);checked=[]
            for actor in actors:
                name=actor['name'];part=gate.audit.pose(actual[name],gap,INDEX)
                # Original range is delta[-.5,.6], starting at -.5. The still-
                # threaded bolt/nut can move another +.5 with captured head float.
                stroke=1.6 if name.startswith(('axial M4','threaded M4')) else 1.1
                box=part.bounding_box();radius=max(math.hypot(x,y) for x in (box.min.X,box.max.X)
                                                   for y in (box.min.Y,box.max.Y))+1
                high=box.max.Z+1
                # Eroding each R/Z band by the complete downward stroke gives
                # a window W with W+[0,-stroke] contained in the ordinary rotary
                # window for every continuous displacement, not sampled poses.
                window=gate.cad.ring(33.,43.5,12.5-stroke,-12.5+stroke)
                window+=gate.cad.ring(33.5,43.5,3.5+stroke,0)
                window+=gate.cad.ring(30.,43.5,gap-3.5,3.5+stroke)
                if high>gap+stroke:window+=gate.cad.cyl(radius,high-gap-stroke,gap+stroke)
                require(gate.outside_volume(part,window)<1e-6,'C relaxed-race actor escapes eroded window: '+name)
                for obstacle,fixed_part in fixed.items():
                    require(gate.intersection(window,fixed_part)<1e-6,'C recovery eroded window hits base: '+obstacle)
                checked.append(dict(name=name,continuous_downward_stroke_mm=stroke,
                                    arbitrary_whole_assembly_index_clear=True,angular_samples_used=0))
            rows[stage][str(int(gap))]=checked
    return dict(base_clear_for_bounded_recovery=rows,
                collar_delta_source_range_mm=[-.5,.6],captured_head_float_range_mm=[0,.5],
                internal_collar_turn_requires_upper_stop_delta_mm=-.5,
                internal_free_race_rotation_admitted=False)


def verify_bearing(data,candidate):
    from build123d import extrude
    bar=load_parts(data,[data['C']['environment']])[0][1]
    ring=gate.cad.ring(44,45.5,1,-1)
    band=next(face for face in ring.faces() if abs(face.bounding_box().min.Z)<1e-7 and abs(face.bounding_box().max.Z)<1e-7)
    patches=[]
    for face in bar.faces():
        box=face.bounding_box()
        if abs(box.min.Z)<1e-7 and abs(box.max.Z)<1e-7:patches.extend((face&band).faces())
    area=sum(patch.area for patch in patches);require(area>0,'Actual C bar has no passive bearing patch')
    for patch in patches:
        witness=gate.audit.pose(extrude(patch,amount=.1,dir=(0,0,1)),candidate['gap'],INDEX)
        require(gate.outside_volume(witness,candidate['parts']['buffer'])<1e-6,'C bar patch escapes PTFE')
        require(gate.outside_volume(witness.translate((0,0,-1)),candidate['parts']['spacer'])<1e-6,
                'C bar patch lacks rigid backing')
    return dict(actual_C_planar_patch_area_mm2=area,selected_radii_mm=[44,45.5],
                selected_patches_fully_backed_by_PTFE_and_support=True,passive_support_only=True,
                no_rotor_to_box_joint=True,physical_drag_and_load_capacity_verified=False)


def verify_base(data):
    rows={}
    for gap in (5.,7.):
        candidate=gate.compact.configuration(data['candidate'],gap)
        parts=candidate['parts'];shell=parts['shell'];bottom=parts['bottom'];original=candidate['original']
        for name,part in parts.items():require(part.is_valid and len(part.solids())==1,'Invalid actual C box part: '+name)
        for i,(name,part) in enumerate(parts.items()):
            for other,obstacle in list(parts.items())[i+1:]:
                require(gate.intersection(part,obstacle)<1e-6,'C box parts overlap: '+name+'/'+other)
        require(abs(bottom.bounding_box().min.Z-original['underside_z'])<1e-6,'C bottom ground datum changed')
        require(abs(shell.bounding_box().max.Z-original['shell'].bounding_box().max.Z)<1e-6,'C roof datum changed')
        # Extruding an imported face can alter its shared OCCT topology. Detached
        # faces keep this temporary withdrawal construction off the actual part.
        from build123d import extrude
        removal=deepcopy(bottom)
        for face in bottom.faces():
            if face.normal_at().Z>.9:removal=removal+extrude(deepcopy(face),amount=-100,dir=(0,0,1))
        require(gate.intersection(removal,shell)<1e-6,'C bottom cannot withdraw continuously downwards')
        require(bottom.is_valid,'Temporary withdrawal sweep mutated actual bottom')
        fixed=shell+bottom
        joints=gate.r.check_joints(candidate['covers']['pairs'],fixed)
        cover_loading=gate.r.verify_nut_loading(candidate['covers']['pairs'],shell)
        cassette_loading=gate.r.verify_nut_loading(candidate['capsule']['pairs'],candidate['capsule']['body'])
        ties=gate.r.verify_tiedowns(candidate['ties'],original['underside_z'])
        ballast=gate.r.verify_cassette(candidate['capsule'])
        for name in ('ballast_body','ballast_lid'):
            require(gate.intersection(parts[name],fixed)<1e-6,'Ballast part blocked by C base: '+name)
        for cube in candidate['ballast_cubes']:require(gate.intersection(cube,fixed)<1e-6,'C base obstructs ballast cube')
        hardware=gate.compact.base.candidate_hardware(candidate)
        for item in hardware:
            for name,part in parts.items():require(gate.intersection(item,part)<1e-6,'C base blocks standard hardware: '+name)
        require(gate.intersection(original['cable_envelope'],fixed)<1e-6,'C base obstructs cable reserve')
        require(gate.intersection(original['bottom'],gate.cad.cyl(14,.1,original['floor_z']-.05))-
                gate.intersection(bottom,gate.cad.cyl(14,.1,original['floor_z']-.05))<1e-6,
                'C central floor reserve changed')
        buffer=gate.compact.base.buffer_cad.verify(candidate['kit'])
        buffer_loading=gate.r.verify_nut_loading(candidate['kit']['pairs'],shell)
        keeper_loading=gate.r.verify_nut_loading(candidate['keepers']['pairs'],shell)
        keeper_body=shell+parts['keeper_tab_0']+parts['keeper_tab_1']
        keeper_joints=gate.r.check_joints(candidate['keepers']['pairs'],keeper_body)
        checks=dict(valid_single_solids=True,all_parts_separate=True,ground_and_roof_alignment_preserved=True,
                    central_floor_reserve_preserved=True,continuous_bottom_withdrawal_clear=True,
                    cover_joints=joints,cover_nut_loading=cover_loading,cassette_nut_loading=cassette_loading,
                    cable_tiedowns=ties,ballast=ballast,cable_reserve_clear=True,
                    standard_hardware_solid_count=len(hardware),all_hardware_clear=True,buffer=buffer,
                    buffer_nut_loading=buffer_loading,keeper_nut_loading=keeper_loading,keeper_joints=keeper_joints)
        checks['stock_hex_capture']=gate.compact.verify_hex_capture(candidate)
        checks['lower_support_web']=gate.compact.verify_lower_web(candidate)
        checks['actual_C_passive_bearing']=verify_bearing(data,candidate)
        rows[str(int(gap))]=checks
    return rows


def export(data,output):
    gate.require_fresh_namespace(output);output.mkdir(parents=True,exist_ok=False)
    # Exclusive directory ownership; any failed build stays visibly incomplete.
    records=[];exports=gate.audit.Artifacts()
    for record in [*data['report']['review_components'],*data['report']['optional_components']]:
        name=record['name'];directory='optional-shim' if name=='height_shim' else 'materials-DO-NOT-PRINT' if name=='buffer' else 'print-candidates'
        stem=output/directory/name;stem.parent.mkdir(exist_ok=True)
        if name=='bottom':
            new=gate.cad.export_part(data['candidate']['parts'][name],stem);new.update(name=name,role=directory)
            for kind in ('step','stl'):new[kind]=str(stem.with_suffix('.'+kind).resolve());new[kind+'_sha256']=gate.audit.digest(Path(new[kind]))
        else:
            new=dict(record)
            for kind in ('step','stl'):
                target=stem.with_suffix('.'+kind);shutil.copyfile(record[kind],target)
                new[kind]=str(target.resolve());require(gate.audit.digest(target)==record[kind+'_sha256'],'Copied base artifact differs')
        actual=exports.load(new)
        source=data['shim'] if name=='height_shim' else data['candidate']['parts'][name]
        require(gate.outside_volume(actual,source)<1e-6 and gate.outside_volume(source,actual)<1e-6,'New base STEP changed source: '+name)
        if name!='height_shim':data['candidate']['parts'][name]=actual
        else:data['shim']=actual
        records.append(new)
    data['candidate']['ties']=dict(data['candidate']['ties'],bottom=data['candidate']['parts']['bottom'])
    data['candidate']['kit']=dict(data['candidate']['kit'],roof=data['candidate']['parts']['shell'],
                               spacer=data['candidate']['parts']['spacer'],buffer=data['candidate']['parts']['buffer'])
    data['artifacts'].files.update(exports.files)
    checks=dict(underside_identifiers=data['marks'],rotors=verify_rotors(data),tools=verify_tools(data),
                module_and_grip_service=verify_service(data),relaxed_C_recovery=verify_race_base(data),
                mounting_box=verify_base(data))
    assemblies={}
    locked=load_parts(data,data['C']['stages']['locked']['components'])
    bar=load_parts(data,[data['C']['environment']])
    for gap in (5.,7.):
        candidate=gate.compact.configuration(data['candidate'],gap)
        pieces=[*candidate['parts'].values(),*gate.compact.base.candidate_hardware(candidate),*candidate['ballast_cubes'],
                candidate['keepers']['stock'],*[gate.audit.pose(part,gap,INDEX) for _,part in bar+locked]]
        assembly=Compound(children=[part.solids()[0] for part in pieces]);path=output/f'complete-C-g{int(gap)}.step'
        require(export_step(assembly,path),'C mounting-box assembly export failed')
        restored=import_step(path)
        require(restored.is_valid and len(restored.solids())==len(pieces),'C mounting-box assembly inventory changed')
        sha=gate.audit.digest(path);data['artifacts'].files[str(path)]=sha
        assemblies[str(int(gap))]=dict(step=str(path.resolve()),sha256=sha,solids=len(pieces),
                                     source_to_step_boolean_identity='NOT_CLAIMED; checked individual actual exports are authoritative')
    patterns=data['report']['material_patterns'];load_parts(data,patterns)
    report=dict(scope='C_SPECIFIC_COMPACT_MOUNT_HUMAN_REVIEW_CANDIDATE',units='mm',C_receipt_sha256=C_SHA,
                base_parent_sha256=gate.BASE_SHA,geometry_checks_pass=True,physical_fit_verified=False,manufacturing_approved=False,
                review_components=[r for r in records if r['name']!='height_shim'],
                optional_components=[r for r in records if r['name']=='height_shim'],material_patterns=patterns,
                assemblies=assemblies,checks=checks,
                inherited_C_lifecycle=data['lifecycle'],C_service_index_degrees=INDEX,
                lock_port=dict(AF_mm=3,world_angle_degrees=135,radius_mm=38),
                drive_port=dict(AF_mm=4,world_arc_degrees=[20,-15],radius_mm=38.5),
                original_ports_and_stock_hex_and_passive_bearing_unchanged=True,
                no_rotor_to_box_retaining_joint_or_stop=True,arcade_unchanged=True,
                changed_material='Only shallow underside C, 3 and 4 identifiers on removable bottom',
                source_code_sha256={name:sha for name,(_,sha) in data['sources'].items()},
                pending=['Actual knob/resin fit, pad grip and structural loads','Hand access and stable 180mm service support',
                         'PTFE forming, drag, wear and creep','Underside identifier print legibility'])
    # freeze_report itself owns a fresh namespace; keep exports in a sibling directory.
    target,digest=gate.freeze_report(data,report,output/'verification')
    print(target);print(digest)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('base-receipt','candidate-receipt','bundle','output'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();export(prepare(args.base_receipt,args.candidate_receipt,args.bundle),args.output)
