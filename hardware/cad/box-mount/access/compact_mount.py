"""Compact measured-interface mount with unchanged C2 socket and optional height shim."""
from __future__ import annotations
import argparse
from dataclasses import asdict,replace
import json
import math
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import measured_hex_joint as measured
import resin_c2 as previous
from build123d import Axis,Compound,export_step,import_step
base=measured.ear.base
ear=measured.ear
r=measured.r
cad=measured.cad
audit=measured.audit
GAPS=(5.,7.)
INDEX=-90.
WELL_FLOOR=-13.
WEB_BOTTOM=-18.
LIFT=180.
FLAT_SOURCE='https://www.accu.co.uk/countersunk-socket-head-screws/5425-SSK-M3-12-A2'
GRIP_NAMES={f'{sign} {kind}' for sign in ('-1','+1') for kind in
            ('ordinary 1.5 mm grip key','full grip key operating sweep','full grip key axial entry sweep')}
GRIP_SOURCES={'check_grip_access.py','check_standard_collar.py','standard_collar.py','full_height.py','check_couplings.py'}


def unchanged(data):
    for name,snapshot in data['snapshots'].items():
        snapshot.unchanged()
        audit.require(snapshot.parse()==data['receipts'][name],'Parsed receipt differs from captured bytes: '+name)
    for name,(path,sha) in data['sources'].items():
        audit.require(audit.digest(path)==sha,'Compact source changed: '+name)
    data['artifacts'].unchanged()
    for snapshot in data['snapshots'].values():snapshot.unchanged()


def build():
    # The legacy field is used only as a conservative tool envelope here, never as knob metrology.
    fit=replace(measured.Parameters(),estimated_knob_diameter=48.)
    box=replace(cad.box_cad.Proposal(),tray_height=14,tray_length=20,tray_y=42,
                screw_clearance_diameter=r.H.clearance,nut_across_flats=r.H.nut_pocket_af,
                head_diameter=r.H.head_pocket_diameter,head_depth=r.H.head_pocket_depth)
    stack=cad.StackProposal(hex_across_flats=fit.well_af,hex_depth=fit.well_depth,
                           body_passage_diameter=fit.passage_diameter,spacer_height=4,
                           contact_inner_radius=44,contact_outer_radius=46)
    original=cad.stack(stack,box)
    covers=r.standard_covers(original['shell'],original['bottom'],original['fastener_axes'],
                             original['floor_z'],original['underside_z'])
    ties=r.cable_tiedowns(covers['bottom'],original['floor_z'],0)
    roof=covers['shell']
    # Continuous material below the moving annulus supports the island; no spoke crosses the race.
    roof+=cad.cyl(32.5,-WEB_BOTTOM,WEB_BOTTOM)
    roof+=cad.cyl(46,WELL_FLOOR-WEB_BOTTOM,WEB_BOTTOM)
    roof+=cad.ring(44,46,-WEB_BOTTOM,WEB_BOTTOM)
    roof-=cad.ring(32.5,44,-WELL_FLOOR+.1,WELL_FLOOR)
    interface=measured.interface(roof,fit,WEB_BOTTOM-.1)
    kit=base.buffer_cad.build(interface['roof'],5.)
    capsule=r.ballast_cassette(15);shift=(0,box.tray_y,original['floor_z']+.5)
    original['stock_hex_keepout']=interface['stock']
    parts=dict(shell=kit['roof'],bottom=ties['bottom'],spacer=kit['spacer'],buffer=kit['buffer'],
               keeper_tab_0=interface['tabs'][0],keeper_tab_1=interface['tabs'][1],
               ballast_body=capsule['body'].translate(shift),ballast_lid=capsule['lid'].translate(shift))
    return dict(variant='knob',box=box,stack=stack,original=original,covers=covers,ties=ties,
                keepers=interface,kit=kit,capsule=capsule,capsule_shift=shift,parts=parts,
                ballast_cubes=[p.translate(shift) for p in capsule['cubes']],gap=5.)


