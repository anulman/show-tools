"""Measure the pinned private source's partial contact; no load or bearing rating."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
import disco_bar
from build123d import Align,Cylinder


def longest_run(flags):
    if all(flags):
        return len(flags)
    best=current=0
    for flag in flags+flags:
        current=current+1 if flag else 0
        best=max(best,current)
    return min(best,len(flags))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--step',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.unlink(missing_ok=True)
    digest=hashlib.sha256(args.step.read_bytes()).hexdigest()
    if digest!=disco_bar.REFERENCE_SHA256:
        raise ValueError('Use the pinned full source; contact is not transferable to another shape')
    path,source=disco_bar.load_reference(args.step)
    original=disco_bar.verify_full_reference(path,source)
    align=(Align.CENTER,Align.CENTER,Align.MIN)
    inner,outer,thickness=43.,45.5,.1
    annulus=Cylinder(outer,thickness,align=align)-Cylinder(inner,thickness+.2,align=align).translate((0,0,-.1))
    records=[]
    for centre_z in (-.05,-1.,-5.,-26.):
        slice_shape=annulus.translate((0,0,centre_z-thickness/2))
        common=source & slice_shape
        supported=sum(s.volume for s in common.solids()) if common is not None else 0.
        records.append(dict(source_centre_z_mm=centre_z,slice_thickness_mm=thickness,
                            annulus_volume_mm3=slice_shape.volume,source_intersection_mm3=supported,
                            geometric_coverage_fraction=supported/slice_shape.volume))
    # Angular sampling describes gap locations, not an exact unsupported-span
    # bound. Exact volume above independently confirms partial source contact.
    radial_samples=(43.25,44.25,45.25)
    supported_any=[]
    for degree in range(360):
        angle=math.radians(degree)
        supported_any.append(any(source.is_inside((r*math.cos(angle),r*math.sin(angle),-.05)) for r in radial_samples))
    missing=longest_run([not value for value in supported_any])
    if not 0<records[0]['geometric_coverage_fraction']<.999:
        raise ValueError('Expected the actual source to interrupt the proposed contact annulus')
    report=dict(scope='PINNED_ORIGINAL_SOURCE_CONTACT_ONLY',units='mm',print_readiness='NOT_READY',
        source_sha256=digest,checker_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),full_reference=original,contact_inner_radius_proposed_mm=inner,
        contact_outer_radius_proposed_mm=outer,slices=records,
        angular_sampling=dict(resolution_degrees=1,radial_samples_mm=radial_samples,source_z_mm=-.05,
                              longest_sampled_no_support_run_degrees=missing,
                              approximate_centre_radius_arc_length_mm=44.25*math.radians(missing),
                              continuous_span_bound_verified=False),
        actual_C1_C2_C3_contact_verified=False,load_drag_wear_or_material_verified=False,
        limits='Original source only. Partial contact is geometry coverage, not safe load. No new receiver support lands or retained buffer are approved.')
    args.output.write_text(json.dumps(report,indent=2)+'\n')
    print(args.output)


if __name__=='__main__':
    main()
