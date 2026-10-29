"""Export one actual buffer-ear joint as two small prints and PTFE references."""
from __future__ import annotations
import argparse
from dataclasses import dataclass
import hashlib
import json
import math
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))
import resin_base as base
from build123d import Axis,Compound,export_step,import_step
r=base.r
b=base.buffer_cad
audit=r.audit
cad=r.cad
ANGLE=45.
RADIAL_CENTRE=52.


def equal(first,second,message):
    removed=audit.volume(first-second);added=audit.volume(second-first)
    audit.require(removed<1e-6 and added<1e-6,message)
    return dict(removed_material_mm3=removed,added_material_mm3=added)


SOURCE_PATHS = {
    'resin_base.py': Path(base.__file__).resolve(),
    'resin_retention.py': Path(r.__file__).resolve(),
    'below_plane_buffer.py': Path(b.__file__).resolve(),
    'final_base.py': Path(base.legacy.__file__).resolve(),
    'integrate_receipt.py': Path(audit.__file__).resolve(),
    'access_study.py': Path(cad.__file__).resolve(),
    'box_mount.py': Path(cad.box_cad.__file__).resolve(),
}


@dataclass(frozen=True)
class ReceiptSnapshot:
    path: Path
    raw: bytes
    sha256: str

    @classmethod
    def capture(cls,path):
        path=Path(path).resolve()
        raw=path.read_bytes()
        return cls(path,raw,hashlib.sha256(raw).hexdigest())

    def parse(self):
        return json.loads(self.raw)

    def unchanged(self):
        audit.require(audit.digest(self.path)==self.sha256,'Base source receipt changed')


def source_files_match(producer):
    sources=producer.get('source_code_sha256')
    audit.require(isinstance(sources,dict) and set(sources)==set(SOURCE_PATHS),
                  'Producer source inventory differs: require exactly the seven loaded source files')
    for name,path in SOURCE_PATHS.items():
        audit.require(audit.digest(path)==sources[name],'Changed producer source '+name)
    return dict(sources)


def inputs_unchanged(trial):
    snapshot=trial['receipt_snapshot']
    snapshot.unchanged()
    producer=snapshot.parse()
    audit.require(trial['producer']==producer,'Parsed producer differs from captured receipt bytes')
    audit.require(source_files_match(producer)==trial['sources'],'Producer source hashes changed')
    audit.require(audit.digest(Path(__file__))==trial['generator_sha256'],'Ear trial generator source changed')
    trial['artifacts'].unchanged()
    snapshot.unchanged()


def make_trial(receipt):
    generator_sha256=audit.digest(Path(__file__))
    snapshot=ReceiptSnapshot.capture(receipt)
    producer=snapshot.parse()
    audit.require(producer['independent_base_geometry_checks_pass'] is True,'Failed independent base source')
    audit.require(producer['concept'].endswith('-knob'),'Expected knob base source')
    audit.require(producer['checks']['buffer']['material_id_mm']==88,'Expected below-plane ID88 buffer')
    sources=source_files_match(producer)
    artifacts=audit.Artifacts()
    trial=dict(producer=producer,receipt_snapshot=snapshot,sources=sources,
               generator_sha256=generator_sha256,artifacts=artifacts)
    inputs_unchanged(trial)
    gap=producer['proposed_stack_parameters']['spacer_height']+producer['proposed_stack_parameters']['buffer_thickness']
    candidate=base.build('knob',gap)
    inputs_unchanged(trial)
    records={record['name']:record for record in producer['review_components']}
    actual={name:artifacts.load(records[name]) for name in ('shell','spacer','buffer')}
    for name,part in actual.items():
        equal(part,candidate['parts'][name],'Actual source export differs from regenerated '+name)
    flat=artifacts.load(producer['material_patterns'][0])
    equal(flat,candidate['kit']['flat_pattern'],'Actual flat pattern differs from regenerated source')
    # Full roof thickness, spacer, PTFE and screw stack; unrelated lower shell,
    # tray and floor are outside this joint's Z interval.
    clip=r.block(20,20,gap+10.2,(RADIAL_CENTRE,0,-10.1)).rotate(Axis.Z,ANGLE)
    parts=dict(roof=actual['shell']&clip,spacer=actual['spacer']&clip,
               formed_PTFE=actual['buffer']&clip,flat_PTFE=flat&clip)
    joint=candidate['kit']['pairs'][0]
    trial.update(actual=actual,actual_flat=flat,gap=gap,clip=clip,parts=parts,joint=joint)
    inputs_unchanged(trial)
    return trial


