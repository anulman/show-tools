"""Reject missing retention and prove real-hardware coupon assembly geometry."""
from dataclasses import replace
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import resin_retention as r
import resin_base as base
import below_plane_buffer as buffer_cad


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
    short=replace(short,length=3,screw=r.bolt(*short.expected_xy,short.length_datum_z,3))
    reject(lambda:r.check_joint(short,kit['roof']+kit['spacer']+kit['cap']),
           'Insufficient nominal thread reach')
# These exact same-Z mistakes passed a5bf946's reaction/length checks.
def reject_wrong_seats(joints,body):
    first,neighbor=joints[:2]
    wrong_nut=replace(first,nut=neighbor.nut)
    reject(lambda:r.check_joint(wrong_nut,body),'nut axis')
    swapped=[replace(first,nut=neighbor.nut),replace(neighbor,nut=first.nut),*joints[2:]]
    reject(lambda:r.check_joints(swapped,body),'nut axis')
    wrong_pair=replace(first,screw=neighbor.screw,nut=neighbor.nut)
    reject(lambda:r.check_joint(wrong_pair,body),'screw axis')
    shifted=replace(first,screw=first.screw.translate((2,0,0)),nut=first.nut.translate((2,0,0)))
    reject(lambda:r.check_joint(shifted,body),'screw axis')
    duplicate=replace(wrong_pair,expected_xy=neighbor.expected_xy)
    reject(lambda:r.check_joints([duplicate,neighbor,*joints[2:]],body),'Joint axes duplicated')

kit=r.buffer_kit(r.cad.cyl(58,10,-10))
reject_wrong_seats(kit['pairs'],kit['roof']+kit['spacer']+kit['cap'])
keepers=r.stock_hex_keepers(r.cad.cyl(58,10,-10))
keeper_body=keepers['roof']
for tab in keepers['tabs']:keeper_body+=tab
reject_wrong_seats(keepers['pairs'],keeper_body)
# Whole-candidate verification must inspect the same joint shapes exported later.
candidate=base.build('knob')
first,neighbor=candidate['kit']['pairs'][:2]
wrong=dict(candidate,kit=dict(candidate['kit'],pairs=[replace(first,nut=neighbor.nut),*candidate['kit']['pairs'][1:]]))
reject(lambda:base.verify(wrong),'nut axis')
first,neighbor=candidate['keepers']['pairs']
wrong=dict(candidate,keepers=dict(candidate['keepers'],pairs=[replace(first,screw=neighbor.screw,nut=neighbor.nut),neighbor]))
reject(lambda:base.verify(wrong),'screw axis')
# The operator's flush opening datum forbids outside-profile parts at/above root.
current=base.build('knob',19)
old_cap=r.buffer_kit(r.cad.cyl(58,10,-10),19)['cap']
wrong=dict(current,parts=dict(current['parts'],raised_cap=old_cap))
reject(lambda:base.verify(wrong),'Outside-bar part crosses required below-root plane')
flat_wide=r.cad.ring(44,57,1,18)
reject(lambda:buffer_cad.below_root_guard([('flat wide washer',flat_wide)],19),
       'Outside-bar part crosses required below-root plane')
kit=buffer_cad.build(r.cad.cyl(58,10,-10),19)
buffer_cad.verify(kit)
wrong_flat=kit['flat_pattern']
for angle in (45,135,225,315):
    extra=kit['neutral_ramp_extra']
    cut=r.block(extra+.1,8.2,1.2,(buffer_cad.EAR_END+(extra+.1)/2,0,-.1)).rotate(r.Axis.Z,angle)
    wrong_flat-=cut
reject(lambda:buffer_cad.verify(dict(kit,flat_pattern=wrong_flat)),'change stock volume')
reject_wrong_seats(kit['pairs'],kit['roof']+kit['spacer']+kit['buffer'])
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
print('PASS: declared axes reject swapped/neighbor/shifted hardware; real-hardware coupon stacks; reject free nut, missing roof/cap/anchor/lid, short screw and oversized tie tail; whole tie-loop witnesses clear')
