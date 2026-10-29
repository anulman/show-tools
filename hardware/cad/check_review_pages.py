"""Check final page composition and reject stale or mismatched proposal inputs."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import tempfile

import box_mount
import box_review
import disco_bar
import final_review


def rejected(label, action):
    try:
        action()
    except ValueError:
        print('PASS rejected', label, flush=True)
    else:
        raise AssertionError('Accepted ' + label)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--step', type=Path, required=True)
    args = parser.parse_args()
    selection = final_review.load()
    box = box_review.preview(selection=selection)
    box_review.verify_preview_scene(box, selection=selection)
    p = box_mount.Proposal()
    for explode in (0, 25):
        rotor = box_review.preview(variant='rotor-level', explode=explode, selection=selection)
        box_review.verify_preview_scene(rotor, variant='rotor-level', explode=explode, selection=selection)
        bottom = next(s for s, name in zip(rotor[0], rotor[1]) if name.endswith(' / bottom'))
        assert abs(bottom.bounding_box().min.Z - (p.underside_z - explode)) < 1e-5
    stale = tuple(list(v) for v in box)
    shell = next(i for i, name in enumerate(box[1]) if name.endswith(' / shell'))
    stale[0][shell] = box_mount.preview(variant='rotor-level')[0][0]
    rejected('legacy rotor substituted for finished base', lambda: box_review.verify_preview_scene(stale, selection=selection))
    button = next(i for i, name in enumerate(box[1]) if 'button REFERENCE' in name)
    moved = tuple(list(v) for v in box)
    moved[0][button] = moved[0][button].translate((1, 0, 0))
    rejected('displaced upstream button reference', lambda: box_review.verify_preview_scene(moved, selection=selection))

    disco = disco_bar.preview(args.step, selection=selection)
    disco_bar.verify_preview_scene(args.step, disco, selection=selection)
    body = next(i for i, name in enumerate(disco[1]) if name.startswith(disco_bar.FINAL_C_LABEL) and name.endswith(' / full-height bar'))
    cropped = tuple(list(v) for v in disco)
    cropped[0][body] &= disco_bar.box(110, 110, 28, (390, 0, -14))
    rejected('cropped final C beside intact original', lambda: disco_bar.verify_preview_scene(args.step, cropped, selection=selection))

    with tempfile.TemporaryDirectory(prefix='final-review-check-') as folder:
        root = Path(folder)
        candidate = root / 'current.json'
        registry = selection.registry
        failed = deepcopy(selection.reports['disco'])
        failed['geometry_review_pass'] = False
        failed_path = root / 'failed.json'
        failed_path.write_text(json.dumps(failed))
        data = deepcopy(registry)
        data['disco'] = dict(path=str(failed_path), sha256=final_review.digest(failed_path))
        candidate.write_text(json.dumps(data))
        rejected('failed proposal promoted for review', lambda: final_review.load(candidate))
        mismatched = deepcopy(selection.reports['box'])
        mismatched['producer_receipt_sha256'] = '0' * 64
        mismatch_path = root / 'mismatched.json'
        mismatch_path.write_text(json.dumps(mismatched))
        data = deepcopy(registry)
        data['box'] = dict(path=str(mismatch_path), sha256=final_review.digest(mismatch_path))
        candidate.write_text(json.dumps(data))
        rejected('base checked against another C', lambda: final_review.load(candidate))
        data = deepcopy(registry)
        del data['source_sha256']['disco-bar/final_c.py']
        candidate.write_text(json.dumps(data))
        rejected('omitted model source check', lambda: final_review.load(candidate))
        data = deepcopy(registry)
        data['source_sha256']['workspace.py'] = '0' * 64
        candidate.write_text(json.dumps(data))
        rejected('changed publication source', lambda: final_review.load(candidate))
        candidate.write_text(json.dumps(registry))
        snapshot = final_review.load(candidate)
        candidate.write_text(json.dumps(registry) + '\n')
        rejected('selection replaced during publication', snapshot.assert_current)
    selection.assert_current()
    print(f'PASS checked pages: {len(disco[0])} disco components, {len(box[0])} box/reference components; aligned and exploded cover', flush=True)


if __name__ == '__main__':
    main()
