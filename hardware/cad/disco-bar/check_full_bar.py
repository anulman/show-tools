"""Protect the immutable original and four complete source-derived variant bodies."""
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
    print(f"PASS original plus four complete assemblies, {len(scene[0])} labelled pieces")

    def replace(index, shape):
        changed = tuple(list(items) for items in scene)
        changed[0][index] = shape
        return changed

    crop = original & model.box(110, 110, 28, (0, 0, -14))
    extra = tuple(list(items) + [items[0]] for items in scene)
    extra[1][-1] = "Unapproved extra display geometry"
    integrated = model.integrated_module()
    protrusion = integrated.cyl(3.6, 12, (integrated.SPACING + 28, 40, -13), "y")
    cases = {
        "same-bounds body protrusion through driver-port mask": replace(1, scene[0][1] + protrusion),
        "unapproved extra display geometry": extra,
        "historical 28 mm original crop": replace(0, crop),
        "historical original displacement": replace(0, original.translate((0, 0, -35))),
        # Rotation preserves the cylindrical bounds and material volume. Its
        # asymmetric channels still differ from the actual original geometry.
        "same-bounds same-volume rotated original": replace(0, original.rotate(model.Axis.Z, 180)),
        "oversized actual preview screw": replace(5, scene[0][5].translate((80, 0, 0))),
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
