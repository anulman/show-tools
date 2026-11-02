"""Verify nominal full-depth spinner space and preserved lower mount geometry."""
import argparse
import json
import math
from pathlib import Path

from build123d import Box, Cylinder, Align, import_step
import panel_mount_box_concept as concept


def parts(receipt):
    data=json.loads(receipt.read_text())
    result={}
    for row in data['preview_components']:
        path=Path(row['step'])
        assert concept.digest(path)==row['sha256']
        shape=import_step(path)
        assert shape.is_valid and len(shape.solids())==1
        result[row['name']]=shape.solids()[0]
    return data,result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--receipt',type=Path,required=True)
    parser.add_argument('--previous',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    report,new=parts(args.receipt);_,old=parts(args.previous)
    shell,bottom=new['shell'],new['bottom']
    shift=report['source_lower_translation_mm']
    facts_path=Path(__file__).resolve().parents[2]/'fabrication/interface-facts.json'
    facts=json.loads(facts_path.read_text())['spinner']['nominal_axial_dimensions_below_fixed_flange_mm']
    assert [facts[k] for k in ('threaded_body','encoder_housing','rear_shaft_extension')]==[28,15,16]
    assert facts['total']==59
    g=concept.g
    values={}
    with concept.previous.inherited.detached_booleans():
        values['cover_preserved_symmetric_difference_mm3']=g.outside_volume(bottom,old['bottom'].translate((0,0,shift)))+g.outside_volume(old['bottom'].translate((0,0,shift)),bottom)
        lower_clip=Box(400,400,200).translate((0,0,-120.1))
        a=shell&lower_clip;b=old['shell'].translate((0,0,shift))&lower_clip
        values['lower_features_preserved_symmetric_difference_mm3']=g.outside_volume(a,b)+g.outside_volume(b,a)
        upper_clip=Box(400,400,200).translate((0,0,80))
        a=shell&upper_clip;b=old['shell']&upper_clip
        values['roof_and_upper_interface_preserved_symmetric_difference_mm3']=g.outside_volume(a,b)+g.outside_volume(b,a)
        body=Cylinder(14,43,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,-43))
        tail=Cylinder(14,16,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,-59))
        for name,shape in [('body_and_encoder',body),('rear_shaft',tail)]:
            for fixed,part in new.items():values[name+'_'+fixed+'_overlap_mm3']=g.intersection(shape,part)
        centre=bottom&Cylinder(14,200,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,-150))
        cover_top=centre.bounding_box().max.Z
        clearance=-59-cover_top
        values['shell_bottom_overlap_mm3']=g.intersection(shell,bottom)
        tool=concept.g.cad.cyl(25,100,-103)
        values['reserved_50mm_underroof_tool_space_overlap_mm3']=g.intersection(shell,tool)
    assert all(math.isfinite(v) and 0<=v<1e-5 for v in values.values()),values
    assert math.isclose(-bottom.bounding_box().min.Z,64,abs_tol=1e-6)
    assert math.isclose(clearance,2,abs_tol=1e-6),clearance
    assert math.isclose(cover_top-bottom.bounding_box().min.Z,3,abs_tol=1e-6)
    result=dict(scope='NOMINAL_LOW_PANEL_MOUNT_GEOMETRY_CHECK',geometry_checks_pass=True,
        receipt=dict(path=str(args.receipt.resolve()),sha256=concept.digest(args.receipt)),
        previous=dict(path=str(args.previous.resolve()),sha256=concept.digest(args.previous)),
        dimensions=dict(manufacturer_flange_to_shaft_tip_mm=28+15+16,
            general_bottom_thickness_within_device_footprint_mm=3,shaft_tip_to_cover_mm=clearance,roof_to_ground_mm=64),
        source_facts=dict(path=str(facts_path),sha256=concept.digest(facts_path)),
        checks=values,physical_fit_verified=False,manufacturing_approved=False,
        limitations=['Nominal manufacturer envelopes; actual hardware and printer tolerances unverified',
            'Rear-shaft clearance conservatively uses the full nominal 28mm body footprint; narrow cable groove is not counted as general clearance',
            'Retained lower geometry equality preserves existing joints and side cable route; no new harness bend allowance'])
    assert not args.output.exists()
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