def configuration(candidate,gap):
    audit.require(gap in GAPS,'Use checked 5 or 7 mm configuration')
    if gap==5:return candidate
    shim=cad.ring(44,57,2.)
    for joint in candidate['kit']['pairs']:
        shim-=r.bore(*joint.expected_xy,-1,3)
    kit=dict(candidate['kit'],gap=gap,spacer=candidate['kit']['spacer'].translate((0,0,2)),
             buffer=candidate['kit']['buffer'].translate((0,0,2)),
             pairs=[replace(j,length_datum_z=j.length_datum_z+2,screw=j.screw.translate((0,0,2)))
                    for j in candidate['kit']['pairs']])
    parts=dict(candidate['parts'],spacer=kit['spacer'],buffer=kit['buffer'],height_shim=shim)
    return dict(candidate,kit=kit,parts=parts,gap=gap)


def prepare(collar,grip,baseline,hex_receipt,worktree):
    paths=(*ear.SOURCE_PATHS.values(),Path(ear.__file__).resolve(),Path(measured.__file__).resolve(),
           Path(previous.__file__).resolve(),Path(__file__).resolve())
    sources={path.name:(path,audit.digest(path)) for path in paths}
    snapshots={name:ear.ReceiptSnapshot.capture(path) for name,path in
               (('collar',collar),('grip',grip),('baseline',baseline),('hex_coupon',hex_receipt))}
    receipts={name:s.parse() for name,s in snapshots.items()};producer=receipts['collar'];keys=receipts['grip']
    audit.require(producer['concept']=='standard-hardware collar C2' and producer['geometry_review_pass'] is True,'Expected checked C2')
    audit.require(set(producer['source_code_sha256'])==previous.COLLAR_SOURCES,'Incomplete C2 source inventory')
    commit=audit.source_revision(worktree,producer['source_commit'],producer['source_code_sha256'])
    audit.require(set(keys['source_code_sha256'])==GRIP_SOURCES,'Incomplete grip source inventory')
    audit.source_revision(worktree,keys['source_commit'],keys['source_code_sha256'])
    audit.require(keys['geometry_review_pass'] is True and keys['source_receipt_sha256']==snapshots['collar'].sha256,'Grip tools use another C2')
    baseline_paths={p.name:p for p in (*ear.SOURCE_PATHS.values(),Path(ear.__file__).resolve(),Path(previous.__file__).resolve())}
    audit.require(set(receipts['baseline']['source_code_sha256'])==set(baseline_paths),'Incomplete baseline source inventory')
    for name,path in baseline_paths.items():
        audit.require(audit.digest(path)==receipts['baseline']['source_code_sha256'][name],'Changed baseline source '+name)
    coupon_paths={p.name:p for p in (*ear.SOURCE_PATHS.values(),Path(ear.__file__).resolve(),Path(measured.__file__).resolve())}
    audit.require(set(receipts['hex_coupon']['source_code_sha256'])==set(coupon_paths),'Incomplete hex coupon source inventory')
    for name,path in coupon_paths.items():
        audit.require(audit.digest(path)==receipts['hex_coupon']['source_code_sha256'][name],'Changed coupon source '+name)
    audit.require({r['name'] for r in keys['access_components']}==GRIP_NAMES,'Incomplete grip tool inventory')
    artifacts=audit.Artifacts();data=dict(sources=sources,snapshots=snapshots,receipts=receipts,artifacts=artifacts,commit=commit)
    unchanged(data)
    def load(records):
        audit.require(len(records)==len({r['name'] for r in records}),'Duplicate component names')
        return [(r['name'],artifacts.load(r)) for r in records]
    review=load(producer['review_components']);names={n for n,_ in review}
    audit.require(len(names)==25,'Expected 25 C2 parts')
    audit.require(set(producer['states_components'])==previous.STATES,'Expected six C2 states')
    states={name:load(records) for name,records in producer['states_components'].items()}
    audit.require(all({n for n,_ in rows}==names for rows in states.values()),'Incomplete posed C2')
    controls=load(producer['control_sweeps']);grip_tools=load(keys['access_components'])
    audit.require({n for n,_ in controls}==previous.CONTROLS,'Missing whole lock/collar tool')
    audit.require(len(grip_tools)==6,'Expected six complete grip key/probe components')
    original=dict(load(receipts['baseline']['review_components']))
    coupon=dict(load(receipts['hex_coupon']['review_components']))
    for record in receipts['hex_coupon']['review_components']:
        coupon[record['name']]=coupon[record['name']].translate(tuple(-v for v in record['source_to_print_translation_mm']))
    candidate=build();unported={name:candidate['parts'][name] for name in ('shell','bottom')}
    for gap in GAPS:
        for _,source in controls:
            tool=audit.pose(source,gap,INDEX)
            for name in unported:candidate['parts'][name]-=tool
    candidate['kit']['roof']=candidate['parts']['shell'];candidate['ties']['bottom']=candidate['parts']['bottom']
    # Preserve the actual prior capsule and floor, with only necessary tool ports allowed in the cover.
    preserved={name:ear.equal(candidate['parts'][name],original[name],'Changed prior '+name)
               for name in ('ballast_body','ballast_lid')}
    preserved['flat_PTFE']=ear.equal(candidate['kit']['flat_pattern'],original['developed-flat-PTFE'],'Changed PTFE cut pattern')
    ear.equal(candidate['parts']['keeper_tab_1'],coupon['keeper'],'Full mount changed tested keeper')
    well_region=cad.cyl(21,11.6,-11.6)
    ear.equal(candidate['parts']['shell']&well_region,coupon['well']&well_region,'Changed coupon hex seat')
    joint_region=cad.cyl(3.5,11.6,-11.6).translate((0,28,0))
    ear.equal(candidate['parts']['shell']&joint_region,coupon['well']&joint_region,'Changed coupon joint seat')
    data.update(candidate=candidate,unported=unported,states=states,review=review,controls=controls,
                grip_tools=grip_tools,preserved=preserved,prior_parts=original,coupon_parts=coupon)
    unchanged(data)
    return data


