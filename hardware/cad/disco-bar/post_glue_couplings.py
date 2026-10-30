"""Fresh post-glue root-access coupling prototypes. No old C2 bar hardware reused."""
from __future__ import annotations
from dataclasses import dataclass
import math
from build123d import Axis,Polygon,extrude
from . import full_height as c
from . import standard_collar as grip
from . import debond_checks as channels
old=grip.old
ANGLES=(45.,110.,240.)
TURN=35.
RADIUS=38.


@dataclass
class Candidate:
    concept:str
    bar:object
    parts:list
    channels:dict
    stages:dict


def sector(inner,outer,low,high,start,end):
    wedge=extrude(Polygon((0,0),old.xy(100,start),old.xy(100,end),align=None),amount=high-low).translate((0,0,low))
    return old.ring(inner,outer,low,high)&wedge


def axial_screw(point,seat=3.):
    x,y=point
    screw=c.cyl(2.,12.,(x,y,seat-6))+c.cyl(3.5,4.,(x,y,seat+2))
    return screw-c.hexagon(3/math.sqrt(3),3.2,(x,y,seat+2.7))


def nut(point,z):
    return c.hexagon(7/math.sqrt(3),3.2,(*point,z))-c.cyl(1.65,5.,(*point,z))


def cup(reference):
    base=grip.baseline(reference)
    body=c.cyl(33.,26.9875,(0,0,-13.49375))-c.pocket()
    for sign in (-1,1):
        body-=c.box(14,23,15,(sign*20.5,0,-13))
        for y in (-12,12):body-=c.box(4,3,11,(sign*25.5,y,-13))
        body-=c.hexagon(5.8/math.sqrt(3),3.6,(sign*28.5,0,-13),'x')
        body-=c.cyl(1.8,10,(sign*31,0,-13),'x')
    body+=old.ring(30.,43.,0.,1.5)+old.ring(33.5,43.,1.5,3.)
    parts=[c.Piece(p.name,p.shape,p.role) for p in base.pieces if p.role!='body']
    cover=old.ring(33.5,43.,7.5,9.5)
    for angle in (15.,200.,310.):
        point=old.xy(38,angle)
        post=c.cyl(4.,4.5,(*point,5.25))
        pocket=grip.old.radial(c.hexagon(5.8/math.sqrt(3),2.8,(38,0,4.7)),angle)
        pocket+=old.radial(c.box(5,5.8,2.8,(35.5,0,4.7)),angle)
        post-=pocket+c.cyl(1.8,10,(*point,5))
        body+=post
        body-=c.cyl(1.8,12,(*point,5))
        cover-=c.cyl(1.8,5,(*point,8.5))
        screw=c.cyl(1.5,8,(*point,5.5))+c.cyl(2.85,1.65,(*point,10.325))
        screw-=c.hexagon(2/math.sqrt(3),1.5,(*point,10.7))
        parts.extend([c.Piece(f'external cover M3x8 screw {angle}',screw,'hardware'),
                      c.Piece(f'external cover M3 nut {angle}',old.radial(grip.nut((38,0,4.9)),angle),'hardware')])
    parts.insert(0,c.Piece('external axial screw capture cover',cover,'print'))
    return body,parts


def protect(reference,bar,oracle):
    for record in oracle.values():
        envelope=record['envelope']
        bar=(bar-envelope)+(reference&envelope)
    return bar


def clear_inlets(shape,oracle):
    for record in oracle.values():
        shape-=c.cyl(record['radius_mm'],50,(*record['center_xy_mm'],-10))
    return shape


def build(reference,concept):
    if concept not in ('A','B'):raise ValueError('Prototype not implemented: '+concept)
    oracle=channels.source_channels(reference)
    body,parts=cup(reference)
    print("BUILD",concept,"bar start",flush=True)
    bar=reference-c.cyl(45.9,30.,(0,0,-15.))
    bar+=old.ring(33.5,46.2,-30.,0.)
    print("BUILD",concept,"base receiver",flush=True)
    lip=-4. if concept=='A' else -3.
    bar-=old.ring(33.5,43.,-11.,lip)
    locks=ANGLES if concept=='A' else (95.,)
    for angle in locks:
        print("BUILD",concept,"track",angle,flush=True)
        entry=old.xy(RADIUS,angle);end=old.xy(RADIUS,angle+TURN)
        bar-=c.cyl(4.7,-lip+1,(*entry,lip/2))
        bar-=old.radial(c.box(5.5,9.4,-lip+1,(35.25,0,lip/2)),angle)
        bar-=sector(RADIUS-2.5,RADIUS+2.5,lip-.1,.1,angle,angle+TURN)
        for point in (entry,end):bar-=c.cyl(2.5,-lip+1,(*point,lip/2))
        pocket=old.radial(c.hexagon(7.4/math.sqrt(3),1.6,(RADIUS,0,lip+.75)),angle+TURN)
        bar-=pocket
        body-=c.cyl(2.5,6,(*entry,1.5))
        parts[0].shape-=c.cyl(2.5,4,(*entry,8.5))
        parts.extend([c.Piece(f'axial M4x12 socket screw {angle}',axial_screw(entry),'hardware'),
                      c.Piece(f'threaded M4 full nut {angle}',old.radial(nut((RADIUS,0),lip-2.1),angle),'hardware')])
    if concept=='B':
        for angle in ANGLES:
            bar-=old.radial(c.box(11,10,4.5,(37.5,0,-1.5)),angle)
            body+=old.radial(c.box(10,6,2,(37,0,-7.5)),angle)
        point=old.xy(38.5,225.)
        body+=c.cyl(5.,9.,(*point,7.5))
        body-=c.hexagon(4.35/math.sqrt(3),7.5,(*point,8.75))
        parts[0].shape-=c.cyl(5.5,5,(*point,8.5))
    print("BUILD",concept,"protect channels",flush=True)
    body=clear_inlets(body,oracle)
    bar=protect(reference,bar,oracle)
    print("BUILD",concept,"finished",flush=True)
    parts.insert(0,c.Piece('removable padded knob cup',body,'print'))
    stages={'outside':dict(angle=0.,shift=50.,nut_drop=0.,head_drop=0.),
            'inserted':dict(angle=0.,shift=0.,nut_drop=0.,head_drop=0.),
            'turned':dict(angle=TURN,shift=0.,nut_drop=0.,head_drop=0.),
            'nuts-seated':dict(angle=TURN,shift=2.,nut_drop=0.,head_drop=0.),
            'locked':dict(angle=TURN,shift=0.,nut_drop=2.,head_drop=0.)}
    return Candidate(concept,bar,parts,oracle,stages)


def posed(candidate,stage):
    values=candidate.stages[stage];result=[]
    for piece in candidate.parts:
        shape=piece.shape
        if piece.name.startswith('threaded M4 full nut'):shape=shape.translate((0,0,values['nut_drop']))
        elif piece.name.startswith('axial M4x12 socket screw'):shape=shape.translate((0,0,values['head_drop']))
        shape=old.radial(shape,values['angle']).translate((0,0,values['shift']))
        result.append(c.Piece(piece.name,shape,piece.role))
    return result


def holding_key(angle,head_drop=0.):
    point=old.xy(RADIUS,angle)
    tool=c.hexagon(3/math.sqrt(3),3.,(*point,6.))
    tool+=c.cyl(2.,123.,(*point,69.))
    tool+=c.cyl(2.,20.,(point[0]+10,point[1],128.5),'x')
    return tool.translate((0,0,head_drop))
