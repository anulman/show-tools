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
    'collar': 'cc535b9d49cdf9c12834ba56efc93d31fb30e1888712d9fbfd50c859f2b75b02',
    'rotor': '29b85bff87c061eba9569b15b297d6f2109babcf30c14b96ff5576974282801b',
    'arcade': 'fa2a4758e78568e396055f652add4088708fa2a2cea6d8da5aa298ae878745bb',
}


HISTORICAL_COLLAR_PIN = '83886c072ce113015196fd621a74c663830b305d3989904e0873e9158d08251d'
COLLAR_SOURCE_COMMIT = 'daf7b6d1f349ce1ac5c241c5b954911fa2c74bcf'
COLLAR_SOURCES = {'debond_collar.py', 'standard_collar.py', 'debond_checks.py', 'couplings.py',
                  'baseplates_v2.py', 'baseplates.py', 'full_height.py', 'check_couplings.py',
                  'disco_bar.py', 'check_debond_collar.py'}
COLLAR_STATES = {'locked', 'screw-clear', 'screw-captive-stop', 'collar-midway', 'released', 'detached'}
COLLAR_TOOLS = {'2.5 mm lock key operating envelope', '2.5 mm lock key full axial staging',
                '4 mm collar key operating quarter arc', '4 mm collar key full axial staging'}


