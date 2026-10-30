"""Export actual candidate geometry and endpoint evidence; continuous proof is separate."""
from __future__ import annotations
import argparse,hashlib,importlib,json,sys
from pathlib import Path
from build123d import Plane,Solid
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import disco_bar
m=importlib.import_module('disco-bar.post_glue_couplings');c=m.c
p=importlib.import_module('disco-bar.check_couplings')


def paired(a,b):
    names={a,b}
    if any('preset set-screw' in n for n in names):
        return any('captive nut envelope' in n for n in names) and a.split()[0]==b.split()[0]
    for prefix,suffix in (('external cover M3x8 screw ','external cover M3 nut '),('axial M4x12 socket screw ','threaded M4 full nut '),('external collar M2x8 screw ','external collar M2 nut ')):
        for first,second in ((a,b),(b,a)):
            if first.startswith(prefix) and second==suffix+first.removeprefix(prefix):return True
    return False


def check_parts(parts):
    for q in parts:
        if not q.shape.is_valid or len(q.shape.solids())!=1:raise ValueError('Invalid print/part: '+q.name)
    for i,a in enumerate(parts):
        for b in parts[i+1:]:
            aa,bb=a.shape.bounding_box(),b.shape.bounding_box()
            if any(getattr(aa.max,k)<=getattr(bb.min,k)+1e-7 or getattr(bb.max,k)<=getattr(aa.min,k)+1e-7 for k in ('X','Y','Z')):continue
            hit=a.shape&b.shape
            if c.volume(hit)<=1e-5:continue
            if not paired(a.name,b.name):raise ValueError('Interference '+a.name+' / '+b.name+': '+str(c.volume(hit)))
            nut=a if 'nut' in a.name else b
            bore=next(BRepAdaptor_Surface(f.wrapped).Cylinder() for f in nut.shape.faces() if BRepAdaptor_Surface(f.wrapped).GetType()==GeomAbs_Cylinder)
            axis=bore.Axis();o=axis.Location();d=axis.Direction();radius=2.01 if 'M4' in nut.name else 1.01 if 'M2' in nut.name else 1.51
            zone=Solid.make_cylinder(radius,100,Plane(origin=(o.X()-50*d.X(),o.Y()-50*d.Y(),o.Z()-50*d.Z()),z_dir=(d.X(),d.Y(),d.Z())))
            c.assert_empty(hit-zone,'Non-thread metal collision')


def run(step,concept,output):
    output.mkdir(parents=True,exist_ok=True);(output/'receipt.json').unlink(missing_ok=True)
    path,reference=disco_bar.load_reference(step);disco_bar.verify_full_reference(path,reference)
    model=importlib.import_module('disco-bar.post_glue_cassette') if concept=='C' else m
    sources={Path(f).resolve():hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (model.__file__,m.__file__,__file__,c.__file__,m.grip.__file__,m.old.__file__,m.channels.__file__,p.__file__,disco_bar.__file__)}
    def unchanged():
        for f,sha in sources.items():
            if hashlib.sha256(f.read_bytes()).hexdigest()!=sha:raise ValueError('Source changed during candidate check: '+str(f))
    candidate=model.build(reference) if concept=='C' else model.build(reference,concept)
    check_parts([c.Piece('bare glued bar',candidate.bar,'bar')])
    mask=c.cyl(46.21,30.01,(0,0,-15))
    c.assert_empty((reference-candidate.bar)-mask,'Protected original removed')
    c.assert_empty((candidate.bar-reference)-mask,'Protected original added')
    for label,record in candidate.channels.items():m.channels.equal(candidate.bar&record['envelope'],reference&record['envelope'],'Original channel '+label)
    environment=p.export_piece(c.Piece('bare glued bar',candidate.bar,'single printed glued environment; no installed hardware'),output/'environment')
    stages={}
    for stage,pose in candidate.stages.items():
        parts=model.posed(candidate,stage)
        check_parts([c.Piece('bare glued bar',candidate.bar,'bar'),*parts])
        if stage=='outside' and any(q.shape.bounding_box().min.Z<0 for q in parts):raise ValueError('Not all actors outside')
        records=[p.export_piece(q,output/'stages'/stage) for q in parts]
        stages[stage]=dict(source_pose=pose,world_mouth_height_rule='nominal gap + shift, keeping knob/cup fixed in world',components=records,endpoint_rigid_clearance=True)
        unchanged()
        print('ENDPOINT',concept,stage,'PASS',flush=True)
    report=dict(schema=1,concept='post-glue '+concept,scope='ACTUAL GEOMETRY AND ENDPOINTS ONLY; NOT FORMALLY ADMITTED',
        geometry_review_pass=False,endpoint_geometry_pass=True,continuous_motion_verified=False,base_integration_verified=False,
        lifecycle_verified=False,physical_fit_verified=False,environment=environment,bar_already_glued=True,
        above_root_exterior_access=False,reference_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        stages=stages,source_frame='Z0 root; negative Z inside ball; positive Z root-side exterior',
        source_code_sha256={f.name:sha for f,sha in sources.items()})
    unchanged()
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--step',type=Path,required=True);parser.add_argument('--concept',choices=('A','B','C'),required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.step,args.concept,args.output)