def obstacles(candidate):
    fixed=previous.obstacles(candidate)
    # The stock hex is a stationary nominal purchased part, not a separate ball retaining joint.
    return fixed


def invariant_check(data,candidate):
    gap=candidate['gap'];parts=candidate['parts']
    bounds=[cad.cyl(32.5,-WELL_FLOOR,WELL_FLOOR),cad.cyl(33,3,0),cad.ring(44,100,gap-WELL_FLOOR,WELL_FLOOR)]
    for name,part in obstacles(candidate).items():
        bb=part.bounding_box()
        if bb.max.Z<=WELL_FLOOR+1e-7:continue
        slab=r.block(bb.size.X+2,bb.size.Y+2,bb.max.Z-WELL_FLOOR+1,(bb.center().X,bb.center().Y,WELL_FLOOR))
        above=part&slab
        captured=sum(audit.intersection(part,bound) for bound in bounds)
        audit.require(audit.volume(above)-captured<1e-5,'Fixed part escapes compact invariant bounds: '+name)
    minimum=math.inf
    for state,rows in data['states'].items():
        for name,source in rows:
            part=audit.pose(source,gap,INDEX);minimum=min(minimum,part.bounding_box().min.Z)
            audit.require(part.bounding_box().min.Z>=WELL_FLOOR+.5-1e-6,'C2 below compact well floor: '+name)
            for bound in bounds:
                audit.require(audit.intersection(part,bound)<1e-5,'C2 enters compact invariant bound: '+state+'/'+name)
    return dict(all_six_states_clear_of_rotation_invariant_bounds=True,
                closed_360_rotation_vs_base_clear=True,collar_quarter_turn_vs_base_clear=True,
                continuous_positive_Z_withdrawal_vs_base_clear=True,
                well_floor_mm=WELL_FLOOR,minimum_C2_z_mm=minimum,minimum_C2_to_well_floor_mm=minimum-WELL_FLOOR,
                central_island_radius_mm=32.5,keeper_upper_bound_radius_mm=33,
                outer_well_radius_mm=44,internal_C2_sequence='Upstream frozen producer checks, not a new physical approval')


