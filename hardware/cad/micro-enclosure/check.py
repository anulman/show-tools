"""Headless exported-solid verification; default inputs are synthetic, not I-PAC facts."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import numpy as np
import trimesh
from build123d import Unit, export_step, export_stl, import_step
from model import build, bore


def require(ok, message):
    if not ok:
        raise ValueError(message)


def bounds(s):
    b = s.bounding_box()
    return np.array([[b.min.X, b.min.Y, b.min.Z], [b.max.X, b.max.Y, b.max.Z]])


def overlap(a, b):
    intersection = a.intersect(b)
    return 0. if intersection is None else sum(s.volume for s in intersection.solids())


def fixture():
    return dict(source='SYNTHETIC geometry harness; not I-PAC dimensions',
        synthetic_fixture=True, board_length_mm=100., board_width_mm=70., foot_height_mm=8., installed_top_mm=28.,
        feet=[dict(xy_mm=[x, y], size_mm=[9., 9.]) for x in (-43., 43.) for y in (-28., 28.)],
        exits=[dict(wall='x+', offset_mm=0., width_mm=25., depth_mm=15.),
               dict(wall='y-', offset_mm=0., width_mm=35., depth_mm=12.)])


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--measurements', type=Path)
    args = p.parse_args()
    m = json.loads(args.measurements.read_text()) if args.measurements else fixture()
    shell, cover, refs, envelope, dimensions = build(m)
    require(abs(bounds(shell)[0, 2]) < 1e-7, 'Shell must be grounded')
    require(overlap(shell, cover) < 1e-6, 'Cover intersects shell')
    for r in [*refs, envelope]:
        require(overlap(shell, r) < 1e-6 and overlap(cover, r) < 1e-6, 'Reference intersects printed parts')
    for rise in (0.1, 1., 10., dimensions['outer_mm'][2]):
        require(overlap(shell, cover.translate((0, 0, rise))) < 1e-6, 'Cover removal obstruction')
    for x, y in dimensions['screw_centres_mm']:
        shaft = bore(3., 10., (x, y, dimensions['shell_top_mm']-7.))
        require(overlap(shell, shaft) < 1e-6 and overlap(cover, shaft) < 1e-6, 'Screw passage blocked')
    args.out.mkdir(parents=True, exist_ok=True)
    records = []
    for name, shape in [('shell', shell), ('cover', cover)]:
        require(shape.is_valid and len(shape.solids()) == 1 and shape.volume > 0, 'Invalid native '+name)
        step, stl = args.out/(name+'.step'), args.out/(name+'.stl')
        export_step(shape, step, unit=Unit.MM)
        export_stl(shape, stl, tolerance=.025, angular_tolerance=.05)
        restored = import_step(step)
        mesh = trimesh.load_mesh(stl)
        require(restored.is_valid and len(restored.solids()) == 1, 'Invalid STEP '+name)
        require(math.isclose(restored.volume, shape.volume, rel_tol=1e-6), 'STEP volume mismatch')
        require(np.allclose(bounds(restored), bounds(shape), atol=1e-6), 'STEP bounds mismatch')
        require(mesh.is_watertight and mesh.is_winding_consistent and mesh.volume > 0, 'Invalid STL '+name)
        require(math.isclose(mesh.volume, shape.volume, rel_tol=.005), 'STL volume mismatch')
        require(np.allclose(mesh.bounds, bounds(shape), atol=.05), 'STL bounds mismatch')
        records.append(dict(name=name, volume_mm3=shape.volume, bounds_mm=bounds(shape).tolist(),
            step=str(step.resolve()), stl=str(stl.resolve()),
            step_sha256=hashlib.sha256(step.read_bytes()).hexdigest(),
            stl_sha256=hashlib.sha256(stl.read_bytes()).hexdigest()))
    receipt = dict(geometry_checks_pass=True, units='mm', measurements=m, dimensions=dimensions,
        physical_fit_verified=False, fabrication_release=False, parts=records,
        limitations=['No connector poses, bend radius, solder or strain-relief fit proof',
                     'No floor mounting hole fit proof; undrilled floor',
                     'Nut pocket and M3 screw design allowances require physical fit checks'])
    (args.out/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps(dict(geometry_checks_pass=True, synthetic=m.get('synthetic_fixture'),
                         receipt=str((args.out/'receipt.json').resolve()))))


if __name__ == '__main__':
    main()
