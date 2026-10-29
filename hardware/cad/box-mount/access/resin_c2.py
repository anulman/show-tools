"""Integrate immutable C2 exports with a separately ported resin base proposal."""
from __future__ import annotations
import argparse
from dataclasses import replace
import json
import math
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))
import buffer_ear_trial as ear
from build123d import Axis,Compound,extrude,export_step,import_step
base=ear.base
r=base.r
cad=base.cad
audit=base.audit
STATES={'locked','screw-clear','screw-captive-stop','collar-midway','released','detached'}
CONTROLS={'2.5 mm lock key operating envelope','2.5 mm lock key full axial staging',
          '4 mm collar key operating quarter arc','4 mm collar key full axial staging'}
COLLAR_SOURCES={'standard_collar.py','couplings.py','baseplates_v2.py','baseplates.py',
                'full_height.py','disco_bar.py','check_standard_collar.py','check_couplings.py'}
SERVICE_INDEX=-90.
GAP=19.
LIFT=160.


def build():
    """Use the existing independent components with a front (zero-degree) outlet."""
    box=replace(cad.box_cad.Proposal(),tray_height=14,tray_length=20,tray_y=42,
                screw_clearance_diameter=r.H.clearance,nut_across_flats=r.H.nut_pocket_af,
                head_diameter=r.H.head_pocket_diameter,head_depth=r.H.head_pocket_depth)
    stack=cad.StackProposal(spacer_height=GAP-1,contact_inner_radius=44,contact_outer_radius=46)
    original=cad.stack(stack,box)
    covers=r.standard_covers(original['shell'],original['bottom'],original['fastener_axes'],
                             original['floor_z'],original['underside_z'])
    ties=r.cable_tiedowns(covers['bottom'],original['floor_z'],0)
    keepers=r.stock_hex_keepers(covers['shell'])
    kit=base.buffer_cad.build(keepers['roof'],GAP)
    capsule=r.ballast_cassette(15)
    shift=(0,box.tray_y,original['floor_z']+.5)
    parts=dict(shell=kit['roof'],bottom=ties['bottom'],spacer=kit['spacer'],buffer=kit['buffer'],
               keeper_tab_0=keepers['tabs'][0],keeper_tab_1=keepers['tabs'][1],
               ballast_body=capsule['body'].translate(shift),ballast_lid=capsule['lid'].translate(shift))
    return dict(variant='knob',box=box,stack=stack,original=original,covers=covers,ties=ties,
                keepers=keepers,kit=kit,capsule=capsule,capsule_shift=shift,parts=parts,
                ballast_cubes=[part.translate(shift) for part in capsule['cubes']],gap=GAP)


def inputs_unchanged(data):
    for snapshot in data['snapshots'].values():snapshot.unchanged()
    for path,sha in data['sources'].items():
        audit.require(audit.digest(Path(path))==sha,'Integration source changed: '+path)
    data['artifacts'].unchanged()
    for snapshot in data['snapshots'].values():snapshot.unchanged()


