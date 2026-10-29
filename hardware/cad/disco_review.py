"""Show only the unchanged original and the selected complete C proposal."""
from __future__ import annotations

import disco_bar
import final_review

SPACING = 130


def preview(step_path=None, *, selection=None):
    selection = selection or final_review.load()
    path, reference = disco_bar.load_reference(step_path)
    disco_bar.verify_full_reference(path, reference)
    objects, names, colors, alphas = [reference], [disco_bar.ORIGINAL_LABEL], ['#9ea8b4'], [1.]
    for part in selection.parts('disco'):
        objects.append(part.shape.translate((SPACING, 0, 0)))
        names.append(disco_bar.FINAL_C_LABEL + ' / ' + part.name)
        colors.append('#e6a238' if part.role == 'pad' else '#8b65c1' if part.role == 'bar' else '#55b9af')
        alphas.append(.18 if part.role == 'bar' else .3 if part.role == 'body' else 1.)
    return objects, names, colors, alphas


def load_reference(step_path=None):
    return disco_bar.load_reference(step_path)


def verify_preview_scene(path, scene, *, selection=None):
    selection = selection or final_review.load()
    expected = preview(path, selection=selection)
    if scene[1:] != expected[1:] or len(scene[0]) != len(expected[0]):
        raise ValueError('Keep only one original and every finished C component in the review')
    disco_bar.verify_full_reference(path, scene[0][0])
    model = disco_bar.integrated_module()
    for actual, source, name in zip(scene[0], expected[0], expected[1]):
        if not actual.is_valid or len(actual.solids()) != 1:
            raise ValueError('Invalid displayed review component: ' + name)
        model.assert_empty(actual - source, 'Displayed review gained or displaced material: ' + name)
        model.assert_empty(source - actual, 'Displayed review lost material: ' + name)
    selection.assert_current()
    return dict(original_and_final_C_only=True, checked_export_geometry_preserved=True,
                physical_fit_verified=False)
