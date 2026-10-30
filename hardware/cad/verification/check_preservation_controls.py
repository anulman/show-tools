"""Mutate delivered A geometry, update its real file pins, demand rejection.

These controls exercise CAD preservation, rather than merely corrupting a hash
or changing a producer's Boolean. They never replace the frozen candidate.
"""
from __future__ import annotations
import argparse,copy,hashlib,importlib,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from build123d import import_step,export_step,export_stl
p=importlib.import_module('disco-bar.check_post_glue_preservation')
c=p.c;a=p.a


def run(source,reference,output):
    if output.exists():raise ValueError('Use a fresh control namespace')
    output.mkdir(parents=True)
    original=json.loads(source.read_text());bar=import_step(original['environment']['step'])
    cup_record=original['stages']['outside']['components'][0]
    if cup_record['name']!='removable padded knob cup':raise ValueError('Unexpected source cup')
    cup=import_step(cup_record['step'])
    oracle=a.source_channels(p.disco_bar.load_reference(reference)[1]);first=next(iter(oracle.values()))
    xy=first['center_xy_mm'];radius=first['radius_mm']
    mutations=[('shortened bar',bar-c.cyl(100.,2.,(0,0,-109.22)), 'Protected profile removed','environment'),
               ('blocked original channel',bar+(c.cyl(radius+.5,1.,(*xy,-10.)) & c.cyl(46.,1.,(0,0,-10.))), 'Original channel void obstructed','environment'),
               ('obstructed original socket',cup+c.cyl(2.,3.,(0,0,original['stages']['outside']['source_pose']['shift']-25.)),
                'Delivered cup obstructs original socket','cup')]
    results={}
    for name,shape,expected,target in mutations:
        folder=output/name.replace(' ','-');folder.mkdir()
        if not shape.is_valid or len(shape.solids())!=1:raise ValueError('Invalid actual geometry mutation: '+name)
        step=folder/'mutated.step';stl=folder/'mutated.stl';export_step(shape,step);export_stl(shape,stl)
        data=copy.deepcopy(original)
        record=data['environment'] if target=='environment' else data['stages']['outside']['components'][0]
        for kind,path in [('step',step),('stl',stl)]:record[kind]=str(path);record[kind+'_sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        receipt=folder/'mutated-receipt.json';receipt.write_text(json.dumps(data,indent=2)+'\n')
        try:p.run(receipt,reference,folder/'MUST-NOT-PASS.json')
        except ValueError as error:
            if expected not in str(error):raise
            results[name]=dict(rejected=True,reason=str(error),mutated_receipt_sha256=hashlib.sha256(receipt.read_bytes()).hexdigest())
            print('REJECTED actual geometry:',name,str(error),flush=True)
        else:raise AssertionError('Unsafe geometry admitted: '+name)
    (output/'receipt.json').write_text(json.dumps(dict(schema=1,actual_geometry_negative_controls=results,
        original_source_receipt=str(source),original_source_sha256=hashlib.sha256(source.read_bytes()).hexdigest()),indent=2)+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('source','reference','output'):parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();run(args.source,args.reference,args.output)
