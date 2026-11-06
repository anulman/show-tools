"""Unvalidated flat-panel spinner mount with a wider stationary foot."""
from __future__ import annotations
import argparse,hashlib,json,math
from copy import deepcopy
from dataclasses import asdict,dataclass
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import air_gap_c_mount as previous
from build123d import RectangleRounded,extrude,import_step,export_step,Compound

g=previous.g


@dataclass(frozen=True)
class Study:
    roof_to_ground_mm:float|None=None
    body_width_mm:float=116.
    body_depth_mm:float=116.
    corner_radius_mm:float=12.
    roof_thickness_mm:float=3.
    nominal_drawing_body_diameter_mm:float=28.
    proposed_hole_diameter_mm:float=29.
    nominal_drawing_shoulder_diameter_mm:float=34.
    foot_extension_each_side_mm:float=25.4
    foot_thickness_mm:float=6.
    bottom_removal_side_allowance_mm:float=.5
    upper_replacement_depth_mm:float=20.
    cable_exit_width_mm:float=10.
    cable_exit_height_mm:float=9.5


def rounded(width,depth,radius,height,z):
    return extrude(RectangleRounded(width,depth,radius),amount=height).translate((0,0,z))


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def build(selection,p=Study()):
    manifest=json.loads(selection.read_bytes());inputs={str(selection.resolve()):digest(selection)}
    records={r['name']:r for r in manifest['base_components']}
    actual={}
    for name in ('shell','bottom'):
        r=records[name]
        for kind in ('step','stl'):
            path=Path(r[kind]);assert digest(path)==r[kind+'_sha256'];inputs[str(path)]=digest(path)
        actual[name]=import_step(r['step']).solids()[0]
    shell=actual['shell'];bottom=actual['bottom']
    shift=0. if p.roof_to_ground_mm is None else -bottom.bounding_box().min.Z-p.roof_to_ground_mm
    shell=shell.translate((0,0,shift));bottom=bottom.translate((0,0,shift))
    floor=shell.bounding_box().min.Z
    ground=bottom.bounding_box().min.Z
    # Keep the lower shell, bottom fasteners, cable outlets, and fixed tie eyes.
    cutter=g.r.block(300,300,100,(0,0,-p.upper_replacement_depth_mm+.1))
    lower=deepcopy(shell)-cutter
    outer=rounded(p.body_width_mm,p.body_depth_mm,p.corner_radius_mm,p.upper_replacement_depth_mm,-p.upper_replacement_depth_mm)
    inner=rounded(p.body_width_mm-10,p.body_depth_mm-10,p.corner_radius_mm-5,p.upper_replacement_depth_mm+2,-p.upper_replacement_depth_mm-1)
    wall=outer-inner
    roof=rounded(p.body_width_mm,p.body_depth_mm,p.corner_radius_mm,p.roof_thickness_mm,-p.roof_thickness_mm)
    roof-=g.cad.cyl(p.proposed_hole_diameter_mm/2,p.roof_thickness_mm+2,-p.roof_thickness_mm-1)
    width=p.body_width_mm+2*p.foot_extension_each_side_mm
    depth=p.body_depth_mm+2*p.foot_extension_each_side_mm
    radius=p.corner_radius_mm+p.foot_extension_each_side_mm
    foot=rounded(width,depth,radius,p.foot_thickness_mm,ground)
    # A stepped opening leaves the original bottom removable below the flange.
    lower_opening=rounded(p.body_width_mm+2*p.bottom_removal_side_allowance_mm,
        p.body_depth_mm+2*p.bottom_removal_side_allowance_mm,
        p.corner_radius_mm+p.bottom_removal_side_allowance_mm,floor-ground+.1,ground-.1)
    upper_opening=rounded(p.body_width_mm-10,p.body_depth_mm-10,p.corner_radius_mm-5,
                         p.foot_thickness_mm+1,ground-.5)
    foot=foot-lower_opening-upper_opening-deepcopy(bottom)
    # Preserve every existing lower-shell void, including corner nut pockets.
    # A plain rounded ring would fill the outer tips of those hex pockets.
    original_body_clip=rounded(p.body_width_mm,p.body_depth_mm,p.corner_radius_mm,p.foot_thickness_mm,ground)
    foot-=original_body_clip-deepcopy(shell)
    # Extend the existing -Y cable route through the wider foot. Its floor and
    # cross section retain the former channel's datums; the tie eyes stay fixed.
    route_length=depth/2+10
    route=g.r.block(p.cable_exit_width_mm,route_length,p.cable_exit_height_mm,
                    (0,-route_length/2,floor-1.5))
    foot-=route
    result=lower+wall+roof+foot
    return dict(shell=result,bottom=bottom,source_shell=shell,source_bottom=bottom,
                floor_z_mm=floor,ground_z_mm=ground,source_lower_translation_mm=shift,parameters=p,input_files=inputs)