def verify(trial):
    inputs_unchanged(trial)
    parts=trial['parts'];joint=trial['joint']
    identities={}
    for name,part in parts.items():
        audit.require(part.is_valid and len(part.solids())==1,'Invalid one-ear trial '+name)
        actual=trial['actual_flat'] if name=='flat_PTFE' else trial['actual']['buffer' if name=='formed_PTFE' else 'shell' if name=='roof' else name]
        identities[name]=equal(part,actual&trial['clip'],'Trial changed source joint material '+name)
    equal_volume=abs(parts['formed_PTFE'].volume-parts['flat_PTFE'].volume)
    audit.require(equal_volume<1e-6,'One-ear developed strip changes material volume')
    body=parts['roof']+parts['spacer']+parts['formed_PTFE']
    hardware=r.check_joint(joint,body)
    insertion=r.verify_nut_loading([joint],parts['roof'])
    audit.require(audit.intersection(parts['roof'],parts['spacer'])<1e-6,'Trial printed pieces overlap')
    audit.require(audit.intersection(parts['formed_PTFE'],parts['spacer'])<1e-6,'Trial sheet overlaps spacer')
    lift=parts['formed_PTFE'].translate((0,0,.3))
    lift_overlap=audit.intersection(lift,joint.screw)
    audit.require(lift_overlap>1e-4,'Actual ear cone does not retain the trial sheet')
    audit.require(audit.intersection(lift,parts['roof']+parts['spacer'])<1e-6,'Missing-screw trial cannot lift free')
    kit=dict(roof=parts['roof'],spacer=parts['spacer'],buffer=parts['formed_PTFE'],
             pairs=[joint],gap=trial['gap'])
    head_tolerances=b.verify_seated_head_tolerances(kit)
    guard=b.below_root_guard([('roof',parts['roof']),('spacer',parts['spacer']),
                              ('PTFE',parts['formed_PTFE']),('screw',joint.screw),('nut',joint.nut)],trial['gap'])
    # Report the actual full-joint counterseat, including its thin residual web.
    pilot_radius=r.H.clearance/2
    head_top=trial['gap']-b.CLEARANCE
    cone_low=head_top-b.FLAT_HEAD_HEIGHT
    ear_bottom=trial['gap']-b.DROP-b.THICKNESS
    web=cone_low+(pilot_radius-1.55)-ear_bottom
    entry_radius=b.FLAT_HEAD_DIAMETER/2+.05-(b.DROP-b.CLEARANCE)
    audit.require(web>=.5-1e-7,'Trial full-source joint leaves less than 0.5 mm PTFE web')
    # Check real imported material below the cone and the void above it.
    x,y=joint.expected_xy;offset=pilot_radius+.02
    px=x+offset*math.cos(math.radians(ANGLE));py=y+offset*math.sin(math.radians(ANGLE))
    audit.require(parts['formed_PTFE'].is_inside((px,py,ear_bottom+web/2)),
                  'Actual source does not preserve the reported lower PTFE web')
    audit.require(not parts['formed_PTFE'].is_inside((px,py,ear_bottom+min(.95,web+.2))),
                  'Actual source counterseat differs from reported cone')
    inputs_unchanged(trial)
    return dict(source_material_identity=identities,full_source_joint_stack_preserved=True,
                PTFE_pilot_diameter_mm=r.H.clearance,
                PTFE_cone_entry_diameter_at_flat_ear_mm=2*entry_radius,
                PTFE_flat_web_at_pilot_edge_mm=web,
                PTFE_side_ligament_beside_cone_mm=(b.EAR_WIDTH-2*entry_radius)/2,
                formed_and_flat_material_volume_difference_mm3=equal_volume,joint=hardware,
                nut_loading=insertion,axial_lift_overlap_mm3=lift_overlap,
                missing_screw_allows_axial_release=True,seated_head_tolerance_checks=head_tolerances,
                root_plane_guard=guard,nominal_stock_thickness_mm=1,
                ordinary_driver_hex_af_mm=2,total_screw_length_including_head_mm=joint.length,
                physical_fit_forming_counterseating_creep_and_preload_verified=False)


