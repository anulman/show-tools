"""Publication gate for replacement couplings; rejected collars stay off the desk."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import disco_bar

HERE = Path(__file__).resolve().parent
REFERENCE_CONFIG = HERE/'build/post-glue-review/reference.json'


def reference_path(step):
    """Use an explicitly pinned durable input instead of an expiring mail cache."""
    if not REFERENCE_CONFIG.exists():
        return step
    config = json.loads(REFERENCE_CONFIG.read_text())
    if config.get('schema') != 1 or config.get('sha256') != disco_bar.REFERENCE_SHA256:
        raise ValueError('Unexpected private CAD reference configuration')
    path = Path(config['path'])
    if hashlib.sha256(path.read_bytes()).hexdigest() != disco_bar.REFERENCE_SHA256:
        raise ValueError('Private CAD reference changed')
    return path


def configure_reference(path):
    path = Path(path).expanduser().resolve()
    _, shape = disco_bar.load_reference(path)
    disco_bar.verify_full_reference(path, shape)
    REFERENCE_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    REFERENCE_CONFIG.write_text(json.dumps(dict(schema=1, path=str(path),
                                               sha256=disco_bar.REFERENCE_SHA256), indent=2)+'\n')


def reference_hold(step, port=3939, reset=False):
    """Return only the preserved source while replacement mechanisms are checked."""
    from build123d import Axis
    path, shape = disco_bar.load_reference(reference_path(step))
    disco_bar.verify_full_reference(path, shape)
    return path, shape.rotate(Axis.X, 180).rotate(Axis.Z, -90)


def publish_reference_hold(step, port=3939, reset=False):
    from ocp_viewer import Camera, show
    path, shape = reference_hold(step, port, reset)
    labels = ['ORIGINAL DARREN BAR / reference only; rejected collars withdrawn']
    show(shape, names=labels, colors=['#367fd4'], alphas=[.4], port=port,
         reset_camera=Camera.ISO if reset else Camera.KEEP)
    receipt = dict(workspace='disco-bar', presentation='post-glue-prototypes-pending',
                   labels=labels, physical_fit_verified=False, manufacturing_approved=False,
                   rejected_collar_visible=False,
                   reference_asset_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                   source_sha256={p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                                  for p in (Path(__file__), HERE/'workspace.py', HERE/'disco_bar.py')})
    target = HERE/'build/workspace/current-view.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--configure-reference', type=Path, required=True)
    configure_reference(parser.parse_args().configure_reference)

