"""Opt-in Leo mushroom check/export. Does not change the baseline selection."""
import argparse
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import sys
import zipfile
from build123d import Axis, extrude, import_step, export_stl
import leo_model as model
import check as old_check
sys.path.insert(0,str(model.baseline.CAD/'verification'))
from geometry_artifacts import Artifacts,adaptive_mass
from arcade_bottom_chamfer import write_inch_step

BASELINE_SHA='130739b02012e2f398197c449e0d3b97398f4b8488891fe001ff05d3ad7a4073'
require=old_check.require
digest=old_check.digest
intersection=old_check.intersection


def difference(a,b):
    return old_check.native_boolean_volume(deepcopy(a),deepcopy(b),'cut')


def equal(a,b,label):
    values=[difference(a,b),difference(b,a)]
    require(max(values)<1e-6,label+': '+str(values));return values


def inputs():
    # Pin only actually loaded project modules, plus both scene entry points.
    paths={Path(m.__file__).resolve() for m in list(sys.modules.values())
           if getattr(m,'__file__',None) and Path(m.__file__).resolve().is_relative_to(model.baseline.CAD)}
    paths.update([Path(__file__).resolve(),model.HERE/'leo_scene.py',model.HERE/'sources.json'])
    return {str(p.relative_to(model.baseline.CAD)):digest(p) for p in sorted(paths)}


