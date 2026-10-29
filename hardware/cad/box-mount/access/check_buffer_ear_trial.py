"""Verify that a small ear trial preserves the actual source joint and length basis."""
import argparse
import json
import tempfile
from unittest.mock import patch
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
# Only temporary receipt copies are mutated; actual source artifacts stay immutable.
with tempfile.TemporaryDirectory(prefix='ear-provenance-') as directory:
    root=Path(directory)
    receipt=root/'producer.json'
    original=args.base_receipt.read_bytes()
    for omitted in (('below_plane_buffer.py',),('resin_retention.py',),
                    ('below_plane_buffer.py','resin_retention.py')):
        changed=json.loads(original)
        for name in omitted:del changed['source_code_sha256'][name]
        receipt.write_text(json.dumps(changed))
        reject(lambda:t.make_trial(receipt),'Producer source inventory differs')
    changed=json.loads(original)
    changed['source_code_sha256']['unrecognized.py']='0'*64
    receipt.write_text(json.dumps(changed))
    reject(lambda:t.make_trial(receipt),'Producer source inventory differs')

    receipt.write_bytes(original)
    build=t.base.build
    def mutate_during_build(*args,**kwargs):
        changed=json.loads(original);changed['mutation_probe']='after parse'
        receipt.write_text(json.dumps(changed))
        return build(*args,**kwargs)
    with patch.object(t.base,'build',mutate_during_build):
        reject(lambda:t.make_trial(receipt),'Base source receipt changed')

    receipt.write_bytes(original)
    snapshot=t.ReceiptSnapshot.capture(receipt)
    temporary=dict(trial,receipt_snapshot=snapshot)
    assert snapshot.sha256==t.hashlib.sha256(original).hexdigest()
    receipt.write_bytes(original+b' ')
    reject(lambda:t.verify(temporary),'Base source receipt changed')
    output=root/'export'
    output.mkdir();(output/'receipt.json').write_text('stale receipt')
    reject(lambda:t.export(temporary,output),'Base source receipt changed')
    assert not (output/'receipt.json').exists()

    receipt.write_bytes(original)
    export_part=t.cad.export_part
    def mutate_during_export(*args,**kwargs):
        record=export_part(*args,**kwargs)
        receipt.write_bytes(original+b' ')
        return record
    with patch.object(t.cad,'export_part',mutate_during_export):
        reject(lambda:t.export(temporary,output),'Base source receipt changed')
    assert not (output/'receipt.json').exists()

    # Changes after writing the final receipt must invalidate that receipt too.
    receipt.write_bytes(original)
    write_text=Path.write_text
    def mutate_after_receipt(path,*args,**kwargs):
        result=write_text(path,*args,**kwargs)
        if path==output/'receipt.json':
            assembly=output/'actual-ear-joint-assembly.step'
            assembly.write_bytes(assembly.read_bytes()+b' ')
        return result
    with patch.object(Path,'write_text',mutate_after_receipt):
        reject(lambda:t.export(temporary,output),'Input artifact changed during integration')
    assert not (output/'receipt.json').exists()
trial['artifacts'].unchanged()
print('PASS: exact source inventory; receipt mutation during build, verification and export; final assembly mutation rejected')
print('PASS: actual one-ear stack; source material, declared axis and including-head screw-length mutations rejected')
