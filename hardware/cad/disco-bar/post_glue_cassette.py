"""Candidate C: cup-mounted split collar, assembled and serviced outside the ball."""
from __future__ import annotations
from dataclasses import dataclass
import math
from build123d import Axis,Keep,Plane
from . import post_glue_couplings as core
c,old=core.c,core.old
LUG_ANGLES=(35.,50.,220.)
JOINT_ANGLES=(90.,270.)
COVER_ANGLES=(110.,200.,310.)
LOCK_ENTRY=20.
LOCK_END=55.


@dataclass
class Cassette:
    concept:str
    bar:object
    parts:list
    channels:dict
    stages:dict
    rotating:set


def build(reference):
    oracle=core.channels.source_channels(reference)
    donor,donor_parts=core.cup(reference,cover_angles=COVER_ANGLES)
    cup=donor&c.cyl(33.,60.,(0,0,-10))
    cup+=old.ring(32.5,35.5,-11.,-9.5)+old.ring(32.5,35.5,-5.,-3.5)
    # This fixed notch clears the integral bar's axial lock seat throughout lift.
    end=old.xy(38.,LOCK_END)
    cup-=core.sector(33.,44.,-7.,-1.,10.,75.)
    for angle in (60.,240.):cup+=old.radial(c.box(11.,5.,4.,(37.5,0,-18.)),angle)
    parts=[q for q in donor_parts if not q.name.startswith('external')]
    bar=reference-c.cyl(45.9,30.,(0,0,-15))
    bar+=old.ring(40.,46.2,-30.,0.)
    bar-=old.ring(40.,44.5,-12.5,-3.)
    for angle in LUG_ANGLES:
        bar-=old.radial(c.box(6.5,10,4.,(41.25,0,-1.5)),angle)
    for angle in (60.,240.):bar-=old.radial(c.box(11.,6.,24.,(38.,0,-11.)),angle)
    bar-=core.sector(37.5,44.5,-3.1,.1,25.,60.)
    # A local lock bridge reaches inward; all other lower lip material stays outside R40.
    bridge=old.radial(c.box(10.,12.,3.,(38.5,0,-1.5)),LOCK_END)
    bar+=bridge
    bar-=c.cyl(4.7,4.,(*old.xy(38.,LOCK_ENTRY),-1.5))
    bar-=c.cyl(2.5,4.,(*end,-1.5))
    bar-=core.sector(35.5,40.5,-3.1,.1,LOCK_ENTRY,LOCK_END)
    bar-=old.radial(c.hexagon(7.4/math.sqrt(3),1.6,(38,0,-2.3)),LOCK_END)
    # Inner full ring stays inside the original channels; rotating outer lobes
    # occupy only sectors whose complete 35-degree arc avoids both channel axes.
    collar=old.ring(33.5,35.,-9.,-5.6)
    for start,end_angle in ((35.,112.),(205.,285.)):
        collar+=core.sector(34.5,39.5,-9.,-5.6,start,end_angle)
    for angle in LUG_ANGLES:
        collar+=old.radial(c.box(5.,6.,2.,(41.,0,-7.5)),angle)
    # Source-positive stems clear the cup lower lip and the R40 bar aperture.
    for angle in (90.,215.,275.):
        stem=core.sector(37.,39.5,-6.,3.2,angle-3,angle+3)
        collar+=stem
    collar+=old.ring(33.5,35.5,1.5,3.)
    for angle in (90.,215.,275.):collar+=old.radial(c.box(5.,4.,1.5,(37.,0,2.25)),angle)
    for angle in COVER_ANGLES:collar+=c.cyl(4.,1.5,(*old.xy(38.,angle),2.25))
    collar+=c.cyl(4.5,1.5,(*old.xy(38.,LOCK_ENTRY),2.25))
    collar+=c.cyl(5.,1.5,(*old.xy(38.5,170.),2.25))
    # Reuse only outside-module cover/purchased hardware, attached to this collar.
    post_region=c.cyl(44.,4.5,(0,0,5.25))-c.cyl(33.,6.,(0,0,5.25))
    for post in (donor&post_region).solids():collar+=post
    cover=next(q.shape for q in donor_parts if q.name=='external axial screw capture cover')
    lock=old.xy(38.,LOCK_ENTRY)
    collar-=c.cyl(2.5,16.,(*lock,-1.))
    collar-=c.cyl(4.7,11.6,(*lock,-9.2))
    cover+=c.cyl(4.5,2.,(*lock,8.5))
    cover-=c.cyl(2.5,5.,(*lock,8.5))
    drive=old.xy(38.5,170.)
    collar+=c.cyl(5.,9.,(*drive,7.5))
    collar-=c.hexagon(4.35/math.sqrt(3),7.5,(*drive,8.75))
    cover-=c.cyl(5.5,5.,(*drive,8.5))
    for angle in COVER_ANGLES:collar-=c.cyl(1.8,12.,(*old.xy(38.,angle),5.))
    # Two ordinary radial M2 joints close the halves while the whole cup is outside.
    joints=[]
    for angle in JOINT_ANGLES:
        collar+=old.radial(c.box(5.,10.,3.5,(38.5,0,-7.5)),angle)
        collar-=old.radial(c.cyl(1.4,12.,(38.5,0,-7.5),'y'),angle)
        collar-=old.radial(c.cyl(2.4,17.,(38.5,11.5,-7.5),'y'),angle)
        print('C joint',angle,'after bore',collar._dim,collar.is_valid,len(collar.solids()),flush=True)
        collar-=old.radial(c.hexagon(4.4/math.sqrt(3),16.5,(38.5,-9.75,-7.5),'y'),angle)
        bolt=c.cyl(1.,8.,(38.5,-1.,-7.5),'y')+c.cyl(1.9,2.,(38.5,4.,-7.5),'y')
        bolt-=c.hexagon(1.5/math.sqrt(3),1.5,(38.5,4.5,-7.5),'y')
        nut=c.hexagon(4/math.sqrt(3),1.6,(38.5,-2.3,-7.5),'y')-c.cyl(.8,4.,(38.5,-2.3,-7.5),'y')
        joints.extend([c.Piece(f'external collar M2x8 screw {angle}',old.radial(bolt,angle),'hardware'),
                       c.Piece(f'external collar M2 nut {angle}',old.radial(nut,angle),'hardware')])
    assert collar.is_valid and len(collar.solids())==1, "Collar before split "+str([(s.volume) for s in collar.solids()])
    collar=collar.solids()[0]
    halves=[]
    for sign,label in ((1,'A'),(-1,'B')):
        direction=(-sign,0,0)
        half=collar.split(Plane(origin=(0,0,0),z_dir=direction),Keep.TOP)
        if half is None:raise ValueError('Empty collar split '+label)
        halves.append(c.Piece('removable collar half '+label,half,'print'))
    cup=core.clear_inlets(cup,oracle)
    bar=core.protect(reference,bar,oracle)
    parts.insert(0,c.Piece('removable padded knob cup',cup,'print'))
    moving=[*halves,c.Piece('external axial screw capture cover',cover,'print'),*joints,
            *[q for q in donor_parts if q.name.startswith('external cover')],
            c.Piece(f'axial M4x12 socket screw {LOCK_ENTRY}',core.axial_screw(lock),'hardware'),
            c.Piece(f'threaded M4 full nut {LOCK_ENTRY}',old.radial(core.nut((38,0),-4.7),LOCK_ENTRY),'hardware')]
    parts+=moving
    stages={'outside':dict(angle=0.,shift=50.,nut_drop=0.,head_drop=0.),
            'inserted':dict(angle=0.,shift=0.,nut_drop=0.,head_drop=0.),
            'turned':dict(angle=35.,shift=0.,nut_drop=0.,head_drop=0.),
            'nuts-seated':dict(angle=35.,shift=core.SEAT_STROKE,nut_drop=0.,head_drop=0.),
            'locked':dict(angle=35.,shift=0.,nut_drop=core.SEAT_STROKE,head_drop=0.)}
    for pose in stages.values():pose['collar_shift']=-.5
    print('C BAR TOPOLOGY',len(bar.faces()),[len(s.faces()) for s in bar.solids()],[(type(s).__name__,s._dim) for s in bar.get_top_level_shapes()],flush=True)
    return Cassette('C',bar,parts,oracle,stages,{q.name for q in moving})


def posed(candidate,stage,collar_shift=None):
    values=candidate.stages[stage];parts=[]
    for q in candidate.parts:
        shape=q.shape
        if q.name.startswith('threaded M4 full nut'):shape=shape.translate((0,0,values['nut_drop']))
        if q.name.startswith('axial M4x12 socket screw'):
            point=old.xy(38.,LOCK_ENTRY)
            shape=shape.rotate(Axis((*point,0),(0,0,1)),-(values['nut_drop']-values['head_drop'])/core.M4_PITCH*360).translate((0,0,values['head_drop']))
        if q.name in candidate.rotating:
            delta=values['collar_shift'] if collar_shift is None else collar_shift
            if not -.5<=delta<=.6:raise ValueError('Collar outside physical race stops')
            shape=old.radial(shape,values['angle']).translate((0,0,delta))
        parts.append(c.Piece(q.name,shape.translate((0,0,values['shift'])),q.role))
    return parts


def torque_witnesses(candidate):
    cup=next(q.shape for q in candidate.parts if q.name=='removable padded knob cup')
    return {str(angle):cup.rotate(Axis.Z,angle)&candidate.bar for angle in (-2.,2.)}