def run(receipt,output,roof_down):
    require(roof_down,'Explicit --roof-down required; this revision addresses that pose only')
    require(not output.exists(),'Preserve issued exports; use fresh output')
    require(digest(receipt)==BASELINE_SHA,'Wrong baseline receipt')
    parent=json.loads(receipt.read_text());artifacts=Artifacts()
    before={r['name']:artifacts.load(r).translate(tuple(-v for v in r['source_to_print_translation_mm']))
            for r in parent['review_components']}
    data=model.build();parts=data['parts'];shell,bottom=parts.values();old=data['original_shell']
    equal(old,before['shell'],'Generated baseline shell differs from checked baseline')
    equal(bottom,before['bottom'],'Bottom changed')
    require(difference(old,shell)<1e-6,'Candidate removes baseline material')
    added=shell-old
    masks=[model.baseline.cylinder(8,16,15,xy) for xy in model.AXES]
    allowed=deepcopy(masks[0])
    for m in masks[1:]:allowed+=m
    require(difference(added,allowed)<1e-6,'Change exceeds four roofward boss regions')
    require(intersection(added,model.baseline.block(200,200,15,0))<1e-6,'Cover/mating/nut datums changed')
    require(intersection(added,model.baseline.block(200,200,30,32))<1e-6,'Roof and mounting hole changed')
    def slope_gate(shape):
        posed=deepcopy(shape).rotate(Axis.X,180).translate((0,0,62))
        faces=[]
        for f in posed.faces():
            bb=f.bounding_box();nz=f.normal_at().Z
            if bb.min.Z>=31-1e-6 and bb.max.Z<=47+1e-6 and nz<-.1:
                require(math.isclose(nz,-math.sqrt(.5),abs_tol=1e-6),'Non-45-degree print-facing boss underside')
                faces.append(dict(area_mm2=f.area,print_bounds_mm=[list(bb.min),list(bb.max)],print_normal=list(f.normal_at())))
        require(len(faces)==8,'Expected two visible slope faces per boss')
        return faces
    try:slope_gate(old)
    except ValueError:baseline_rejected=True
    else:raise ValueError('Slope gate admitted flat baseline caps')
    slopes=slope_gate(shell)
    old_caps=[f for f in old.faces() if abs(f.bounding_box().min.Z-15)<1e-6
              and abs(f.bounding_box().max.Z-15)<1e-6 and f.normal_at().Z>.9]
    require(len(old_caps)==4,'Baseline cap audit changed')
    attachments=[]
    for wedge in data['wedges']:
        overlap=intersection(wedge,old);require(overlap>1,'Ramp not joined to original walls')
        attachments.append(overlap)
    require(intersection(shell,bottom)<1e-6,'Cover overlap')
    for name,p in parts.items():require(p.is_valid and len(p.solids())==1,'Invalid '+name)
    require(intersection(shell,data['mounting'])<1e-6,'Mounting passage blocked')
    for ref in data['reference']:require(intersection(shell,ref)<1e-6,'Reference envelope blocked')
    for route in data['exits']:require(intersection(route,shell+bottom)<1e-6,'Cable route blocked')
    joints=model.baseline.retention.check_joints(data['covers']['pairs'],shell+bottom)
    loading=model.baseline.retention.verify_nut_loading(data['covers']['pairs'],shell)
    for j in data['covers']['pairs']:
        require(intersection(model.baseline.cylinder(1.15,85,j.length_datum_z-85,j.expected_xy),shell+bottom)<1e-6,'Key blocked')
    withdrawal=deepcopy(bottom)
    for f in bottom.faces():
        if f.normal_at().Z>.9:withdrawal+=extrude(deepcopy(f),amount=-85,dir=(0,0,1))
    require(intersection(withdrawal,shell)<1e-6,'Cover withdrawal blocked')
    require(intersection(model.baseline.cylinder(14.7,79.3,58-79.3),shell)<1e-6,'OEM tool blocked')
    require(intersection(model.baseline.cylinder(14.5,3,55),shell)<1e-6,'OEM ring region blocked')
    pins=inputs();output.mkdir(parents=True);rows=[];actual=Artifacts()
    for name,shape in parts.items():
        angle=180 if name=='shell' else 0;translation=[0,0,62] if name=='shell' else [0,0,0]
        posed=deepcopy(shape).rotate(Axis.X,angle).translate(translation)
        require(abs(posed.bounding_box().min.Z)<1e-6,'Print not grounded')
        step=output/f'mushroom-leo-{name}.step';stl=output/f'mushroom-leo-{name}.stl'
        contexts=write_inch_step(posed,step)
        require(export_stl(deepcopy(posed),stl,tolerance=.025,angular_tolerance=.1),'STL failed')
        restored=import_step(step).solids()[0];equal(posed,restored,'STEP roundtrip changed '+name)
        mass,error=adaptive_mass(posed);mass2,error2=adaptive_mass(restored);bb=posed.bounding_box()
        row=dict(name=name,step=str(step.resolve()),step_sha256=digest(step),stl=str(stl.resolve()),stl_sha256=digest(stl),
            volume_mm3=mass,restored_volume_mm3=mass2,mass_relative_error_estimates=[error,error2],
            mass_integration='native adaptive closed-volume Eps1e-10; original rtol1e-6 unchanged',
            source_to_print=dict(rotation_x_degrees=angle,translation_mm=translation),
            bounds_mm=[list(bb.min),list(bb.max)],step_coordinate_unit='inch',active_step_length_contexts=contexts)
        actual.load(row);rows.append(row)
    actual.unchanged();artifacts.unchanged()
    for relative,sha in pins.items():require(digest(model.baseline.CAD/relative)==sha,'Changed source during checks')
    archive=output/'MUSHROOM-LEO-INCH-STEP.zip'
    with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
        for row in rows:z.write(row['step'],Path(row['step']).name)
    with zipfile.ZipFile(archive) as z:
        require(z.testzip() is None and sorted(z.namelist())==['mushroom-leo-bottom.step','mushroom-leo-shell.step'],'Wrong STEP ZIP')
    old_check.render([(shell,(209,179,148),(0,0,0)),(bottom,(182,154,126),(95,0,0)),
        *[(s,c,(0,0,0)) for s,c in zip(data['reference'],[(50,50,55),(36,36,40),(210,40,40)])]],output/'review.png')
    # Open side, roof down: reveal all four new ramps for review without altering exports.
    cut=model.baseline.block(160,50,100,-10,(0,-44))
    old_check.render([((shell-cut).rotate(Axis.X,180).translate((0,0,62)),(209,179,148),(0,0,0))],output/'ramp-review.png')
    report=dict(scope='MUSHROOM_LEO_ROOF_DOWN_GUSSETS',geometry_checks_pass=True,units='mm',step_coordinate_unit='inch',
        parent_receipt=dict(path=str(receipt.resolve()),sha256=BASELINE_SHA),source_sha256=pins,
        review_components=rows,features=data['features'],slope_faces=slopes,
        baseline_flat_overhang_caps=len(old_caps),flat_baseline_rejected_by_print_slope_gate=baseline_rejected,
        ramp_wall_attachment_volume_mm3=attachments,
        changes_additive_and_confined=True,bottom_unchanged=True,all_material_below_z15_unchanged=True,
        cover_joints=joints,cover_nut_loading=loading,cover_key_access_mm=85,continuous_cover_withdrawal_mm=85,
        cable_reserves_clear=True,oem_tool_clear_with_contacts_and_cover_removed=True,
        hole_mm=23,roof_thickness_mm=4,counterbore=False,
        print_pose=dict(shell='roof down; rotate X180 then translate Z62 mm',bottom='unchanged flat underside down'),
        baseline_selection_unchanged=True,physical_fit_verified=False,manufacturing_approved=False,
        slicer_support_free_verified=False,
        limitations=['45-degree CAD surfaces verified for four boss caps only; not whole-part support approval.',
            'Horizontal captive-nut pocket ceilings and small bores are retained; slicer/bridge review required.',
            'Actual material, printer, layer settings, strength and physical fits remain unverified.'],
        archive=dict(path=str(archive.resolve()),sha256=digest(archive)))
    target=output/'receipt.json';target.write_text(json.dumps(report,indent=2)+'\n')
    selection=dict(path=str(target.resolve()),sha256=digest(target))
    (output/'selection.json').write_text(json.dumps(selection,indent=2)+'\n')
    print(json.dumps(selection))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--baseline-receipt',required=True,type=Path)
    p.add_argument('--output',required=True,type=Path);p.add_argument('--roof-down',action='store_true')
    args=p.parse_args();run(args.baseline_receipt,args.output,args.roof_down)
