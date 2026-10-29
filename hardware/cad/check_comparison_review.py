"""Check old/new publication composition against the real reviewed exports."""
import json
from pathlib import Path
import tempfile

import box_review
import comparison_review as review
import disco_review
import final_review

selection = final_review.load()
comparison = review.Comparison()
reference = Path(selection.registry['reference']['path'])
old = disco_review.preview(reference, selection=selection)
disco_review.verify_preview_scene(reference, old, selection=selection)
scene = comparison.extend('disco-bar', old)
assert len(scene[0]) == len(old[0])+25
assert scene[1][0] == old[1][0]
assert sum(name.startswith('NEW C2, FIT PENDING / ') for name in scene[1]) == 25
assert scene[0][:len(old[0])] == old[0]
for variant in ('all', 'arcade-inclined', 'rotor-level', 'mushroom-level'):
    old = box_review.preview(variant=variant, selection=selection)
    box_review.verify_preview_scene(old, variant=variant, selection=selection)
    scene = comparison.extend('box-mount', old, variant=variant)
    added = {'all':13, 'arcade-inclined':5, 'rotor-level':8, 'mushroom-level':0}[variant]
    assert len(scene[0]) == len(old[0])+added
    assert len(set(scene[1])) == len(scene[1])
    assert not any('developed-flat-PTFE' in name for name in scene[1])
    if variant == 'all':
        assert any(name.startswith('OLD / arcade-inclined') for name in scene[1])
        assert any(name.startswith('NEW arcade-inclined') for name in scene[1])
        assert any(name.startswith('OLD / rotor-level') for name in scene[1])
        assert any(name.startswith('NEW rotor-level') for name in scene[1])
    print('PASS composition', variant, len(scene[0]), flush=True)
with tempfile.TemporaryDirectory(prefix='comparison-negative-') as directory:
    directory=Path(directory)
    registry=dict(comparison.registry, receipts=dict(comparison.registry['receipts']))
    source=json.loads(Path(registry['receipts']['collar']).read_text())
    source['review_components'].pop()
    changed=directory/'collar.json'; changed.write_text(json.dumps(source))
    registry['receipts']['collar']=str(changed)
    target=directory/'selection.json'; target.write_text(json.dumps(registry))
    try: review.Comparison(target)
    except ValueError as error: assert 'independently reviewed' in str(error)
    else: raise AssertionError('Incomplete replacement collar accepted')
comparison.assert_current(); selection.assert_current()
print('PASS: original/old/new complete; actual reviewed solids preserved; substituted receipt rejected')
