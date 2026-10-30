"""Verify candidate-only scenes without publishing or deleting prior selections."""
import json
import hashlib
from pathlib import Path
import sys
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
    gap = candidate.reports['rotor']['C2_source_to_box']['mouth_z_mm']
    assert abs(bounds.min.Z-gap) < 1e-5 and abs(bounds.size.Z-109.22) < 1e-5
    assert bounds.max.Z > gap+100, 'Installed bar must extend upward from its root'
    candidate.assert_current()
    # A presentation change must preserve the previous selection, including on failure.
    live_path = review.CURRENT
    argv = sys.argv
    try:
        review.CURRENT = Path(directory)/'staged'/'current.json'
        review.CURRENT.parent.mkdir()
        previous = dict(registry, presentation='comparison')
        previous_bytes = json.dumps(previous).encode()
        review.CURRENT.write_bytes(previous_bytes)
        sys.argv = ['comparison_review.py', '--presentation', 'candidates']
        for kind, receipt in registry['receipts'].items(): sys.argv.extend(('--'+kind, receipt))
        review.main()
        saved = review.CURRENT.parent/'prior-selections'/(hashlib.sha256(previous_bytes).hexdigest()+'.json')
        assert saved.read_bytes() == previous_bytes
        staged = review.CURRENT.read_bytes()
        assert json.loads(staged)['presentation'] == 'candidates'
        sys.argv[sys.argv.index('--rotor')+1] = registry['receipts']['arcade']
        try: review.main()
        except ValueError as error: assert 'independently reviewed' in str(error)
        else: raise AssertionError('Wrong rotor receipt staged')
        assert review.CURRENT.read_bytes() == staged and saved.read_bytes() == previous_bytes
    finally:
        review.CURRENT = live_path
        sys.argv = argv
assert review.CURRENT.read_bytes() == original, 'Candidate check replaced the prior selection'
print('PASS: complete installed candidate assembly, full upward bar, no historical scenes; prior data untouched')
