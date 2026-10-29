"""Verify that a small ear trial preserves the actual source joint and length basis."""
import argparse
from dataclasses import replace
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import buffer_ear_trial as t

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-receipt',type=Path,required=True)
args=parser.parse_args()
trial=t.make_trial(args.base_receipt)
t.verify(trial)


def reject(action,reason):
    try:action()
    except ValueError as error:assert reason in str(error),str(error)
    else:raise AssertionError('Altered ear trial accepted: '+reason)


# Remove a real 1 mm cube beside the bore, within the source spacer and clip.
x,y=trial['joint'].expected_xy
offset=5/(2**.5)
cut=t.r.block(1,1,1,(x-offset,y+offset,1))
changed=trial['parts']['spacer']-cut
assert t.audit.volume(trial['parts']['spacer']-changed)>.9
wrong=dict(trial,parts=dict(trial['parts'],spacer=changed))
reject(lambda:t.verify(wrong),'Trial changed source joint material spacer')
# A countersunk screw's 25 mm datum includes its head; the wrong basis must fail.
wrong=dict(trial,joint=replace(trial['joint'],length=trial['joint'].length-t.b.FLAT_HEAD_HEIGHT))
reject(lambda:t.verify(wrong),'Screw length/envelope mismatch')
wrong=dict(trial,joint=replace(trial['joint'],expected_xy=(0,0)))
reject(lambda:t.verify(wrong),'screw axis')
trial['artifacts'].unchanged()
print('PASS: actual one-ear stack; source material, declared axis and including-head screw-length mutations rejected')
