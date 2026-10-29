"""Positive and negative checks for the private nominal stationary stack."""
from dataclasses import replace
from pathlib import Path
import sys
import tempfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from access_study import StackProposal,export_part,export_study,stack,verify_stack
from build123d import Align,Box,Compound

p=StackProposal()
parts=stack(p)
report=verify_stack(p,parts)
assert report['roof_z_mm']==0
assert report['proposed_bar_mouth_z_mm']==6
assert report['illustrative_tool_path']['table_intersection_mm3']>0
assert not report['installed_latch_access_verified']
# The actual bearing support material must matter to the verification.
missing_roof=dict(parts)
missing_roof['shell']=parts['shell']-Box(45,45,5,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,-10))
try:
    verify_stack(p,missing_roof)
except ValueError as error:
    assert 'bearing seat absent' in str(error),str(error)
else:
    raise AssertionError('A stock hex well without its bearing seat was accepted')
wrong_buffer=dict(parts)
wrong_buffer['buffer']=parts['buffer'].translate((0,0,1))
try:
    verify_stack(p,wrong_buffer)
except ValueError as error:
    assert 'Buffer stack height changed' in str(error),str(error)
else:
    raise AssertionError('A buffer disconnected from the nominal mouth plane was accepted')
# A failed rebuild cannot leave the previous nominal success receipt.
with tempfile.TemporaryDirectory(prefix='box-access-failure-') as temporary:
    output=Path(temporary)
    (output/'receipt.json').write_text('STALE SUCCESS')
    (output/'interface.json').write_text('STALE INTERFACE')
    try:
        export_study(output,replace(p,body_passage_diameter=100))
    except ValueError:
        pass
    else:
        raise AssertionError('Impossible body passage was accepted')
    assert not (output/'receipt.json').exists()
    assert not (output/'interface.json').exists()
# The CAD STEP exporter rejects a child attached to an assembly tree. Our helper
# exports an independent single-solid handle, so a later component export works.
with tempfile.TemporaryDirectory(prefix='box-access-child-export-') as temporary:
    part=Box(2,3,4)
    assembly=Compound(children=[part,Box(2,3,4).translate((10,0,0))])
    record=export_part(part,Path(temporary)/'child')
    assert record['step_two_way_material_equality']
print('PASS: nominal stack; missing stock hex seat and wrong buffer rejected; failed rebuild removes stale evidence')
