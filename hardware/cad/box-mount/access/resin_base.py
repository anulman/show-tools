"""New unported resin base candidate with standard hardware and contained materials."""
from __future__ import annotations
import argparse
from dataclasses import asdict,replace
import json
import math
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))
import resin_retention as r
import below_plane_buffer as buffer_cad
import final_base as legacy
from build123d import Axis,Compound,export_step,extrude,import_step
cad=r.cad
audit=r.audit


def build(variant='arcade-inclined',gap=19):
    box=replace(cad.box_cad.Proposal(),tray_height=14,
                screw_clearance_diameter=r.H.clearance,nut_across_flats=r.H.nut_pocket_af,
                head_diameter=r.H.head_pocket_diameter,head_depth=r.H.head_pocket_depth)
    stack=cad.StackProposal(spacer_height=gap-1,contact_inner_radius=44,contact_outer_radius=46)
    if variant=='arcade-inclined':
        shell,bottom,axes,cable,ballast=cad.box_cad.build(box,variant)
        floor,underside=box.floor_z,box.underside_z
        original=dict(shell=shell,bottom=bottom,fastener_axes=axes,cable_envelope=cable,
                      ballast_envelope=ballast,floor_z=floor,underside_z=underside)
        route=0;depth=23
    else:
        audit.require(variant=='knob','Unknown new base variant')
        box=replace(box,tray_length=20,tray_y=42)
        original=legacy.routed_stack(stack,box)
        shell,bottom=original['shell'],original['bottom']
        floor,underside=original['floor_z'],original['underside_z']
        axes=original['fastener_axes'];route=25;depth=15
    covers=r.standard_covers(shell,bottom,axes,floor,underside)
    shell,bottom=covers['shell'],covers['bottom']
    ties=r.cable_tiedowns(bottom,floor,route);bottom=ties['bottom']
    capsule=r.ballast_cassette(depth)
    capsule_shift=(0,box.tray_y,floor+.5)
    parts=dict(shell=shell,bottom=bottom,
               ballast_body=capsule['body'].translate(capsule_shift),ballast_lid=capsule['lid'].translate(capsule_shift))
    result=dict(variant=variant,box=box,stack=stack,original=original,covers=covers,ties=ties,
                capsule=capsule,capsule_shift=capsule_shift,parts=parts,
                ballast_cubes=[part.translate(capsule_shift) for part in capsule['cubes']],gap=gap)
    if variant=='knob':
        keepers=r.stock_hex_keepers(shell)
        kit=buffer_cad.build(keepers['roof'],gap)
        parts.update(shell=kit['roof'],spacer=kit['spacer'],buffer=kit['buffer'],
                     keeper_tab_0=keepers['tabs'][0],keeper_tab_1=keepers['tabs'][1])
        result.update(keepers=keepers,kit=kit)
    return result



def candidate_hardware(candidate):
    """There is no second hardware list that can drift from the declared joints."""
    parts=r.joint_hardware(candidate['covers']['pairs'])
    parts += [part.translate(candidate['capsule_shift']) for part in r.joint_hardware(candidate['capsule']['pairs'])]
    if candidate['variant']=='knob':
        parts += r.joint_hardware(candidate['keepers']['pairs'])+r.joint_hardware(candidate['kit']['pairs'])
    return parts


