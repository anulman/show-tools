"""Protect the immutable original and selected complete source-derived variant bodies."""
from pathlib import Path
import argparse
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import disco_bar as model


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--step", type=Path, required=True)
    args = parser.parse_args()
    scene = model.preview(args.step)
    model.verify_preview_scene(args.step, scene)
    original = scene[0][0]
    print(f"PASS original plus selected complete assemblies, {len(scene[0])} labelled pieces")

    def replace(index, shape):
        changed = tuple(list(items) for items in scene)
        changed[0][index] = shape
        return changed

    crop = original & model.box(110, 110, 28, (0, 0, -14))
    extra = tuple(list(items) + [items[0]] for items in scene)
    extra[1][-1] = "Unapproved extra display geometry"
    integrated = model.integrated_module()
    c_body = next(i for i, name in enumerate(scene[1]) if name.startswith("A |") and name.endswith(" / complete integrated bar"))
    c_screw = next(i for i, name in enumerate(scene[1]) if name.startswith("A |") and name.endswith(" / -38 axial screw"))
    review_pad = next(i for i, name in enumerate(scene[1]) if name.startswith("B REVIEW ONLY") and name.endswith(" / +1 captured pad"))
    protrusion = integrated.cyl(3.6, 12, (integrated.SPACING + 28, 40, -13), "y")
    _, reference = model.load_reference(args.step)
    circular_probe = model.full_variants(reference)[0]
    circular_probe.pieces[0].shape += integrated.cyl(3.6, 12, (28, 40, -13), "y")
    try:
        integrated.check_assembly(circular_probe, 0.)
    except ValueError as error:
        if "circular insertion envelope" not in str(error):
            raise
        print("PASS circular guard rejects same-bounds body protrusion independently of edit mask")
    else:
        raise AssertionError("Circular guard accepted body protrusion")
    cases = {
        "altered final C export": replace(len(scene[0]) - 1, scene[0][-1].translate((.2, 0, 0))),
        "altered locked-review pad": replace(review_pad, scene[0][review_pad].translate((.1, 0, 0))),
        "same-bounds body protrusion beyond circular opening": replace(c_body, scene[0][c_body] + protrusion),
        "unapproved extra display geometry": extra,
        "historical 28 mm original crop": replace(0, crop),
        "historical original displacement": replace(0, original.translate((0, 0, -35))),
        # Rotation preserves the cylindrical bounds and material volume. Its
        # asymmetric channels still differ from the actual original geometry.
        "same-bounds same-volume rotated original": replace(0, original.rotate(model.Axis.Z, 180)),
        "oversized actual preview screw": replace(c_screw, scene[0][c_screw].translate((80, 0, 0))),
        "missing original": tuple(list(items[1:]) for items in scene),
        "duplicate original": tuple(list(items) + [items[0]] for items in scene),
        "cropped variant beside intact original": replace(1, scene[0][1] & model.box(110, 110, 28, (130, 0, -14))),
        "displaced variant beside intact original": replace(1, scene[0][1].translate((0, 0, -35))),
    }
    for name, candidate in cases.items():
        try:
            model.verify_preview_scene(args.step, candidate)
        except ValueError:
            print(f"PASS rejected {name}")
        else:
            raise AssertionError(f"Regression accepted: {name}")
    with tempfile.TemporaryDirectory() as folder:
        wrong_asset = Path(folder) / "replacement.step"
        wrong_asset.write_text("Not the original measured bar")
        try:
            model.verify_preview_scene(wrong_asset, scene)
        except ValueError:
            print("PASS rejected changed source asset")
        else:
            raise AssertionError("Changed source asset accepted")
    print("PASS geometry identity, full height/profile/end preservation, and original pocket clearance")


if __name__ == "__main__":
    main()
