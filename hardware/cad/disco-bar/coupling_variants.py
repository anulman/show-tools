"""Private C2/C3 alternatives for comparison, including failed operation states."""
from __future__ import annotations
import math
from . import couplings as common
from . import full_height as c
from .latches import capsule
from build123d import Axis,Plane,Polygon,extrude


def pieces_of(name,shape,role):
    if len(shape.solids()) != 1:
        raise ValueError(f'Disconnected component {name}; splitting meshes is not proof of attachment')
    return [c.Piece(name,shape,role)]


def assemble(concept,state,base,bar,carrier,moving,hardware,shift,controls):
    parts=[c.Piece('preset / '+p.name,p.shape,p.role) for p in base.pieces]
    rest=[c.Piece('full-height bar',bar,'bar')]+pieces_of('fixed-to-bar latch carrier',carrier,'print')+moving+hardware
    parts.extend(c.Piece(p.name,p.shape.translate((0,0,shift)),p.role) for p in rest)
    return common.Prototype(concept,state,base,parts,shift,controls)


def c2(reference,state='locked',bar_shift=None,angle_override=None,key_override=None):
    poses={'locked':(0,'locked',0),'key-pushed':(0,'pushed',0),'key-turned':(0,'turned',0),
           'key-removed':(0,'removed',0),'opening':(45,'removed',0),'released':(90,'removed',0),'detached':(90,'removed',-35)}
    angle,mode,shift=poses[state]
    if bar_shift is not None:shift=bar_shift
    if angle_override is not None:angle=angle_override
    if key_override is not None:mode=key_override
    base,bar,carrier,hardware=common.common(reference)
    moving=[];controls=[]
    for direction in (90,270):
        pivot=(40,0,2.6)
        carrier-=common.radial(c.box(14,5.2,10,(39,0,4)),direction)
        for side in (-1,1):
            ear=c.box(6,1.2,6,(40,side*3.3,2.6))-c.cyl(1.05,12,pivot,'y')
            carrier+=common.radial(ear,direction)
            carrier+=common.radial(c.box(2,1.6,8.3,(41,side*3.5,7.55)),direction)
        # The hook catches the flange independently of the preset knob pads.
        hook=capsule(pivot,(35,0,1.2),1,4)+capsule(pivot,(40,0,6),1.7,4)+c.cyl(2.4,4,pivot,'y')
        hook-=c.cyl(1.05,12,pivot,'y')
        hook-=c.cyl(1.05,10,(40,0,4))
        hook=hook.rotate(Axis(pivot,(0,1,0)),angle)
        housing,key=common.locking_key(c.box(.01,.01,.01,(40,0,8)),(40,0),top=11.7,cap=12.2,bottom=5.5,mode=mode)
        carrier+=common.radial(housing,direction)
        carrier-=common.radial(c.cyl(1.05,12,pivot,'y'),direction)
        for side in (-1,1):
            bar-=common.radial(c.box(6.4,1.6,.7,(40,side*3.3,-.25)),direction)
        # Permanent carrier towers are an intentional packaging study. Their
        # actual opening collisions are retained as comparative findings.
        moving.extend(pieces_of(f'hook {direction}',common.radial(hook,direction),'print'))
        hardware.extend([c.Piece(f'hook pivot pin {direction}',common.radial(c.cyl(.85,8,pivot,'y'),direction),'hardware'),
                         c.Piece(f'positive safety key {direction}',common.radial(key,direction),'hardware')])
        controls.append({'kind':f'hook/key {direction}','source_xy_mm':list(common.xy(40,direction)),
                         'source_z_start_mm':12.2,'source_z_end_mm':100})
    carrier&=c.cyl(42.9,26,(0,0,2))
    return assemble('C2',state,base,bar,carrier,moving,hardware,shift,controls)


