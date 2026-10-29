"""Executable geometry, assembly and export checks for the standard-hardware collar."""
from __future__ import annotations
import argparse
from dataclasses import replace
import hashlib
import importlib
import json
import math
from pathlib import Path
import sys
from build123d import Axis
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import disco_bar
m=importlib.import_module('disco-bar.standard_collar')
p=importlib.import_module('disco-bar.check_couplings')
c=m.c
COLLAR_NAMES={'standard-screw drive collar','preassembled captive-lock cap','M3x8 lock-cap button screw','M3 lock-cap nut','WDS 899 captive M3x12 screw','WDS 899-M3 retaining washer'}


def named(item):
    return {q.name:q.shape for q in item.parts}


def pose(locked,state,angle=90.,travel=0.,lift=0.):
    pieces=[]
    for q in locked.parts:
        shape=q.shape
        if q.name=='WDS 899 captive M3x12 screw':
            shape=shape.rotate(Axis((*m.POINT,0),(0,0,1)),travel/.5*360).translate((0,0,travel))
        if q.name in COLLAR_NAMES:
            shape=m.old.radial(shape,angle-90)
        if not q.name.startswith('preset / '):
            shape=shape.translate((0,0,lift))
        pieces.append(c.Piece(q.name,shape,q.role))
    return replace(locked,state=state,parts=pieces,bar_shift=lift)


def thread_pairs():
    pairs={}
    for sign in (-1,1):
        prefix='preset / '+f'{sign:+d}'+' '
        # Names come from the preserved pad producer, asserted below.
        pairs[frozenset((prefix+'preset set-screw envelope',prefix+'captive nut envelope'))]=c.cyl(1.51,4,(sign*29.1,0,-13),'x')
    for a in (0,120,240):
        pairs[frozenset((f'M3x8 carrier button screw {a}',f'M3 carrier nut {a}'))]=m.old.radial(c.cyl(1.51,3,(38.7,0,-7),'x'),a)
    pairs[frozenset(('WDS 899 captive M3x12 screw','M3 positive-lock nut'))]=c.cyl(1.51,4,(*m.POINT,-1.7))
    pairs[frozenset(('M3x8 lock-cap button screw','M3 lock-cap nut'))]=m.old.radial(c.cyl(1.51,3,(34.8,6,9.4),'x'),135)
    return pairs


def disjoint(a,b):
    aa,bb=a.bounding_box(),b.bounding_box()
    return any(getattr(aa.max,k)<=getattr(bb.min,k)+1e-7 or getattr(bb.max,k)<=getattr(aa.min,k)+1e-7 for k in ('X','Y','Z'))


def collisions(item,angle=90.,lift=0.,active=None):
    allowed=thread_pairs(); found=[]
    for i,a in enumerate(item.parts):
        for b in item.parts[i+1:]:
            if active is not None and ((a.name in active)==(b.name in active)):continue
            if disjoint(a.shape,b.shape):continue
            hit=a.shape&b.shape
            if c.volume(hit)<=1e-5:continue
            zone=allowed.get(frozenset((a.name,b.name)))
            if zone is not None:
                if 'M3 lock-cap nut' in (a.name,b.name):zone=m.old.radial(zone,angle-90)
                if not a.name.startswith('preset / '):zone=zone.translate((0,0,lift))
                c.assert_empty(hit-zone,'Overlap outside purchased thread zone')
            else:found.append(dict(a=a.name,b=b.name,volume_mm3=c.volume(hit)))
    return found


def empty(shape,message):
    c.assert_empty(shape,message)


