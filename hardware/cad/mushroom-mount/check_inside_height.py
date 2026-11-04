"""Check the issued Leo STEP interior against the operator's 2-inch budget."""
import argparse
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import sys
from build123d import Align,Axis,Box
CAD=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(CAD/'verification'))
sys.path.insert(0,str(CAD/'box-mount/access'))
from geometry_artifacts import Artifacts,digest
from post_glue_base_gate import native_boolean_volume

ISSUED_SHA='2b908fa85febf130e969f0e0c7508fbe9ff52347c7880e6cac872cfe5e2a74e1'
MINIMUM_MM=1.875*25.4
TARGET_MM=2*25.4
FOOTPRINT_MM=45.5  # Existing study width, not a new actual-hardware measurement.
EPS=1e-5


def require(value,message):
    if not value:raise ValueError(message)


def box(height,z):
    return Box(FOOTPRINT_MM,FOOTPRINT_MM,height,
               align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,z))


def intersection(first,second):
    return native_boolean_volume(deepcopy(first),deepcopy(second),'common')


def corridor(parts,floor,height):
    probe=box(height-2*EPS,floor+EPS)
    collisions={name:intersection(shape,probe) for name,shape in parts.items()}
    require(max(collisions.values())<1e-6,'Inside-height corridor obstructed: '+str(collisions))
    return collisions


def run(receipt,output):
    require(not output.exists(),'Use a fresh report path; preserve issued records')
    require(digest(receipt)==ISSUED_SHA,'Expected exact issued Leo receipt')
    record=json.loads(receipt.read_text())
    require(record.get('scope')=='MUSHROOM_LEO_ROOF_DOWN_GUSSETS'
            and record.get('geometry_checks_pass') is True,'Expected checked Leo candidate')
    artifacts=Artifacts();parts={}
    for row in record['review_components']:
        transform=row['source_to_print'];shape=artifacts.load(row)
        parts[row['name']]=shape.translate(tuple(-v for v in transform['translation_mm'])).rotate(
            Axis.X,-transform['rotation_x_degrees'])
    require(set(parts)=={'shell','bottom'},'Expected shell and bottom')
    region=box(80,-5)
    # Crop solid roof material away from the mounting-hole void: the ray at
    # centre is intentionally not the height measurement.
    roof_material=deepcopy(parts['shell']) & deepcopy(region)
    floor_material=deepcopy(parts['bottom']) & deepcopy(region)
    roof_z=roof_material.bounding_box().min.Z
    floor_z=floor_material.bounding_box().max.Z
    roof_faces=[f for f in roof_material.faces() if f.normal_at().Z<-.99
        and abs(f.bounding_box().min.Z-roof_z)<1e-6 and abs(f.bounding_box().max.Z-roof_z)<1e-6]
    floor_faces=[f for f in floor_material.faces() if f.normal_at().Z>.99
        and abs(f.bounding_box().min.Z-floor_z)<1e-6 and abs(f.bounding_box().max.Z-floor_z)<1e-6]
    require(sum(f.area for f in roof_faces)>1000,'No substantial actual underside roof witness')
    require(sum(f.area for f in floor_faces)>1000,'No substantial actual cover-floor witness')
    inside=roof_z-floor_z
    require(math.isclose(roof_z,58,abs_tol=1e-6) and math.isclose(floor_z,3,abs_tol=1e-6),
            'Issued assembly datums changed')
    require(inside>=TARGET_MM-1e-6,'Less than adopted 2-inch inside budget')
    full_corridor=corridor(parts,floor_z,inside)
    target_corridor=corridor(parts,floor_z,TARGET_MM)
    negative_height=inside+1
    try:corridor(parts,floor_z,negative_height)
    except ValueError as error:negative_rejection=str(error)
    else:raise ValueError('Corridor gate admitted 1mm penetration into roof')
    artifacts.unchanged()
    require(digest(receipt)==ISSUED_SHA,'Issued receipt changed during check')
    result=dict(scope='MUSHROOM_INSIDE_HEIGHT_REQUIREMENT',geometry_checks_pass=True,units='mm',
        subject_receipt=dict(path=str(receipt.resolve()),sha256=ISSUED_SHA),actual_artifacts=artifacts.files,
        check_source_sha256=digest(Path(__file__)),
        component_region=dict(width_mm=FOOTPRINT_MM,length_mm=FOOTPRINT_MM,centred_xy_mm=[0,0],
            width_is_existing_study_parameter=True,actual_hardware_width_verified=False),
        actual_roof_underside_z_mm=roof_z,actual_cover_floor_z_mm=floor_z,
        roof_material_witness_area_mm2=sum(f.area for f in roof_faces),
        floor_material_witness_area_mm2=sum(f.area for f in floor_faces),
        usable_inside_height_mm=inside,usable_inside_height_inches=inside/25.4,
        minimum_mm=MINIMUM_MM,adopted_target_mm=TARGET_MM,
        minimum_margin_mm=inside-MINIMUM_MM,target_margin_mm=inside-TARGET_MM,
        signed_target_shortfall_mm=TARGET_MM-inside,unmet_target_shortfall_mm=max(0,TARGET_MM-inside),
        full_height_native_collision_mm3=full_corridor,target_height_native_collision_mm3=target_corridor,
        roof_penetrating_negative_probe_height_mm=negative_height,negative_probe_rejected=True,
        negative_probe_rejection=negative_rejection,
        geometry_changed=False,issued_sourcepins_changed=False,viewer_written=False,
        limits=['Inside enclosure budget, not a new exact OEM rear-height claim.',
                'Full 45.5mm-square existing study footprint checked; actual body width and wiring fit unverified.',
                'No slicer, physical fit, strength or manufacturing approval established.'])
    output.parent.mkdir(parents=True,exist_ok=True)
    with output.open('x') as f:f.write(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(report=str(output.resolve()),sha256=digest(output),inside_mm=inside,
        inside_inches=inside/25.4,target_margin_mm=inside-TARGET_MM,negative_probe_rejected=True)))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--receipt',required=True,type=Path)
    p.add_argument('--output',required=True,type=Path);a=p.parse_args();run(a.receipt,a.output)
