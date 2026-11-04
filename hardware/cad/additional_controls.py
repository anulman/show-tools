"""Load the two specialist enclosure scenes without giving workers viewer access."""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCENES = ('mushroom-mount', 'micro-enclosure')


def module_for(name):
    if name not in SCENES:
        raise ValueError('Unknown specialist enclosure')
    source = HERE / name / 'scene.py'
    spec = importlib.util.spec_from_file_location(name.replace('-', '_') + '_scene', source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def missing_measurements(name):
    module = module_for(name)
    return module.missing_measurements() if hasattr(module, "missing_measurements") else []


def load(name):
    module = module_for(name)
    objects, labels, colors, alphas, provenance = module.load()
    if not objects or not len(objects) == len(labels) == len(colors) == len(alphas):
        raise ValueError('Specialist scene must have matching objects and display metadata')
    return objects, labels, colors, alphas, provenance


def publish(name, port=3939, reset=False):
    missing = missing_measurements(name)
    if missing:
        print(json.dumps(dict(missing_measurements=missing)))
        raise SystemExit(78)
    from ocp_viewer import Camera, show
    objects, labels, colors, alphas, provenance = load(name)
    target = HERE / 'build/workspace/current-view.json'
    previous = json.loads(target.read_text()) if target.exists() else {}
    reset = reset or previous.get('workspace') != name
    receipt = dict(workspace=name, presentation=name + '-v1', labels=labels,
                   provenance=provenance, canvas_delivery_verified=False)
    show(*objects, names=labels, colors=colors, alphas=alphas, port=port,
         reset_camera=Camera.RESET if reset else Camera.KEEP,
         ortho=True if reset else None, zoom=.85 if reset else None,
         axes=True, grid=(True, False, False))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(receipt, indent=2) + '\n')
