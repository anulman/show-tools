"""Verify measured hex coupon behavior and reject inherited interface mistakes."""
from dataclasses import replace
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import measured_hex_joint as m


def reject(action,reason):
    try:action()
    except ValueError as error:assert reason in str(error),str(error)
    else:raise AssertionError('Invalid measured coupon accepted: '+reason)


coupon=m.build();checks=m.verify(coupon)
for field,value,reason in (
    ('well_af',34,'Hex allowance below'),
    ('passage_diameter',29,'Barrel allowance below'),
    ('well_depth',5,'Nut is thicker than pocket')):
    reject(lambda:m.build(replace(m.Parameters(),**{field:value})),reason)
roof=coupon['parts']['well'];tab=coupon['parts']['keeper'];p=coupon['parameters']
no_nose=tab-m.r.block(8,2,-p.hex_top_z,(0,16.5,p.hex_top_z))
assert m.audit.volume(tab-no_nose)>3.9
assert m.audit.intersection(coupon['stock'].translate((0,0,.1)),no_nose)<1e-6
wrong=dict(coupon,parts=dict(coupon['parts'],keeper=no_nose),tabs=[coupon['tabs'][0],no_nose])
reject(lambda:m.verify(wrong),'Measured keeper leaves hidden axial clearance')
# Replaying the old -10 mm loading opening leaves a cap beneath the deeper roof.
bottom=-p.well_depth-p.seat_web
cap=m.r.block(8,8,1.5,(0,28,bottom))-m.r.bore(0,28,bottom-.1,bottom+2)
wrong=dict(coupon,parts=dict(coupon['parts'],well=roof+cap))
reject(lambda:m.verify(wrong),'Nut loading')
wrong=dict(coupon,joint=replace(coupon['joint'],expected_xy=(0,-28)))
reject(lambda:m.verify(wrong),'screw axis')
assert checks['nominal_hex_top_z_mm']==-0.25 or abs(checks['nominal_hex_top_z_mm']+.25)<1e-10
print('PASS: measured well/ledge/nose, stock pullout/antirotation, actual M3 joint/loading, ordinary key/B access; old AF/bore/depth, missing nose, capped nut channel and wrong axis rejected')
