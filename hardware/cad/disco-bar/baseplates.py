"""Independent knob-joint study; no bar-latch placement or installed-stack claim."""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path

from . import full_height as cad
from build123d import export_step, export_stl, import_step
import numpy as np
import trimesh


@dataclass(frozen=True)
class KnobBaseplate:
    setting_mm: float
    pieces: tuple
    driver_paths: tuple


def retained_pad(sign):
    # A T-shaped back sits behind the jaw lip. It is not the old flange that
    # could simply leave the same open radial groove.
    neck = cad.cyl(cad.R + 2, 8, (0, 0, -13)) - cad.cyl(cad.R, 10, (0, 0, -13))
    backing = cad.cyl(cad.R + 2.75, 10, (0, 0, -13)) - cad.cyl(cad.R + 2, 12, (0, 0, -13))
    return (neck + backing) & cad.box(30, 20, 20, (sign * 29, 0, -13))


def knob_baseplate(reference, setting_mm=0.):
    """Preset adjustment only. Future bar-latch states must reuse these pieces."""
    if not np.isfinite(setting_mm) or not 0 <= setting_mm <= .25:
        raise ValueError('This form study checks only 0..0.25 mm proposed shoe travel; no force is established')
    # The source cup's mouth, entry bevel and fixed stop remain at source Z.
    # Outer reinforcement is proposed and has no latch flange or support face.
    body = cad.cyl(33, 26.9875, (0, 0, -13.49375)) - cad.pocket()
    pieces, tools = [], []
    for sign in (-1, 1):
        pad = retained_pad(sign)
        shoe = cad.box(13, 22, 14, (sign * 20.5, 0, -13)) - cad.cyl(cad.R + 1.5, 18, (0, 0, -13))
        for y in (-12, 12):
            shoe += cad.box(3, 2, 10, (sign * 25.5, y, -13))
        shoe -= pad
        body -= cad.box(13.6, 22.6, 14.6, (sign * 20.5, 0, -13))
        for y in (-12, 12):
            body -= cad.box(3.6, 2.6, 10.6, (sign * 25.5, y, -13))
        # The nut enters from the cup before the shoe. A finite outer roof
        # carries its reaction; a bare plastic thread is not assumed.
        body -= cad.hexagon(3.5, 3.6, (sign * 28.5, 0, -13), 'x')
        body -= cad.cyl(1.8, 10, (sign * 31, 0, -13), 'x')
        nut = cad.hexagon(3.2, 2.4, (sign * 29.1, 0, -13), 'x') - cad.cyl(1.6, 5, (sign * 29.1, 0, -13), 'x')
        screw = cad.cyl(1.5, 6, (sign * (30 - setting_mm), 0, -13), 'x')
        shift = (-sign * setting_mm, 0, 0)
        pieces += [cad.Piece(f'{sign:+d} retained padded shoe', shoe.translate(shift), 'print'),
                   cad.Piece(f'{sign:+d} pad', pad.translate(shift), 'pad'),
                   cad.Piece(f'{sign:+d} preset set-screw envelope', screw, 'hardware'),
                   cad.Piece(f'{sign:+d} captive nut envelope', nut, 'hardware')]
        # Access with the bar removed, not a selected actual driver dimension.
        tools.append(cad.cyl(1.3, 12, (sign * (39 - setting_mm), 0, -13), 'x'))
    return KnobBaseplate(setting_mm, tuple([cad.Piece('knob baseplate cup', body, 'body')] + pieces), tuple(tools))


