"""Publish one selected CAD workstream to the existing shared viewer."""
from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import os
from pathlib import Path

CAD_DIR = Path(__file__).parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", choices=("box-mount", "disco-bar"))
    parser.add_argument("--variant", choices=("all", "arcade-inclined", "rotor-level", "mushroom-level"), default="all", help="Box-mount variants to show")
    parser.add_argument("--step", type=Path, help="Local Darren STEP path, for disco-bar only")
    parser.add_argument("--explode", type=float, default=0, help="Lower box-mount bottoms for inspection, in mm")
    parser.add_argument("--reset-camera", action="store_true")
    parser.add_argument("--port", type=int, default=3939)
    args = parser.parse_args()
    if args.step is not None and args.workspace != "disco-bar":
        parser.error("--step applies only to disco-bar")
    if args.explode != 0 and args.workspace != "box-mount":
        parser.error("--explode applies only to box-mount")
    if args.variant != "all" and args.workspace != "box-mount":
        parser.error("--variant applies only to box-mount")
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
