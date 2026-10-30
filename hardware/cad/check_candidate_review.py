"""Verify candidate-only scenes without publishing or deleting prior selections."""
import json
from pathlib import Path
import tempfile

import comparison_review as review

original = review.CURRENT.read_bytes()
with tempfile.TemporaryDirectory(prefix='candidate-review-') as directory:
    registry = json.loads(original)
    registry['presentation'] = 'candidates'
    path = Path(directory)/'selection.json'
    path.write_text(json.dumps(registry))
    candidate = review.Comparison(path)
    assert candidate.presentation == 'candidates'
    for variant, count in [('all',13), ('arcade-inclined',5), ('rotor-level',8)]:
        scene = candidate.candidates('box-mount', variant=variant, explode=25)
        assert len(scene[0]) == count and len(set(scene[1])) == count
        assert not any('OLD' in name or 'mushroom' in name or 'developed-flat' in name for name in scene[1])
        print('PASS candidate boxes', variant, count, flush=True)
    try: candidate.candidates('box-mount', variant='mushroom-level')
    except ValueError as error: assert 'No complete publication candidate' in str(error)
    else: raise AssertionError('Uncut mushroom blank accepted as a publication candidate')
    scene = candidate.candidates('disco-bar')
    assert len(scene[0]) == 33 and len(set(scene[1])) == 33
    assert not any('OLD' in name or 'ORIGINAL' in name or 'fit coupon' in name for name in scene[1])
    bar = next(shape for shape,name in zip(scene[0],scene[1]) if name.endswith('/ full-height bar'))
    bounds = bar.bounding_box()
    gap = candidate.reports['rotor']['proposed_layout']['gap_mm']
    assert abs(bounds.min.Z-gap) < 1e-5 and abs(bounds.size.Z-109.22) < 1e-5
    assert bounds.max.Z > gap+100, 'Installed bar must extend upward from its root'
    candidate.assert_current()
assert review.CURRENT.read_bytes() == original, 'Candidate check replaced the prior selection'
print('PASS: complete installed candidate assembly, full upward bar, no historical scenes; prior data untouched')
