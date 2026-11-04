"""Headless exported-solid verification; default inputs are synthetic, not I-PAC facts."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
import trimesh
from build123d import Unit, RegularPolygon, extrude, export_step, export_stl, import_step
from model import build, bore, box


def require(ok, message):
    if not ok:
        raise ValueError(message)


def bounds(s):
    b = s.bounding_box()
    return np.array([[b.min.X, b.min.Y, b.min.Z], [b.max.X, b.max.Y, b.max.Z]])


def overlap(a, b):
    intersection = a.intersect(b)
    return 0. if intersection is None else sum(s.volume for s in intersection.solids())


def joint_readback(screw, head, nut, pitch=.5):
    """Native envelope extents establish axial reach, not helical thread strength."""
    sb, hb, nb = bounds(screw), bounds(head), bounds(nut)
    require(np.allclose(sb.mean(axis=0)[:2], nb.mean(axis=0)[:2], atol=1e-7), 'Screw and nut axes differ')
    tip, bearing = sb[0, 2], hb[0, 2]
    covered = max(0., min(bearing, nb[1, 2])-max(tip, nb[0, 2]))
    projection = nb[0, 2]-tip
    require(math.isclose(covered, nb[1, 2]-nb[0, 2], abs_tol=1e-7)
            and projection >= pitch-1e-7, 'Insufficient full nut span plus one pitch')
    return dict(screw_bounds_mm=sb.tolist(), head_bounds_mm=hb.tolist(),
        nut_bounds_mm=nb.tolist(), under_head_length_mm=bearing-tip,
        covered_nut_height_mm=covered, tip_projection_beyond_nut_mm=projection,
        required_pitch_mm=pitch, full_nut_span_plus_one_pitch=True)


def fixture():
    return dict(source='SYNTHETIC geometry harness; not I-PAC dimensions',
        synthetic_fixture=True, board_length_mm=100., board_width_mm=70.,
        pcb_mounting_elevation_above_inside_floor_mm=8., interior_height_mm=60., cable_bay_length_mm=45.,
        exits=[dict(wall='x+', offset_mm=0., width_mm=35., depth_mm=12.)])


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--measurements', type=Path)
    args = p.parse_args()
    require(not args.out.exists(), 'Output directory already exists; choose a fresh --out namespace')
    m = json.loads(args.measurements.read_text()) if args.measurements else fixture()
    shell, cover, refs, envelope, dimensions = build(m)
    require(abs(bounds(shell)[0, 2]) < 1e-7, 'Shell must be grounded')
    require(math.isclose(bounds(envelope)[0, 2], dimensions['floor_mm']+m['pcb_mounting_elevation_above_inside_floor_mm'], abs_tol=1e-7), 'PCB nominal mounting elevation changed')
    require(math.isclose(bounds(envelope)[1, 2], bounds(envelope)[0, 2], abs_tol=1e-7), 'PCB reference must be a surface, not invented thickness')
    require(math.isclose(dimensions['shell_top_mm']-dimensions['floor_mm'], m['interior_height_mm'], abs_tol=1e-7), 'Chosen interior budget changed')
    require(overlap(shell, cover) < 1e-6, 'Cover intersects shell')
    pcb_bounds, storage_bounds = bounds(envelope), bounds(refs[0])
    require(storage_bounds[0, 0] > pcb_bounds[1, 0], 'Storage bay overlaps PCB plan')
    require(math.isclose(envelope.area, m['board_length_mm']*m['board_width_mm'], rel_tol=1e-9), 'PCB footprint area changed')
    for part in (shell, cover):
        intersection = envelope.intersect(part)
        require(intersection is None or sum(f.area for f in intersection.faces()) < 1e-6, 'PCB reference surface intersects printed part')
    for r in refs:
        require(overlap(shell, r) < 1e-6 and overlap(cover, r) < 1e-6, 'Reference intersects printed parts')
    for rise in (0.1, 1., 10., dimensions['outer_mm'][2]):
        require(overlap(shell, cover.translate((0, 0, rise))) < 1e-6, 'Cover removal obstruction')
    hardware_readbacks = []
    for x, y in dimensions['screw_centres_mm']:
        rim, bearing = dimensions['shell_top_mm'], dimensions['outer_mm'][2]
        head = bore(5.7, 1.65, (x, y, bearing))
        nut_bottom = rim-3.4-2.4
        nut = extrude(RegularPolygon(5.5/math.sqrt(3), 6), amount=2.4).translate((x, y, nut_bottom))
        nut -= bore(3.1, 2.6, (x, y, nut_bottom-.1))
        require(overlap(shell, nut) < 1e-6, 'Clamped nut blocked')
        require(overlap(shell, nut.translate((0, 0, .1))) > 1e-4, 'Nut has no flat roof reaction')
        require(overlap(cover, head.translate((0, 0, -.1))) > 1e-4, 'Head has no cover bearing')
        for length in (9.7, 10., 10.3):
            shaft = bore(3., length, (x, y, bearing-length))
            screw = shaft+head
            require(screw.is_valid and len(screw.solids()) == 1, 'Invalid screw envelope')
            require(overlap(shell, screw) < 1e-6 and overlap(cover, screw) < 1e-6, 'Screw passage blocked')
            for seat, shift in [('clamped', 0.), ('lowest_in_pocket', -.3)]:
                placed_nut = nut.translate((0, 0, shift))
                row = joint_readback(screw, head, placed_nut)
                row.update(axis_xy_mm=[x,y], nut_position=seat)
                hardware_readbacks.append(row)
        for travel in (0., 1., 3., 6., 9., 12.):
            moved = nut.translate(((-1 if x>0 else 1)*travel, 0, 0))
            require(overlap(shell, moved) < 1e-6, 'Nut insertion path blocked')
        tool = bore(6., 25., (x, y, dimensions['outer_mm'][2]+3.))
        require(overlap(shell, tool) < 1e-6 and overlap(cover, tool) < 1e-6, 'Vertical tool approach blocked')
    for e in m.get('exits', []):
        # A block through the centre of each proposed opening checks the native cut.
        ox, oy, _ = dimensions['outer_mm']
        z = dimensions['shell_top_mm']-e['depth_mm']+1
        if e['wall'][0] == 'x':
            path = box(7., e['width_mm']-2, e['depth_mm']-2, ((1 if e['wall'][1]=='+' else -1)*(ox/2-1.5), e['offset_mm'], z))
        else:
            path = box(e['width_mm']-2, 7., e['depth_mm']-2, (e['offset_mm'], (1 if e['wall'][1]=='+' else -1)*(oy/2-1.5), z))
        require(overlap(shell, path) < 1e-6 and overlap(cover, path) < 1e-6, 'Proposed seam passage blocked')
    legacy_nut = extrude(RegularPolygon(5.5/math.sqrt(3), 6), amount=2.4).translate((x, y, dimensions['shell_top_mm']-7.55))
    nominal_screw = bore(3., 10., (x, y, bearing-10.))+head
    try:
        joint_readback(nominal_screw, head, legacy_nut)
    except ValueError as error:
        require(str(error) == 'Insufficient full nut span plus one pitch', 'Wrong legacy short-reach failure')
    else:
        raise ValueError('Legacy short-reach negative control passed')
    args.out.mkdir(parents=True, exist_ok=False)
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
        scope='IPAC_TWO_PART_MEASURED_ENVELOPE',
        measurement_sha256=(hashlib.sha256(args.measurements.read_bytes()).hexdigest()
                            if args.measurements else None),
        source_sha256={p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                       for p in [Path(__file__).with_name(n) for n in ('model.py', 'scene.py', 'check.py')]},
        physical_fit_verified=False, fabrication_release=False, parts=records,
        hardware_readbacks=hardware_readbacks,
        legacy_short_reach_negative_rejected=True,
        screw_length_bounds_mm=[9.7,10.3],
        tolerance_basis='Explicit 9.70..10.30mm design/test bound only; no verified ISO7380-1 length tolerance or operator hardware measurement',
        screw_head_envelope=dict(standard='ISO7380-1 button head', diameter_mm=5.7, height_mm=1.65,
                                 source='https://www.accu.co.uk/socket-button-screws/8103-SSB-M3-10-A2'),
        thread_end_limit='One pitch geometric projection does not prove complete end threads, thread fit, preload or strength',
        limitations=['Interior height is a design budget; installed component height unmeasured',
                     'No PCB thickness, feet footprints, connector poses, bend radius, solder or strain-relief fit proof',
                     'No floor mounting hole fit proof; undrilled floor',
                     'Nut pocket and M3 screw design allowances require physical fit checks'])
    (args.out/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n')
    print(json.dumps(dict(geometry_checks_pass=True, synthetic=m.get('synthetic_fixture'),
                         receipt=str((args.out/'receipt.json').resolve()))))


if __name__ == '__main__':
    main()
