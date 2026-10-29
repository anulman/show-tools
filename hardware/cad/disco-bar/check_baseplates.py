"""Check only the independent preset knob clamp, not a bar-latch or installed stack."""
import argparse
from dataclasses import replace
import hashlib
import importlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import disco_bar


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--step', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'build' / 'two-joint-baseplate')
    args = parser.parse_args()
    path, reference = disco_bar.load_reference(args.step)
    disco_bar.verify_full_reference(path, reference)
    model = importlib.import_module('disco-bar.baseplates')
    report = model.export_baseplate(reference, args.output)
    released = model.knob_baseplate(reference)
    tightened = model.knob_baseplate(reference, .2)
    try:
        model.verify_baseplate(reference, replace(tightened, setting_mm=0.))
    except ValueError:
        print('PASS rejected preset pad overlap labelled as released clearance')
    else:
        raise AssertionError('Released source socket obstruction was accepted')
    pieces = list(released.pieces)
    original = pieces[0]
    pieces[0] = model.cad.Piece(original.name, original.shape - model.cad.cyl(model.cad.R, 2, (0, 0, -25.4)), original.role)
    try:
        model.verify_baseplate(reference, replace(released, pieces=tuple(pieces)))
    except ValueError:
        print('PASS rejected changed original blind stop')
    else:
        raise AssertionError('Changed source stop was accepted')
    report['reference_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    report['model_sources_sha256'] = {Path(p).name: hashlib.sha256(Path(p).read_bytes()).hexdigest()
                                     for p in (model.__file__, model.cad.__file__, __file__)}
    report['negative_checks'] = ['released path obstructed', 'blind stop removed']
    (args.output / 'receipt.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f'PASS independent baseplate: {len(released.pieces)} components, {len(report["exports"])} print exports; no bar-latch placement')


if __name__ == '__main__':
    main()
