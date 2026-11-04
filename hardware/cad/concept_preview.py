"""Display explicitly unvalidated exposed-side-grip studies from pinned exports."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import sys
from pathlib import Path

from build123d import Axis, import_step

HERE = Path(__file__).resolve().parent
CONFIG = HERE / 'build/flared-side-grip/current.json'
SCOPE = 'UNVALIDATED_FLARED_SIDE_GRIP_AND_PANEL_MOUNT_STUDY'


@dataclass(frozen=True)
class DisplayPart:
    name: str
    path: Path
    sha256: str
    color: str
    alpha: float
    rotation_x_degrees: float
    rotation_z_degrees: float
    translation_mm: tuple[float, float, float]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(config_path=CONFIG):
    selection = json.loads(config_path.read_text())
    receipt_path = Path(selection['path'])
    if digest(receipt_path) != selection['sha256']:
        raise ValueError('Changed concept preview selection')
    data = json.loads(receipt_path.read_text())
    if (data['scope'] != SCOPE or data['manufacturing_approved'] is not False
            or data['physical_fit_verified'] is not False
            or data['display_only'] is not True):
        raise ValueError('Expected an explicitly unvalidated display study')
    leo = data.get('leo_box_revision')
    if leo is not None:
        sys.path.insert(0, str(HERE / 'box-mount/access'))
        import leo_box_ledges
        leo_box_ledges.load_review(leo['path'], leo['sha256'], 'disco')
        candidate = json.loads(Path(leo['path']).read_text())
        for role, label in leo['actor_names'].items():
            rows = [row for row in data['parts'] if row['name'] == label]
            records = [row for row in candidate['review_components'] if row['name'] == role]
            if (len(rows) != 1 or len(records) != 1
                    or rows[0]['path'] != records[0]['step']
                    or rows[0]['sha256'] != records[0]['step_sha256']):
                raise ValueError('Disco scene does not match checked Leo box inventory')
        if set(leo['actor_names']) != {'shell', 'bottom'}:
            raise ValueError('Expected both checked Leo box actors')
    parts = []
    for row in data['parts']:
        part = DisplayPart(row['name'], Path(row['path']), row['sha256'], row['color'],
            row['alpha'], row['rotation_x_degrees'], row['rotation_z_degrees'], tuple(row['translation_mm']))
        numbers = (part.alpha, part.rotation_x_degrees, part.rotation_z_degrees, *part.translation_mm)
        if (len(part.translation_mm) != 3 or not all(math.isfinite(v) for v in numbers)
                or not 0 < part.alpha <= 1 or not part.name.startswith(('STUDY ', 'HISTORICAL '))):
            raise ValueError('Invalid concept display parameters or missing status label')
        if digest(part.path) != part.sha256:
            raise ValueError('Changed concept STEP export: ' + part.name)
        shape = import_step(part.path)
        if not shape.is_valid or not shape.solids() or not math.isfinite(shape.volume) or shape.volume <= 0:
            raise ValueError('Invalid display solid: ' + part.name)
        shape = shape.rotate(Axis.X, part.rotation_x_degrees).rotate(Axis.Z, part.rotation_z_degrees)
        parts.append((part, shape.translate(part.translation_mm)))
    if not parts or len({part.name for part, _ in parts}) != len(parts):
        raise ValueError('Empty or duplicate concept display inventory')
    return data, selection, parts


def publish_configured(port=3939, reset=False):
    from ocp_viewer import Camera, show
    data, selection, parts = load()
    target = HERE / 'build/workspace/current-view.json'
    previous = json.loads(target.read_text()) if target.exists() else {}
    reset = reset or previous.get('presentation') != SCOPE or previous.get('selection') != selection
    for part, _ in parts:
        if digest(part.path) != part.sha256:
            raise ValueError('Display artifact changed during preparation')
    import spinner_reference
    objects=[shape for _, shape in parts]
    names=[part.name for part, _ in parts]
    colors=[part.color for part, _ in parts]
    alphas=[part.alpha for part, _ in parts]
    bar=next(part for part, _ in parts if part.name.startswith('STUDY ') and 'integral' in part.name)
    extra, extra_names, extra_colors, extra_alphas, reference=spinner_reference.scene(
        data['study_parameters']['roof_height_above_ground_mm'],bar.translation_mm[0],bar.translation_mm[1])
    objects.extend(extra);names.extend(extra_names);colors.extend(extra_colors);alphas.extend(extra_alphas)
    receipt = json.dumps(dict(workspace='disco-bar', presentation=SCOPE,
        selection=selection, labels=names, spinner_reference=reference,
        leo_box_revision=data.get('leo_box_revision'),
        pending_measurements=data['pending_measurements'], study_parameters=data['study_parameters'],
        actual_artifacts={str(part.path): part.sha256 for part, _ in parts},
        physical_fit_verified=False, manufacturing_approved=False,
        canvas_delivery_verified=False), indent=2) + '\n'
    show(*objects, names=names, colors=colors, alphas=alphas,
        port=port, reset_camera=Camera.RESET if reset else Camera.KEEP,
        ortho=True if reset else None, zoom=.85 if reset else None)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(receipt)