def prepare(collar_receipt,base_receipt,source_worktree):
    sources={str(path):audit.digest(path) for path in
             (*ear.SOURCE_PATHS.values(),Path(ear.__file__).resolve(),Path(__file__).resolve())}
    snapshots={name:ear.ReceiptSnapshot.capture(path) for name,path in
               (('collar',collar_receipt),('base',base_receipt))}
    producer=snapshots['collar'].parse();baseline=snapshots['base'].parse()
    audit.require(producer['concept']=='standard-hardware collar C2','Expected standard-hardware C2')
    audit.require(producer['geometry_review_pass'] is True,'Failed collar geometry')
    audit.require(producer['gap_PROPOSED_mm']==GAP,'Unexpected collar gap proposal')
    audit.require(set(producer['source_code_sha256'])==COLLAR_SOURCES,'Incomplete collar source inventory')
    commit=audit.source_revision(source_worktree,producer['source_commit'],producer['source_code_sha256'])
    audit.require(baseline['independent_base_geometry_checks_pass'] is True,'Failed baseline geometry')
    audit.require(baseline['concept'].endswith('-knob'),'Expected knob base')
    ear.source_files_match(baseline)
    parameters=baseline['proposed_stack_parameters']
    audit.require(parameters['spacer_height']+parameters['buffer_thickness']==GAP,'Unexpected provisional gap')
    artifacts=audit.Artifacts()
    data=dict(snapshots=snapshots,sources=sources,artifacts=artifacts,producer=producer,baseline=baseline,commit=commit)
    inputs_unchanged(data)
    def load(records):
        audit.require(len({record['name'] for record in records})==len(records),'Duplicate component names')
        return [(record['name'],artifacts.load(record)) for record in records]
    review=load(producer['review_components'])
    audit.require(len(review)==25 and producer['part_count']==25,'Expected complete 25-part collar')
    audit.require(set(producer['states_components'])==STATES,'Expected all six C2 states')
    states={name:load(records) for name,records in producer['states_components'].items()}
    audit.require(all({name for name,_ in value}=={name for name,_ in review} for value in states.values()),
                  'State component inventory differs')
    controls=load(producer['control_sweeps'])
    audit.require({name for name,_ in controls}==CONTROLS,'Expected four complete tool sweeps')
    candidate=build()
    baseline_parts=dict(load(baseline['review_components']))
    identity={name:ear.equal(candidate['parts'][name],baseline_parts[name],'Changed baseline '+name)
              for name in candidate['parts'] if name not in ('shell','bottom')}
    flat=artifacts.load(baseline['material_patterns'][0])
    identity['developed_flat_PTFE']=ear.equal(candidate['kit']['flat_pattern'],flat,'Changed baseline PTFE pattern')
    posed=[(name,audit.pose(part,GAP,SERVICE_INDEX)) for name,part in controls]
    unported={name:candidate['parts'][name] for name in ('shell','bottom')}
    for name in unported:
        for _,tool in posed:candidate['parts'][name]-=tool
    candidate['kit']['roof']=candidate['parts']['shell']
    candidate['ties']['bottom']=candidate['parts']['bottom']
    data.update(review=review,states=states,controls=posed,candidate=candidate,unported=unported,
                preserved_baseline_components=identity)
    inputs_unchanged(data)
    return data


def obstacles(candidate):
    fixed=dict(candidate['parts'])
    fixed.update({f'hardware-{i}':part for i,part in enumerate(base.candidate_hardware(candidate))})
    fixed.update({f'cube-{i}':part for i,part in enumerate(candidate['ballast_cubes'])})
    fixed.update(cable=candidate['original']['cable_envelope'],
                 ballast_reserve=candidate['original']['ballast_envelope'],
                 stock_hex=candidate['original']['stock_hex_keepout'])
    return fixed


def clear(named_parts,fixed,label):
    rows=[]
    for name,part in named_parts:
        overlaps={key:audit.intersection(part,obstacle) for key,obstacle in fixed.items()}
        audit.require(all(value<1e-5 for value in overlaps.values()),
                      label+' blocked '+name+': '+str({key:value for key,value in overlaps.items() if value>=1e-5}))
        rows.append(dict(name=name,intersections_mm3=overlaps))
    return rows


def invariant_clearance(states,candidate):
    """Rotation-invariant bounds also remain clear under positive-Z withdrawal."""
    parts=candidate['parts']
    roof_top=parts['shell'].bounding_box().max.Z
    keeper_parts=[*candidate['keepers']['tabs'],*r.joint_hardware(candidate['keepers']['pairs'])]
    keeper_top=max(part.bounding_box().max.Z for part in keeper_parts)
    keeper_bound=cad.cyl(33,keeper_top,roof_top)
    bearing_bound=cad.ring(44,58,GAP,roof_top)
    for name,part in obstacles(candidate).items():
        bounds=part.bounding_box()
        if bounds.max.Z<=roof_top+1e-7:continue
        slab=r.block(bounds.size.X+2,bounds.size.Y+2,bounds.max.Z-roof_top+1,
                     (bounds.center().X,bounds.center().Y,roof_top))
        above=part & slab
        contained=audit.intersection(part,keeper_bound)+audit.intersection(part,bearing_bound)
        audit.require(audit.volume(above)-contained<1e-5,'Fixed part escapes invariant bounds: '+name)
    rows={}
    for state,actors in states.items():
        checks=[]
        for name,source in actors:
            part=audit.pose(source,GAP,SERVICE_INDEX)
            audit.require(part.bounding_box().min.Z>=roof_top-1e-6,'Actor below roof: '+name)
            audit.require(audit.intersection(part,keeper_bound)<1e-5,'Actor enters keeper bound: '+name)
            audit.require(audit.intersection(part,bearing_bound)<1e-5,'Actor enters bearing bound: '+name)
            checks.append(dict(name=name,minimum_z_mm=part.bounding_box().min.Z))
        rows[state]=checks
    return dict(all_states_clear_of_rotation_invariant_fixed_bounds=True,
                closed_360_degree_rotation_clear=True,collar_quarter_turn_vs_fixed_base_clear=True,
                positive_z_withdrawal_vs_fixed_base_clear=True,roof_top_mm=roof_top,
                keeper_bound_radius_mm=33,keeper_bound_top_mm=keeper_top,
                bearing_bound_radii_mm=[44,58],bearing_bound_top_mm=GAP,states=rows,
                internal_C2_transition_verification='Producer checks; base bounds do not establish internal mechanism strength or fit')


