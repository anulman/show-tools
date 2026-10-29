"""Stage checked local proposal exports for both CAD pages. Never publishes."""
from __future__ import annotations

import argparse
from copy import deepcopy
from dataclasses import dataclass, replace
import hashlib
import importlib
import json
from pathlib import Path
import tempfile

HERE = Path(__file__).resolve().parent
CURRENT = HERE / 'build' / 'final-review' / 'current.json'
integration = importlib.import_module('box-mount.access.integrate_receipt')
REQUIRED_SOURCES = {
    'disco': {'disco-bar/final_c.py', 'disco-bar/couplings.py', 'disco-bar/baseplates_v2.py',
              'disco-bar/baseplates.py', 'disco-bar/full_height.py', 'disco-bar/check_couplings.py',
              'disco_bar.py', 'disco-bar/check_final_c.py'},
    'box': {'box-mount/access/final_base.py', 'box-mount/access/lifted_base.py',
            'box-mount/access/integrate_receipt.py', 'box-mount/access/retention_studies.py',
            'box-mount/access_study.py', 'box_mount.py'},
}


def required_components(kind):
    """Publication inventory belongs to source, never to the supplied receipt."""
    if kind == 'box':
        return {name: 'unselected low-drag material envelope' if name == 'buffer' else 'proposed print geometry'
                for name in ('shell', 'bottom', 'spacer', 'buffer', 'keeper_tab_0', 'keeper_tab_1')}
    require(kind == 'disco', 'Unknown proposal kind')
    roles = {'preset / knob baseplate cup': 'body', 'full-height bar': 'bar',
             'fixed-to-bar latch carrier': 'print', 'quarter-turn retainer': 'print',
             'captive push-turn pin': 'custom fabricated control proposal', 'fastened captive roof': 'print'}
    for sign in (-1, 1):
        for suffix, role in (('retained padded shoe', 'print'), ('cut-stock adhesive-backed pad envelope', 'pad'),
                             ('preset set-screw envelope', 'hardware'), ('captive nut envelope', 'hardware')):
            roles[f'preset / {sign:+d} {suffix}'] = role
        for suffix in ('screw', 'nut'):
            roles[f'captive roof {suffix} {sign}'] = 'standard fastener envelope'
    for angle in (0, 120, 240):
        for suffix in ('bolt', 'nut'):
            roles[f'carrier {suffix} {angle}'] = 'hardware'
    return roles


def validate_inventory(kind, report):
    records = report.get('review_components', [])
    actual = {p['name']: p['role'] for p in records}
    require(len(records) == len(actual) and actual == required_components(kind),
            f'{kind} proposal does not contain the required named components and roles')


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def source_path(name):
    path = Path(name)
    require(not path.is_absolute() and '..' not in path.parts, 'Invalid proposal source path')
    if len(path.parts) > 1:
        candidates = [HERE / path]
    else:
        candidates = [p for p in HERE.rglob(name) if 'build' not in p.relative_to(HERE).parts]
    require(len(candidates) == 1 and candidates[0].is_file(), f'Ambiguous or missing proposal source: {name}')
    return candidates[0]


def recorded_sources(kind, report):
    recorded = report.get('source_code_sha256', report.get('source_sha256'))
    require(isinstance(recorded, dict) and recorded, 'Proposal receipt must identify its source files')
    result = {}
    for name, expected in recorded.items():
        actual = source_path(name)
        require(digest(actual) == expected, f'Export source differs from this checkout: {name}')
        result[str(actual.relative_to(HERE))] = expected
    require(set(result) == REQUIRED_SOURCES[kind], f'{kind} receipt differs from the required source-file manifest')
    return result


@dataclass(frozen=True)
class ReviewPart:
    name: str
    role: str
    shape: object


