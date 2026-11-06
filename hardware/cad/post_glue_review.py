"""Publication gate for replacement couplings; rejected collars stay off the desk."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import disco_bar

HERE = Path(__file__).resolve().parent
REFERENCE_CONFIG = HERE/'build/post-glue-review/reference.json'
PUBLICATION_CONFIG = HERE/'build/post-glue-review/publication.json'


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
    if PUBLICATION_CONFIG.exists():
        config = json.loads(PUBLICATION_CONFIG.read_text())
        path = Path(config['selector'])
        if hashlib.sha256(path.read_bytes()).hexdigest() != config['sha256']:
            raise ValueError('Changed three-candidate publication selector')
        return publish_candidates(path, port=port, reset=reset)
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


def publication_data(selector):
    import sys
    sys.path.insert(0,str(HERE/'verification'))
    from publication_bundle import load
    return load(selector)


def configure_publication(selector):
    path=Path(selector).expanduser().resolve()
    publication_data(path)
    PUBLICATION_CONFIG.parent.mkdir(parents=True,exist_ok=True)
    PUBLICATION_CONFIG.write_text(json.dumps(dict(selector=str(path),
        sha256=hashlib.sha256(path.read_bytes()).hexdigest()),indent=2)+'\n')


def publish_candidates(selector,port=3939,reset=False):
    """Render only admitted actual exports, without regeneration or old collar imports."""
    from build123d import Axis
    from ocp_viewer import Camera,show
    candidates=publication_data(selector)
    from geometry_artifacts import Artifacts
    artifacts=Artifacts();shapes=[];names=[];colors=[];alphas=[];groups=[]
    titles={'A':'Three captured screw keyholes','B':'Direct bayonet with one lock screw',
            'C':'Independent removable rotary collar'}
    for index,(concept,admission,report,proof) in enumerate(candidates):
        records=[report['environment']]+report['stages']['locked']['components']
        group=[]
        for number,record in enumerate(records):
            shape=artifacts.load(record)
            shapes.append(shape.rotate(Axis.X,180).rotate(Axis.Z,-90).translate(((index-1)*140,0,0)))
            label=concept+' / '+titles[concept]+' / '+record['name']
            names.append(label);group.append(label)
            role=record['role']
            colors.append('#6699bb' if number==0 else '#f2bb4b' if role=='pad' else '#aaaaaa' if role=='hardware' else
                          {'A':'#e29068','B':'#72bd92','C':'#b294db'}[concept])
            alphas.append(.24 if number==0 else 1.)
        groups.append(dict(concept=concept,title=titles[concept],objects=group,
                           lifecycle_reachable_states=proof.reachable_states))
    artifacts.unchanged()
    show(*shapes,names=names,colors=colors,alphas=alphas,port=port,
         reset_camera=Camera.ISO if reset else Camera.KEEP)
    receipt=dict(workspace='disco-bar',presentation='three-post-glue-review-candidates',
        selector=str(Path(selector).resolve()),selector_sha256=hashlib.sha256(Path(selector).read_bytes()).hexdigest(),
        labels=names,groups=groups,rejected_collar_visible=False,
        physical_fit_verified=False,manufacturing_approved=False,actual_export_files=artifacts.files,
        canvas_delivery_verified=False)
    target=HERE/'build/workspace/current-view.json';target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--configure-reference',type=Path)
    group.add_argument('--configure-publication',type=Path)
    args=parser.parse_args()
    if args.configure_reference:configure_reference(args.configure_reference)
    else:configure_publication(args.configure_publication)
