"""Private two-joint couplings. Source bar retained; no viewer integration."""
from __future__ import annotations
from dataclasses import dataclass
import math
from . import full_height as c
from . import baseplates_v2 as pads
from build123d import Axis

GAP_STUDY = 9.0


@dataclass
class Prototype:
    concept: str
    state: str
    baseplate: object
    parts: list
    bar_shift: float
    controls: list


def ring(inside, outside, low, high):
    return c.cyl(outside, high-low, (0,0,(low+high)/2)) - c.cyl(inside,high-low+2,(0,0,(low+high)/2))


def radial(shape, angle):
    return shape.rotate(Axis.Z, angle)


def xy(radius, angle):
    t=math.radians(angle)
    return radius*math.cos(t),radius*math.sin(t)


def common(reference):
    base=pads.build(reference,.2)
    bar=reference-c.cyl(37.5,30,(0,0,-15))
    bar+=ring(33.4,41,-12,0)
    bar-=c.cyl(37.4,2.3,(0,0,-1.15))
    for sign in (-1,1):
        bar-=c.box(6.6,6.6,8.3,(0,sign*34.75,-4.15))
    carrier=ring(39.8,42.8,0,4)
    hardware=[]
    for angle in (0,120,240):
        bar+=radial(c.box(12,10,9.2,(40,0,-5.5)),angle)
        tab=radial(c.box(3,6,10,(41.5,0,-5)),angle)
        carrier+=tab
        bar-=radial(c.box(3.4,6.4,10.6,(41.5,0,-5)),angle)
        bore=radial(c.cyl(1.6,12,(42,0,-7),'x'),angle)
        bar-=bore
        carrier-=bore
        bar-=radial(c.cyl(3,6,(47.5,0,-7),'x'),angle)
        bar-=radial(c.hexagon(3.2,6.5,(36.6,0,-7),'x'),angle)
        bolt=c.cyl(1.4,7.05,(41.025,0,-7),'x')+c.cyl(2.8,1.8,(45.4,0,-7),'x')
        nut=c.hexagon(3,2.5,(38.6,0,-7),'x')-c.cyl(1.5,5,(38.6,0,-7),'x')
        hardware.extend([c.Piece(f'carrier bolt {angle}',radial(bolt,angle),'hardware'),c.Piece(f'carrier nut {angle}',radial(nut,angle),'hardware')])
    # Re-cut receiving interfaces after anchor reinforcement.
    bar-=c.cyl(37.4,2.3,(0,0,-1.15))
    for sign in (-1,1):
        bar-=c.box(6.6,6.6,8.3,(0,sign*34.75,-4.15))
    return base,bar,carrier,hardware


def locking_key(carrier, point, top=7., cap=7.5, bottom=.5, mode='locked'):
    x,y=point
    carrier+=c.box(6,6,3.8,(x,y,top-1.9))
    carrier-=c.cyl(1.05,top-bottom+4,(x,y,(top+bottom)/2))
    carrier-=c.box(4.4,1.4,.8,(x,y,top-1.2))
    carrier-=c.cyl(2.5,1.4,(x,y,top-2.3))
    carrier-=c.box(1.4,4.4,4,(x,y,top-1))
    carrier-=c.cyl(1.55,1.3,(x,y,top-.65))
    key=c.cyl(.8,cap-.5-bottom,(x,y,(cap-.5+bottom)/2))
    key+=c.cyl(1.4,.5,(x,y,cap-.25))
    key+=c.box(4,1,.6,(x,y,top-1.2))
    axis=Axis((x,y,0),(0,0,1))
    if mode=='pushed': key=key.translate((0,0,-1.2))
    elif mode=='turned': key=key.translate((0,0,-1.2)).rotate(axis,90)
    elif mode=='removed': key=key.rotate(axis,90).translate((0,0,10))
    return carrier,key


def c1(reference,state='locked', bar_shift=None, angle_override=None, key_override=None):
    poses={'locked':(90,'locked',0),'key-pushed':(90,'pushed',0),
           'key-turned':(90,'turned',0),'key-removed':(90,'removed',0),
           'turning':(45,'removed',0),'released':(0,'removed',0),'detached':(0,'removed',-35)}
    angle,mode,shift=poses[state]
    if angle_override is not None: angle=angle_override
    if key_override is not None: mode=key_override
    if bar_shift is not None: shift=bar_shift
    base,bar,carrier,hardware=common(reference)
    carrier+=ring(38.8,42.8,0,.5)+ring(38.8,42.8,3.5,4)
    retainer=ring(37.8,39.5,.8,3.2)
    for sign in (-1,1):
        retainer+=c.box(4.6,6,2,(sign*36.3,0,1.2))
    point=xy(38.5,45)
    # The collar is separate from the keyed bar, which supplies hand reaction.
    hole=c.cyl(1.05,7,(*xy(38.5,-45),2))
    retainer-=hole
    retainer=radial(retainer,angle)
    carrier,key=locking_key(carrier,point,mode=mode)
    bar-=c.cyl(1.05,4,(*point,-1))
    moving=[c.Piece('full-height bar',bar,'bar'),c.Piece('fixed-to-bar latch carrier',carrier,'print'),
            c.Piece('quarter-turn retainer',retainer,'print'),c.Piece('positive safety key',key,'hardware')]+hardware
    parts=[c.Piece('preset / '+p.name,p.shape,p.role) for p in base.pieces]
    parts += [c.Piece(p.name,p.shape.translate((0,0,shift)),p.role) for p in moving]
    controls=[{'kind':'key','source_xy_mm':list(point),'source_z_start_mm':7.5,'source_z_end_mm':95},
              {'kind':'collar reaction','source_xy_mm':[0,36.3],'source_z_start_mm':2.2,'source_z_end_mm':95}]
    return Prototype('C1',state,base,parts,shift,controls)


def c1_access_sweeps():
    # Exact circular-tool sweep: annular quadrant plus round end caps.
    height=95-2.2
    sweep=ring(34.3,38.3,2.2,95)&c.box(100,100,100,(50,50,50))
    for angle in (0,90):
        sweep+=c.cyl(2,height,(*xy(36.3,angle),(95+2.2)/2))
    point=xy(38.5,45)
    key=c.cyl(3.2,95-7.5,(*point,(95+7.5)/2))
    return [('quarter-turn tool arc 0 to 90',sweep),('opposite tool arc 180 to 270',radial(sweep,180)),('safety key axial service path',key)]
