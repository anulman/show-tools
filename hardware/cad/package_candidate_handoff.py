"""Package pinned prototype candidates; keep shopping and validation outside the ZIP."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import tempfile
import zipfile

import numpy as np
import trimesh
import comparison_review
import disco_bar
import box_mount


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(ok, message):
    if not ok:
        raise ValueError(message)


def build(args):
    selected = comparison_review.Comparison(args.selection)
    output = args.output.resolve()
    require(not output.exists(), 'Use a fresh output directory')
    output.mkdir(parents=True)
    print_root = output / 'print-files'
    records = []

    def add(record, folder, *, material=False):
        shape = selected.artifacts.load(record)
        source = Path(record['step' if material else 'stl'])
        target = (output / 'cut-material-references' if material else print_root / folder) / source.name
        require(not target.exists(), 'Duplicate delivery filename')
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        require(digest(target) == digest(source), 'Copy changed bytes')
        if not material:
            mesh = trimesh.load_mesh(target)
            require(isinstance(mesh, trimesh.Trimesh) and np.isfinite(mesh.vertices).all(), 'Invalid STL')
            require(mesh.is_watertight and mesh.is_winding_consistent and mesh.volume > 0, 'Bad STL topology')
            require(shape.is_valid and len(shape.solids()) == 1, 'Invalid source solid')
            require(math.isclose(mesh.volume, shape.volume, rel_tol=.005), 'STL volume differs from CAD')
            bounds = shape.bounding_box()
            require(np.allclose(mesh.bounds, [[bounds.min.X,bounds.min.Y,bounds.min.Z],
                                             [bounds.max.X,bounds.max.Y,bounds.max.Z]], atol=.055, rtol=0),
                    'STL bounds differ from CAD')
            require(len(mesh.split(only_watertight=False)) == len(shape.shells()), 'Boundary shell count differs')
        records.append(dict(file=str(target.relative_to(output)), sha256=digest(target),
                            source=(str(source.relative_to(output)) if source.is_relative_to(output)
                                    else str(source)), name=record['name'], quantity=1,
                            category='cut-stock-reference' if material else folder))
        print('PASS', target.relative_to(output), flush=True)

    for kind, folder in [('arcade','01-arcade-box'), ('rotor','02-spinner-box'), ('collar','03-collar-bar')]:
        for record in selected.reports[kind]['review_components']:
            printable = record['role'] in ('body','bar','print','print-candidates') or kind == 'arcade'
            if printable:
                add(record, folder)
    require(len(records) == 19, 'Installed print inventory changed')
    for record in selected.reports['rotor']['optional_components']:
        add(record, '04-optional-2mm-shim')
    for record in selected.reports['rotor']['fit_coupons']:
        add(record, '05-print-first-fit-tests')
    original_path, original = disco_bar.load_reference(args.step)
    disco_bar.verify_full_reference(original_path, original)
    require(digest(original_path) == selected.reports['collar']['reference_sha256'], 'Original reference changed')
    original_dir = output / 'original-source-export'
    original_dir.mkdir()
    record = box_mount.export_part(original, original_dir / 'darren-original-bar-mm')
    record.update(name='Darren original bar; alternative to collar bar',
                  step=str(original_dir/'darren-original-bar-mm.step'),
                  stl=str(original_dir/'darren-original-bar-mm.stl'))
    record.update(step_sha256=record['files']['darren-original-bar-mm.step'],
                  stl_sha256=record['files']['darren-original-bar-mm.stl'])
    add(record, '06-original-bar-alternative')
    for record in selected.reports['rotor']['material_patterns']:
        add(record, '', material=True)
    add(next(r for r in selected.reports['rotor']['review_components'] if r['name']=='buffer'), '', material=True)
    selected.assert_current()
    shutil.copyfile(Path(__file__).with_name('PROTOTYPE_SHOPPING.md'), output/'Shopping-list.md')
    with zipfile.ZipFile(output/'PTFE-cut-and-form-references.zip','x',zipfile.ZIP_DEFLATED) as z:
        for path in sorted((output/'cut-material-references').glob('*.step')):
            z.write(path, path.name)
    files = sorted(print_root.rglob('*.stl'))
    require(len(files) == 26, 'Expected 19 installed, one shim, five tests, one original alternative')
    archive = output/'prototype-print-files.zip'
    with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
        for path in files:
            z.write(path, path.relative_to(print_root))
    with zipfile.ZipFile(archive) as z:
        require(len(z.namelist()) == 26 and all(n.endswith('.stl') for n in z.namelist()), 'ZIP contains non-print files')
        require(z.testzip() is None, 'ZIP integrity failed')
        for path in files:
            require(z.read(str(path.relative_to(print_root))) == path.read_bytes(), 'ZIP changed STL')
    manifest = dict(units='mm', scope='first prototype; physical fit and strength unverified',
                    receipts=selected.provenance(), files=records, zip_sha256=digest(archive),
                    installed_print_count=19, optional_print_count=1, fit_test_count=5, alternative_count=1)
    (output/'validation.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print('PASS 26 validated STL files; fabrication-only ZIP:',archive,flush=True)


def run(args):
    """Expose the output name only after the complete package passes validation."""
    requested = Path(args.output)
    require(not requested.is_symlink() and not requested.exists(), 'Use a fresh output directory')
    output = requested.resolve()
    require(not output.exists(), 'Use a fresh output directory')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.'+output.name+'-', dir=output.parent) as staging:
        staged = argparse.Namespace(**vars(args))
        staged.output = Path(staging)/'complete'
        build(staged)
        require(not output.exists(), 'Output appeared during packaging; refusing replacement')
        staged.output.rename(output)
    print('Published complete prototype handoff:', output, flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection', type=Path, required=True)
    parser.add_argument('--step', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    run(parser.parse_args())
