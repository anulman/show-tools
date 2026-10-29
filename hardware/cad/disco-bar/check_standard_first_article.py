"""Derive and verify a mating-latch test packet from frozen C2 component exports."""
from __future__ import annotations
import argparse
from dataclasses import replace
import hashlib
import importlib
import json
import math
from pathlib import Path
import sys
from build123d import Axis,Keep,Plane,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
v=importlib.import_module('disco-bar.check_standard_collar')
m,c,p=v.m,v.c,v.p
SOURCE_SHA='83886c072ce113015196fd621a74c663830b305d3989904e0873e9158d08251d'
TRIMS={'full-height bar':-12.,'preset / knob baseplate cup':-8.}
LABELS={'full-height bar':'mouth-only latch test fixture','preset / knob baseplate cup':'cup-rim latch test fixture'}


def empty_pair(a,b,label):
    if not v.disjoint(a,b):c.assert_empty(a&b,label)


def exported(piece,folder):
    label=LABELS.get(piece.name,piece.name)
    role='print fixture' if piece.name in TRIMS else piece.role
    record=p.export_piece(c.Piece(label,piece.shape,role),folder)
    record['source_component_name']=piece.name
    return record


def run(source,output):
    output.mkdir(parents=True,exist_ok=True)
    (output/'receipt.json').unlink(missing_ok=True)
    data=source.read_bytes()
    if hashlib.sha256(data).hexdigest()!=SOURCE_SHA:raise ValueError('Wrong frozen C2 receipt')
    receipt=json.loads(data)
    for module in (m,v,m.old,m.old.pads,m.old.pads.previous,c,p):
        file=Path(module.__file__)
        if hashlib.sha256(file.read_bytes()).hexdigest()!=receipt['source_code_sha256'][file.name]:
            raise ValueError('Source differs from frozen candidate: '+file.name)
    pieces=[];derived=[]
    for record in receipt['review_components']:
        name=record['name']
        if name.startswith('preset / ') and name!='preset / knob baseplate cup':continue
        file=Path(record['step'])
        if hashlib.sha256(file.read_bytes()).hexdigest()!=record['step_sha256']:raise ValueError('Source STEP hash mismatch')
        loaded=import_step(file)
        if not loaded.is_valid or len(loaded.solids())!=1:raise ValueError('Invalid source STEP')
        # Transform the actual solid, not the imported assembly wrapper.
        original=loaded.solids()[0];shape=original
        if name in TRIMS:
            z=TRIMS[name]
            shape=original.split(Plane(origin=(0,0,z)),Keep.TOP)
            kept=c.box(150,150,30,(0,0,z+15))
            c.assert_empty(shape-(original&kept),'Fixture added material')
            c.assert_empty((original&kept)-shape,'Fixture lost retained interface')
            derived.append(dict(source_component_name=name,source_step_sha256=record['step_sha256'],retained_source_z_mm=[z,0.],new_geometry='planar truncation only; no scaling, filled pockets, substituted latch or added fastener interfaces'))
        if not shape.is_valid or len(shape.solids())!=1:raise ValueError('Invalid fixture: '+name)
        pieces.append(c.Piece(name,shape,record['role']))
    if len(pieces)!=17:raise ValueError('Wrong test assembly count')
    locked=m.old.Prototype('C2 source-derived mating-latch first article','locked',None,pieces,0.,[])
    n=v.named(locked);collar=n['standard-screw drive collar'];cap=n['preassembled captive-lock cap']
    receivers=n['fixed receiver half A']+n['fixed receiver half B']
    # Initial assembly uses the same parts and order as the complete candidate.
    for dz in [i*.5 for i in range(21)]:
        for name in ('preassembled captive-lock cap','WDS 899 captive M3x12 screw','WDS 899-M3 retaining washer'):
            empty_pair(n[name].translate((0,0,dz)),collar,'Cap assembly blocked')
    for a in (0,120,240):
        for distance in [i*.25 for i in range(25)]:
            dx,dy=m.old.xy(-distance,a)
            empty_pair(n[f'M3 carrier nut {a}'].translate((dx,dy,0)),n['full-height bar'],f'Carrier nut loading blocked {a} {distance}')
    for distance in [i*.25 for i in range(25)]:
        empty_pair(n['M3 positive-lock nut'].translate((0,0,-distance)),receivers,'Lock nut loading blocked')
        dx,dy=m.old.xy(-distance,135)
        empty_pair(n['M3 lock-cap nut'].translate((dx,dy,0)),collar,'Cap nut loading blocked')
    assembly=v.named(v.pose(locked,'assembly',45,6))
    for sign,label in ((1,'A'),(-1,'B')):
        direction=(-sign*math.sin(math.radians(25)),sign*math.cos(math.radians(25)),0)
        for distance in range(0,51,2):
            half=assembly['fixed receiver half '+label].translate(tuple(distance*x for x in direction))
            for name in v.COLLAR_NAMES:empty_pair(half,assembly[name],'Receiver assembly blocked')
    for dz in range(21):
        for name in ('fixed receiver half A','fixed receiver half B','M3 positive-lock nut',*v.COLLAR_NAMES):
            empty_pair(assembly[name].translate((0,0,dz)),n['full-height bar'],'Mouth fixture insertion blocked')
    print('INITIAL ASSEMBLY PASS',flush=True)
    states=[]
    for state,(angle,travel,lift) in m.STATES.items():
        item=v.pose(locked,state,angle,travel,lift)
        bad=v.collisions(item,angle,lift)
        if bad:raise ValueError(state+str(bad))
        states.append(dict(state=state,rigid_clearance_pass=True))
    active={q.name for q in pieces if not q.name.startswith('preset / ')}
    for distance in range(36):
        bad=v.collisions(v.pose(locked,'withdrawal',0,6,-distance),0,-distance,active)
        if bad:raise ValueError('Withdrawal '+str(distance)+str(bad))
    print('POSES AND WITHDRAWAL PASS',flush=True)
    for angle in range(0,91,5):
        item=v.pose(locked,'drive',angle,6)
        bad=v.collisions(item,angle,active=v.COLLAR_NAMES)
        if bad:raise ValueError('Collar arc '+str(bad))
        for q in item.parts:empty_pair(m.drive_key(angle),q.shape,'Drive key blocked')
    for fraction in range(25):
        travel=fraction*.25
        item=v.pose(locked,'lock',90,travel)
        bad=v.collisions(item,active={'WDS 899 captive M3x12 screw'})
        if bad:raise ValueError('Lock backout '+str(bad))
        for q in item.parts:empty_pair(m.key(90,travel),q.shape,'Lock key blocked')
    for kind,maximum in (('lock',84.),('drive',91.5)):
        for fraction in range(21):
            dz=maximum*fraction/20
            tool=m.key(90,6,dz) if kind=='lock' else m.drive_key(0,dz)
            for q in v.pose(locked,'entry',90 if kind=='lock' else 0,6).parts:empty_pair(tool,q.shape,'Full tool staging blocked')
    # Negative movements must still meet actual retained material.
    cup=n['preset / knob baseplate cup']
    if c.volume(collar.translate((0,0,-.6))&cup)<=1e-5:raise ValueError('Trim defeated axial capture')
    if c.volume(v.named(v.pose(locked,'bad turn',88))['WDS 899 captive M3x12 screw']&receivers)<=1e-5:raise ValueError('Trim defeated lock')
    for angle in (-1,91):
        if c.volume(v.named(v.pose(locked,'bad stop',angle,6))['standard-screw drive collar']&receivers)<=1e-5:raise ValueError('Trim defeated stop')
    washer=n['WDS 899-M3 retaining washer'];screw=n['WDS 899 captive M3x12 screw']
    if c.volume(screw.translate((0,0,6.1))&washer)<=1e-5:raise ValueError('No screw captivity')
    if c.volume(washer.translate((0,0,-.6))&collar)<=1e-5:raise ValueError('No washer lower capture')
    if c.volume(washer.translate((0,0,.1))&cap)<=1e-5:raise ValueError('No washer upper capture')
    print('TOOLS AND RETENTION PASS',flush=True)
    review=[exported(q,output/'review_components') for q in pieces]
    states_components={state:[exported(q,output/'states'/state) for q in v.pose(locked,state,*values).parts] for state,values in m.STATES.items()}
    report=dict(schema_version=1,scope='UNLOADED MATING-LATCH FIRST ARTICLE; not a replacement full bar',geometry_review_pass=True,physical_trial_completed=False,
        source_candidate_commit='4903640',source_receipt=str(source.resolve()),source_receipt_sha256=SOURCE_SHA,derived_fixtures=derived,
        total_components=17,printed_components=6,purchased_hardware_components=11,
        initial_assembly_verified=True,states=states,withdrawal_samples_mm=list(range(36)),collar_samples_degrees=list(range(0,91,5)),
        lock_backout_samples_mm=[i*.25 for i in range(25)],ordinary_tool_staging_verified=True,positive_capture_verified=True,
        review_components=review,states_components=states_components,hardware=receipt['hardware'],tools=receipt['tools'],
        excluded_checks=['spinner and pad fit','box ports and support lift','ball attachment and full bar strength','loaded operation and durability'],
        source_code_sha256={'check_standard_first_article.py':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),**receipt['source_code_sha256']})
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();r=run(args.source,args.output)
    print(json.dumps(dict(geometry_review_pass=r['geometry_review_pass'],printed_components=r['printed_components'],total_components=r['total_components'])))