def verify_baseplate(reference, assembly):
    source_void = cad.cyl(23.5, 25.4, (0, 0, -12.7)) - reference
    cad.assert_empty(source_void - cad.pocket(), 'Source socket reconstruction lost clearance')
    cad.assert_empty(cad.pocket() - source_void, 'Source socket reconstruction exceeds clearance')
    envelope = cad.cyl(cad.OUTER, 30, (0, 0, -15))
    body = assembly.pieces[0].shape
    for region in (cad.cyl(25.5, 3, (0, 0, -1.5)), cad.cyl(cad.R + .1, 1, (0, 0, -25.9))):
        cad.assert_empty((reference & region) - body, 'Source entry/stop removed')
        # Outward reinforcement is allowed. Retaining source interface material
        # together with an empty source void fixes the actual entry and stop.
    compression = 0.
    for index, piece in enumerate(assembly.pieces):
        if not piece.shape.is_valid or len(piece.shape.solids()) != 1 or piece.shape.volume <= 0:
            raise ValueError(f'Invalid baseplate component: {piece.name}')
        cad.assert_empty(piece.shape - envelope, f'Original insertion envelope exceeded: {piece.name}')
        if piece.role == 'pad' and assembly.setting_mm:
            compression += cad.volume(piece.shape & source_void)
        else:
            cad.assert_empty(piece.shape & source_void, f'Original knob path blocked: {piece.name}')
        for second in assembly.pieces[index + 1:]:
            cad.assert_empty(piece.shape & second.shape, f'Component overlap: {piece.name}/{second.name}')
    for path in assembly.driver_paths:
        for piece in assembly.pieces:
            cad.assert_empty(path & piece.shape, f'Bar-off driver access blocked: {piece.name}')
    for sign in (-1, 1):
        items = {p.name: p.shape for p in assembly.pieces}
        if items[f'{sign:+d} retained padded shoe'].distance_to(items[f'{sign:+d} preset set-screw envelope']) > 1e-5:
            raise ValueError('Set screw must meet the shoe rather than the knob')
        if items[f'{sign:+d} pad'].distance_to(items[f'{sign:+d} retained padded shoe']) > 1e-5:
            raise ValueError('Pad has no backing seat')
    # Test finite retention/reaction geometry, not just nominal clearances.
    items = {p.name: p.shape for p in assembly.pieces}
    for sign in (-1, 1):
        if cad.volume((items[f'{sign:+d} pad'].translate((-sign * .1, 0, 0))) & items[f'{sign:+d} retained padded shoe']) <= 1e-5:
            raise ValueError('Pad backing does not encounter a retaining lip')
        if cad.volume(items[f'{sign:+d} retained padded shoe'].translate((-sign * .4, 0, 0)) & body) <= 1e-5:
            raise ValueError('Shoe can leave its guide without encountering a retaining shoulder')
        nut = items[f'{sign:+d} captive nut envelope']
        if cad.volume(nut.translate((sign * .1, 0, 0)) & body) <= 1e-5:
            raise ValueError('Nut has no positive outward reaction roof')
    return {'setting_mm_PROPOSED': assembly.setting_mm, 'original_entry_and_stop': True,
            'original_knob_path_unblocked': not assembly.setting_mm,
            'pad_compression_envelope_mm3': compression, 'bar_off_driver_paths_clear': True,
            'components_valid': True, 'rigid_component_intersections_mm3': 0.,
            'limits': 'Independent knob joint only. Hardware standard, preload, pad insertion, installed stack, bar latch, and strength are unverified.'}


def export_baseplate(reference, output):
    output.mkdir(parents=True, exist_ok=True)
    report = {'scope': 'INDEPENDENT_KNOB_BASEPLATE_FORM_STUDY', 'units': 'mm',
              'source_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'operator_access_for_bar_latch': 'pending; no latch placement modelled',
              'checks': [verify_baseplate(reference, knob_baseplate(reference, setting)) for setting in (0., .2)], 'exports': []}
    for number, piece in enumerate(knob_baseplate(reference).pieces):
        if piece.role not in ('body', 'print'):
            continue
        stem = f'{number:02d}-{piece.name.replace(" ", "-").replace("+", "plus")}'
        step, stl = output / f'{stem}.step', output / f'{stem}.stl'
        if not export_step(piece.shape, step) or not export_stl(piece.shape, stl, tolerance=.03):
            raise ValueError('Baseplate export failed')
        restored = import_step(step)
        mesh = trimesh.load_mesh(stl)
        if not restored.is_valid or len(restored.solids()) != 1 or not np.isclose(restored.volume, piece.shape.volume, rtol=1e-6):
            raise ValueError('Baseplate STEP round trip failed')
        cad.assert_empty(restored - piece.shape, 'STEP added material')
        cad.assert_empty(piece.shape - restored, 'STEP removed material')
        if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume <= 0 or not np.isclose(mesh.volume, piece.shape.volume, rtol=.005):
            raise ValueError('Baseplate STL validation failed')
        report['exports'].append({'piece': piece.name, 'volume_mm3': piece.shape.volume, 'step_roundtrip': True, 'stl_watertight': True})
    (output / 'receipt.json').write_text(json.dumps(report, indent=2) + '\n')
    return report
