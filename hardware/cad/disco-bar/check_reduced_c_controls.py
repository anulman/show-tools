"""Real actual-file geometry mutations and the past unsafe-face operation must fail."""
from __future__ import annotations
from copy import deepcopy
import argparse,hashlib,importlib,json,sys
from pathlib import Path
from build123d import import_step,export_step,export_stl,extrude
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'verification'))
v=importlib.import_module('disco-bar.check_post_glue_candidates');c=v.c;a=v.m.channels
u=importlib.import_module('disco-bar.reduced_c_subjects')
root=importlib.import_module('disco-bar.check_reduced_c_root')
from check_preservation_controls import run as preservation_controls


def run(source,reference,output):
    if output.exists():raise ValueError('Use a fresh negative-control namespace')
    output.mkdir(parents=True);data=json.loads(source.read_text());pins={str(source.resolve()):hashlib.sha256(source.read_bytes()).hexdigest(),str(reference.resolve()):hashlib.sha256(reference.read_bytes()).hexdigest()}
    for module in (sys.modules[__name__],v,u,root):pins[str(Path(module.__file__).resolve())]=hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
    preservation_controls(source,reference,output/'preservation')
    rows=data['stages']['inserted']['components'];subjects={q['name']:import_step(q['step']).solids()[0] for q in rows};u.unchanged(subjects,rows)
    altered=dict(subjects);name='integrated half B and capture cover';altered[name]=altered[name].translate((0,0,.01))
    try:u.unchanged(altered,rows)
    except ValueError:rigid_rejected=True
    else:raise AssertionError('Moved in-memory actual subject admitted')
    bar_record=data['environment'];bar=import_step(bar_record['step']).solids()[0]
    def face_operation(copy_first):
        subject=import_step(bar_record['step']).solids()[0];before=u.fingerprint(subject)
        ring=v.m.old.ring(44.,45.5,-1.,0.);band=next(f for f in ring.faces() if abs(f.bounding_box().min.Z)<1e-7 and abs(f.bounding_box().max.Z)<1e-7)
        for face in subject.faces():
            box=face.bounding_box()
            if abs(box.min.Z)<1e-7 and abs(box.max.Z)<1e-7:
                for patch in ((deepcopy(face) if copy_first else face)&band).faces():extrude(deepcopy(patch) if copy_first else patch,amount=.1,dir=(0,0,1))
        return subject,before==u.fingerprint(subject)
    unsafe,same=face_operation(False)
    if same:raise AssertionError('Past actual face mutation no longer reproduced')
    try:u.unchanged({bar_record['name']:unsafe},[bar_record])
    except ValueError:past_rejected=True
    else:raise AssertionError('Past face mutation admitted')
    safe,same=face_operation(True)
    if not same or not safe.is_valid:raise AssertionError('Deepcopied face control changed subject')
    u.unchanged({bar_record['name']:safe},[bar_record])
    # Connected material, not a hash-only mutant or disconnected cosmetic solid.
    fused=subjects[name];fin=v.m.old.radial(c.box(4.5,2.,1.,(43.75,0,-8.)),35.)
    mutant=deepcopy(fused)+fin
    if not mutant.is_valid or len(mutant.solids())!=1:raise AssertionError('Collision fin is not a connected valid solid')
    raw=a.channel_boolean(a.BRepAlgoAPI_Common,mutant.wrapped,bar.wrapped);hit=a.channel_material_volume(raw)
    if hit<=1e-5:raise AssertionError('Actual fin is not a mechanical collision')
    folder=output/'connected-collision-fin';record=v.export_piece(c.Piece(name,mutant,'print'),folder)
    changed=deepcopy(data)
    changed['stages']['inserted']['components']=[record if q['name']==name else q for q in rows]
    receipt=folder/'mutated-receipt.json';receipt.write_text(json.dumps(changed,indent=2)+'\n')
    try:root.run(receipt,folder/'must-not-pass')
    except ValueError as error:
        if 'outside' not in str(error).lower() and 'blocked' not in str(error).lower():raise
        reason=str(error)
    else:raise AssertionError('Connected actual collision fin admitted')
    # Restore original files and rerun the entire positive native root proof.
    root.run(source,output/'restored-positive-root')
    u.unchanged(subjects,rows);u.unchanged({bar_record['name']:bar},[bar_record])
    for path,sha in pins.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=sha:raise ValueError('Control source/input changed')
    preserved=json.loads((output/'preservation'/'receipt.json').read_text())['actual_geometry_negative_controls']
    report=dict(schema=1,variant='reduced-cover-B',source_receipt_sha256=pins[str(source.resolve())],input_files=pins,actual_geometry_negative_controls=preserved|{'connected collision fin':dict(rejected=True,native_collision_mm3=hit,reason=reason)},memory_mutation_guard=dict(all17_fresh_checksum=True,moved_subject_rejected=rigid_rejected,past_actual_face_operation_rejected=past_rejected,deepcopy_control_unchanged=True),restored_positive_root=dict(path=str(output/'restored-positive-root'/'receipt.json'),sha256=hashlib.sha256((output/'restored-positive-root'/'receipt.json').read_bytes()).hexdigest()),scope='Expected negative tests on temporary actual geometry copies; originals retained')
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print('REDUCED REAL GEOMETRY AND MEMORY NEGATIVE CONTROLS PASS',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for arg in ('source','reference','output'):parser.add_argument('--'+arg,type=Path,required=True)
    args=parser.parse_args();run(args.source,args.reference,args.output)
