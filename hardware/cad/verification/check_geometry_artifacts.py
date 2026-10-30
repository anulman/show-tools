"""Check a real delivered candidate and reject forged mass/method/file records."""
import argparse
from copy import deepcopy
import json
from geometry_artifacts import Artifacts

p=argparse.ArgumentParser(description=__doc__);p.add_argument('receipt');args=p.parse_args()
r=json.load(open(args.receipt));a=Artifacts()
records=[r['environment'],*r['stages']['locked']['components']]
for record in records:a.load(record)
a.unchanged()
for change,phrase in (
    (lambda q:q.update(volume_mm3=q['volume_mm3']*1.01),'mass disagrees'),
    (lambda q:q.update(restored_volume_mm3=q['restored_volume_mm3']*1.01),'restored STEP mass'),
    (lambda q:q.update(mass_integration='unknown method'),'Unknown declared'),
    (lambda q:q.update(step_sha256='0'*64),'Changed step')):
    wrong=deepcopy(records[0]);change(wrong)
    try:a.load(wrong)
    except ValueError as error:assert phrase in str(error),str(error)
    else:raise AssertionError('Invalid actual artifact record accepted')
print('PASS: actual delivered STEP/STL integrity and adaptive mass; forged mass/method/hash rejected')
