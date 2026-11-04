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
        raise ValueError('I-PAC fit blocked: supply measured PCB, installed height and four CAPFEET envelopes in micro-enclosure/measurements.json; see README.md')
    raw = path.read_bytes()
    m = json.loads(raw)
    if m.get('synthetic_fixture') is not False:
        raise ValueError('Actual scene requires measurements, not a synthetic fixture')
    shell, cover, refs, envelope, dimensions = build(m)
    provenance = dict(units='mm', source_sha256=hashlib.sha256(raw).hexdigest(),
        measurements=m, dimensions=dimensions, physical_fit_verified=False,
        fabrication_release=False, reference_type='measured exclusion boxes; not manufacturer CAD',
        geometry_sources={p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in (HERE/'model.py', HERE/'scene.py')})
    return ([shell, cover, *refs, envelope],
        ['I-PAC shell - provisional undrilled floor', 'I-PAC removable cover',
         *['REFERENCE measured CAPFEET envelope '+str(i+1) for i in range(len(refs))],
         'REFERENCE measured assembly envelope - PCB and feet details pending'],
        ['#d1b394', '#b69a7e', *['#efefdf']*len(refs), '#23774e'],
        [.55, .7, *[1.]*len(refs), .3], provenance)
