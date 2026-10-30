"""Display reviewed exports as candidates or comparisons without deleting prior data."""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path

import box_mount
import final_review

HERE = Path(__file__).resolve().parent
CURRENT = HERE / 'build' / 'comparison-review' / 'current.json'
# These exact frozen receipts are selected by the independent prototype reviews.
# Their pending physical-fit flags remain false; this permits human review only.
PINS = {
    'collar': '83886c072ce113015196fd621a74c663830b305d3989904e0873e9158d08251d',
    'rotor': '0b482042d1f6fc1c64524180bd2d0d7e157311ac33ce2cb72bec7d6ed86ee865',
    'arcade': 'fa2a4758e78568e396055f652add4088708fa2a2cea6d8da5aa298ae878745bb',
}


class Comparison:
    def __init__(self, path=CURRENT):
        self.path = Path(path)
        data = self.path.read_bytes()
        self.sha256 = hashlib.sha256(data).hexdigest()
        self.registry = json.loads(data)
        final_review.require(self.registry.get('schema') == 1, 'Unknown comparison registry')
        self.presentation = self.registry.get('presentation', 'comparison')
        final_review.require(self.presentation in ('comparison', 'candidates'), 'Unknown review presentation')
        entries = self.registry['receipts']
        final_review.require(set(entries) == set(PINS), 'Incomplete comparison selection')
        self.files = {str(self.path): self.sha256}
        self.artifacts = final_review.integration.Artifacts()
        self.reports = {}
        self.parts = {}
        for kind, expected in PINS.items():
            source = Path(entries[kind])
            raw = source.read_bytes()
            final_review.require(hashlib.sha256(raw).hexdigest() == expected,
                                 'Not the independently reviewed comparison receipt: ' + kind)
            self.files[str(source)] = expected
            report = json.loads(raw)
            self.reports[kind] = report
            records = report['review_components']
            final_review.require(len(records) == {'collar': 25, 'rotor': 9, 'arcade': 4}[kind],
                                 'Comparison inventory changed')
            # The pinned receipt fixes all component names, roles, transforms and hashes.
            self.parts[kind] = [(r['name'], r['role'], self.artifacts.load(r)) for r in records
                                if r['name'] != 'developed-flat-PTFE']
            for name, sha in report.get('validated_input_files', {}).items():
                self.files[name] = sha
            if kind != 'collar':
                for name, sha in report['source_code_sha256'].items():
                    self.files[str(final_review.source_path(name))] = sha
        final_review.require(self.reports['collar']['geometry_review_pass'] is True,
                             'Collar geometry checks missing')
        final_review.require(self.reports['rotor']['geometry_checks_pass'] is True,
                             'Base geometry checks missing')
        final_review.require(self.reports['arcade']['independent_base_geometry_checks_pass'] is True,
                             'Arcade geometry checks missing')
        final_review.require(self.reports['rotor']['input_receipts']['collar']['sha256'] == PINS['collar'],
                             'The base was checked against a different collar')
        final_review.integration.source_revision(
            HERE.parents[1], self.reports['collar']['source_commit'],
            self.reports['collar']['source_code_sha256'])
        self.assert_current()

    def assert_current(self):
        for path, expected in self.files.items():
            final_review.require(final_review.digest(path) == expected, 'Comparison input changed: ' + path)
        self.artifacts.unchanged()

    def provenance(self):
        return dict(registry_sha256=self.sha256, receipts=PINS,
                    presentation=self.presentation,
                    physical_fit_verified=False, manufacturing_approved=False)

    def candidates(self, workspace, *, variant='all', explode=0):
        """Build selected assemblies only; historical comparisons remain on disk."""
        import math
        from build123d import Axis, import_step
        final_review.require(math.isfinite(explode) and explode >= 0, 'Invalid explode distance')
        scene = ([], [], [], [])

        def base_at(x, z=0, lower_bottom=0):
            for name, role, shape in self.parts['rotor']:
                self.append(scene, shape, 'SPINNER BASE CANDIDATE / ' + name,
                            '#48acaa' if name == 'shell' else '#e6a238' if name == 'buffer' else '#80c8bd',
                            .6 if name == 'shell' else 1.,
                            (x, 0, z-(lower_bottom if name == 'bottom' else 0)))

        if workspace == 'disco-bar':
            # Show the installed orientation and the actual checked companion base.
            base_at(0)
            layout = self.reports['rotor']['proposed_layout']
            final_review.require(layout['source_to_box_rotation_x_degrees'] == 180,
                                 'Unsupported installed bar orientation')
            for name, role, shape in self.parts['collar']:
                placed = final_review.integration.pose(
                    shape, layout['gap_mm'], layout['service_index_degrees'])
                color = '#e6a238' if role == 'pad' else '#8b65c1' if role == 'bar' else '#39bca7'
                self.append(scene, placed, 'BAR / BASEPLATE CANDIDATE / ' + name,
                            color, .18 if role == 'bar' else .35 if role == 'body' else 1., (0, 0, 0))
        else:
            final_review.require(workspace == 'box-mount', 'Unknown candidate workspace')
            final_review.require(variant in ('all', 'arcade-inclined', 'rotor-level'),
                                 'No complete publication candidate for this box variant')
            if variant in ('all', 'arcade-inclined'):
                x = -80 if variant == 'all' else 0
                for name, role, shape in self.parts['arcade']:
                    self.append(scene, shape, 'ARCADE CANDIDATE, DUAL EXITS / ' + name,
                                '#48acaa' if name == 'shell' else '#80c8bd',
                                .6 if name == 'shell' else 1., (x, 0, -explode if name == 'bottom' else 0))
                folder = HERE / 'components' / 'adafruit-1185'
                provenance = folder / 'source.json'
                reference = folder / 'button.step'
                self.files[str(provenance)] = final_review.digest(provenance)
                self.files[str(reference)] = json.loads(provenance.read_text())['sha256']
                self.assert_current()
                # This upstream reference contains invalid bodies and is never a print target.
                scene[0].append(import_step(reference).rotate(Axis.X, box_mount.Proposal().tilt).translate((x, 0, 0)))
                scene[1].append('ARCADE / button REFERENCE, not a print target')
                scene[2].append('#367fd4'); scene[3].append(1.)
            if variant in ('all', 'rotor-level'):
                base_at(80 if variant == 'all' else 0, box_mount.Proposal().level_top_z, explode)
        self.assert_current()
        return scene

    @staticmethod
    def append(scene, shape, name, color, alpha, offset):
        # Place actual sole solids, never imported assembly wrappers.
        source = shape.solids()[0]
        placed = deepcopy(source).translate(offset)
        inverse = placed.translate(tuple(-value for value in offset))
        final_review.require(final_review.integration.volume(inverse-source) < 1e-5
                             and final_review.integration.volume(source-inverse) < 1e-5,
                             'Comparison placement changed material: ' + name)
        scene[0].append(placed); scene[1].append(name)
        scene[2].append(color); scene[3].append(alpha)

    def extend(self, workspace, scene, *, variant='all', explode=0):
        result = tuple(list(items) for items in scene)
        if workspace == 'disco-bar':
            result[1][:] = [name if index == 0 else 'OLD C / ' + name
                            for index, name in enumerate(result[1])]
            for name, role, shape in self.parts['collar']:
                color = '#e6a238' if role == 'pad' else '#8b65c1' if role == 'bar' else '#39bca7'
                alpha = .18 if role == 'bar' else .35 if role == 'body' else 1.
                self.append(result, shape, 'NEW C2, FIT PENDING / ' + name, color, alpha, (260, 0, 0))
        else:
            all_variants = variant == 'all'
            # Keep each old/new pair together. The unmodified mushroom blank stays last.
            for index, (shape, name) in enumerate(zip(scene[0], scene[1])):
                dx = (-160 if name.startswith('arcade-inclined') else
                      160 if name.startswith('mushroom-level') else 0) if all_variants else -80
                if variant == 'mushroom-level': dx = 0
                result[0][index] = shape.translate((dx, 0, 0))
                result[1][index] = ('UNCHANGED / ' if name.startswith('mushroom-level') else 'OLD / ') + name
            for kind, label, x, z in (
                ('arcade', 'arcade-inclined', -160 if all_variants else 80, 0),
                ('rotor', 'rotor-level', 160 if all_variants else 80, box_mount.Proposal().level_top_z),
            ):
                if variant not in ('all', label): continue
                for name, role, shape in self.parts[kind]:
                    bottom = name == 'bottom'
                    note = ', DUAL EXITS' if kind == 'arcade' else ''
                    self.append(result, shape, f'NEW {label}{note}, FIT PENDING / {name}',
                                '#48acaa' if name == 'shell' else '#e6a238' if name == 'buffer' else '#80c8bd',
                                .65 if name == 'shell' else 1., (x, 0, z-(explode if bottom else 0)))
                if kind == 'arcade':
                    for shape, name, color, alpha in zip(*scene):
                        if 'button REFERENCE' in name:
                            old_x = -160 if all_variants else 0
                            result[0].append(shape.translate((x-old_x, 0, 0)))
                            result[1].append('NEW arcade-inclined / button REFERENCE, fit pending')
                            result[2].append(color); result[3].append(alpha)
        self.assert_current()
        return result


def load_optional():
    return Comparison() if CURRENT.exists() else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for kind in PINS: parser.add_argument('--' + kind, type=Path, required=True)
    parser.add_argument('--presentation', choices=('comparison', 'candidates'), default='comparison')
    args = parser.parse_args()
    CURRENT.parent.mkdir(parents=True, exist_ok=True)
    temporary = CURRENT.with_suffix('.pending.json')
    temporary.write_text(json.dumps(dict(schema=1, presentation=args.presentation, receipts={
        kind: str(getattr(args, kind).resolve()) for kind in PINS}), indent=2)+'\n')
    try:
        selection = Comparison(temporary)
        selection.assert_current()
        temporary.replace(CURRENT)
    finally:
        temporary.unlink(missing_ok=True)
    print(CURRENT)


if __name__ == '__main__': main()
