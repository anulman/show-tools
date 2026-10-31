"""Real connected socket obstruction must reject the new serial service proof."""
from __future__ import annotations
import argparse,hashlib,importlib,json,sys
from copy import deepcopy
from pathlib import Path
from build123d import import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
s=importlib.import_module('disco-bar.check_airgap_c_service');e=s.e;u=s.u;c=s.c;v=s.v;a=s.a


def run(source,output):
    if output.exists():raise ValueError('Use a fresh air-gap control namespace')
    output.mkdir(parents=True);raw=source.read_bytes();data=json.loads(raw)
    pins={str(source.resolve()):hashlib.sha256(raw).hexdigest()}
    for module in (sys.modules[__name__],s,e,u,c,v,a):pins[str(Path(module.__file__).resolve())]=hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest()
    rows=data['stages']['turned']['components'];parts={q['name']:import_step(q['step']).solids()[0] for q in rows}
    name=e.r.LOCK_HALF;point=e.m.old.xy(38.5,295.)
    plug=c.cyl(3.,1.,(*point,7.));mutant=deepcopy(parts[name])+plug
    if not mutant.is_valid or len(mutant.solids())!=1:raise AssertionError('Socket obstruction must be one connected valid solid')
    collision=a.channel_material_volume(a.channel_boolean(a.BRepAlgoAPI_Common,deepcopy(s.actual4(295.)).wrapped,deepcopy(mutant).wrapped))
    if collision<=1e-5:raise AssertionError('Socket obstruction does not hit actual ordinary AF4 key')
    record=v.export_piece(c.Piece(name,mutant,'print'),output/'mutated-actual')
    changed=deepcopy(data);changed['stages']['turned']['components']=[record if q['name']==name else q for q in rows]
    path=output/'mutated-receipt.json';path.write_text(json.dumps(changed,indent=2)+'\n')
    try:s.run(path,output/'must-not-pass')
    except ValueError as error:
        if 'collision' not in str(error).lower():raise
        reason=str(error)
    else:raise AssertionError('Actual obstructed serial recovery socket admitted')
    s.run(source,output/'restored-positive');u.unchanged(parts,rows)
    for path,sha in pins.items():
        if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=sha:raise ValueError('Air-gap control input changed')
    restored=output/'restored-positive/receipt.json'
    report=dict(schema=1,variant='air-gap-C-serial-service',source_receipt_sha256=pins[str(source.resolve())],input_files=pins,connected_AF4_socket_obstruction=dict(rejected=True,native_actual_key_collision_mm3=collision,reason=reason,mutated_actual=record),original_subjects_unchanged=True,restored_positive=dict(path=str(restored.resolve()),sha256=hashlib.sha256(restored.read_bytes()).hexdigest()))
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print('AIRGAP REAL SOCKET NEGATIVE AND RESTORED POSITIVE PASS',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('source','output'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();run(args.source,args.output)