def print_pose(part):
    minimum=part.bounding_box().min.Z
    return part.rotate(Axis.Z,-ANGLE).translate((-RADIAL_CENTRE,0,-minimum)),minimum


def restore_source(part,minimum):
    return part.translate((RADIAL_CENTRE,0,minimum)).rotate(Axis.Z,ANGLE)


def export(trial,output):
    output.mkdir(parents=True,exist_ok=True)
    target=output/'receipt.json';target.unlink(missing_ok=True)
    inputs_unchanged(trial)
    checks=verify(trial)
    records=[];exported=audit.Artifacts()
    for name,part in trial['parts'].items():
        printable=name in ('roof','spacer')
        directory=output/('print' if printable else 'materials-DO-NOT-PRINT')
        stem=directory/('ear-trial-'+name)
        posed,minimum=print_pose(part)
        record=cad.export_part(posed,stem)
        record.update(name=name,role='resin hardware/ear joint trial print' if printable else 'purchased PTFE cut/form reference; do not print',
                      source_to_export=dict(rotation_z_degrees=-ANGLE,translation_after_rotation_mm=[-RADIAL_CENTRE,0,-minimum]))
        for kind in ('step','stl'):
            path=stem.with_suffix('.'+kind).resolve()
            record[kind]=str(path);record[kind+'_sha256']=audit.digest(path)
        restored=restore_source(exported.load(record),minimum)
        record['exported_source_material_identity']=equal(restored,part,'Export changed actual joint '+name)
        records.append(record)
    # One common assembly transform preserves all mating locations.
    source_parts=[trial['parts'][name] for name in ('roof','spacer','formed_PTFE')]+[trial['joint'].screw,trial['joint'].nut]
    common=[part.solids()[0].rotate(Axis.Z,-ANGLE).translate((-RADIAL_CENTRE,0,10)) for part in source_parts]
    assembly=Compound(children=common)
    assembly_path=output/'actual-ear-joint-assembly.step'
    audit.require(export_step(assembly,assembly_path),'Ear assembly export failed')
    assembly_sha256=audit.digest(assembly_path)
    exported.files[str(assembly_path)]=assembly_sha256
    restored=import_step(assembly_path)
    audit.require(restored.is_valid and len(restored.solids())==5,'Ear assembly solids changed')
    equal(assembly,restored,'Ear assembly STEP changed material')
    exported.unchanged();inputs_unchanged(trial)
    snapshot=trial['receipt_snapshot']
    report=dict(scope='ACTUAL_ONE_EAR_PRINTER_TRIAL_NOT_FULL_BASE_APPROVAL',units='mm',
                trial_geometry_checks_pass=True,print_readiness='PRINTER_FIT_TRIAL',
                producer_receipt=str(snapshot.path),producer_receipt_sha256=snapshot.sha256,
                producer_source_code_sha256=trial['sources'],
                source_code_sha256={Path(__file__).name:trial['generator_sha256']},
                source_joint_name=trial['joint'].name,source_clip=dict(radial_centre_mm=RADIAL_CENTRE,
                    radial_tangential_width_mm=[20,20],angle_degrees=ANGLE,z_mm=[-10.1,trial['gap']+.1]),
                review_components=records,print_part_names=['roof','spacer'],material_reference_names=['formed_PTFE','flat_PTFE'],
                checks=checks,assembly_step=str(assembly_path.resolve()),assembly_step_sha256=assembly_sha256,
                instructions=['Print only the two files in print/. Each is centered and rests at Z0.',
                              'Use the same resin, orientation, wash and cure as the intended base.',
                              'Cut/form purchased 1 mm PTFE to the material reference; these are not print parts.',
                              'Load the real M3 nut before mating the two prints. Use the real ISO10642 M3x25 screw, 2 mm key.',
                              'The 25 mm screw length includes its countersunk head. Tighten only enough to seat for this fit test.',
                              'Check nut insertion/rotation, screw reach, ear forming, cone retention and clearance below root.',
                              'The supplier head diameter/angle tolerance seats at different depths; do not force a flush appearance.',
                              'This trial does not prove load capacity, creep life or full-ball fit.'])
    target.write_text(json.dumps(report,indent=2)+'\n')
    try:
        inputs_unchanged(trial);exported.unchanged()
    except Exception:
        target.unlink(missing_ok=True)
        raise
    print(target)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-receipt',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    export(make_trial(args.base_receipt),args.output)
