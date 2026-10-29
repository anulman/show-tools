"""Reject missing retention and prove real-hardware coupon assembly geometry."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import resin_retention as r


def reject(action,message):
    try:action()
    except ValueError as error:
        assert message in str(error),str(error)
    else:raise AssertionError('Incorrect retention accepted: '+message)


for af in (5.7,5.8,5.9):
    r.verify_joint_coupon(r.joint_coupon(af))
reject(lambda:r.verify_joint_coupon(r.joint_coupon(6.2)),'Nut can rotate freely')
coupon=r.joint_coupon()
missing=dict(coupon,upper=coupon['upper']-r.cad.cyl(4,20,7.8))
reject(lambda:r.verify_joint_coupon(missing),'Nut has no roof reaction')
for gap in (9,16):
    kit=r.buffer_kit(r.cad.cyl(58,5,-5),gap)
    r.verify_buffer(kit)
    reject(lambda:r.verify_buffer(dict(kit,cap=kit['cap'].translate((0,0,20)))),'Buffer can escape axially')
    short=kit['pairs'][0]
    bb=short[2].bounding_box()
    short_screw=r.bolt((bb.min.X+bb.max.X)/2,(bb.min.Y+bb.max.Y)/2,short[3],3)
    reject(lambda:r.check_pair('short',short_screw,short[2],kit['roof']+kit['spacer']+kit['cap'],
                              short[3],-1,3),'Insufficient nominal thread reach')
for depth in (15,23):
    capsule=r.ballast_cassette(depth)
    r.verify_cassette(capsule)
    reject(lambda:r.verify_cassette(dict(capsule,lid=capsule['lid'].translate((0,0,30)))),'Cube has an open escape direction')
base=r.block(116,116,3,(0,0,-68))
for angle in (0,25):
    ties=r.cable_tiedowns(base,-65,angle)
    r.verify_tiedowns(ties,-68)
    reject(lambda:r.verify_tiedowns(dict(ties,bottom=base),-68),'Missing printed cable anchor')
    wrong=[r.block(8.1,3.5,1.3,(x,-38,-63.65)).rotate(r.Axis.Z,angle) for x in (-11,11)]
    reject(lambda:r.verify_tiedowns(dict(ties,tie_tail_paths=wrong),-68),'tie tail cannot pass anchor')
print('PASS: real-hardware coupon stacks; reject free nut, missing roof/cap/anchor/lid, short screw and oversized tie tail; whole tie-loop witnesses clear')
