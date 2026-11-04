"""Compose current controls on one ground plane, with an illustrative open ball."""
import json
import math
from pathlib import Path

from build123d import Axis, Box, Sphere, import_step
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Sphere

import arcade_scene
import concept_preview

HERE = Path(__file__).resolve().parent


def compose(step_path):
    objects, names, colors, alphas, arcade = arcade_scene.load()
    objects = [s.translate((-120, 0, 0)) for s in objects]
    data, selection, parts = concept_preview.load()
    current = [(p, s) for p, s in parts if p.name.startswith('STUDY ')]
    bars = [(p, s) for p, s in current if 'integral' in p.name.lower() and 'bar' in p.name.lower()]
    if len(bars) != 1:
        raise ValueError('Expected exactly one current integral bar')
    bar, _ = bars[0]
    bottoms = [s for p, s in current if 'mounting box bottom' in p.name.lower()]
    if (len(bottoms) != 1 or abs(bottoms[0].bounding_box().min.Z) > 1e-6
            or abs(objects[1].bounding_box().min.Z) > 1e-6):
        raise ValueError('Both controls must share the Z=0 desk plane')
    offset = (120 - bar.translation_mm[0], -bar.translation_mm[1], 0)
    for p, shape in current:
        objects.append(shape.translate(offset))
        names.append(p.name)
        colors.append(p.color)
        alphas.append(p.alpha)
    import spinner_reference
    reference_objects, reference_names, reference_colors, reference_alphas, reference = spinner_reference.scene(
        data['study_parameters']['roof_height_above_ground_mm'],120,0)
    objects.extend(reference_objects);names.extend(reference_names)
    colors.extend(reference_colors);alphas.extend(reference_alphas)
    # Equal illustrative sections use the original fitted maximum width, not the added flare.
    original_path = Path(step_path)
    original_sha = concept_preview.digest(original_path)
    if original_sha != 'f0a21384179b69eff79205032dad536bfa1350e358c25ed0fe01de4189f2e003':
        raise ValueError('Recheck ball datums for a changed original bar')
    original = import_step(original_path)
    bounds = original.bounding_box()
    if abs(bounds.max.Z) > 1e-6:
        raise ValueError('Original bar root must be source Z=0')
    height = bounds.max.Z - bounds.min.Z
    diameter = max(bounds.max.X - bounds.min.X, bounds.max.Y - bounds.min.Y)
    radius = math.hypot(height / 2, diameter / 2)
    sphere = Sphere(radius).translate((0, 0, -height / 2))
    length = 2 * radius + 2
    clipped = sphere & Box(length, length, length).translate((0, 0, -length / 2))
    faces = [f for f in clipped.faces()
             if BRepAdaptor_Surface(f.wrapped).GetType() == GeomAbs_Sphere]
    if len(faces) != 1 or not faces[0].is_valid:
        raise ValueError('Expected one valid open spherical face without a planar cap')
    surface = faces[0]
    for z in (0, -height):
        if not math.isclose(radius * radius - (z + height / 2) ** 2,
                            (diameter / 2) ** 2, abs_tol=1e-8):
            raise ValueError('Unequal illustrative sphere sections')
    if bar.rotation_x_degrees != 180 or bar.rotation_z_degrees != 0:
        raise ValueError('Recheck sphere datums after a bar orientation change')
    surface = surface.rotate(Axis.X, bar.rotation_x_degrees).rotate(Axis.Z, bar.rotation_z_degrees)
    surface = surface.translate(bar.translation_mm).translate(offset)
    objects.append(surface)
    names.append('REFERENCE open ball - illustrative equal sections; not measured or printable')
    colors.append('#b6c4cf')
    alphas.append(.22)
    roof_height = next(s.bounding_box().max.Z for p, s in current if 'box shell' in p.name.lower())
    receipt = dict(workspace='all-controls', presentation='shared-desk-controls-v1',
        units='mm', arcade=arcade, disco_selection=selection,
        actual_artifacts={str(p.path): p.sha256 for p, _ in current},
        horizontal_layout_centres_mm=[-120, 120], desk_z_mm=0,
        original_component_heights_preserved=True,
        sphere_reference=dict(measured_ball_geometry=False, fabrication_geometry=False,
            slice_diameter_mm=diameter, original_bar_height_mm=height,
            source_section_planes_mm=[0, -height], source_center_z_mm=-height / 2,
            radius_mm=radius, wall_thickness_mm=None, planar_bottom_cap=False,
            diameter_basis='Original maximum fitted bar width reused at both sections; shaped endpoint radii differ',
            transform=dict(rotation_x_degrees=bar.rotation_x_degrees,
                translation_mm=[120, 0, bar.translation_mm[2]])),
        spinner_reference=reference,
        original_bar=dict(path=str(original_path), sha256=original_sha),
        desk_heights_mm=dict(button_top=objects[2].bounding_box().max.Z,
            ball_top=surface.bounding_box().max.Z, disco_box_roof=roof_height),
        physical_fit_verified=False, manufacturing_approved=False,
        canvas_delivery_verified=False, labels=names)
    for p, _ in current:
        if concept_preview.digest(p.path) != p.sha256:
            raise ValueError('Changed disco display artifact')
    import additional_controls
    pending = {}
    additions = []
    for workspace in additional_controls.SCENES:
        missing = additional_controls.missing_measurements(workspace)
        if missing:
            pending[workspace] = missing
            continue
        additions.append((workspace, additional_controls.load(workspace)))
    back_y = max(shape.bounding_box().max.Y for shape in objects) + 40
    cursor_x = min(shape.bounding_box().min.X for shape in objects)
    receipt['additional_controls'] = {}
    receipt['pending_measurements'] = pending
    for workspace, (parts, labels, palette, opacity, provenance) in additions:
        bounds = [shape.bounding_box() for shape in parts]
        left = min(box.min.X for box in bounds)
        front = min(box.min.Y for box in bounds)
        floor = min(box.min.Z for box in bounds)
        if abs(floor) > 1e-6:
            raise ValueError('Additional controls must be assembled on the Z=0 desk plane')
        offset = (cursor_x - left, back_y - front, 0)
        start_index = len(objects)
        objects.extend(shape.translate(offset) for shape in parts)
        names.extend(labels); colors.extend(palette); alphas.extend(opacity)
        receipt['additional_controls'][workspace] = dict(
            provenance=provenance, translation_mm=list(offset),
            object_start_index=start_index, object_count=len(parts), labels=labels)
        cursor_x += max(box.max.X for box in bounds) - left + 40
    receipt['labels'] = names
    receipt['presentation'] = 'shared-desk-controls-v2'
    return objects, names, colors, alphas, receipt


def publish(step_path, port=3939, reset=False):
    from ocp_viewer import Camera, show
    objects, names, colors, alphas, receipt = compose(step_path)
    target = HERE / 'build/workspace/current-view.json'
    previous = json.loads(target.read_text()) if target.exists() else {}
    reset = reset or previous.get('presentation') != receipt['presentation']
    encoded = json.dumps(receipt, indent=2) + '\n'
    show(*objects, names=names, colors=colors, alphas=alphas, port=port,
         reset_camera=Camera.RESET if reset else Camera.KEEP,
         ortho=True if reset else None, zoom=.85 if reset else None,
         axes=True, grid=(True, False, False))
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(encoded)