def contact(data,candidate):
    bar=dict(data['review'])['full-height bar'];ring=cad.ring(44,45.5,1,-1)
    band=next(f for f in ring.faces() if abs(f.bounding_box().min.Z)<1e-7 and abs(f.bounding_box().max.Z)<1e-7)
    patches=[]
    for face in bar.faces():
        bb=face.bounding_box()
        if abs(bb.min.Z)<1e-7 and abs(bb.max.Z)<1e-7:patches.extend((face&band).faces())
    from build123d import extrude
    for patch in patches:
        witness=audit.pose(extrude(patch,amount=.1,dir=(0,0,1)),candidate['gap'],INDEX)
        audit.require(audit.volume(witness-candidate['parts']['buffer'])<1e-5,'Actual bar patch escapes compact PTFE')
        audit.require(audit.volume(witness.translate((0,0,-1))-candidate['parts']['spacer'])<1e-5,'Actual bar patch lacks backing')
    area=sum(p.area for p in patches);audit.require(area>0,'No actual bar bearing patches')
    return dict(selected_band_radii_mm=[44,45.5],actual_planar_patch_area_mm2=area,
                selected_band_coverage_fraction=area/(math.pi*(45.5**2-44**2)),
                patches_fully_backed=True,passive_support_only=True,
                bearing_surface_height_mm=candidate['gap'],no_separate_bar_to_box_retention=True,physical_load_and_drag_verified=False)


def B_sequence(data,candidate):
    p=candidate['keepers']['parameters'];gap=candidate['gap'];fixed=obstacles(candidate)
    low=p.hex_top_z+p.reported_underside_gap_min;high=p.hex_top_z+p.reported_underside_gap_max+p.estimated_knob_height
    knob_bound=cad.cyl(24,high-low,low)
    key_rows=[]
    for joint in candidate['keepers']['pairs']:
        x,y=joint.expected_xy;sign=1 if y>0 else -1;top=joint.screw.bounding_box().max.Z
        key=cad.cyl(1.2,100,top).translate((x,y,0))
        key+=cad.cyl(1.2,16).rotate(Axis.X,-sign*90).translate((x,y,top+100))
        previous.clear([(joint.name,key)],dict(fixed,nominal_knob_TOOL_BOUND=knob_bound),'B keeper key before cup')
        key_rows.append(dict(axis_xy_mm=[x,y],full_2mm_key_entry_from_above_clear_with_cup_off=True))
    presets=[(n,audit.pose(part,gap,INDEX)) for n,part in data['states']['locked'] if n.startswith('preset / ')]
    for name,part in presets:
        audit.require(part.bounding_box().min.Z>=3+.5-1e-6,'Cup/preset too low for retained hex: '+name)
        audit.require(audit.volume(part-cad.cyl(44,200,0))<1e-5,'Cup entry exceeds open bearing bore: '+name)
    grip=[(name,audit.pose(part,gap,INDEX)) for name,part in data['grip_tools']]
    grip_rows=previous.clear(grip,dict(fixed,nominal_knob_TOOL_BOUND=knob_bound),'B bar-off grip key')
    return dict(order=['Cup and ball OFF: seat hex, load M3 nuts from below and tighten both keepers from above',
                       'Lower loosened known-socket cup over knob from above',
                       'Set both radial grip screws with ball/bar OFF',
                       'Fit permanently glued ball/bar and operate collar/lock through underside ports'],
                keeper_key_access=key_rows,nominal_cup_entry_continuously_clear_from_above=True,
                six_actual_grip_key_and_sweep_components_clear=grip_rows,
                knob_tool_envelope_diameter_mm=48,tool_envelope_is_not_a_measured_knob_OD=True,
                nominal_hex_top_mm=p.hex_top_z,estimated_knob_height_mm=p.estimated_knob_height,
                required_hex_top_to_knob_underside_mm=gap+25.4-p.hex_top_z-p.estimated_knob_height,
                known_socket_preserved=True,physical_sequence_and_hand_access_verified=False)


