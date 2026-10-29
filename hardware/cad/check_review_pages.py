"""Check final page composition and reject stale or mismatched proposal inputs."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import tempfile

import box_mount
import box_review
import disco_bar
import disco_review
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

    disco = disco_review.preview(args.step, selection=selection)
    disco_review.verify_preview_scene(args.step, disco, selection=selection)
    assert len(disco[0]) == 25
    assert disco[1][0] == disco_bar.ORIGINAL_LABEL
    assert all(name.startswith(disco_bar.FINAL_C_LABEL + ' / ') for name in disco[1][1:])
    extra = tuple(list(v) + [v[0]] for v in disco)
    rejected('extra historical option in focused page', lambda: disco_review.verify_preview_scene(args.step, extra, selection=selection))
    body = next(i for i, name in enumerate(disco[1]) if name.startswith(disco_bar.FINAL_C_LABEL) and name.endswith(' / full-height bar'))
    cropped = tuple(list(v) for v in disco)
    cropped[0][body] &= disco_bar.box(110, 110, 28, (disco_review.SPACING, 0, -14))
    rejected('cropped final C beside intact original', lambda: disco_review.verify_preview_scene(args.step, cropped, selection=selection))

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
        original_path = Path(registry['reference']['path'])
        def stage_variant(label, kind, report, message):
            modified = root / (kind + '-modified.json')
            modified.write_text(json.dumps(report))
            disco_path = modified if kind == 'disco' else Path(registry['disco']['path'])
            box_path = modified if kind == 'box' else Path(registry['box']['path'])
            if kind == 'disco':
                bound = deepcopy(selection.reports['box'])
                bound['producer_receipt_sha256'] = final_review.digest(modified)
                box_path = root / 'rebound-box.json'
                box_path.write_text(json.dumps(bound))
            try:
                final_review.stage(disco_path, box_path, root / 'staged.json', reference=original_path)
            except ValueError as error:
                assert message in str(error), str(error)
                print('PASS rejected', label, flush=True)
            else:
                raise AssertionError('Accepted ' + label)
        for kind, name in (('box', 'bottom'), ('box', 'buffer'), ('disco', 'fastened captive roof')):
            report = deepcopy(selection.reports[kind])
            report['review_components'] = [r for r in report['review_components'] if r['name'] != name]
            stage_variant('omitted required '+name, kind, report, 'required named components')
        report = deepcopy(selection.reports['disco'])
        report['review_components'][0]['role'] = 'hardware'
        stage_variant('substituted C component role', 'disco', report, 'required named components')
        report = deepcopy(selection.reports['box'])
        bottom = next(i for i, r in enumerate(report['review_components']) if r['name'] == 'bottom')
        spacer = next(r for r in report['review_components'] if r['name'] == 'spacer')
        report['review_components'][bottom] = dict(spacer, name='bottom')
        stage_variant('valid spacer geometry substituted for bottom', 'box', report, 'differs from source geometry')
        report = deepcopy(selection.reports['disco'])
        roof = next(i for i, r in enumerate(report['review_components']) if r['name'] == 'fastened captive roof')
        carrier = next(r for r in report['review_components'] if r['name'] == 'fixed-to-bar latch carrier')
        report['review_components'][roof] = dict(carrier, name='fastened captive roof')
        stage_variant('valid carrier geometry substituted for C roof', 'disco', report, 'differs from source geometry')
        for kind, name in (('disco', 'final_c.py'), ('disco', 'check_final_c.py'), ('box', 'final_base.py')):
            report = deepcopy(selection.reports[kind])
            del report['source_code_sha256'][name]
            stage_variant('omitted required source '+name, kind, report, 'required source-file manifest')
    selection.assert_current()
    print(f'PASS checked pages: {len(disco[0])} disco components, {len(box[0])} box/reference components; aligned and exploded cover', flush=True)


if __name__ == '__main__':
    main()
