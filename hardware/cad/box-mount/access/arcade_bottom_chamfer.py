"""Add an outside lower-rim chamfer to the printed arcade shell; deliver inch STEP."""
from __future__ import annotations
import argparse
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import zipfile

from build123d import Align,Box,Cylinder,GeomType,RectangleRounded,Unit,export_step,export_stl,extrude,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'verification'))
from geometry_artifacts import Artifacts,adaptive_mass
import clean_c_base_admission as native
import post_glue_base_gate as gate

PARENT_SHA='b82dc5c2e3f1c5e58b0ae2222c60f6a88a1864e9342b250608bdf7c624ca3560'


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition,message):
    if not condition:raise ValueError(message)


def boolean(first,second,kind):
    return gate.native_boolean_volume(deepcopy(first),deepcopy(second),kind)


def equal(first,second,label):
    differences=[boolean(first,second,'cut'),boolean(second,first,'cut')]
    require(max(differences)<1e-6,label+': '+str(differences))
    return differences


def bottom_edges(shell):
    result=[]
    for edge in shell.edges():
        bounds=edge.bounding_box()
        if abs(bounds.min.Z)>1e-6 or abs(bounds.max.Z)>1e-6:continue
        straight=edge.geom_type==GeomType.LINE and (
            abs(abs(bounds.min.X)-58)<1e-6 and abs(bounds.max.X-bounds.min.X)<1e-6
            or abs(abs(bounds.min.Y)-63)<1e-6 and abs(bounds.max.Y-bounds.min.Y)<1e-6)
        corner=edge.geom_type==GeomType.CIRCLE and abs(edge.radius-12)<1e-6
        if straight or corner:result.append(edge)
    require(len(result)==9,'Changed outside bottom-rim topology; review edge selection')
    require(math.isclose(sum(e.length for e in result),453.39822368615506,abs_tol=1e-6),'Changed bottom perimeter')
    return result


