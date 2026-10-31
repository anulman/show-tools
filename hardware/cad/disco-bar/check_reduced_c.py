"""Export the single reduced C candidate; no admission or publication implied."""
from __future__ import annotations
import argparse,hashlib,importlib,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
m=importlib.import_module('disco-bar.reduced_c');v=importlib.import_module('disco-bar.check_post_glue_candidates');c=m.c


def run(baseline,output):
    output.mkdir(parents=True,exist_ok=True);(output/'receipt.json').unlink(missing_ok=True)
    sources={Path(f).resolve():hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (__file__,m.__file__,v.__file__,v.m.__file__,c.__file__,v.m.grip.__file__,v.m.old.__file__,v.m.channels.__file__,v.p.__file__,v.disco_bar.__file__)}
    candidate=m.build(baseline);inputs=candidate.inputs.copy();stages={}
    for stage,pose in candidate.stages.items():
        posed=m.posed(candidate,stage);v.check_parts([c.Piece('immutable glued C456 bar',candidate.bar,'bar'),*posed])
        old={q['name']:q for q in candidate.baseline['stages'][stage]['components']};records=[]
        for q in posed:
            if q.name==m.FUSED_HALF:record=v.export_piece(q,output/'stages'/stage)
            else:
                name='removable collar half A' if q.name==m.LOCK_HALF else q.name
                record=dict(old[name],name=q.name)
                for kind in ('step','stl'):
                    file=Path(record[kind]);sha=hashlib.sha256(file.read_bytes()).hexdigest()
                    if sha!=record[kind+'_sha256']:raise ValueError('Changed baseline staged artifact')
                    inputs[str(file.resolve())]=sha
            records.append(record)
        actual=[c.Piece(q['name'],v.p.import_step(q['step']).solids()[0],q['role']) for q in records]
        v.check_parts([c.Piece('immutable glued C456 bar',candidate.bar,'bar'),*actual])
        if stage=='outside' and any(q.shape.bounding_box().min.Z<0 for q in actual):raise ValueError('Actor starts inside ball')
        stages[stage]=dict(source_pose=pose,components=records,endpoint_rigid_clearance=True,delivered_step_endpoint_rigid_clearance=True,world_mouth_height_rule='nominal gap + shift, keeping knob/cup fixed in world')
        for file,sha in {**sources,**{Path(k):v for k,v in inputs.items()}}.items():
            if hashlib.sha256(file.read_bytes()).hexdigest()!=sha:raise ValueError('Input changed during export')
        print('REDUCED C ENDPOINT',stage,'PASS',flush=True)
    prints=[candidate.baseline['environment'],*[q for q in stages['inserted']['components'] if q['role']=='print']]
    unique=[]
    for q in prints:
        if q['name'].startswith('-1 retained padded shoe'):continue
        unique.append(dict(name=q['name'],quantity=2 if q['name'].startswith('+1 retained padded shoe') else 1,step=q['step'],step_sha256=q['step_sha256'],stl=q['stl'],stl_sha256=q['stl_sha256']))
    report=dict(schema=1,concept='post-glue C',variant='reduced-cover-B',scope='ACTUAL ENDPOINTS ONLY; NEW17-ACTOR PROTOCOL AND ALL MOTIONS REQUIRE INDEPENDENT ADMISSION',geometry_review_pass=False,lifecycle_verified=False,continuous_motion_verified=False,physical_fit_verified=False,bar_already_glued=True,above_root_exterior_access=False,environment=candidate.baseline['environment'],reference_sha256=candidate.baseline['reference_sha256'],baseline_receipt=str(baseline.resolve()),baseline_receipt_sha256=m.BASELINE_SHA,input_files=inputs,source_code_sha256={f.name:sha for f,sha in sources.items()},source_files={str(f):sha for f,sha in sources.items()},stages=stages,endpoint_geometry_pass=True,delivered_step_endpoint_geometry_pass=True,manufacturing=dict(printed_physical_count=6,unique_print_designs=5,metal_count=10,pad_count=2,detachable_actor_count=17,unique_prints=unique,shoe_duplicate_requires_rotation_Z_degrees=180.))
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--baseline',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.baseline,args.output)
