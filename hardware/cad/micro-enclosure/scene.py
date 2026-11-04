"""Coordinator-compatible scene; no viewer or service writes."""
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('ipac_enclosure_model', HERE / 'model.py')
MODEL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODEL)
build = MODEL.build
ARTIFACT_SPEC = importlib.util.spec_from_file_location('ipac_geometry_artifacts', HERE.parent / 'verification/geometry_artifacts.py')
ARTIFACT_MODULE = importlib.util.module_from_spec(ARTIFACT_SPEC)
ARTIFACT_SPEC.loader.exec_module(ARTIFACT_MODULE)


def missing_measurements():
    path = HERE / 'measurements.json'
    if not path.exists():
        return ['PCB length', 'PCB width', 'feet-bottom to highest connected component']
    m = json.loads(path.read_bytes())
    if m.get('synthetic_fixture') is not False:
        raise ValueError('Actual scene requires measurements, not a synthetic fixture')
    build(m)  # Invalid supplied geometry is an error, never a pending-scene fallback.
    return []


def load():
    path = HERE / 'measurements.json'
    if not path.exists():
        raise ValueError('I-PAC fit blocked: supply measured PCB length/width and total installed height in micro-enclosure/measurements.json; see README.md')
    raw = path.read_bytes()
    m = json.loads(raw)
    if m.get('synthetic_fixture') is not False:
        raise ValueError('Actual scene requires measurements, not a synthetic fixture')
    receipt_path = HERE / 'validation.json'
    if not receipt_path.exists():
        raise ValueError('I-PAC validation required: run check.py --measurements measurements.json, then copy receipt.json to validation.json')
    receipt = json.loads(receipt_path.read_bytes())
    sources = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
               for p in [HERE/n for n in ('model.py', 'scene.py', 'check.py')]}
    if (receipt.get('scope') != 'IPAC_TWO_PART_MEASURED_ENVELOPE'
            or receipt.get('geometry_checks_pass') is not True
            or receipt.get('measurement_sha256') != hashlib.sha256(raw).hexdigest()
            or receipt.get('source_sha256') != sources):
        raise ValueError('I-PAC validation stale or mismatched; rerun check.py with current measurements')
    records = receipt.get('parts', [])
    if [r.get('name') for r in records] != ['shell', 'cover']:
        raise ValueError('I-PAC validation requires checked shell and cover artifacts')
    artifacts = ARTIFACT_MODULE.Artifacts()
    shell, cover = [artifacts.load(record) for record in records]
    _, _, refs, envelope, dimensions = build(m)
    artifacts.unchanged()
    provenance = dict(units='mm', source_sha256=hashlib.sha256(raw).hexdigest(),
        measurements=m, dimensions=dimensions, physical_fit_verified=False,
        validation_receipt=str(receipt_path),
        validation_sha256=hashlib.sha256(receipt_path.read_bytes()).hexdigest(),
        actual_artifacts=artifacts.files,
        fabrication_release=False, reference_type='measured exclusion boxes; not manufacturer CAD',
        geometry_sources={p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in (HERE/'model.py', HERE/'scene.py')})
    return ([shell, cover, *refs, envelope],
        ['I-PAC shell - provisional undrilled floor', 'I-PAC removable cover',
         *['REFERENCE measured CAPFEET envelope '+str(i+1) for i in range(len(refs))],
         'REFERENCE measured assembly envelope - PCB and feet details pending'],
        ['#d1b394', '#b69a7e', *['#efefdf']*len(refs), '#23774e'],
        [.55, .7, *[1.]*len(refs), .3], provenance)