def verify_configuration(data,candidate):
    checks=base.verify(candidate)
    checks.pop('unchanged_unmeasured_unit_interface');checks.pop('no_latch_access_ports_cut')
    checks['buffer']['flat_head_source']=FLAT_SOURCE
    parts=candidate['parts'];fixed=obstacles(candidate);gap=candidate['gap']
    controls=[(name,audit.pose(part,gap,INDEX)) for name,part in data['controls']]
    checks['whole_lock_and_collar_tool_workflow']=previous.clear(controls,fixed,'Compact tool workflow')
    checks['states']={state:previous.clear([(name,audit.pose(part,gap,INDEX)) for name,part in rows],fixed,'Compact state '+state)
                      for state,rows in data['states'].items()}
    checks['hex_capture']=verify_hex_capture(candidate)
    checks['lower_web']=verify_lower_web(candidate)
    for joint in candidate['covers']['pairs']:
        x,y=joint.expected_xy;region=cad.cyl(6,14,candidate['original']['floor_z']).translate((x,y,0))
        ear.equal(parts['shell']&region,data['unported']['shell']&region,'Ports changed cover seat')
    checks['invariant_motion_clearance']=invariant_check(data,candidate)
    checks['contact']=contact(data,candidate);checks['assembly_B']=B_sequence(data,candidate)
    checks['tabletop']=tabletop_check(candidate,controls,LIFT)
    checks['declared_fit']=dict(well_AF_mm=36,barrel_passage_mm=30,well_depth_mm=6.6,hex_top_mm=-.25,
                               approximate_operator_estimates=True,old_47p625_knob_OD_estimate_superseded=True,
                               socket_bore_mm=44.35475,socket_entry_mm=45.94225,socket_blind_depth_mm=25.4,
                               socket_dimensions_are_not_measured_knob_dimensions=True)
    return checks


def tabletop_check(candidate,controls,lift):
    audit.require(math.isfinite(lift) and lift>=0,'Lift must be finite and nonnegative')
    lowest=min(p.bounding_box().min.Z for _,p in controls);bottom=candidate['original']['underside_z']
    audit.require(lowest>=bottom-lift,'Compact whole tool staging hits lifted table')
    audit.require(lowest<bottom,'Original tabletop obstruction not reproduced')
    return dict(baseline_blocked=True,lowest_tool_z_mm=lowest,underside_z_mm=bottom,
                minimum_geometric_lift_mm=bottom-lowest,proposed_lift_mm=lift,
                minimum_lifted_table_clearance_mm=lowest-(bottom-lift))


def verify_hex_capture(candidate):
    stock=candidate['keepers']['stock'];parts=candidate['parts'];rows=[]
    tabbody=parts['keeper_tab_0']+parts['keeper_tab_1']
    audit.require(audit.intersection(stock,parts['shell']+tabbody)<1e-6,'Measured hex cannot seat')
    for i in (0,1):
        tab=parts[f'keeper_tab_{i}']
        ear.equal(tab,candidate['keepers']['tabs'][i],'Actual keeper differs from shared interface')
        capture=audit.intersection(stock.translate((0,0,.1)),tab)
        audit.require(capture>1e-4,'Measured keeper has hidden axial play')
        rows.append(dict(keeper=i,stock_up_0p1_overlap_mm3=capture))
    down=audit.intersection(stock.translate((0,0,-.1)),parts['shell'])
    audit.require(down>1e-4,'Measured hex lacks lower bearing seat')
    rotation=audit.intersection(stock.rotate(Axis.Z,5),parts['shell'])
    audit.require(rotation>1e-4,'Measured hex lacks antirotation')
    return dict(keepers=rows,stock_down_0p1_overlap_mm3=down,stock_5degree_rotation_overlap_mm3=rotation)