def verify_compatibility(reports):
    """Bind the new collar's proof to the unchanged base and its historical input."""
    collar, base = reports['collar'], reports['rotor']
    require = final_review.require
    require(collar.get('schema_version') == 1
            and collar.get('concept') == 'debond-preserving standard-hardware collar C2',
            'Unsupported collar proof schema')
    require(collar.get('source_commit') == COLLAR_SOURCE_COMMIT
            and set(collar.get('source_code_sha256', {})) == COLLAR_SOURCES,
            'Incomplete or different collar producer revision')
    require(collar.get('installed_fit_verified') is False
            and collar.get('physical_strength_verified') is False,
            'Candidate must retain its unverified physical limits')
    historical = base.get('input_receipts', {}).get('collar', {}).get('sha256')
    require(historical == HISTORICAL_COLLAR_PIN, 'Compact base historical collar pin changed')
    proof = collar.get('debond_checks')
    require(isinstance(proof, dict), 'Collar compatibility proof missing')
    require(proof.get('baseline_receipt_sha256') == historical,
            'Collar compatibility proof uses another historical baseline')
    require(proof.get('compact_receipt_sha256') == PINS['rotor'],
            'Collar compatibility proof uses another compact base')
    require(collar.get('checked_compact_root_heights_mm') == [5, 7],
            'Collar compatibility proof omits a supported root height')
    for name in ('original_voids_clear_all_six_states', 'actual_purchased_hardware_uncut',
                 'blocked_channel_and_bottom_entry_controls_rejected', 'producer_narrowed_baseline_rejected',
                 'channel_native_IsDone_and_validity_required', 'disconnected_actor_both_orders_rejected',
                 'unchanged_components_and_tools_preserved'):
        require(proof.get(name) is True, 'Collar checked proof missing: ' + name)
    require(proof.get('channel_fuzzy_tolerance_mm') == 0,
            'Collar proof changed its exact Boolean configuration')
    entries = proof.get('connected_bottom_entry_cup_absent', {})
    require(set(entries) == {'locked', 'released'}, 'Connected bottom-entry proof missing')
    for state, channels in entries.items():
        require(set(channels) == {'+', '-'}
                and all(isinstance(record.get('connected_routes'), list) and record['connected_routes']
                        for record in channels.values()),
                'Incomplete connected bottom-entry proof: ' + state)
    configurations = proof.get('compact_base', {})
    require(set(configurations) == {'5', '7'}, 'Incomplete compact compatibility proof')
    for height, count in (('5', 41), ('7', 42)):
        checked = configurations[height]
        require(checked.get('actual_fixed_solids') == count,
                'Compact compatibility proof has another fixed assembly')
        for name in ('all_six_states_clear', 'whole_tools_clear', 'rotation_invariant_bounds_pass',
                     'continuous_positive_Z_withdrawal_clear', 'actual_bearing_material_unchanged'):
            require(checked.get(name) is True, 'Compact compatibility proof missing: ' + height + '/' + name)
    return dict(collar_receipt_sha256=PINS['collar'], compact_receipt_sha256=PINS['rotor'],
                historical_collar_receipt_sha256=historical, checked_root_heights_mm=[5, 7])


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
            final_review.require(len(records) == {'collar': 25, 'rotor': 8, 'arcade': 4}[kind],
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
        self.compatibility = verify_compatibility(self.reports)
        collar = self.reports['collar']
        names = {record['name'] for record in collar['review_components']}
        states = collar.get('states_components', {})
        final_review.require(set(states) == COLLAR_STATES, 'Incomplete checked collar state inventory')
        for state, records in states.items():
            final_review.require(len(records) == 25 and {r['name'] for r in records} == names,
                                 'Incomplete checked collar state: ' + state)
            self.record_artifact_hashes(records)
        tools = collar.get('control_sweeps', [])
        final_review.require(len(tools) == 4 and {r['name'] for r in tools} == COLLAR_TOOLS,
                             'Incomplete checked collar tool inventory')
        self.record_artifact_hashes(tools)
        final_review.integration.source_revision(
            HERE.parents[1], self.reports['collar']['source_commit'],
            self.reports['collar']['source_code_sha256'])
        self.assert_current()

    def record_artifact_hashes(self, records):
        # These paired exports were validated by the pinned producer. Keep every
        # state/tool byte bound to that proof even when it is not displayed.
        for record in records:
            for kind in ('step', 'stl'):
                path, expected = record[kind], record[kind + '_sha256']
                final_review.require(final_review.digest(path) == expected,
                                     'Checked collar artifact changed: ' + record['name'])
                self.files[str(path)] = expected

    def assert_current(self):
        for path, expected in self.files.items():
            final_review.require(final_review.digest(path) == expected, 'Comparison input changed: ' + path)
        self.artifacts.unchanged()

    def provenance(self):
        return dict(registry_sha256=self.sha256, receipts=PINS,
                    presentation=self.presentation, compatibility=self.compatibility,
                    physical_fit_verified=False, manufacturing_approved=False)

    def candidates(self, workspace, *, variant='all', explode=0, step_path=None):
        """Build the selected box assemblies or original/C2 bar comparison."""
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
            import disco_bar
            reference_path, reference = disco_bar.load_reference(step_path)
            disco_bar.verify_full_reference(reference_path, reference)
            final_review.require(disco_bar.REFERENCE_SHA256 == self.reports['collar']['reference_sha256'],
                                 'C2 was checked against another original bar')
            self.files[str(reference_path)] = disco_bar.REFERENCE_SHA256
            layout = self.reports['rotor']['C2_source_to_box']
            final_review.require(layout['rotation_x_degrees'] == 180,
                                 'Unsupported installed bar orientation')
            # Both bars stand upright on the same mouth plane, without a box.
            original = final_review.integration.pose(reference.solids()[0], 0, layout['rotation_z_degrees'])
            self.append(scene, original, 'ORIGINAL DARREN BAR / full-height reference',
                        '#367fd4', .35, (-80, 0, 0))
            for name, role, shape in self.parts['collar']:
                placed = final_review.integration.pose(
                    shape, 0, layout['rotation_z_degrees'])
                color = '#e6a238' if role == 'pad' else '#8b65c1' if role == 'bar' else '#39bca7'
                self.append(scene, placed, 'C2 BAR / BASEPLATE CANDIDATE / ' + name,
                            color, .18 if role == 'bar' else .35 if role == 'body' else 1., (80, 0, 0))
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
        if CURRENT.exists():
            previous = CURRENT.read_bytes()
            history = CURRENT.parent / 'prior-selections'
            history.mkdir(exist_ok=True)
            saved = history / (hashlib.sha256(previous).hexdigest()+'.json')
            if saved.exists():
                final_review.require(saved.read_bytes() == previous, 'Prior selection archive differs')
            else:
                saved.write_bytes(previous)
            final_review.require(CURRENT.read_bytes() == previous, 'Selection changed while staging')
        temporary.replace(CURRENT)
    finally:
        temporary.unlink(missing_ok=True)
    print(CURRENT)


if __name__ == '__main__': main()