def verify(candidate):
    p=candidate['box'];parts=candidate['parts'];original=candidate['original']
    shell,bottom=parts['shell'],parts['bottom']
    for name,part in parts.items():
        audit.require(part.is_valid and len(part.solids())==1,'Invalid candidate '+name)
    names=list(parts)
    for index,name in enumerate(names):
        for other in names[index+1:]:
            audit.require(audit.intersection(parts[name],parts[other])<1e-6,f'Candidate parts overlap {name}/{other}')
    audit.require(math.isclose(bottom.bounding_box().min.Z,original['underside_z'],abs_tol=1e-6),'Ground changed')
    audit.require(math.isclose(shell.bounding_box().max.Z,original['shell'].bounding_box().max.Z,abs_tol=1e-6),'Roof alignment changed')
    # Raised seats/eyes are restricted to the perimeter; the central floor retains its datum.
    centre=cad.cyl(14,.1,original['floor_z']-.05)
    audit.require(audit.volume((original['bottom']&centre)-bottom)<1e-6,'Central floor reserve changed')
    removal=bottom
    for face in bottom.faces():
        if face.normal_at().Z>.9:
            removal+=extrude(face,amount=-100,dir=(0,0,1))
    audit.require(audit.intersection(removal,shell)<1e-6,'New cover cannot withdraw downwards')
    fixed=shell+bottom
    cover_checks=r.check_joints(candidate['covers']['pairs'],fixed)
    cover_loading=r.verify_nut_loading(candidate['covers']['pairs'],shell)
    cassette_loading=r.verify_nut_loading(candidate['capsule']['pairs'],candidate['capsule']['body'])
    tie_checks=r.verify_tiedowns(candidate['ties'],original['underside_z'])
    cassette_checks=r.verify_cassette(candidate['capsule'])
    for name in ('ballast_body','ballast_lid'):
        audit.require(audit.intersection(parts[name],fixed)<1e-6,'Installed cassette blocked '+name)
    for cube in candidate['ballast_cubes']:
        audit.require(audit.intersection(cube,fixed)<1e-6,'Installed ballast cube blocked')
    for part in candidate_hardware(candidate):
        for name,obstacle in parts.items():
            audit.require(audit.intersection(part,obstacle)<1e-6,'Standard hardware blocked '+name)
    audit.require(audit.intersection(original['cable_envelope'],fixed)<1e-6,'Cable reserve obstructed')
    checks=dict(valid_single_solids=True,all_parts_separate=True,ground_and_roof_alignment_preserved=True,
                central_floor_datum_preserved=True,cover_continuous_downward_withdrawal_clear=True,
                cover_fasteners=cover_checks,cover_nut_loading=cover_loading,cassette_nut_loading=cassette_loading,cover_head_seat_web_mm=candidate['covers']['head_seat_web_mm'],
                tiedowns=tie_checks,ballast=cassette_checks,actual_hardware_solid_envelopes_clear=True,
                cable_reserve_clear=True,no_latch_access_ports_cut=True)
    if candidate['variant']=='arcade-inclined':
        corridor=cad.cyl(p.corridor_radius,p.clearance_mm,-p.clearance_mm).rotate(Axis.X,p.tilt)
        for name,part in parts.items():
            audit.require(audit.intersection(corridor,part)<1e-6,'New retention enters required arcade corridor '+name)
        checks.update(required_axial_corridor_mm=p.clearance_mm,proposed_corridor_diameter_mm=2*p.corridor_radius,
                      arcade_reserve_clear=True)
    else:
        # Keep the unmeasured unit interface identical to the previous proposal.
        region=cad.cyl(25,12,-11)
        audit.require(audit.volume((original['shell']&region)-shell)<1e-6 and
                      audit.volume((shell&region)-original['shell'])<1e-6,'Unmeasured stock-hex interface changed')
        checks['unchanged_unmeasured_unit_interface']=True
        checks['buffer']=buffer_cad.verify(candidate['kit'])
        fixed_parts=[*parts.items(),*[(f'hardware-{i}',part) for i,part in enumerate(candidate_hardware(candidate))]]
        checks['whole_fixed_base_root_plane_guard']=buffer_cad.below_root_guard(fixed_parts,candidate['gap'])
        checks['buffer_nut_loading']=r.verify_nut_loading(candidate['kit']['pairs'],shell)
        checks['keeper_nut_loading']=r.verify_nut_loading(candidate['keepers']['pairs'],shell)
        study=shell
        for tab in candidate['keepers']['tabs']:
            study+=tab
        checks['keeper_fasteners']=r.check_joints(candidate['keepers']['pairs'],study)
    return checks


