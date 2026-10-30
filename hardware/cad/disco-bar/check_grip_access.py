"""Full ordinary 1.5 mm L-key access to frozen C2 grip screws, with bar removed."""
from __future__ import annotations
import argparse
import hashlib
import importlib
import json
import math
from pathlib import Path
import sys
from build123d import Axis,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
v=importlib.import_module('disco-bar.check_standard_collar')
m,c,p=v.m,v.c,v.p
SOURCE_SHA='83886c072ce113015196fd621a74c663830b305d3989904e0873e9158d08251d'
TOOL=dict(manufacturer='Wera',part='05021600001',name='950 L 1.5 x 90 x 14 mm',
          source='https://www.wera.de/fileadmin/pdf/catalog/ES-Catalogo-compacto-2025.pdf',
          model='complete conservative L envelope with radius 1 mm stock and nominal AF1.5 working hex; not proprietary surface CAD')


def key(sign,angle=0.,retreat=0.):
    shape=c.hexagon(1.5/math.sqrt(3),2.,(32.5,0,-13),'x')
    shape+=c.cyl(1.,88.,(77.5,0,-13),'x')
    shape+=c.cyl(1.,14.,(120.5,0,-20))
    shape=shape.rotate(Axis((0,0,-13),(1,0,0)),angle)
    if sign<0:shape=shape.rotate(Axis.Z,180)
    return shape.translate((sign*retreat,0,0))


def sweep(sign,entry=False):
    distance=10. if entry else 0.
    shape=c.cyl(1.,90.+distance,(76.5+distance/2,0,-13),'x')
    shape+=c.cyl(15.,2.+distance,(120.5+distance/2,0,-13),'x')
    return shape if sign>0 else shape.rotate(Axis.Z,180)


def run(source,output):
    output.mkdir(parents=True,exist_ok=True)
    (output/'receipt.json').unlink(missing_ok=True)
    data=source.read_bytes()
    if hashlib.sha256(data).hexdigest()!=SOURCE_SHA:raise ValueError('Wrong frozen C2 receipt')
    producer=json.loads(data)
    sources={Path(module.__file__).name:hashlib.sha256(Path(module.__file__).read_bytes()).hexdigest() for module in (v,m,c,p)}
    for name,sha in sources.items():
        if producer['source_code_sha256'][name]!=sha:raise ValueError('Tool helper changed: '+name)
    parts={record['name']:None for record in producer['review_components']}
    for record in producer['review_components']:
        file=Path(record['step'])
        if hashlib.sha256(file.read_bytes()).hexdigest()!=record['step_sha256']:raise ValueError('STEP hash mismatch')
        loaded=import_step(file)
        if not loaded.is_valid or len(loaded.solids())!=1:raise ValueError('Invalid source STEP')
        parts[record['name']]=loaded.solids()[0]
    preset={name:shape for name,shape in parts.items() if name.startswith('preset / ')}
    checks=[];exports=[]
    for sign in (-1,1):
        screw_name=f'preset / {sign:+d} preset set-screw envelope'
        screw=parts[screw_name]
        axis=Axis((0,0,-13),(sign,0,0))
        for angle in range(0,360,5):
            tool=key(sign,angle)
            c.assert_empty(tool-sweep(sign),'Actual key outside operating sweep')
            for name,shape in preset.items():
                # Rotate the purchased screw socket with the engaged key.
                # This checks handle clearance, not a 360-degree grip-setting stroke.
                obstacle=shape.rotate(axis,angle) if name==screw_name else shape
                if not v.disjoint(tool,obstacle):c.assert_empty(tool&obstacle,'Grip key blocked: '+name)
        for distance in [i*.25 for i in range(41)]:
            tool=key(sign,0,distance)
            c.assert_empty(tool-sweep(sign,True),'Actual key outside entry sweep')
            for name,shape in preset.items():
                if not v.disjoint(tool,shape):c.assert_empty(tool&shape,'Grip key entry blocked: '+name)
        if c.volume(key(sign)&parts['full-height bar'])<=1e-5:raise ValueError('Missing bar-on obstruction control')
        checks.append(dict(side=sign,working_end_nominal_socket_overlap_mm=1.3,
            full_handle_orientation_samples_degrees=list(range(0,360,5)),entry_samples_mm=[i*.25 for i in range(41)],
            preset_clear=True,bar_installed_blocks_access=True))
        for label,shape in ((f'{sign:+d} ordinary 1.5 mm grip key',key(sign)),
                            (f'{sign:+d} full grip key operating sweep',sweep(sign)),
                            (f'{sign:+d} full grip key axial entry sweep',sweep(sign,True))):
            exports.append(p.export_piece(c.Piece(label,shape,'temporary tool clearance probe'),output/'access'))
    report=dict(scope='C2 bar-off grip-setting tool clearance; complete base consumer checks still required',
        geometry_review_pass=True,tool=TOOL,source_receipt=str(source.resolve()),source_receipt_sha256=SOURCE_SHA,
        source_candidate_commit='4903640',checks=checks,access_components=exports,
        source_code_sha256={'check_grip_access.py':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),**sources},
        installed_height_relation='key axis g+13 mm above roof; handle sweep outside radius 119.5 mm',
        limits='Handle orientations are clearance samples, not permission to turn the grip through 360 degrees against compressed pads. Actual key and socket tolerances, pad preload, hand clearance and physical fit are unverified.')
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(dict(geometry_review_pass=True,sides=2,tool=TOOL['part'])),flush=True)
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.source,args.output)
