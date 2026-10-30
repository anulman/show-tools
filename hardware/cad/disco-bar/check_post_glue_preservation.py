"""Check original profile/channels and the cup socket on actual delivered STEP solids."""
from __future__ import annotations
import argparse,hashlib,importlib,json,sys
from pathlib import Path
from build123d import import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import disco_bar
m=importlib.import_module('disco-bar.post_glue_couplings');c=m.c;a=m.channels


def run(source,reference_path,output):
    output.unlink(missing_ok=True)
    inputs={}
    sources={Path(f).resolve():hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (__file__,m.__file__,c.__file__,a.__file__,disco_bar.__file__)}
    def bind(path):
        path=Path(path).resolve();raw=path.read_bytes();inputs[str(path)]=hashlib.sha256(raw).hexdigest();return raw
    data=json.loads(bind(source));bind(reference_path)
    path,reference=disco_bar.load_reference(reference_path);disco_bar.verify_full_reference(path,reference)
    def load(record):
        if hashlib.sha256(bind(record['step'])).hexdigest()!=record['step_sha256']:raise ValueError('STEP hash mismatch')
        if hashlib.sha256(bind(record['stl'])).hexdigest()!=record['stl_sha256']:raise ValueError('STL hash mismatch')
        shape=import_step(record['step'])
        if not shape.is_valid or len(shape.solids())!=1:raise ValueError('Invalid delivered solid')
        return shape.solids()[0]
    def operation(kind,left,right):return a.channel_boolean(kind,left.wrapped,right.wrapped)
    from build123d import Compound
    def cut(left,right):return Compound(operation(a.BRepAlgoAPI_Cut,left,right))
    def common(left,right):return Compound(operation(a.BRepAlgoAPI_Common,left,right))
    def empty(shape,label):
        value=a.channel_material_volume(shape.wrapped)
        if value>1e-5:raise ValueError(label+': '+str(value))
        return value
    bar=load(data['environment']);mask=c.cyl(46.21,30.01,(0,0,-15))
    before,after=cut(reference,mask),cut(bar,mask)
    profile=[empty(cut(before,after),'Protected profile removed'),empty(cut(after,before),'Protected profile added')]
    channels={}
    for name,record in a.source_channels(reference).items():
        original=common(reference,record['envelope']);delivered=common(bar,record['envelope'])
        channels[name]=[empty(cut(original,delivered),'Original channel material removed'),empty(cut(delivered,original),'Original channel void obstructed')]
    sockets={}
    for stage,record in data['stages'].items():
        item=next(q for q in record['components'] if q['name']=='removable padded knob cup')
        cup=load(item).translate((0,0,-record['source_pose']['shift']))
        if data['concept']!='post-glue C':cup=cup.rotate(m.Axis.Z,-record['source_pose']['angle'])
        floor=c.cyl(c.R,1.5875,(0,0,-26.19375))
        sockets[stage]=dict(socket_void_added_material_mm3=empty(common(cup,c.pocket()),'Delivered cup obstructs original socket'),blind_floor_missing_material_mm3=empty(cut(floor,cup),'Delivered cup lost blind floor'))
    for file,sha in {**inputs,**{str(f):sha for f,sha in sources.items()}}.items():
        if hashlib.sha256(Path(file).read_bytes()).hexdigest()!=sha:raise ValueError('Input changed during check')
    result=dict(schema=1,concept=data['concept'],source_receipt=str(source.resolve()),source_receipt_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),input_files=inputs,actual_delivered_step_only=True,protected_profile_difference_mm3=profile,original_channel_differences_mm3=channels,socket_checks=sockets,bare_bar_channel_access_after_module_withdrawal=True,installed_extended_channel_access_verified=False,scope='STATIC PROFILE, ORIGINAL CHANNEL MATERIAL/VOID AND KNOWN SOCKET/FLOOR ONLY; NOT LIFECYCLE OR PHYSICAL FIT',source_code_sha256={f.name:sha for f,sha in sources.items()})
    output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(result,indent=2)+'\n');print('ACTUAL STEP PRESERVATION PASS',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True);parser.add_argument('--reference',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.source,args.reference,args.output)