def contact_check(data):
    bar=dict(data['review'])['full-height bar']
    ring=cad.ring(44,45.5,1,-1)
    band=next(face for face in ring.faces() if abs(face.bounding_box().min.Z)<1e-7 and
              abs(face.bounding_box().max.Z)<1e-7)
    patches=[]
    for face in bar.faces():
        bounds=face.bounding_box()
        if abs(bounds.min.Z)<1e-7 and abs(bounds.max.Z)<1e-7:
            patch=face & band
            patches.extend(patch.faces())
    area=sum(face.area for face in patches)
    audit.require(area>0,'No actual bar support patches')
    candidate=data['candidate']
    for patch in patches:
        # Extrude inward from the actual planar face into the purchased material.
        witness=extrude(patch,amount=.1,dir=(0,0,1))
        posed=audit.pose(witness,GAP,SERVICE_INDEX)
        audit.require(audit.volume(posed-candidate['parts']['buffer'])<1e-5,'Actual contact escapes PTFE')
        backing=posed.translate((0,0,-1))
        audit.require(audit.volume(backing-candidate['parts']['spacer'])<1e-5,'Actual contact lacks spacer backing')
    nominal=math.pi*(45.5**2-44**2)
    return dict(source='Actual exported bar planar mouth faces clipped to R44..45.5',
                exact_planar_contact_area_mm2=area,selected_band_area_mm2=nominal,
                selected_band_coverage_fraction=area/nominal,patch_count=len(patches),
                whole_selected_contact_supported_by_PTFE_and_spacer=True,
                load_drag_wear_and_unsupported_spans_approved=False)


def tabletop_check(data,lift):
    lowest=min(part.bounding_box().min.Z for _,part in data['controls'])
    underside=data['candidate']['original']['underside_z'];minimum=max(0,underside-lowest)
    audit.require(math.isfinite(lift) and lift>=0,'Lift must be finite and nonnegative')
    audit.require(lowest>=underside-lift,'Proposed lift blocks full tool entry')
    audit.require(minimum>0,'Baseline tabletop obstruction not reproduced')
    return dict(baseline_blocked=True,lowest_tool_z_mm=lowest,underside_z_mm=underside,
                minimum_geometric_lift_mm=minimum,proposed_lift_mm=lift,
                minimum_lifted_table_clearance_mm=lowest-(underside-lift))


def verify(data):
    inputs_unchanged(data)
    candidate=data['candidate'];parts=candidate['parts'];original=candidate['original']
    checks=base.verify(candidate)
    checks.pop('no_latch_access_ports_cut')
    protected={}
    for name,region in (
        ('central_roof',cad.cyl(33,12,-10)),
        ('bearing_roof',cad.ring(44,46,.5,-.5))):
        removed=audit.volume((data['unported']['shell']&region)-parts['shell'])
        audit.require(removed<1e-6,'Ports removed '+name)
        protected[name]=removed
    for i,(x,y) in enumerate(original['fastener_axes']):
        region=cad.cyl(candidate['box'].boss_radius,6,original['underside_z']).translate((x,y,0))
        removed=audit.volume((data['unported']['bottom']&region)-parts['bottom'])
        audit.require(removed<1e-6,'Ports removed cover seat')
        protected['cover_seat_'+str(i)]=removed
    ballast_floor=r.block(candidate['box'].tray_width,candidate['box'].tray_length,3,
                          (0,candidate['box'].tray_y,original['underside_z']))
    removed=audit.volume((data['unported']['bottom']&ballast_floor)-parts['bottom'])
    audit.require(removed<1e-6,'Ports removed ballast floor')
    protected['ballast_floor']=removed
    fixed=obstacles(candidate)
    controls=clear(data['controls'],fixed,'Full tool workflow')
    states={state:clear([(name,audit.pose(part,GAP,SERVICE_INDEX)) for name,part in actors],fixed,'State '+state)
            for state,actors in data['states'].items()}
    tabletop=tabletop_check(data,LIFT)
    removed={name:audit.volume(data['unported'][name]-parts[name]) for name in data['unported']}
    audit.require(all(value>1e-4 for value in removed.values()),'Ports have no measured effect')
    checks.update(protected_regions_removed_mm3=protected,ported_material_removed_mm3=removed,
                  preserved_baseline_components=data['preserved_baseline_components'],
                  full_tool_workflow=controls,actual_states=states,
                  invariant_base_clearance=invariant_clearance(data['states'],candidate),
                  contact=contact_check(data),
                  tabletop=tabletop)
    inputs_unchanged(data)
    return checks