class Selection:
    def __init__(self, path):
        self.path = Path(path)
        require(self.path.is_file(), 'Prepare the checked final proposal exports before viewing them')
        self.sha256 = digest(self.path)
        self.registry = json.loads(self.path.read_text())
        require(self.registry.get('schema') == 2, 'Unsupported final-review registry')
        require(isinstance(self.registry.get('source_sha256'), dict) and self.registry['source_sha256'],
                'Final-review registry has no source checks')
        self.artifacts = integration.Artifacts()
        self.reports = {}
        self._expected = {}
        self._reference_loaded = False
        for kind in ('disco', 'box'):
            entry = self.registry[kind]
            require(digest(entry['path']) == entry['sha256'], f'Changed {kind} proposal receipt')
            report = json.loads(Path(entry['path']).read_text())
            require(report.get('geometry_review_pass') is True, f'{kind} proposal has not passed geometry review')
            validate_inventory(kind, report)
            self.reports[kind] = report
        for kind, report in self.reports.items():
            for name, expected in recorded_sources(kind, report).items():
                require(self.registry['source_sha256'].get(name) == expected, f'Unchecked proposal source: {name}')
        for name in ('final_review.py', 'workspace.py', 'disco_bar.py', 'box_review.py'):
            require(name in self.registry['source_sha256'], f'Unchecked publication source: {name}')
        require(self.reports['box'].get('producer_receipt_sha256') == self.registry['disco']['sha256'],
                'The box was not checked against the selected disco proposal')
        expected = importlib.import_module('disco_bar').REFERENCE_SHA256
        require(self.reports['disco'].get('reference_sha256') == expected, 'Final proposal uses a different original bar')
        require(self.registry.get('reference', {}).get('sha256') == expected, 'Original bar reference is not pinned')
        self.assert_current()

    def expected_parts(self, kind):
        if kind not in self._expected:
            final_c = importlib.import_module('disco-bar.final_c')
            if kind == 'disco':
                original = importlib.import_module('disco_bar')
                path, reference = original.load_reference(Path(self.registry['reference']['path']))
                original.verify_full_reference(path, reference)
                self._reference_loaded = True
                parts = final_c.build(reference).parts
                expected = {p.name: (p.role, p.shape) for p in parts}
            else:
                # This factory uses only the public numeric control contract;
                # viewing the fixed base never opens the private original STEP.
                base = importlib.import_module('box-mount.access.final_base')
                p = base.cad.StackProposal(spacer_height=final_c.old.GAP_STUDY - 1)
                box = replace(base.cad.box_cad.Proposal(), tray_length=20, tray_y=42)
                probes = [(name, integration.pose(shape.solids()[0], p.bar_mouth_z, 45))
                          for name, shape in final_c.control_sweeps()]
                candidate = base.make_candidate(p, box, probes)
                shapes = {'shell': candidate['study']['shell'], 'bottom': candidate['bottom'],
                          'spacer': candidate['original']['spacer'], 'buffer': candidate['original']['buffer'],
                          **{f'keeper_tab_{i}': shape for i, shape in enumerate(candidate['study']['retainers'])}}
                expected = {name: (required_components(kind)[name], shape) for name, shape in shapes.items()}
            require({name: role for name, (role, _) in expected.items()} == required_components(kind),
                    f'{kind} source model differs from its publication inventory')
            for name, (_, shape) in expected.items():
                require(shape.is_valid and len(shape.solids()) == 1 and shape.volume > 0,
                        f'Invalid source-owned component: {kind}/{name}')
            self._expected[kind] = {name: shape.solids()[0] for name, (_, shape) in expected.items()}
        return self._expected[kind]

    def parts(self, kind):
        # Keep the verified cached solids separate from caller-owned scene shapes.
        expected = self.expected_parts(kind)
        result = []
        for record in self.reports[kind]['review_components']:
            actual = self.artifacts.load(record)
            source = expected[record['name']]
            require(integration.volume(actual-source) < 1e-5 and integration.volume(source-actual) < 1e-5,
                    f'{kind} export differs from source geometry: {record["name"]}')
            result.append(ReviewPart(record['name'], record['role'], deepcopy(actual)))
        return tuple(result)

    def assert_current(self):
        require(digest(self.path) == self.sha256, 'Final-review selection changed during preparation')
        for kind in ('disco', 'box'):
            entry = self.registry[kind]
            require(digest(entry['path']) == entry['sha256'], f'Changed {kind} proposal receipt')
        for name, expected in self.registry['source_sha256'].items():
            require(digest(source_path(name)) == expected, f'Proposal source changed: {name}')
        self.artifacts.unchanged()
        if self._reference_loaded:
            require(digest(self.registry['reference']['path']) == self.registry['reference']['sha256'],
                    'Original bar source changed during preparation')

    def provenance(self):
        return dict(registry_sha256=self.sha256,
                    receipts={kind: entry['sha256'] for kind, entry in self.registry.items() if kind in ('disco', 'box')},
                    source_sha256=self.registry['source_sha256'],
                    physical_fit_verified=False, manufacturing_approved=False)


def load(path=CURRENT):
    return Selection(path)


def stage(disco, box, target=CURRENT, *, reference=None):
    reports = {kind: Path(path).resolve() for kind, path in (('disco', disco), ('box', box))}
    sources = {}
    for kind, path in reports.items():
        report = json.loads(path.read_text())
        validate_inventory(kind, report)
        sources.update(recorded_sources(kind, report))
    require(reference is not None, 'Supply --step to verify C against the original source geometry')
    reference = Path(reference).resolve()
    for name in ('final_review.py', 'workspace.py', 'disco_bar.py', 'box_review.py'):
        path = source_path(name)
        sources[str(path.relative_to(HERE))] = digest(path)
    registry = dict(schema=2, source_sha256=sources,
                    reference=dict(path=str(reference), sha256=digest(reference)),
                    **{kind: dict(path=str(path), sha256=digest(path)) for kind, path in reports.items()})
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, prefix='.review-', suffix='.json', delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(registry, handle, indent=2)
        handle.write('\n')
    try:
        checked = load(temporary)
        for kind in ('disco', 'box'):
            checked.parts(kind)
        checked.assert_current()
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
    return load(target)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--disco-report', type=Path, required=True)
    parser.add_argument('--box-report', type=Path, required=True)
    parser.add_argument('--step', type=Path, required=True)
    parser.add_argument('--registry', type=Path, default=CURRENT)
    args = parser.parse_args()
    selected = stage(args.disco_report, args.box_report, args.registry, reference=args.step)
    print(json.dumps(selected.provenance(), indent=2))


if __name__ == '__main__':
    main()
