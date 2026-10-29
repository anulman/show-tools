"""Behavioral negative checks for the private stock-hex keeper studies."""
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))
import retention_studies as studies

p=studies.cad.StackProposal(spacer_height=8)
base=studies.cad.stack(p)
checks={}
for kind in ('R1-tape','R2-keeper-tabs','R3-swing-clips'):
    assembly=studies.make_study(kind,p,base)
    checks[kind]=studies.verify_study(p,base,assembly)
assert not checks['R1-tape']['positive_mechanical_retention']
assert checks['R2-keeper-tabs']['nut_up_attempt_blocked']
assert checks['R3-swing-clips']['continuous_swing_envelope_clear']
# A nut with no nearby roof seat must be rejected even if it has no overlap.
r2=studies.make_study('R2-keeper-tabs',p,base)
r2['hardware'][1]=r2['hardware'][1].translate((0,0,-1))
try:
    studies.verify_study(p,base,r2)
except ValueError as error:
    assert 'no upward roof reaction' in str(error),str(error)
else:
    raise AssertionError('Floating keeper fastener nut accepted')
# Moving the lock away must invalidate the claimed locked swing restriction.
r3=studies.make_study('R3-swing-clips',p,base)
r3['hardware'][2]=r3['hardware'][2].translate((100,0,0))
try:
    studies.verify_study(p,base,r3)
except ValueError as error:
    assert 'bypass its locking fastener' in str(error),str(error)
else:
    raise AssertionError('A clip without its positive rotation lock was accepted')
print('PASS: tape limits, keeper nut reaction, captive clip swing; floating nut and absent lock rejected')
