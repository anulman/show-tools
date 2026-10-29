"""Check actual dual arcade outlets and reject changes to protected geometry."""
import argparse
import json
from pathlib import Path
import sys
import tempfile
sys.path.insert(0,str(Path(__file__).resolve().parent))
import arcade_dual_exit as dual


def reject(action,reason):
    try:action()
    except ValueError as error:assert reason in str(error),str(error)
    else:raise AssertionError('Altered dual-exit arcade accepted: '+reason)


def altered(data,name,shape):
    return dict(data,candidate=dict(data['candidate'],parts=dict(data['candidate']['parts'],**{name:shape})))


parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-receipt',type=Path,required=True)
args=parser.parse_args()
data=dual.prepare(args.base_receipt);checks=dual.verify(data)
parts=data['candidate']['parts'];p=data['candidate']['box'];floor=p.floor_z
# A clear old box has no rear outlet; the new route must detect its closed wall.
reject(lambda:dual.verify_routes(altered(data,'shell',data['original_parts']['shell'])),'Cable route blocked: high_back')
plug=dual.r.block(10,p.wall,9.5,(0,-p.tilted_length/2+p.wall/2,floor-p.channel_depth))
reject(lambda:dual.verify_routes(altered(data,'shell',parts['shell']+plug)),'Cable route blocked: low_front')
# Real material must be removed at each protected region before the guard is exercised.
for name,cut,reason in (
    ('shell',dual.r.block(1,1,1,(52,0,10)),'Changed arcade roof/counterbore'),
    ('shell',dual.r.block(1,1,1,(52,0,-4)),'Changed arcade roof/counterbore'),
    ('shell',dual.r.block(1,1,1,(53.5,54,floor+6)),'Changed cover fastener region'),
    ('ballast_lid',dual.r.block(1,1,1,(0,36,floor+10.5)),'Changed preserved arcade ballast_lid')):
    changed=parts[name]-cut
    assert dual.audit.volume(parts[name]-changed)>.9,(name,reason)
    reject(lambda:dual.verify(altered(data,name,changed)),reason)
reject(lambda:dual.verify(altered(data,'shell',parts['shell']-data['rear_ties']['bottom'])),
       'Missing integral rear tie bridge or anchor')
# A connected shelf across the required axial corridor must fail the actual corridor check.
bar=dual.r.block(59,1,1,(-28.5,0,-30))
reject(lambda:dual.verify(altered(data,'shell',parts['shell']+bar)),'New retention enters required arcade corridor')
with tempfile.TemporaryDirectory(prefix='arcade-dual-negative-') as directory:
    receipt=Path(directory)/'receipt.json';original=args.base_receipt.read_bytes()
    producer=json.loads(original);del producer['source_code_sha256']['resin_retention.py']
    receipt.write_text(json.dumps(producer))
    reject(lambda:dual.prepare(receipt),'Producer source inventory differs')
    receipt.write_bytes(original)
    temporary=dict(data,snapshot=dual.ear.ReceiptSnapshot.capture(receipt))
    receipt.write_bytes(original+b' ')
    reject(lambda:dual.verify(temporary),'Base source receipt changed')
print('PASS: both closed-cover outlets, original datums/capsule/fasteners/corridor and rear tie routes; blocked outlets, altered roof/seat/lid/corridor, missing source and changed receipt rejected')