def run(receipt,output,size):
    require(not output.exists(),'Preserve issued exports; use a fresh output directory')
    require(math.isfinite(size) and size>0,'Chamfer size must be finite and positive')
    require(digest(receipt)==PARENT_SHA,'Expected the exact printed two-part arcade model')
    parent=json.loads(receipt.read_text());inputs=Artifacts()
    records=parent['review_components'];require([r['name'] for r in records]==['shell','bottom'],'Wrong parent inventory')
    source={r['name']:inputs.load(r) for r in records}
    before={name:native.fingerprint(shape) for name,shape in source.items()}
    work=deepcopy(source['shell']);edges=bottom_edges(work)
    changed=work.chamfer(size,None,edges)
    require(changed.is_valid and len(changed.solids())==1,'Chamfer did not produce one valid shell')
    require(boolean(changed,source['shell'],'cut')<1e-6,'Chamfer added material')
    removed=deepcopy(source['shell'])-deepcopy(changed)
    removed_mass,_=adaptive_mass(removed)
    require(removed_mass>0,'Chamfer removed no material')
    band=Box(400,400,size+2e-5,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((0,0,-1e-5))
    require(boolean(removed,band,'cut')<1e-6,'Chamfer changed material above the bottom band')
    interior=extrude(RectangleRounded(116-2*(size+.1),126-2*(size+.1),12-size-.1),amount=size+1).translate((0,0,-.5))
    equal(deepcopy(source['shell'])&deepcopy(interior),deepcopy(changed)&deepcopy(interior),'Inner mating rim changed')
    protected=[]
    for joint in parent['checks']['cover_joints']:
        x,y=joint['declared_joint_axis_xy_mm']
        region=Cylinder(6,90,align=(Align.CENTER,Align.CENTER,Align.MIN)).translate((x,y,0))
        differences=equal(deepcopy(source['shell'])&deepcopy(region),deepcopy(changed)&deepcopy(region),'Cover joint changed')
        protected.append(dict(axis_xy_mm=[x,y],two_way_material_difference_mm3=differences))
    faces=[]
    for face in changed.faces():
        bounds=face.bounding_box();nz=abs(face.normal_at().Z)
        if bounds.min.Z>=-1e-6 and bounds.max.Z<=size+1e-6 and .1<nz<.9:
            require(math.isclose(nz,math.sqrt(.5),abs_tol=1e-6),'Bottom bevel is not 45 degrees')
            faces.append(float(face.area))
    require(len(faces)==9,'Expected nine outside-rim chamfer faces')
    parts=dict(shell=changed,bottom=source['bottom']);rows=[];validated=Artifacts()
    output.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='.arcade-step-',dir=output.parent) as temporary:
        staged=Path(temporary)/'packet';staged.mkdir();(staged/'internal-mm').mkdir()
        for old in records:
            name=old['name'];shape=parts[name]
            step=staged/('arcade-box-'+name+'.step');stl=staged/'internal-mm'/('arcade-box-'+name+'.stl')
            # build123d declares STEP units without converting the input coordinates.
            require(export_step(deepcopy(shape).scale(1/25.4,about=(0,0,0)),step,unit=Unit.IN),'Inch STEP export failed')
            restored=import_step(step);require(restored.is_valid and len(restored.solids())==1,'Invalid STEP round trip')
            equal(shape,restored.solids()[0],'STEP changed physical size or material')
            require(export_stl(deepcopy(shape),stl,tolerance=.03,angular_tolerance=.1),'Internal validation mesh export failed')
            mass,error=adaptive_mass(shape);restored_mass,restored_error=adaptive_mass(restored.solids()[0])
            bb=restored.bounding_box()
            row=dict(name=name,role='print',step=str(step),step_sha256=digest(step),stl=str(stl),stl_sha256=digest(stl),
                volume_mm3=mass,restored_volume_mm3=restored_mass,
                mass_integration='native adaptive closed-volume Eps1e-10; original rtol1e-6 unchanged',
                mass_relative_error_estimates=[error,restored_error],
                source_to_print_translation_mm=old['source_to_print_translation_mm'],
                bounds_mm=[[bb.min.X,bb.min.Y,bb.min.Z],[bb.max.X,bb.max.Y,bb.max.Z]],step_coordinate_unit='inch')
            validated.load(row)
            rows.append(row)
        archive=staged/'ARCADE-BUTTON-BOX-STEP-CHAMFER.zip'
        with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
            for row in rows:z.write(row['step'],Path(row['step']).name)
        with zipfile.ZipFile(archive) as z:
            require(z.testzip() is None and sorted(z.namelist())==['arcade-box-bottom.step','arcade-box-shell.step'],'Wrong STEP-only ZIP inventory')
        for name,shape in source.items():require(native.fingerprint(shape)==before[name],'Original printed subject mutated')
        inputs.unchanged();validated.unchanged()
        for row in rows:
            row['step']=str((output/Path(row['step']).name).resolve())
            row['stl']=str((output/'internal-mm'/Path(row['stl']).name).resolve())
        report=dict(scope='TWO_PART_ARCADE_BUTTON_BOX_WITHOUT_BALLAST',units='mm',geometry_checks_pass=True,
            step_coordinate_unit='inch',unit_aware_step_roundtrip_verified=True,
            parent_receipt=dict(path=str(receipt.resolve()),sha256=PARENT_SHA),review_components=rows,
            outside_bottom_chamfer=dict(size_mm=size,size_inches=size/25.4,angle_degrees=45,edge_count=9,
                removed_material_mm3=removed_mass,material_changes_confined_to_outside_bottom_band=True),
            protected_cover_joints=protected,bottom_physical_geometry_unchanged=True,source_subjects_unchanged=True,
            existing_empty_cable_reserves_and_cover_withdrawal_preserved_by_material_subset=True,
            archive=dict(path=str((output/archive.name).resolve()),sha256=digest(archive)),
            source_code_sha256=digest(Path(__file__)),new_chamfer_physical_print_verified=False)
        (staged/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
        require(not output.exists(),'Export target appeared during preparation')
        staged.rename(output)
    print(json.dumps(dict(archive=report['archive'],chamfer=report['outside_bottom_chamfer'],step_coordinate_unit='inch'),indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--receipt',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--chamfer-mm',type=float,default=1.)
    args=p.parse_args();run(args.receipt,args.output,args.chamfer_mm)
