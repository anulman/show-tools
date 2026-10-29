"""Exercise C2 resin integration and failures against its actual exported solids."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
import resin_c2 as c2


def reject(action,reason):
    try:action()
    except ValueError as error:assert reason in str(error),str(error)
    else:raise AssertionError('Invalid integration accepted: '+reason)


parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--collar-receipt',type=Path,required=True)
parser.add_argument('--base-receipt',type=Path,required=True)
parser.add_argument('--source-worktree',type=Path,required=True)
args=parser.parse_args()
with tempfile.TemporaryDirectory(prefix='resin-c2-check-') as directory:
    root=Path(directory);receipt=root/'collar.json'
    original=args.collar_receipt.read_bytes()
    producer=json.loads(original)
    del producer['source_code_sha256']['standard_collar.py']
    receipt.write_text(json.dumps(producer))
    reject(lambda:c2.prepare(receipt,args.base_receipt,args.source_worktree),'Incomplete collar source inventory')
    receipt.write_bytes(original)
    data=c2.prepare(receipt,args.base_receipt,args.source_worktree)
    checks=c2.verify(data)
    assert checks['tabletop']['minimum_geometric_lift_mm']>140
    assert checks['tabletop']['minimum_lifted_table_clearance_mm']>19
    assert checks['contact']['exact_planar_contact_area_mm2']>0
    reject(lambda:c2.tabletop_check(data,100),'Proposed lift blocks full tool entry')
    altered=dict(data['candidate'],parts=dict(data['candidate']['parts'],
                 unmodeled_fixed=c2.r.block(1,1,1,(38,0,1))))
    reject(lambda:c2.invariant_clearance(data['states'],altered),'Fixed part escapes invariant bounds')
    fixed=c2.obstacles(data['candidate'])
    for name,part in data['unported'].items():
        wrong=dict(fixed,**{name:part})
        reject(lambda:c2.clear(data['controls'],wrong,'Unported'),'Unported blocked')
    # The previous 25-degree tiedown position approaches the drive arc endpoint.
    old=c2.r.cable_tiedowns(data['candidate']['parts']['bottom'],data['candidate']['original']['floor_z'],25)
    wrong=dict(fixed,**{f'old-eye-{i}':eye for i,eye in enumerate(old['eyes'])})
    reject(lambda:c2.clear(data['controls'],wrong,'Old cable route'),'Old cable route blocked')
    receipt.write_bytes(original+b' ')
    reject(lambda:c2.verify(data),'Base source receipt changed')
    output=root/'output';output.mkdir();(output/'receipt.json').write_text('stale')
    reject(lambda:c2.export(data,output),'Base source receipt changed')
    assert not (output/'receipt.json').exists()
print('PASS: actual C2 states/tool workflows/contact, 160 mm lift; missing source, unported panels, old cable route, 100 mm lift and changed receipt rejected')
