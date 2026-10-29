"""Check the restored preview and reject the actual cropped-reference regression."""
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
    full = scene[0][0]
    crop = full & model.box(110, 110, 28, (0, 0, -14))
    cases = {
        "historical 28 mm crop": [crop],
        "historical display offset": [full.translate((0, 0, -35))],
        "replacement assembly scene": [full, full],
    }
    for name, shapes in cases.items():
        bad_scene = (shapes, [name] * len(shapes), ["#ffffff"] * len(shapes), [1.] * len(shapes))
        try:
            model.verify_preview_scene(args.step, bad_scene)
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
    print("PASS full original bar, source hash, top-attachment reach, opening-fit width, and volume")


if __name__ == "__main__":
    main()