def c3(reference,state='locked',bar_shift=None,stroke_override=None,key_override=None):
    poses={'locked':(0,'locked',0),'key-pushed':(0,'pushed',0),'key-turned':(0,'turned',0),
           'opening':(1.5,'turned',0),'released':(3,'turned',0),'detached':(3,'turned',-35)}
    stroke,mode,shift=poses[state]
    if bar_shift is not None:shift=bar_shift
    if stroke_override is not None:stroke=stroke_override
    if key_override is not None:mode=key_override
    base,bar,carrier,hardware=common.common(reference)
    sleeve=common.ring(38.3,40,0,3)
    carrier-=c.cyl(40.3,4.2,(0,0,2))
    moving=[];controls=[]
    for direction in (90,270):
        carrier-=common.radial(c.box(10,6.6,2.6,(38,0,1.2)),direction)
        for side in (-1,1):
            carrier-=common.radial(c.box(7.6,1.9,9.2,(38,side*4.5,4.5)),direction)
        # Closed blocking land and the positive cam track are distinct paths.
        # The latter retracts the dog as the sleeve moves down by 3 mm.
        dog=c.box(4,6,2,(36,0,1.2))+c.box(2,4,2.1,(36,0,3.25))
        dog+=c.cyl(1.6,4,(36,0,4.3),'y')
        dog-=c.cyl(1,12,(36,0,4.3),'y')
        travel=3.4*stroke/3
        moving.extend(pieces_of(f'rigid dog {direction}',common.radial(dog.translate((travel,0,0)),direction),'print'))
        pin=c.cyl(.8,12,(36+travel,0,4.3),'y')
        for y in (-6.2,6.2):pin+=c.cyl(1.3,.6,(36+travel,y,4.3),'y')
        hardware.extend(pieces_of(f'cam follower pin {direction}',common.radial(pin,direction),'hardware'))
        for side in (-1,1):
            cam=c.box(7,1.5,5.8,(38,side*4.5,2.9))
            slot=capsule((36,side*4.5,4.3),(39.4,side*4.5,1.3),1,4)
            cam-=slot
            sleeve+=common.radial(cam,direction)
        controls.append({'kind':f'axial sleeve {direction}','source_xy_mm':list(common.xy(39,direction)),
                         'source_z_start_mm':5.8,'source_z_end_mm':100})
    # A fixed key post reaches inward through an entry notch. It connects
    # below the moving collar rather than bridging across its stroke.
    key_post=c.box(3.2,4,11,(36.3,0,2))
    key_post+=c.box(6,4,1.2,(38.2,0,-3.6))
    bar-=c.box(3.6,4.4,4.3,(36.3,0,-2.15))
    bar-=c.box(6.4,4.4,1.6,(38.2,0,-3.6))
    carrier+=key_post
    carrier-=c.hexagon(3.2,6.5,(36.6,0,-7),'x')
    top=7.
    # Compact positive push-turn lock, wholly inside the sleeve radius.
    carrier+=c.box(3.2,4,3.8,(36.3,0,top-1.9))
    carrier-=c.cyl(.85,8,(36.3,0,4))
    carrier-=c.box(2.6,1,.8,(36.3,0,top-1.2))
    carrier-=c.cyl(1.35,1.4,(36.3,0,top-2.3))
    carrier-=c.box(1,2.6,4,(36.3,0,top-1))
    carrier-=c.cyl(1.15,1.3,(36.3,0,top-.65))
    key=c.cyl(.65,6.5,(36.3,0,3.75))+c.cyl(1.05,.5,(36.3,0,7.25))
    key+=c.box(2.2,.6,.6,(36.3,0,top-1.2))
    key+=c.box(6,.8,.6,(36.3,0,3.5))
    axis=Axis((36.3,0,0),(0,0,1))
    if mode=='pushed':key=key.translate((0,0,-1.2))
    elif mode=='turned':key=key.translate((0,0,-1.2)).rotate(axis,90)
    elif mode=='removed':key=key.rotate(axis,90).translate((0,0,10))
    # Blind ear recess permits the deliberate push while retaining a floor.
    sleeve-=c.box(1.6,1.2,1.4,(39,0,2.3))
    moving.extend(pieces_of('axial blocking sleeve',sleeve.translate((0,0,stroke)),'print'))
    hardware.append(c.Piece('positive safety key',key,'hardware'))
    controls.append({'kind':'safety key','source_xy_mm':[36.3,0],'source_z_start_mm':7.5,'source_z_end_mm':100})
    return assemble('C3',state,base,bar,carrier,moving,hardware,shift,controls)
