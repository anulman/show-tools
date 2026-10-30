"""Run the one allowlisted headless CAD recipe without publishing or discovering services."""
from __future__ import annotations

import argparse
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import hashlib
import importlib
import io
import json
from pathlib import Path
import runpy
import sys

HERE = Path(__file__).resolve().parent
RECIPE = 'measured-hex-joint'


class ProductGateFailure(ValueError):
    """An existing explicit product guard rejected its input or artifact."""


@contextmanager
def tagged_guards(model):
    """Preserve the real guards, tagging only failures they deliberately raise."""
    originals = []

    def wrap(original):
        def checked(condition, message):
            try:
                return original(condition, message)
            except ValueError as error:
                if condition or str(error) != str(message):
                    raise
                raise ProductGateFailure(str(error)) from error
        return checked

    try:
        for module in (model.audit, model.cad, model.cad.box_cad):
            originals.append((module, module.require))
            module.require = wrap(module.require)
        yield
    finally:
        for module, original in reversed(originals):
            module.require = original


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_receipt(output):
    output = output.resolve()
    path = output / 'receipt.json'
    raw = path.read_bytes()
    report = json.loads(raw)
    if (report.get('scope') != 'ISOLATED_FULL_HEX_ONE_KEEPER_FIT_COUPON_NOT_FULL_MOUNT'
            or report.get('geometry_checks_pass') is not True
            or report.get('physical_fit_preload_and_strength_verified') is not False):
        raise ProductGateFailure('The exporter did not produce the required checked fit-trial receipt.')
    records = report.get('review_components', [])
    if len(records) != 2 or {part.get('name') for part in records} != {'well', 'keeper'}:
        raise ProductGateFailure('The fit trial must contain exactly the well and one keeper.')
    for part in records:
        for kind in ('step', 'stl'):
            expected = output / 'print' / f'measured-hex-{part["name"]}.{kind}'
            if Path(part[kind]).resolve() != expected or digest(expected) != part[kind + '_sha256']:
                raise ProductGateFailure('A checked fit-trial export is missing, relocated or changed.')
    assembly = output / 'nominal-one-keeper-assembly.step'
    if (Path(report['assembly_step']).resolve() != assembly
            or digest(assembly) != report['assembly_step_sha256']):
        raise ProductGateFailure('The checked nominal assembly is missing, relocated or changed.')
    if path.read_bytes() != raw:
        raise ProductGateFailure('The receipt changed during the final export check.')
    return dict(path=str(path), sha256=hashlib.sha256(raw).hexdigest())


def run(output):
    stage = 'input'
    owned = False
    try:
        if not output.is_absolute():
            raise ProductGateFailure('Choose an absolute output path for a new trial directory.')
        if output.exists() or output.is_symlink():
            raise ProductGateFailure('The output already exists. Choose a new directory; existing work was not changed.')
        output = output.resolve()
        stage = 'runtime'
        sys.path.insert(0, str(HERE / 'box-mount' / 'access'))
        model = importlib.import_module('measured_hex_joint')
        with tagged_guards(model):
            stage = 'validation'
            runpy.run_path(str(HERE / 'box-mount' / 'access' / 'check_measured_hex_joint.py'), run_name='__main__')
            stage = 'export'
            # Reserve a fresh destination only after the product gate passes.
            output.mkdir(parents=True, exist_ok=False)
            owned = True
            model.export(model.build(), output)
            stage = 'receipt'
            receipt = check_receipt(output)
        return dict(protocol=1, kind='validated', recipe=RECIPE, receipt=receipt)
    except ProductGateFailure as error:
        result = dict(protocol=1, kind='gate-failed', stage=stage, cause=str(error))
    except Exception as error:
        # Unknown implementation/runtime faults are not relabeled as product errors.
        result = dict(protocol=1, kind='execution-failed', stage=stage, cause=type(error).__name__)
    if owned:
        try:
            (output / 'receipt.json').unlink(missing_ok=True)
        except OSError:
            result = dict(protocol=1, kind='execution-failed', stage='cleanup', cause='ReceiptRemovalFailed')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recipe', choices=(RECIPE,))
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    # The bridge protocol is one JSON object. Normal validator chatter is not a result.
    with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
        result = run(args.output)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