def export_candidate(candidate,output):
    output.mkdir(parents=True,exist_ok=True)
    target=output/'receipt.json';target.unlink(missing_ok=True)
    checks=verify(candidate)
    records=[]
    for name,part in candidate['parts'].items():
        stem=output/(name+'-RESIN-RETENTION-CANDIDATE')
        record=cad.export_part(part,stem)
        record.update(name=name,role='cut-stock PTFE envelope; do not print' if name=='buffer' else 'resin print candidate')
        for kind in ('step','stl'):
            path=stem.with_suffix('.'+kind).resolve()
            record[kind]=str(path);record[kind+'_sha256']=audit.digest(path)
        records.append(record)
    validation=audit.Artifacts()
    for record in records:validation.load(record)
    assembly=Compound(children=[part.solids()[0] for part in [*candidate['parts'].values(),*candidate_hardware(candidate),*candidate['ballast_cubes']]])
    assembly_path=output/'assembly-RESIN-RETENTION-CANDIDATE.step'
    audit.require(export_step(assembly,assembly_path),'Candidate assembly export failed')
    restored=import_step(assembly_path)
    audit.require(restored.is_valid and len(restored.solids())==len(assembly.solids()),'Assembly solids changed')
    audit.require(audit.volume(assembly-restored)<1e-6 and audit.volume(restored-assembly)<1e-6,'Assembly material changed')
    coupon_records=[]
    for af in (5.7,5.8,5.9):
        coupon=r.joint_coupon(af);coupon_checks=r.verify_joint_coupon(coupon)
        for name in ('lower','upper'):
            stem=output/f'coupon-AF{str(af).replace(chr(46),chr(112))}-{name}'
            record=cad.export_part(coupon[name],stem)
            record.update(name=stem.name,role='print this hardware trial before full shells',checks=coupon_checks)
            for kind in ('step','stl'):
                path=stem.with_suffix('.'+kind).resolve()
                record[kind]=str(path);record[kind+'_sha256']=audit.digest(path)
            validation.load(record);coupon_records.append(record)
    material_patterns=[]
    if candidate['variant']=='knob':
        stem=output/'material-patterns'/'PTFE-flat-cut-pattern-DO-NOT-PRINT'
        record=cad.export_part(candidate['kit']['flat_pattern'],stem)
        record.update(name='PTFE developed flat pattern',role='cut and form purchased 1 mm PTFE; do not print')
        for kind in ('step','stl'):
            path=stem.with_suffix('.'+kind).resolve()
            record[kind]=str(path);record[kind+'_sha256']=audit.digest(path)
        validation.load(record);material_patterns.append(record)
    validation.unchanged()
    source_paths=(Path(__file__),Path(r.__file__),Path(buffer_cad.__file__),Path(legacy.__file__),Path(audit.__file__),Path(cad.__file__),Path(cad.box_cad.__file__))
    report=dict(concept='resin-retention-v2-'+candidate['variant'],scope='INDEPENDENT_RETENTION_CANDIDATE_NOT_COLLAR_INTEGRATED',
                geometry_review_pass=False,independent_base_geometry_checks_pass=True,print_readiness='NOT_READY',units='mm',
                review_components=records,checks=checks,proposed_box_parameters=asdict(candidate['box']),
                proposed_stack_parameters=asdict(candidate['stack']),standard_hardware=asdict(r.H),
                hardware_sources=r.SOURCES,hardware_envelope_count=len(candidate_hardware(candidate)),
                assembly_step=str(assembly_path.resolve()),assembly_sha256=audit.digest(assembly_path),
                fit_coupons=coupon_records,material_patterns=material_patterns,coupon_nut_pocket_af_variants_mm=[5.7,5.8,5.9],
                source_code_sha256={path.name:audit.digest(path) for path in source_paths},
                pending=['operator stock-hex AF/thickness and knob top height','simpler collar envelope and service access contract',
                         'actual resin/process/cure fit coupon and hardware trial','physical outer ball-shell fit despite verified below-root envelope','physical tie threading and cable pull test',
                         'PTFE drag and retention trial','contained ballast rattle, retention and stability trials'],
                no_existing_models_or_exports_modified=True,no_viewer_or_services_started=True)
    target.write_text(json.dumps(report,indent=2)+'\n')
    print(target)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--variant',choices=('arcade-inclined','knob'),required=True)
    parser.add_argument('--gap',type=float,default=19,help='Temporary packaging value; not a selected collar spacing')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    export_candidate(build(args.variant,args.gap),args.output)
