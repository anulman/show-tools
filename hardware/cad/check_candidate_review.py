"""Verify candidate-only scenes without publishing or deleting prior selections."""
import argparse
from copy import deepcopy
import json
import hashlib
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

import comparison_review as review
import disco_bar
import workspace

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--step', type=Path, help='Original Darren STEP, or SHOW_TOOLS_DISCO_STEP')
args = parser.parse_args()
reference_path, reference = disco_bar.load_reference(args.step)
disco_bar.verify_full_reference(reference_path, reference)

original = review.CURRENT.read_bytes()
with tempfile.TemporaryDirectory(prefix='candidate-review-') as directory:
    registry = json.loads(original)
    registry['presentation'] = 'candidates'
    path = Path(directory)/'selection.json'
    path.write_text(json.dumps(registry))
    candidate = review.Comparison(path)
    assert candidate.presentation == 'candidates'
    assert candidate.compatibility == {
        'collar_receipt_sha256': review.PINS['collar'],
        'compact_receipt_sha256': review.PINS['rotor'],
        'historical_collar_receipt_sha256': review.HISTORICAL_COLLAR_PIN,
        'checked_root_heights_mm': [5, 7],
    }
    assert candidate.reports['rotor']['input_receipts']['collar']['sha256'] == review.HISTORICAL_COLLAR_PIN
    def reject_compatibility(change, message):
        reports = deepcopy(candidate.reports)
        change(reports)
        try: review.verify_compatibility(reports)
        except ValueError as error: assert message in str(error)
        else: raise AssertionError('Invalid collar/base compatibility accepted')
    reject_compatibility(lambda r:r['collar'].pop('debond_checks'), 'proof missing')
    reject_compatibility(lambda r:r['collar']['debond_checks'].__setitem__('compact_receipt_sha256', '0'*64), 'another compact base')
    reject_compatibility(lambda r:r['collar']['debond_checks'].__setitem__('baseline_receipt_sha256', '0'*64), 'another historical baseline')
    reject_compatibility(lambda r:r['rotor']['input_receipts']['collar'].__setitem__('sha256', review.PINS['collar']), 'historical collar pin changed')
    reject_compatibility(lambda r:r['collar']['debond_checks']['compact_base'].pop('7'), 'Incomplete compact compatibility')
    reject_compatibility(lambda r:r['collar']['debond_checks'].__setitem__('original_voids_clear_all_six_states', False), 'checked proof missing')
    reject_compatibility(lambda r:r['collar']['debond_checks'].pop('connected_bottom_entry_cup_absent'), 'bottom-entry proof missing')
    reject_compatibility(lambda r:r['collar'].__setitem__('source_commit', '0'*40), 'producer revision')
    reject_compatibility(lambda r:r['collar'].__setitem__('schema_version', 999), 'proof schema')
    # The proof's unseen state/tool exports remain byte-checked during selection.
    state_record = deepcopy(candidate.reports['collar']['states_components']['released'][0])
    changed_state = Path(directory)/'changed-state.step'
    changed_state.write_bytes(Path(state_record['step']).read_bytes()+b'changed')
    state_record['step'] = str(changed_state)
    try: candidate.record_artifact_hashes([state_record])
    except ValueError as error: assert 'artifact changed' in str(error)
    else: raise AssertionError('Changed checked state artifact accepted')
    for records in [*candidate.reports['collar']['states_components'].values(),
                    candidate.reports['collar']['control_sweeps']]:
        assert all(str(record[kind]) in candidate.files for record in records for kind in ('step','stl'))
    print('PASS new-collar/base compatibility, unchanged historical pin, missing/wrong proof and changed state rejection',flush=True)
    for variant, count in [('all',13), ('arcade-inclined',5), ('rotor-level',8)]:
        scene = candidate.candidates('box-mount', variant=variant, explode=25)
        assert len(scene[0]) == count and len(set(scene[1])) == count
        assert not any('OLD' in name or 'mushroom' in name or 'developed-flat' in name for name in scene[1])
        if variant == 'all':
            arcade = [shape for shape,name in zip(scene[0],scene[1]) if name.startswith('ARCADE')]
            spinner = [shape for shape,name in zip(scene[0],scene[1]) if name.startswith('SPINNER')]
            assert max(s.bounding_box().max.X for s in arcade) < min(s.bounding_box().min.X for s in spinner)
        print('PASS candidate boxes', variant, count, flush=True)
    try: candidate.candidates('box-mount', variant='mushroom-level')
    except ValueError as error: assert 'No complete publication candidate' in str(error)
    else: raise AssertionError('Uncut mushroom blank accepted as a publication candidate')
    scene = candidate.candidates('disco-bar', step_path=reference_path)
    assert len(scene[0]) == 26 and len(set(scene[1])) == 26
    assert scene[1][0] == 'ORIGINAL DARREN BAR / full-height reference'
    assert all(name.startswith('C2 BAR / BASEPLATE CANDIDATE / ') for name in scene[1][1:])
    assert not any('SPINNER BASE' in name or 'ARCADE' in name or 'fit coupon' in name for name in scene[1])
    bar = next(shape for shape,name in zip(scene[0],scene[1]) if name.endswith('/ full-height bar'))
    for shape in (scene[0][0],bar):
        bounds = shape.bounding_box()
        assert abs(bounds.min.Z) < 1e-5 and abs(bounds.size.Z-109.22) < 1e-5
        assert bounds.max.Z > 100, 'Both bars must extend upward from their common root'
    assert scene[0][0].bounding_box().max.X < min(s.bounding_box().min.X for s in scene[0][1:])
    from build123d import Axis
    angle = candidate.reports['rotor']['C2_source_to_box']['rotation_z_degrees']
    for placed,source,x in [(scene[0][0],reference.solids()[0],-80),
                           *[(placed,source,80) for placed,(_,_,source) in zip(scene[0][1:],candidate.parts['collar'])]]:
        restored = placed.translate((-x,0,0)).rotate(Axis.Z,-angle).rotate(Axis.X,180)
        assert review.final_review.integration.volume(restored-source) < 1e-5
        assert review.final_review.integration.volume(source-restored) < 1e-5
    replacement = next(r['step'] for r in candidate.reports['collar']['review_components'] if r['name']=='full-height bar')
    try: candidate.candidates('disco-bar', step_path=Path(replacement))
    except ValueError as error: assert "Darren's original full-height STEP" in str(error)
    else: raise AssertionError('Modified candidate substituted for original Darren bar')
    class StopBeforePublication(Exception): pass
    with patch.object(review,'load_optional',return_value=candidate), \
         patch.object(candidate,'candidates',side_effect=StopBeforePublication) as build, \
         patch.object(sys,'argv',['workspace.py','disco-bar','--step',str(reference_path)]):
        try: workspace.main()
        except StopBeforePublication: pass
        else: raise AssertionError('Workspace continued toward publication')
        build.assert_called_once_with('disco-bar',variant='all',explode=0,step_path=reference_path)
    print('PASS original/C2 side-by-side, common upright root, unchanged solids, no box; STEP pin and forwarding',flush=True)
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
print('PASS: both boxes and original/C2 bars, complete upright geometry; prior data untouched')
