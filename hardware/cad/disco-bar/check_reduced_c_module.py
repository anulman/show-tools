"""Actual reduced module against the accepted nominal OEM socket envelope."""
from __future__ import annotations
import argparse,hashlib,importlib,json,sys
from pathlib import Path
from build123d import Axis,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
u=importlib.import_module('disco-bar.reduced_c_subjects')
m=importlib.import_module('disco-bar.post_glue_couplings');c=m.c;a=m.channels


def run(source,output):
    output.mkdir(parents=True,exist_ok=True);(output/'receipt.json').unlink(missing_ok=True)
    paths={Path(f).resolve():hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (__file__,u.__file__,m.__file__,c.__file__,a.__file__)}
    paths[source.resolve()]=hashlib.sha256(source.read_bytes()).hexdigest();data=json.loads(source.read_text())
    if data.get('variant')!='reduced-cover-B':raise ValueError('Reduced C required')
    rows=[];parts={}
    for record in data['stages']['inserted']['components']:
        for kind in ('step','stl'):
            file=Path(record[kind]);sha=hashlib.sha256(file.read_bytes()).hexdigest()
            if sha!=record[kind+'_sha256']:raise ValueError('Changed actual file')
            paths[file.resolve()]=sha
        part=import_step(record['step'])
        if not part.is_valid or len(part.solids())!=1:raise ValueError('Invalid actual solid')
        parts[record['name']]=part.solids()[0]
        radius=21.977365 if record['role']=='pad' else 22.177375
        envelope=c.cyl(radius,125.4,(0,0,37.3))
        raw=a.channel_boolean(a.BRepAlgoAPI_Common,part.wrapped,envelope.wrapped);amount=a.channel_material_volume(raw)
        if amount>1e-5:raise ValueError('Nominal OEM module entry blocked '+record['name'])
        rows.append(dict(name=record['name'],rigid_intersection_mm3=amount,permitted_soft_pad_compression_mm=.20001 if record['role']=='pad' else 0.))
    left=parts['-1 retained padded shoe'];right=parts['+1 retained padded shoe'].rotate(Axis.Z,180.)
    differences=[]
    for first,second in ((left,right),(right,left)):
        raw=a.channel_boolean(a.BRepAlgoAPI_Cut,first.wrapped,second.wrapped);amount=a.channel_material_volume(raw)
        if amount>1e-5:raise ValueError('Shoe instances are not one printable design')
        differences.append(amount)
    manifest=data['manufacturing']['unique_prints']
    if len(manifest)!=5 or sum(q['quantity'] for q in manifest)!=6 or [q['quantity'] for q in manifest if q['name']=='+1 retained padded shoe']!=[2]:raise ValueError('Unique print quantities differ')
    u.unchanged(parts,data['stages']['inserted']['components'])
    for path,sha in paths.items():
        if hashlib.sha256(path.read_bytes()).hexdigest()!=sha:raise ValueError('Input changed')
    report=dict(schema=1,concept='post-glue C',variant='reduced-cover-B',source_receipt_sha256=paths[source.resolve()],source_receipt=str(source.resolve()),input_files={str(k):v for k,v in paths.items()},actual_delivered_files=True,actual_subjects_reimport_unchanged=True,shoe_duplicate_Z180_difference_mm3=differences,unique_print_manifest_checked=True,nominal_knob_path_clear=True,continuous_knob_entry_withdrawal_mm=100,checks=rows,base_service_deferred_to_combined_admission=True,scope='Original accepted socket nominal envelope only, NOT measured knob geometry; base service clearance requires combined admission',physical_fit_verified=False,pad_grip_force_verified=False)
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print('REDUCED NOMINAL MODULE PATH PASS',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.source,args.output)
