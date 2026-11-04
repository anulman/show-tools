"""Check the actual composed reference scene without publishing to the viewer."""
import argparse
import json
import math

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Sphere

from all_controls import compose


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--step', required=True)
    args = parser.parse_args()
    objects, names, colors, alphas, receipt = compose(args.step)
    assert len(objects) == len(names) == len(colors) == len(alphas) == 21 + sum(item["object_count"] for item in receipt["additional_controls"].values())
    assert not any(name.startswith('HISTORICAL ') for name in names)
    assert receipt['manufacturing_approved'] is False
    assert receipt['arcade']['button_reference']['upstream_valid'] is False
    assert objects[1].bounding_box().min.Z == 0
    reference=receipt['spinner_reference']
    assert reference['axial_total_mm']==59 and reference['rear_shaft_is_axis_without_assumed_diameter'] is True
    assert reference['display_only'] is True
    roof=receipt['desk_heights_mm']['disco_box_roof']
    assert math.isclose(roof-objects[19].bounding_box().min.Z,59,abs_tol=1e-6)
    surface = objects[20]
    assert not surface.solids() and len(surface.faces()) == 1
    adaptor = BRepAdaptor_Surface(surface.faces()[0].wrapped)
    assert adaptor.GetType() == GeomAbs_Sphere
    sphere = adaptor.Sphere()
    ref = receipt['sphere_reference']
    root_z = ref['transform']['translation_mm'][2]
    height = ref['original_bar_height_mm']
    assert math.isclose(sphere.Location().Z(), root_z + height / 2, abs_tol=1e-6)
    assert math.isclose(sphere.Radius(), ref['radius_mm'], abs_tol=1e-6)
    for z in (root_z, root_z + height):
        section_radius = math.sqrt(sphere.Radius() ** 2 - (z - sphere.Location().Z()) ** 2)
        assert math.isclose(2 * section_radius, ref['slice_diameter_mm'], abs_tol=1e-6)
    assert math.isclose(surface.bounding_box().min.Z, root_z, abs_tol=1e-6)
    assert surface.bounding_box().max.Z > root_z + height
    assert math.isclose(objects[2].bounding_box().max.Z, 113.0343037697962, abs_tol=1e-6)
    groups = []
    for workspace, entry in receipt['additional_controls'].items():
        start = entry['object_start_index']
        parts = objects[start:start + entry['object_count']]
        bounds = [shape.bounding_box() for shape in parts]
        assert abs(min(box.min.Z for box in bounds)) < 1e-6
        left, right = min(box.min.X for box in bounds), max(box.max.X for box in bounds)
        front = min(box.min.Y for box in bounds)
        assert front >= max(shape.bounding_box().max.Y for shape in objects[:21]) + 40 - 1e-6
        groups.append((left, right))
        assert entry['provenance']['physical_fit_verified'] is False
    for first, second in zip(groups, groups[1:]):
        assert second[0] - first[1] >= 40 - 1e-6
    assert not set(receipt['additional_controls']) & set(receipt['pending_measurements'])
    print(json.dumps(dict(result='PASS', checks=['actual source pins', 'shared desk plane',
        'original mounted button pose', 'current assembly only', 'native spherical surface',
        'equal sections at original bar planes', 'open bottom and upper dome', 'spinner reference full-depth axis'],
        desk_heights_inches={k: v / 25.4 for k, v in receipt['desk_heights_mm'].items()},
        physical_fit_verified=False), indent=2))


if __name__ == '__main__':
    main()
