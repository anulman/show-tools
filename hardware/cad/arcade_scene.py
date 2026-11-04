"""Load the selected arcade print pair and unchanged visual button reference."""
import hashlib
import json
from pathlib import Path
import sys

from build123d import Axis, import_step

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'verification'))
from geometry_artifacts import Artifacts

CONFIG = HERE / 'build/arcade-simple/current.json'
LEO_CONFIG = HERE / 'build/arcade-leo/current.json'


def load(config_path=CONFIG, explode=0):
    use_leo = config_path == CONFIG and (LEO_CONFIG.exists() or LEO_CONFIG.is_symlink())
    if use_leo and not LEO_CONFIG.is_file():
        raise ValueError('Leo arcade selector must be a readable regular file')
    selection = json.loads((LEO_CONFIG if use_leo else config_path).read_text())
    receipt_path = Path(selection['path'])
    if hashlib.sha256(receipt_path.read_bytes()).hexdigest() != selection['sha256']:
        raise ValueError('Changed arcade selection')
    artifacts = Artifacts()
    leo = None
    if use_leo:
        sys.path.insert(0, str(HERE / 'box-mount/access'))
        import leo_box_ledges
        parts, leo = leo_box_ledges.load_review(receipt_path, selection['sha256'], 'arcade')
        shapes = [parts['shell'], parts['bottom']]
        artifacts.files.update(leo['validated_artifact_files'])
    else:
        receipt = json.loads(receipt_path.read_text())
        records = receipt['review_components']
        if (receipt.get('scope') != 'TWO_PART_ARCADE_BUTTON_BOX_WITHOUT_BALLAST'
                or receipt['geometry_checks_pass'] is not True
                or [r['name'] for r in records] != ['shell', 'bottom']):
            raise ValueError('Expected the checked arcade shell and bottom')
        shapes = [artifacts.load(r).translate(tuple(-v for v in r['source_to_print_translation_mm']))
                  for r in records]
    ground = min(s.bounding_box().min.Z for s in shapes)
    objects = [s.translate((0, 0, -ground - (explode if i == 1 else 0)))
               for i, s in enumerate(shapes)]
    source_dir = HERE / 'components/adafruit-1185'
    source = json.loads((source_dir / 'source.json').read_text())
    button_path = source_dir / 'button.step'
    button_sha = hashlib.sha256(button_path.read_bytes()).hexdigest()
    if button_sha != source['sha256']:
        raise ValueError('Changed upstream button reference')
    # Preserve the approved mount-frame pose; this upstream reference has an invalid solid.
    button = import_step(button_path).rotate(Axis.X, 5).translate((0, 0, -ground))
    if len(button.solids()) != 5:
        raise ValueError('Unexpected upstream button inventory')
    objects.append(button)
    artifacts.unchanged()
    provenance = dict(selection=selection, actual_artifacts=artifacts.files,
        common_ground_translation_mm=-ground,
        button_reference=dict(path=str(button_path), sha256=button_sha,
            upstream_valid=bool(button.is_valid), fabrication_geometry=False,
            physical_fit_verified=False, rotation_x_degrees=5))
    if leo is not None:
        provenance['leo_ledge_revision'] = leo
    return (objects, ['Arcade button box - shell', 'Arcade button box - removable bottom',
                     'REFERENCE button - upstream invalid; fit unverified'],
            ['#d1b394', '#b69a7e', '#367fd4'], [.55, 1., 1.], provenance)