def run(step,output):
    output.mkdir(parents=True,exist_ok=True)
    (output/'receipt.json').unlink(missing_ok=True)
    path,reference=disco_bar.load_reference(step)
    disco_bar.verify_full_reference(path,reference)
    locked=m.build(reference); n=named(locked)
    print('BUILT',len(locked.parts),flush=True)
    invalid=[q.name for q in locked.parts if not q.shape.is_valid or len(q.shape.solids())!=1]
    if invalid:raise ValueError('Invalid parts: '+str(invalid))
    # Whole source profile/reach is preserved beyond the modified mouth.
    far=c.box(120,120,80,(0,0,-70))
    empty((reference&far)-n['full-height bar'],'Far source lost')
    empty((n['full-height bar']&far)-reference,'Far source added')
    if abs(n['full-height bar'].bounding_box().min.Z+109.22)>1e-5:raise ValueError('Bar shortened')
    above=c.box(180,180,130,(0,0,-65))-c.cyl(c.OUTER,140,(0,0,-65))
    for q in locked.parts:empty(q.shape&above,'Added feature exceeds ball mouth boundary: '+q.name)
    # Retainer has .5 radial/axial races and a 1 mm retaining-lip overlap.
    if min(m.BORE-m.RACE_OUTER,1.5-1,4-3.5,m.RACE_OUTER-m.LIP_INNER)<.5:raise ValueError('Race clearance')
    collar=n['standard-screw drive collar']; cap=n['preassembled captive-lock cap']
    receivers=n['fixed receiver half A']+n['fixed receiver half B']
    # Lock cap + purchased washer/screw enter as a preassembled unit.
    assembly_records=[]
    for dz in [i*.5 for i in range(21)]:
        for label in ('preassembled captive-lock cap','WDS 899 captive M3x12 screw','WDS 899-M3 retaining washer'):
            empty(n[label].translate((0,0,dz))&collar,'Cap installation blocked: '+label)
    assembly_records.append('Cap/screw/washer axial installation sampled every 0.5 mm over 10 mm')
    # Washer passage through separate cap is commercial screw-thread assembly,
    # not a fictitious OD6 translation through the completed shaft bore.
    washer=n['WDS 899-M3 retaining washer']; screw=n['WDS 899 captive M3x12 screw']
    empty(screw.translate((0,0,6.0))&washer,'Nominal captive stop already interferes')
    if c.volume(screw.translate((0,0,6.1))&washer)<1e-5:raise ValueError('No washer capture')
    # Washer has a closed 1.5 mm axial pocket around its 1 mm thickness.
    for shift in (-.5,-.25,0):
        empty(washer.translate((0,0,shift))&(collar+cap+receivers),'Washer float obstructed')
    if c.volume(washer.translate((0,0,-.6))&collar)<=1e-5:raise ValueError('Washer can drop out')
    if c.volume(washer.translate((0,0,.1))&cap)<=1e-5:raise ValueError('Washer can escape upward')
    # Back-loaded lock nut is closed in by bar only after receiver assembly.
    locknut=n['M3 positive-lock nut']
    for dz in [i*.25 for i in range(25)]:
        empty(locknut.translate((0,0,-dz))&receivers,'Lock nut back-loading blocked')
    assembly_records.append('Lock nut back-loaded before bar closure')
    # Maximum nominal nuts enter through real open loading channels; the
    # conservative minimum nut still cannot rotate through 30 degrees.
    nut_cases=[]
    for sign in (-1,1):
        nut_cases.append((f'preset / {sign:+d} captive nut envelope',n['preset / knob baseplate cup'],
                          (sign*29.1,0,-13),'x',0,(sign,0,0)))
    for a in (0,120,240):
        nut_cases.append((f'M3 carrier nut {a}',n['full-height bar'],(38.7,0,-7),'x',a,
                          (*m.old.xy(1,a),0)))
    nut_cases.append(('M3 positive-lock nut',receivers,(*m.POINT,-1.7),'z',0,(0,0,1)))
    nut_cases.append(('M3 lock-cap nut',collar,(34.8,6,9.4),'x',135,(*m.old.xy(1,135),0)))
    for label,host,center,axis,rotation,direction in nut_cases:
        for retreat in [i*.25 for i in range(25)]:
            empty(n[label].translate(tuple(-retreat*v for v in direction))&host,'Nut loading blocked: '+label)
        minimum=c.hexagon(5.32/math.sqrt(3),2.15,center,axis)&c.cyl(3.005,3,center,axis)
        ax=Axis(center,(1,0,0) if axis=='x' else (0,0,1))
        turned=m.old.radial(minimum.rotate(ax,30),rotation)
        if c.volume(turned&host)<=1e-5:raise ValueError('Minimum nut spins: '+label)
    assembly_records.append('All seven nut channels load maximum nominal nuts and block conservative minimum nuts at 30 degrees')
    # Receiver halves enter laterally around the preassembled collar, then
    # the resulting assembly enters the open bar mouth before permanent glue.
    assembly=named(pose(locked,'initial assembly',45,6.0))
    collar_group={label:assembly[label] for label in COLLAR_NAMES}
    for sign,label in ((1,'A'),(-1,'B')):
        normal=(-sign*math.sin(math.radians(25)),sign*math.cos(math.radians(25)),0)
        for distance in range(0,51,2):
            half=n['fixed receiver half '+label].translate(tuple(distance*v for v in normal))
            for name,part in collar_group.items():empty(half&part,f'Receiver lateral assembly blocked {label} {distance} {name}')
    for dz in range(0,21):
        for label in ['fixed receiver half A','fixed receiver half B',*COLLAR_NAMES,'M3 positive-lock nut']:
            empty(assembly[label].translate((0,0,dz))&n['full-height bar'],'Bar-mouth assembly blocked: '+label)
    assembly_records.append('Both receiver halves enter laterally, then insert axially into the bar mouth before glue')
    states=[]
    for state,(angle,travel,lift) in m.STATES.items():
        item=pose(locked,state,angle,travel,lift)
        p.frozen_preset(item,locked.baseplate)
        bad=collisions(item,angle,lift)
        print('STATE',state,bad,flush=True)
        if bad:raise ValueError('Interference: '+str(bad))
        states.append(dict(state=state,angle_degrees=angle,screw_backout_mm=travel,withdrawal_source_z_mm=lift,rigid_clearance_pass=True))
    # Released withdrawal checks all non-thread contact pairs through 35 mm.
    for distance in range(36):
        item=pose(locked,'withdrawal',0,6.0,-distance)
        bad=collisions(item,0,-distance,{q.name for q in item.parts if not q.name.startswith('preset / ')})
        if bad:raise ValueError('Withdrawal '+str(distance)+': '+str(bad))
    print('WITHDRAWAL PASS',flush=True)
    # Ordinary complete L tools, including staged axial entry.
    for angle in range(0,91,5):
        tool=m.drive_key(angle)
        item=pose(locked,'drive',angle,6.0)
        bad=collisions(item,angle,active=COLLAR_NAMES)
        if bad:raise ValueError('Intermediate collar collision: '+str(bad))
        for q in item.parts:
            if not disjoint(tool,q.shape):empty(tool&q.shape,'4mm tool blocked: '+q.name)
    for backout in [i*.25 for i in range(25)]:
        tool=m.key(90,backout)
        item=pose(locked,'lock',90,backout)
        bad=collisions(item,active={'WDS 899 captive M3x12 screw'})
        if bad:raise ValueError('Intermediate backout collision: '+str(bad))
        for q in item.parts:
            if not disjoint(tool,q.shape):empty(tool&q.shape,'2.5mm tool blocked: '+q.name)
    sweeps_geometry=m.control_sweeps()
    for kind,max_entry in (('lock',84.),('drive',91.5)):
        for fraction in range(21):
            dz=max_entry*fraction/20
            tool=m.key(90,6.0,dz) if kind=='lock' else m.drive_key(0,dz)
            item=pose(locked,'entry',90 if kind=='lock' else 0,6.0)
            for q in item.parts:
                if not disjoint(tool,q.shape):empty(tool&q.shape,'Staged tool blocked: '+q.name)
            empty(tool-sweeps_geometry[1 if kind=='lock' else 3][1],'Actual staged tool outside sweep')
    for angle in range(0,91,5):
        empty(m.drive_key(angle)-sweeps_geometry[2][1],'Drive arc exceeds sweep')
    for backout in [i*.25 for i in range(25)]:
        empty(m.key(90,backout)-sweeps_geometry[0][1],'Lock key exceeds sweep')
    # Controls block unintended motion and carry the intended action.
    if c.volume(collar.translate((0,0,-.6))&n['preset / knob baseplate cup'])<=1e-5:raise ValueError('No axial capture')
    if c.volume(named(pose(locked,'forbidden turn',88))['WDS 899 captive M3x12 screw']&receivers)<=1e-5:raise ValueError('Lock does not stop collar rotation')
    for angle in (-1,91):
        if c.volume(named(pose(locked,'stop',angle,6.0))['standard-screw drive collar']&receivers)<=1e-5:raise ValueError('No end stop')
    drive=m.drive_key(0)
    point=m.old.xy(38.5,225)
    if c.volume(drive.rotate(Axis((*point,0),(0,0,1)),20)&named(pose(locked,'drive',0,6.0))['standard-screw drive collar'])<=1e-5:raise ValueError('Hex does not transmit torque')
    if c.volume(drive.translate((0,0,-.6))&named(pose(locked,'drive',0,6.0))['standard-screw drive collar'])<=1e-5:raise ValueError('No blind socket floor')
    print('TOOLS AND BLOCKING PASS',flush=True)
    exports=[p.export_piece(q,output/'review_components') for q in locked.parts]
    sweeps=[p.export_piece(c.Piece(label,shape,'temporary tool clearance probe'),output/'access') for label,shape in m.control_sweeps()]
    state_exports={}
    for state,(angle,travel,lift) in m.STATES.items():
        state_exports[state]=[p.export_piece(q,output/'states'/state) for q in pose(locked,state,angle,travel,lift).parts]
    receipt=dict(schema_version=1,concept='standard-hardware collar C2',geometry_review_pass=True,
        installed_fit_verified=False,physical_strength_verified=False,release_scope='PRIVATE FIRST-ARTICLE REVIEW; not a print release',
        reference_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),part_count=len(locked.parts),states=states,
        assembly_checks=assembly_records,radial_race_gap_mm=.5,axial_race_gap_mm=.5,capture_overlap_mm=1.,
        gap_PROPOSED_mm=19,pad_contact_height_above_roof_mm=[28,36],required_operator_measurements='spinner knob top/bottom and shaft reference heights',
        tools=[m.TOOL,m.DRIVE_TOOL],hardware=m.HARDWARE,
        supplier_model_limits='Nominal catalog dimensions plus selected maximum head/nut bounds; purchased threads modeled as envelopes, not helices. Washer may intentionally be unwound if restrained.',
        review_components=exports,states_components=state_exports,control_sweeps=sweeps,
        source_code_sha256={Path(f).name:hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (m.__file__,m.old.__file__,m.old.pads.__file__,m.old.pads.previous.__file__,c.__file__,disco_bar.__file__,__file__)})
    (output/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--step',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();r=run(args.step,args.output)
    print(json.dumps(dict(geometry_review_pass=r['geometry_review_pass'],parts=r['part_count'])))
