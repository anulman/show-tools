"""Publish one selected CAD workstream to the existing shared viewer."""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path

CAD_DIR = Path(__file__).parent


def publish_simple_arcade(config_path, port, reset, explode):
    """Publish the selected arcade print pair with its visual button reference."""
    import arcade_scene
    from ocp_viewer import Camera, show
    objects, labels, colors, alphas, provenance = arcade_scene.load(config_path, explode)
    target = CAD_DIR / 'build/workspace/current-view.json'
    previous = json.loads(target.read_text()) if target.exists() else {}
    reset = reset or previous.get('presentation') != 'simple-arcade-box'
    receipt = json.dumps(dict(workspace='box-mount', presentation='simple-arcade-box',
        labels=labels, provenance=provenance, canvas_delivery_verified=False), indent=2) + '\n'
    show(*objects, names=labels, colors=colors, alphas=alphas,
         port=port, reset_camera=Camera.RESET if reset else Camera.KEEP,
         ortho=True if reset else None, zoom=.85 if reset else None)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(receipt)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", choices=("box-mount", "disco-bar", "mushroom-mount", "micro-enclosure", "all-controls"))
    parser.add_argument("--variant", choices=("all", "arcade-inclined", "rotor-level", "mushroom-level"), default="all", help="Box-mount variants to show")
    parser.add_argument("--step", type=Path, help="Local Darren STEP path, for disco-ball scenes")
    parser.add_argument("--explode", type=float, default=0, help="Lower box-mount bottoms for inspection, in mm")
    parser.add_argument("--reset-camera", action="store_true")
    parser.add_argument("--port", type=int, default=3939)
    args = parser.parse_args()
    if args.step is not None and args.workspace not in ("disco-bar", "all-controls"):
        parser.error("--step applies only to disco-bar and all-controls")
    if args.explode != 0 and args.workspace != "box-mount":
        parser.error("--explode applies only to box-mount")
    if args.variant != "all" and args.workspace != "box-mount":
        parser.error("--variant applies only to box-mount")
    if args.workspace in ('mushroom-mount', 'micro-enclosure'):
        import additional_controls
        additional_controls.publish(args.workspace, args.port, args.reset_camera)
        return
    if args.workspace == 'all-controls':
        args.step = args.step or (Path(os.environ['SHOW_TOOLS_DISCO_STEP'])
                                 if os.environ.get('SHOW_TOOLS_DISCO_STEP') else None)
        if args.step is None:
            parser.error('all-controls requires --step or SHOW_TOOLS_DISCO_STEP')
        import all_controls
        all_controls.publish(args.step, args.port, args.reset_camera)
        return
    import concept_preview
    if args.workspace == 'disco-bar' and concept_preview.CONFIG.is_file():
        concept_preview.publish_configured(args.port, args.reset_camera)
        return
    simple_arcade = CAD_DIR / 'build/arcade-simple/current.json'
    if args.workspace == 'box-mount' and args.variant in ('all', 'arcade-inclined') and simple_arcade.is_file():
        publish_simple_arcade(simple_arcade, args.port, args.reset_camera, args.explode)
        return
    import air_gap_disco
    if args.workspace == 'disco-bar' and air_gap_disco.CONFIG.is_file():
        air_gap_disco.publish_configured(args.port, args.reset_camera)
        return
    import clean_disco
    if args.workspace == 'disco-bar' and clean_disco.CONFIG.is_file():
        clean_disco.publish_configured(args.port, args.reset_camera)
        return
    import print_handoff
    if print_handoff.CONFIG.is_file() and args.variant == 'all' and args.explode == 0:
        print_handoff.publish_configured(args.port, args.reset_camera,
                                         boxes_only=args.workspace == 'box-mount')
        return
    if args.workspace == 'disco-bar':
        import post_glue_review
        post_glue_review.publish_reference_hold(args.step, args.port, args.reset_camera)
        return
    comparison = importlib.import_module('comparison_review').load_optional()
    candidate_only = comparison is not None and comparison.presentation == 'candidates'
    module = importlib.import_module('comparison_review' if candidate_only else
                                    'disco_review' if args.workspace == 'disco-bar' else 'box_review')
    try:
        selection = (importlib.import_module('final_review').load()
                     if not candidate_only and
                     (args.workspace == 'disco-bar' or args.variant in ('all', 'rotor-level')) else None)
        if candidate_only:
            objects, names, colors, alphas = comparison.candidates(
                args.workspace, variant=args.variant, explode=args.explode, step_path=args.step)
        else:
            objects, names, colors, alphas = (
                module.preview(step_path=args.step, selection=selection) if args.workspace == "disco-bar"
                else module.preview(explode=args.explode, variant=args.variant, selection=selection)
            )
    except (ValueError, FileNotFoundError) as error:
        parser.error(str(error))
    if not objects or not len(objects) == len(names) == len(colors) == len(alphas):
        raise RuntimeError("Preview objects and labels must have matching nonzero lengths")
    if not candidate_only and args.workspace == "disco-bar":
        reference_path, _ = module.load_reference(args.step)
        module.verify_preview_scene(reference_path, (objects, names, colors, alphas), selection=selection)
    elif not candidate_only:
        module.verify_preview_scene((objects, names, colors, alphas), explode=args.explode, variant=args.variant, selection=selection)
    if comparison is not None and not candidate_only:
        objects, names, colors, alphas = comparison.extend(
            args.workspace, (objects, names, colors, alphas), variant=args.variant, explode=args.explode)
    if selection is not None:
        selection.assert_current()
    if comparison is not None:
        comparison.assert_current()
    output = CAD_DIR / "build" / "workspace"
    output.mkdir(parents=True, exist_ok=True)
    last_path = output / "current-view.json"
    previous = json.loads(last_path.read_text()) if last_path.exists() else {}
    reset = (args.reset_camera or previous.get("workspace") != args.workspace
             or previous.get('presentation') != ('candidates' if candidate_only else 'comparison')
             or (args.workspace == "box-mount" and previous.get("variant") != args.variant))
    from ocp_viewer import Camera, show
    show(*objects, names=names, colors=colors, alphas=alphas,
         port=args.port, reset_camera=Camera.ISO if reset else Camera.KEEP,
         zoom=1 if reset else None,
         axes=True, grid=(True, False, False))
    sources = [Path(module.__file__), Path(__file__)]
    if args.workspace == "disco-bar":
        sources.append(CAD_DIR / "disco_bar.py")
        sources.append(CAD_DIR / "disco-bar" / "full_height.py")
        sources.append(CAD_DIR / "disco-bar" / "latches.py")
    else:
        sources.append(CAD_DIR / 'box_mount.py')
    sources.append(CAD_DIR / 'final_review.py')
    receipt = dict(workspace=args.workspace, labels=names, units="mm", port=args.port,
                   presentation='candidates' if candidate_only else 'comparison',
                   camera="iso" if reset else "keep", explode_mm=args.explode, physical_fit_verified=False,
                   source_sha256={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sources})
    if selection is not None:
        receipt['checked_final_review'] = selection.provenance()
    if comparison is not None:
        comparison.assert_current()
        receipt['checked_comparison_review'] = comparison.provenance()
        receipt['source_sha256']['comparison_review.py'] = hashlib.sha256((CAD_DIR / 'comparison_review.py').read_bytes()).hexdigest()
    if args.workspace == "box-mount":
        receipt["variant"] = args.variant
    if args.workspace == "disco-bar":
        asset = args.step or (Path(os.environ["SHOW_TOOLS_DISCO_STEP"]) if os.environ.get("SHOW_TOOLS_DISCO_STEP") else None)
        if asset is not None:
            receipt["reference_asset_sha256"] = hashlib.sha256(asset.expanduser().read_bytes()).hexdigest()
    # A successful publish is not an on-screen delivery or print-readiness claim.
    last_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))
    print(f"Viewer: http://127.0.0.1:{args.port}/viewer")


if __name__ == "__main__":
    main()
