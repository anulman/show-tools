"""Actual C STEP collar race bounds and axial push/contact witnesses."""
from __future__ import annotations
from copy import deepcopy
import argparse,hashlib,importlib,json,sys,math
from pathlib import Path
from build123d import Compound,import_step,Axis
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
r=importlib.import_module('disco-bar.reduced_c')
u=importlib.import_module('disco-bar.reduced_c_subjects')
BODY_NAMES={r.LOCK_HALF,r.FUSED_HALF}
m=importlib.import_module('disco-bar.post_glue_couplings');c=m.c;a=m.channels
p=importlib.import_module('disco-bar.check_couplings')


def run(source,output):
    output.mkdir(parents=True,exist_ok=True);(output/'receipt.json').unlink(missing_ok=True)
    paths={Path(f).resolve():hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (__file__,r.__file__,u.__file__,m.__file__,c.__file__,a.__file__,p.__file__)}
    raw=source.read_bytes();data=json.loads(raw);paths[source.resolve()]=hashlib.sha256(raw).hexdigest()
    if data['concept']!='post-glue C':raise ValueError('C race evidence only')
    def load(record):
        for kind in ('step','stl'):
            file=Path(record[kind]);sha=hashlib.sha256(file.read_bytes()).hexdigest()
            if sha!=record[kind+'_sha256']:raise ValueError('Artifact changed')
            paths[file.resolve()]=sha
        shape=import_step(record['step'])
        if not shape.is_valid or len(shape.solids())!=1:raise ValueError('Invalid actual solid')
        return shape.solids()[0]
    def operation(kind,left,right):return a.channel_boolean(kind,left.wrapped,right.wrapped)
    def empty(left,right,label,kind=a.BRepAlgoAPI_Common):
        amount=a.channel_material_volume(operation(kind,left,right))
        if amount>1e-5:raise ValueError(label+': '+str(amount))
        return amount
    def contains(part,bound,label):return empty(part,bound,label,a.BRepAlgoAPI_Cut)
    def witness(label,left,right):
        raw=operation(a.BRepAlgoAPI_Common,left,right);amount=a.channel_material_volume(raw)
        if amount<=1e-5:raise ValueError('Missing positive contact '+label)
        records=[p.export_piece(c.Piece(label+' '+str(i),deepcopy(solid),'overtravel contact witness only; NOT PRINT GEOMETRY'),output/'contacts') for i,solid in enumerate(Compound(raw).solids())]
        return dict(overtravel_source_mm=.01,intersection_mm3=amount,components=records)
    bar=load(data['environment']);records={};contacts={}
    def collar_bound(extra):
        shape=m.old.ring(33.5,35.,-9.5,-6.1+extra)+m.old.ring(33.5,43.7,1.,11.5+extra)
        for start,end in ((35.,112.),(205.,285.)):shape+=m.sector(34.5,39.5,-9.5,-6.1+extra,start,end)
        for angle in (35.,50.,220.):shape+=m.old.radial(c.box(5.,6.,2.+extra,(41.,0,-8.+extra/2)),angle)
        for angle in (90.,270.):shape+=m.old.radial(c.box(5.,10.,3.5+extra,(38.5,0,-8.+extra/2)),angle)
        for angle in (90.,215.,275.):shape+=m.sector(37.,39.5,-6.1,1.+extra,angle-3,angle+3)
        return shape
    initial,moving=collar_bound(0.),collar_bound(1.1)
    for stage in ('inserted','turned'):
        parts={record['name']:load(record) for record in data['stages'][stage]['components']}
        cup=parts['removable padded knob cup'];angle=data['stages'][stage]['source_pose']['angle']
        if data['stages'][stage]['source_pose'].get('collar_shift')!=-.5:raise ValueError('Unexpected loaded stop')
        bounds=[]
        for name,part in parts.items():
            if name=='removable padded knob cup' or name.startswith(('-1','+1')):continue
            if name in BODY_NAMES:
                contains(part,initial.rotate(Axis.Z,angle),'Collar outside matched R/Z decomposition')
                bound=moving.rotate(Axis.Z,angle)
            elif name.startswith('threaded M4 full nut'):
                entry=float(name.rsplit(' ',1)[1]);point=m.old.xy(38.,entry+angle)
                bound=m.old.radial(c.hexagon(7/math.sqrt(3),4.8,(38.,0,-4.4)),entry+angle)
            elif name.startswith('axial M4x12 socket screw'):
                entry=float(name.rsplit(' ',1)[1]);point=m.old.xy(38.,entry+angle)
                bound=c.cyl(2.,13.6,(*point,-2.7))+c.cyl(3.5,5.6,(*point,5.3))
            elif name.startswith('external collar M2'):
                joint=float(name.rsplit(' ',1)[1])+angle
                bound=m.old.radial(c.box(4.62,1.6,5.72,(38.5,-2.3,-7.45)) if ' nut ' in name else c.box(3.8,10.,4.9,(38.5,0,-7.45)),joint)
            else:
                bound=m.old.ring(33.5,43.7,1.,12.6)
            contains(part,bound,'Actual part outside complete race bound '+name)
            contains(part.translate((0,0,1.1)),bound,'Upper endpoint outside race bound '+name)
            empty(bound,cup,'Race bound collides with fixed cup '+name)
            empty(bound,bar,'Race bound collides with glued bar '+name)
            bounds.append(dict(name=name,components=[p.export_piece(c.Piece(stage+' '+name+' race bound '+str(i),solid,'continuous +0..1.1mm collar motion bound'),output/'bounds') for i,solid in enumerate(bound.solids())]))
        u.unchanged(parts,data['stages'][stage]['components'])
        records[stage]=bounds
        if stage=='inserted':
            for name,part in parts.items():
                if name in BODY_NAMES:
                    contacts[name+' upper stop']=witness(name+' upper stop',part.translate((0,0,-.01)),cup)
                    contacts[name+' lower stop']=witness(name+' lower stop',part.translate((0,0,1.11)),cup)
            screw=next(part for name,part in parts.items() if name.startswith('axial M4x12 socket screw'))
            halves=[part for name,part in parts.items() if name in BODY_NAMES]
            hits=[]
            for i,half in enumerate(halves):
                raw=operation(a.BRepAlgoAPI_Common,screw.translate((0,0,-.01)),half)
                if a.channel_material_volume(raw)>1e-5:hits.append(witness('screw head seat '+str(i),screw.translate((0,0,-.01)),half))
            if not hits:raise ValueError('No positive screw head seat contact')
            contacts['screw head seat']=hits
            cover=parts[r.FUSED_HALF]
            empty(screw.translate((0,0,.5)),cover,'Nominal head float blocked before cover stop')
            contacts['screw head capture cover']=witness('screw head capture cover',screw.translate((0,0,.51)),cover)
    u.unchanged({data['environment']['name']:bar},[data['environment']])
    for file,sha in paths.items():
        if hashlib.sha256(file.read_bytes()).hexdigest()!=sha:raise ValueError('Input changed during race proof')
    result=dict(schema=1,concept=data['concept'],variant='reduced-cover-B',actual_delivered_step_only=True,actual_subjects_reimport_unchanged=True,source_receipt=str(source.resolve()),source_receipt_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),input_files={str(f):sha for f,sha in paths.items()},collar_delta_source_range_mm=[-.5,.6],head_float_source_range_mm=[0.,.5],nut_orientation='actual exported orientation held; no free nut spin permission',scope='CONTINUOUS RELEASED INSERTED/TURNED RACE AND THREADED HEAD-FLOAT RANGES; NOT FREE-RACE ROTATION PERMISSION',continuous_bounds=records,contacts=contacts,requires_upper_stop_for_reverse_rotation=True,requires_bottomed_key_push_for_head_seated=True,head_float_motion_verified=True,lifecycle_verified=False,physical_strength_verified=False)
    (output/'receipt.json').write_text(json.dumps(result,indent=2)+'\n');print('ACTUAL C RACE AND CONTACT BOUNDS PASS',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.source,args.output)