def verify_lower_web(candidate):
    rows=[]
    for angle in (90,270):
        web=r.block(12,8,5,(38.5,0,WEB_BOTTOM)).rotate(Axis.Z,angle)
        missing=audit.volume(web-candidate['parts']['shell'])
        audit.require(missing<1e-5,'Missing lower radial support web')
        rows.append(dict(angle_degrees=angle,missing_material_mm3=missing,thickness_mm=5))
    return rows


def verify_shim(candidate,raised):
    whole=base.buffer_cad.build(candidate['parts']['shell'],7.)
    return ear.equal(raised['parts']['spacer']+raised['parts']['height_shim'],whole['spacer'],
                     'Shim changes full g7 support material')


def specimens(data):
    candidate=data['candidate'];parts=candidate['parts'];clip=r.block(50,55.5,11.6,(0,6.75,-11.6))
    coupon=dict(candidate['keepers'],parts=dict(well=parts['shell']&clip,keeper=parts['keeper_tab_1']),
                joint=candidate['keepers']['pairs'][1],sources=data['sources'])
    checks=dict(hex_joint=measured.verify(coupon));ear_checks={}
    ear_clip=r.block(20,20,17.1,(52,0,-10)).rotate(Axis.Z,45)
    for gap in GAPS:
        c=configuration(candidate,gap);joint=c['kit']['pairs'][0]
        kit=dict(roof=c['parts']['shell']&ear_clip,spacer=c['parts']['spacer']&ear_clip,
                 buffer=c['parts']['buffer']&ear_clip,pairs=[joint],gap=gap)
        body=kit['roof']+kit['spacer']+kit['buffer']
        if gap==7:body+=c['parts']['height_shim']&ear_clip
        ear_checks[str(int(gap))]=dict(joint=r.check_joint(joint,body),nut_loading=r.verify_nut_loading([joint],kit['roof']),
                                     head_tolerances=base.buffer_cad.verify_seated_head_tolerances(kit))
    checks['ear_joint']=ear_checks
    exports=dict(hex_joint_source_coupon=coupon['parts']['well'],hex_joint_source_keeper=coupon['parts']['keeper'],
                 ear_source_roof_coupon=parts['shell']&ear_clip,ear_source_support_coupon=parts['spacer']&ear_clip,
                 ear_source_shim_coupon=configuration(candidate,7.)['parts']['height_shim']&ear_clip,
                 ear_PTFE_formed_reference=parts['buffer']&ear_clip,
                 ear_PTFE_flat_reference=candidate['kit']['flat_pattern']&ear_clip)
    return exports,checks


def verify(data):
    unchanged(data);checks={}
    for gap in GAPS:checks[str(int(gap))]=verify_configuration(data,configuration(data['candidate'],gap))
    checks['shim_material_identity']=verify_shim(data['candidate'],configuration(data['candidate'],7.))
    _,checks['source_derived_specimens']=specimens(data)
    unchanged(data)
    return checks


