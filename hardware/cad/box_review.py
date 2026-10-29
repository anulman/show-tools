"""Keep the existing box layout and show the checked companion rotor base."""
from __future__ import annotations

import math
import numpy as np

import box_mount
import final_review


def preview(*, explode=0., variant='all', selection=None):
    if not math.isfinite(explode) or explode < 0:
        raise ValueError('Explode distance must be finite and nonnegative')
    selected = list(box_mount.variant_requirements()['variants']) if variant == 'all' else [variant]
    if any(label not in box_mount.variant_requirements()['variants'] for label in selected):
        raise ValueError('Unknown box variant')
    objects, names, colors, alphas = [], [], [], []
    p = box_mount.Proposal()
    for index, label in enumerate(selected):
        x = (index - (len(selected) - 1) / 2) * 160
        if label != 'rotor-level':
            scene = box_mount.preview(explode=explode, variant=label)
            objects.extend(shape.translate((x, 0, 0)) for shape in scene[0])
            names.extend(scene[1]); colors.extend(scene[2]); alphas.extend(scene[3])
            continue
        selection = selection or final_review.load()
        for part in selection.parts('box'):
            is_bottom = part.name.lower() in ('bottom', 'cover', 'removable bottom')
            objects.append(part.shape.translate((x, 0, p.level_top_z - (explode if is_bottom else 0))))
            names.append('rotor-level C REVIEW / ' + part.name)
            is_shell = part.name.lower() in ('shell', 'roof', 'enclosure')
            colors.append('#b8a084' if is_shell else '#d4c3a8' if is_bottom else '#648c9b')
            alphas.append(.75 if is_shell else 1.)
    return objects, names, colors, alphas


def verify_preview_scene(scene, *, explode=0., variant='all', selection=None):
    expected = preview(explode=explode, variant=variant, selection=selection)
    if scene[1:] != expected[1:] or len(scene[0]) != len(expected[0]):
        raise ValueError('Box review labels, attributes or component count changed')
    for actual, original, name in zip(scene[0], expected[0], expected[1]):
        if 'button REFERENCE' in name:
            # The packaged upstream reference is invalid and is never a print
            # target. Compare its displayed tessellation rather than Boolean it.
            av, at = actual.tessellate(.15)
            ev, et = original.tessellate(.15)
            if (len(av) != len(ev) or not np.array_equal(at, et)
                    or not np.allclose([(v.X, v.Y, v.Z) for v in av],
                                       [(v.X, v.Y, v.Z) for v in ev], atol=1e-5, rtol=0)):
                raise ValueError('The displayed upstream button reference changed')
            continue
        if not actual.is_valid:
            raise ValueError(f'Invalid displayed box component: {name}')
        if box_mount.volume(actual - original) > box_mount.EPS or box_mount.volume(original - actual) > box_mount.EPS:
            raise ValueError(f'Displayed box component changed: {name}')
    if selection is not None:
        selection.assert_current()
    return dict(final_companion_base=True, original_arcade_and_mushroom_preserved=True,
                ground_and_roof_alignment_preserved=True, physical_fit_verified=False)
