"""Bounded C2 over-centre attempt, separate from the rejected pivot-only seed."""
from __future__ import annotations
import math
from . import coupling_variants as seed
from . import couplings as common
from . import full_height as c
from .latches import capsule
from build123d import Axis

CLOSED=100.
H=(40.,0.,2.6)
O=(40.,0.,7.6)


def kinematics(angle):
    theta=math.radians(angle)
    crank=(40+2.5*math.cos(theta),0,7.6+2.5*math.sin(theta))
    dx,dz=crank[0]-H[0],crank[2]-H[2]
    distance=math.hypot(dx,dz)
    along=(2**2-5.5**2+distance**2)/(2*distance)
    height=math.sqrt(max(0.,2**2-along**2))
    ux,uz=dx/distance,dz/distance
    candidates=[(H[0]+along*ux+sign*height*(-uz),0,H[2]+along*uz+sign*height*ux) for sign in (-1,1)]
    output=max(candidates,key=lambda p:p[0])
    hook_angle=math.degrees(math.atan2(output[0]-H[0],output[2]-H[2]))
    signed=(crank[0]-O[0])*(output[2]-O[2])-(crank[2]-O[2])*(output[0]-O[0])
    return crank,output,hook_angle,signed


def build(reference,state='locked',bar_shift=None,angle_override=None,key_override=None):
    poses={'locked':(CLOSED,'locked',0),'key-pushed':(CLOSED,'pushed',0),'key-turned':(CLOSED,'turned',0),
           'key-removed':(CLOSED,'removed',0),'dead-centre':(90,'removed',0),'opening':(45,'removed',0),
           'released':(0,'removed',0),'detached':(0,'removed',-35)}
    angle,mode,shift=poses[state]
    if angle_override is not None:angle=angle_override
    if key_override is not None:mode=key_override
    if bar_shift is not None:shift=bar_shift
    crank,output,hook_angle,signed=kinematics(angle)
    base,bar,carrier,hardware=common.common(reference)
    moving=[];controls=[]
    t=math.radians(CLOSED)
    closed_crank=kinematics(CLOSED)[0]
    handle=(40-6*math.cos(t),0,7.6-6*math.sin(t))
    key_point=(40-5*math.cos(t),0,7.6-5*math.sin(t))
    for direction in (90,270):
        carrier-=common.radial(c.box(15,5.2,14,(39,0,6)),direction)
        # Two fixed pivots and two moving pins make a genuine four-bar.
        hook=capsule(H,(35,0,1.2),1,4)+capsule(H,(40,0,6),1.7,4)
        hook+=c.cyl(1.8,4,(40,0,4.6),'y')
        for point in (H,(40,0,4.6)):hook-=c.cyl(1.05,12,point,'y')
        hook=hook.rotate(Axis(H,(0,1,0)),hook_angle)
        lever=capsule(handle,closed_crank,1.4,4)
        for point in (O,closed_crank):lever-=c.cyl(1.05,12,point,'y')
        lever-=c.cyl(1.05,15,(key_point[0],0,5))
        lever=lever.rotate(Axis(O,(0,1,0)),CLOSED-angle)
        link=capsule((crank[0],5.5,crank[2]),(output[0],5.5,output[2]),1.4,2.4)
        for point in (crank,output):link-=c.cyl(1.05,10,(point[0],5.5,point[2]),'y')
        for pivot in (H,O):
            for side in (-1,1):
                ear=c.box(6,1.2,5,(pivot[0],side*3.3,pivot[2]))-c.cyl(1.05,12,pivot,'y')
                ear+=c.box(1.2,1.2,pivot[2]+1,(42.2,side*3.3,(pivot[2]+1)/2))
                carrier+=common.radial(ear,direction)
                bar-=common.radial(c.box(6.4,1.6,1,(40,side*3.3,-.2)),direction)
        # Finite stop at the closed lever's near-pivot arm.
        point=(40-2*math.cos(t),0,7.6-2*math.sin(t))
        stop=(point[0]+1.9*math.sin(t),0,point[2]-1.9*math.cos(t))
        support=c.cyl(.5,4,stop,'y')+c.box(.7,8,3,(42.35,0,4.8))
        carrier+=common.radial(support,direction)
        tower=c.box(2,1.2,12,(41,3.3,9))+c.box(2,1.2,12,(41,-3.3,9))
        carrier+=common.radial(tower,direction)
        housing,key=common.locking_key(c.box(.01,.01,.01,(key_point[0],0,12)),(key_point[0],0),top=15,cap=15.5,bottom=1,mode=mode)
        carrier+=common.radial(housing,direction)
        carrier-=common.radial(c.cyl(1.05,12,O,'y'),direction)
        carrier-=common.radial(c.cyl(1.05,12,H,'y'),direction)
        bar-=common.radial(c.cyl(1.05,4,(key_point[0],0,-1)),direction)
        moving.extend([c.Piece(f'hook {direction}',common.radial(hook,direction),'print'),
                       c.Piece(f'over-centre lever {direction}',common.radial(lever,direction),'print'),
                       c.Piece(f'coupling link {direction}',common.radial(link,direction),'print')])
        for label,point,length,y in (('hook pivot',H,7.8,0),('lever pivot',O,7.8,0),('crank',crank,9.2,2.3),('output',output,9.2,2.3)):
            hardware.append(c.Piece(f'{label} pin {direction}',common.radial(c.cyl(.85,length,(point[0],y,point[2]),'y'),direction),'hardware'))
        hardware.append(c.Piece(f'positive safety key {direction}',common.radial(key,direction),'hardware'))
        controls.append({'kind':f'hook/key {direction}','source_xy_mm':list(common.xy(key_point[0],direction)),
                         'source_z_start_mm':15.5,'source_z_end_mm':100})
    carrier&=c.cyl(42.9,40,(0,0,8))
    result=seed.assemble('C2-overcentre',state,base,bar,carrier,moving,hardware,shift,controls)
    result.holding_test_shift=-1.
    result.kinematics={'crank_angle_degrees':angle,'hook_angle_degrees':hook_angle,'signed_overcentre':signed,
                       'crank_length_mm':math.dist(O,crank),'link_length_mm':math.dist(crank,output),'hook_arm_mm':math.dist(H,output)}
    return result