def export(data,output):
    output.mkdir(parents=True,exist_ok=True)
    target=output/'receipt.json';target.unlink(missing_ok=True)
    checks=verify(data);candidate=data['candidate'];exported=audit.Artifacts();records=[]
    for name,part in candidate['parts'].items():
        stem=output/('material-reference-DO-NOT-PRINT' if name=='buffer' else 'print-candidates')/name
        record=cad.export_part(part,stem)
        record.update(name=name,role='purchased PTFE reference; do not print' if name=='buffer' else 'resin print candidate, not released')
        for kind in ('step','stl'):
            path=stem.with_suffix('.'+kind).resolve();record[kind]=str(path);record[kind+'_sha256']=audit.digest(path)
        ear.equal(exported.load(record),part,'Export changed '+name);records.append(record)
    stem=output/'material-reference-DO-NOT-PRINT'/'developed-flat-PTFE'
    record=cad.export_part(candidate['kit']['flat_pattern'],stem)
    record.update(name='developed-flat-PTFE',role='purchased PTFE cutting/forming reference; do not print')
    for kind in ('step','stl'):
        path=stem.with_suffix('.'+kind).resolve();record[kind]=str(path);record[kind+'_sha256']=audit.digest(path)
    ear.equal(exported.load(record),candidate['kit']['flat_pattern'],'Export changed flat PTFE');records.append(record)
    assembly_parts=[*candidate['parts'].values(),*base.candidate_hardware(candidate),*candidate['ballast_cubes'],
                    *[audit.pose(part,GAP,SERVICE_INDEX) for _,part in data['states']['locked']]]
    assembly=Compound(children=[part.solids()[0] for part in assembly_parts])
    path=output/'combined-assembly-PRIVATE-PROPOSAL.step'
    audit.require(export_step(assembly,path),'Assembly export failed')
    sha=audit.digest(path);exported.files[str(path)]=sha
    restored=import_step(path)
    audit.require(restored.is_valid and len(restored.solids())==len(assembly.solids()),'Assembly solids changed')
    ear.equal(restored,assembly,'Assembly material changed')
    inputs_unchanged(data);exported.unchanged()
    report=dict(scope='PRIVATE_C2_RESIN_BASE_GEOMETRY_PROPOSAL',units='mm',geometry_checks_pass=True,
                geometry_review_pass=False,print_readiness='NOT_READY',installed_spinner_fit_verified=False,physical_strength_verified=False,
                source_code_sha256={Path(path).name:sha for path,sha in data['sources'].items()},
                producer_commit=data['commit'],
                input_receipts={name:dict(path=str(s.path),sha256=s.sha256) for name,s in data['snapshots'].items()},
                producer_source_code_sha256=data['producer']['source_code_sha256'],
                validated_input_files=data['artifacts'].files,review_components=records,
                assembly_step=str(path.resolve()),assembly_step_sha256=sha,checks=checks,
                proposed_layout=dict(gap_mm=GAP,source_to_box_rotation_x_degrees=180,service_index_degrees=SERVICE_INDEX,cable_angle_from_front_degrees=0,
                                     lift_mm=LIFT,pad_contact_band_above_roof_mm=[28,36]),
                pending=['Actual spinner hex AF, hex thickness, hex-top-to-knob-top height',
                         'Physical resin/hardware fit, PTFE forming/creep/drag and ball-shell fit',
                         'Hand access, support/stability and load/torque tests'],
                no_viewer_or_services_started=True,no_existing_exports_modified=True)
    target.write_text(json.dumps(report,indent=2)+'\n')
    try:inputs_unchanged(data);exported.unchanged()
    except Exception:
        target.unlink(missing_ok=True)
        raise
    print(target)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--collar-receipt',type=Path,required=True)
    parser.add_argument('--base-receipt',type=Path,required=True)
    parser.add_argument('--source-worktree',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    export(prepare(args.collar_receipt,args.base_receipt,args.source_worktree),args.output)
