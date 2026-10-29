"""Stage checked local proposal exports for both CAD pages. Never publishes."""
from __future__ import annotations

import argparse
from copy import deepcopy
from dataclasses import dataclass
import hashlib
import importlib
import json
from pathlib import Path
import tempfile

HERE = Path(__file__).resolve().parent
CURRENT = HERE / 'build' / 'final-review' / 'current.json'
integration = importlib.import_module('box-mount.access.integrate_receipt')


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


def recorded_sources(report):
    recorded = report.get('source_code_sha256', report.get('source_sha256'))
    require(isinstance(recorded, dict) and recorded, 'Proposal receipt must identify its source files')
    result = {}
    for name, expected in recorded.items():
        actual = source_path(name)
        require(digest(actual) == expected, f'Export source differs from this checkout: {name}')
        result[str(actual.relative_to(HERE))] = expected
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
        require(self.registry.get('schema') == 1, 'Unsupported final-review registry')
        require(isinstance(self.registry.get('source_sha256'), dict) and self.registry['source_sha256'],
                'Final-review registry has no source checks')
        self.artifacts = integration.Artifacts()
        self.reports = {}
        for kind in ('disco', 'box'):
            entry = self.registry[kind]
            require(digest(entry['path']) == entry['sha256'], f'Changed {kind} proposal receipt')
            report = json.loads(Path(entry['path']).read_text())
            require(report.get('geometry_review_pass') is True, f'{kind} proposal has not passed geometry review')
            records = report.get('review_components', [])
            require(records and len({p['name'] for p in records}) == len(records), f'Missing or duplicate {kind} review pieces')
            self.reports[kind] = report
        for report in self.reports.values():
            for name, expected in recorded_sources(report).items():
                require(self.registry['source_sha256'].get(name) == expected, f'Unchecked proposal source: {name}')
        for name in ('final_review.py', 'workspace.py', 'disco_bar.py', 'box_review.py'):
            require(name in self.registry['source_sha256'], f'Unchecked publication source: {name}')
        require(self.reports['box'].get('producer_receipt_sha256') == self.registry['disco']['sha256'],
                'The box was not checked against the selected disco proposal')
        expected = importlib.import_module('disco_bar').REFERENCE_SHA256
        require(self.reports['disco'].get('reference_sha256') == expected, 'Final proposal uses a different original bar')
        self.assert_current()

    def parts(self, kind):
        # Keep the verified cached solids separate from caller-owned scene shapes.
        return tuple(ReviewPart(record['name'], record['role'], deepcopy(self.artifacts.load(record)))
                     for record in self.reports[kind]['review_components'])

    def assert_current(self):
        require(digest(self.path) == self.sha256, 'Final-review selection changed during preparation')
        for kind in ('disco', 'box'):
            entry = self.registry[kind]
            require(digest(entry['path']) == entry['sha256'], f'Changed {kind} proposal receipt')
        for name, expected in self.registry['source_sha256'].items():
            require(digest(source_path(name)) == expected, f'Proposal source changed: {name}')
        self.artifacts.unchanged()

    def provenance(self):
        return dict(registry_sha256=self.sha256,
                    receipts={kind: entry['sha256'] for kind, entry in self.registry.items() if kind in ('disco', 'box')},
                    source_sha256=self.registry['source_sha256'],
                    physical_fit_verified=False, manufacturing_approved=False)


def load(path=CURRENT):
    return Selection(path)


def stage(disco, box, target=CURRENT):
    reports = {kind: Path(path).resolve() for kind, path in (('disco', disco), ('box', box))}
    sources = {}
    for path in reports.values():
        report = json.loads(path.read_text())
        sources.update(recorded_sources(report))
    for name in ('final_review.py', 'workspace.py', 'disco_bar.py', 'box_review.py'):
        path = source_path(name)
        sources[str(path.relative_to(HERE))] = digest(path)
    registry = dict(schema=1, source_sha256=sources,
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
    parser.add_argument('--registry', type=Path, default=CURRENT)
    args = parser.parse_args()
    selected = stage(args.disco_report, args.box_report, args.registry)
    print(json.dumps(selected.provenance(), indent=2))


if __name__ == '__main__':
    main()