def export(data,output):
    output.mkdir(parents=True,exist_ok=True);target=output/'receipt.json';target.unlink(missing_ok=True)
    checks=verify(data);candidate=data['candidate'];validation=audit.Artifacts();records=[]
    parts=dict(candidate['parts'],height_shim=configuration(candidate,7.)['parts']['height_shim'],
               developed_flat_PTFE=candidate['kit']['flat_pattern'])
    samples,_=specimens(data);parts.update(samples)
    default_names=set(candidate['parts'])
    material_names={'developed_flat_PTFE','ear_PTFE_formed_reference','ear_PTFE_flat_reference'}
    for name,part in parts.items():
        is_coupon=name in samples
        directory='materials-DO-NOT-PRINT' if name=='buffer' or name in material_names else 'fit-coupons' if is_coupon else 'optional-shim' if name=='height_shim' else 'print-candidates'
        stem=output/directory/name
        translation=(0.,0.,0.)
        if is_coupon:
            bb=part.bounding_box();centre=bb.center();translation=(-centre.X,-centre.Y,-bb.min.Z)
        record=cad.export_part(part.translate(translation),stem)
        record.update(name=name,role=directory,source_to_export_translation_mm=list(translation))
        for kind in ('step','stl'):
            path=stem.with_suffix('.'+kind).resolve();record[kind]=str(path);record[kind+'_sha256']=audit.digest(path)
        restored=validation.load(record).translate(tuple(-v for v in translation))
        ear.equal(restored,part,'Compact export changed '+name);records.append(record)
    assemblies={}
    for gap in GAPS:
        c=configuration(candidate,gap)
        shapes=[*c['parts'].values(),*base.candidate_hardware(c),*c['ballast_cubes'],c['keepers']['stock'],
                *[audit.pose(part,gap,INDEX) for _,part in data['states']['locked']]]
        assembly=Compound(children=[part.solids()[0] for part in shapes]);path=output/f'complete-g{int(gap)}-assembly.step'
        audit.require(export_step(assembly,path),'Compact assembly export failed')
        sha=audit.digest(path);validation.files[str(path)]=sha;restored=import_step(path)
        audit.require(restored.is_valid and len(restored.solids())==len(assembly.solids()),'Compact assembly solids changed')
        ear.equal(assembly,restored,'Compact assembly material changed')
        assemblies[str(int(gap))]=dict(step=str(path.resolve()),sha256=sha)
    unchanged(data);validation.unchanged()
    report=dict(scope='COMPLETE_COMPACT_MOUNT_GEOMETRY_CANDIDATE',concept='compact-g5-with-optional-g7-shim',units='mm',
                geometry_checks_pass=True,geometry_review_pass=False,print_readiness='NOT_READY',
                installed_fit_and_physical_strength_verified=False,checks=checks,
                review_components=[r for r in records if r['name'] in default_names],
                optional_components=[r for r in records if r['name']=='height_shim'],
                material_patterns=[r for r in records if r['name'] in material_names],
                fit_coupons=[r for r in records if r['name'] in samples and r['name'] not in material_names],
                assemblies=assemblies,C2_source_to_box=dict(rotation_x_degrees=180,rotation_z_degrees=INDEX,mouth_z_mm=5),
                proposed_box_parameters=asdict(candidate['box']),proposed_stack_parameters=asdict(candidate['stack']),
                input_receipts={name:dict(path=str(s.path),sha256=s.sha256) for name,s in data['snapshots'].items()},
                validated_input_files=data['artifacts'].files,source_code_sha256={name:sha for name,(_,sha) in data['sources'].items()},
                frozen_C2_commit=data['commit'],preserved_actual_source_material=data['preserved'],
                known_snug_socket_authority='Operator confirms Darren was right; rough 1 7/8 inch OD superseded',
                fit_inputs=dict(estimated_hex_AF_mm=34.925,estimated_threaded_barrel_diameter_mm=28.575,
                                estimated_nut_thickness_mm=6.35,estimated_knob_height_mm=25.4,
                                estimated_hex_TOP_to_knob_UNDERSIDE_range_mm=[4.7625,22.225],
                                knob_diameter_is_not_a_measured_input=True,conservative_knob_tool_bound_diameter_mm=48,
                                quality='Approximate ruler estimates; converted decimals do not imply metrology accuracy'),
                nominal_configurations_mm=[5,7],shim_thickness_mm=2,
                nominal_hex_top_z_mm=-.25,nominal_required_hex_to_knob_underside_mm=[5.25,7.25],
                no_separate_bar_to_box_retention=True,no_existing_sources_or_exports_modified=True,
                no_viewer_or_services_started=True,
                pending=['Actual resin/process fit trials, axial play and shim selection',
                         'Physical assembly B, tool/hand access, stability while lifted',
                         'PTFE forming, creep, drag, wear and load testing'])
    target.write_text(json.dumps(report,indent=2)+'\n')
    try:unchanged(data);validation.unchanged()
    except Exception:
        target.unlink(missing_ok=True)
        raise
    print(target)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('collar-receipt','grip-receipt','baseline-receipt','hex-receipt','source-worktree','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    export(prepare(args.collar_receipt,args.grip_receipt,args.baseline_receipt,args.hex_receipt,args.source_worktree),args.output)