def preview(data,output):
    assert not output.exists();output.mkdir(parents=True)
    records=[]
    for name in ('shell','bottom'):
        shape=data[name];path=output/('panel-mount-concept-'+name+'.step')
        assert shape.is_valid and len(shape.solids())==1
        assert export_step(deepcopy(shape),path)
        restored=import_step(path)
        assert restored.is_valid and len(restored.solids())==1
        b=shape.bounding_box()
        records.append(dict(name=name,step=str(path.resolve()),sha256=digest(path),valid_single_solid=True,
                            bounds_mm=[[b.min.X,b.min.Y,b.min.Z],[b.max.X,b.max.Y,b.max.Z]]))
    assembly=output/'panel-mount-concept-assembly.step'
    assert export_step(Compound(children=[deepcopy(data[n]).solids()[0] for n in ('shell','bottom')]),assembly)
    own=Path(__file__).resolve();data['input_files'][str(own)]=digest(own)
    receipt=dict(scope='UNVALIDATED_PANEL_MOUNT_BOX_CONCEPT_NOT_PRINT_APPROVAL',units='mm',
        parameters=asdict(data['parameters']),preview_components=records,
        preview_assembly=dict(path=str(assembly.resolve()),sha256=digest(assembly)),input_files=data['input_files'],
        source_lower_translation_mm=data['source_lower_translation_mm'],
        old_hex_well_and_keepers_obsolete=True,no_ballast=True,
        interpretation='Fixed flange bottom is on roofZ0; knob underside aligns with flange top. Earlier3/32in gap interpretation is invalid.',
        reported_measurements=dict(fixed_flange_axial_thickness_mm=2.38125,
            visible_knob_underside_to_flange_top_gap_mm=0.,
            basis='Corrected operator description: rough3/32in is fixed flange thickness, no visible gap above flange; not precision metrology'),
        nominal_interface=dict(roof_top_z_mm=0.,fixed_flange_bottom_z_mm=0.,
            fixed_flange_top_z_mm=2.38125,knob_underside_z_mm=2.38125,
            flange_thickness_is_approximate=True,actual_rotating_shaft_dimensions_unknown=True),
        actual_hardware_fit_verified=False,actual_roof_to_knob_underside_fit_verified=False,
        geometry_checks_complete=False,
        strength_verified=False,stability_verified=False,manufacturing_approved=False,
        pending=['Precision confirmation of fixed flange thickness and actual rotating shaft clearance','Actual body, flange, nut and thread dimensions',
                 'Native bottom removal, joint/cable preservation, and ordinary nut-tool access checks',
                 'Combination with the separately proposed flared rotating clamp','Roof stiffness and loaded tipping assessment'])
    path=output/'preview-receipt.json';path.write_text(json.dumps(receipt,indent=2)+'\n')
    print(path,flush=True);print(digest(path),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--selection',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--roof-to-ground-mm',type=float)
    args=parser.parse_args()
    if args.roof_to_ground_mm is not None and (not math.isfinite(args.roof_to_ground_mm) or args.roof_to_ground_mm<=0):
        parser.error('--roof-to-ground-mm must be finite and positive')
    preview(build(args.selection,Study(roof_to_ground_mm=args.roof_to_ground_mm)),args.output)
