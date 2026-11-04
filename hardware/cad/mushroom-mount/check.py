"""Export and check actual two-part mushroom STEP/STL; never publish a viewer."""
import argparse
from copy import deepcopy
import hashlib
import json
import math
from pathlib import Path
import sys
import zipfile
import numpy as np
import trimesh
from build123d import import_step, export_step, export_stl
import model
sys.path.insert(0,str(model.CAD/'verification'))
from geometry_artifacts import Artifacts, adaptive_mass
from post_glue_base_gate import native_boolean_volume


def require(ok,message):
    if not ok:raise ValueError(message)


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def intersection(a,b):return native_boolean_volume(deepcopy(a),deepcopy(b),'common')


def render(parts,path):
    """Small offline mesh review; source dimensions remain the CAD authority."""
    from PIL import Image,ImageDraw
    image=Image.new('RGB',(1200,850),'#f5f3ef');draw=ImageDraw.Draw(image)
    meshes=[];all_uv=[]
    for shape,color,shift in parts:
        vertices,indices=shape.tessellate(.3,.2)
        xyz=np.array([tuple(v) for v in vertices])+np.array(shift)
        uv=np.stack(((xyz[:,0]-xyz[:,1])*.707,
            xyz[:,2]*.816-(xyz[:,0]+xyz[:,1])*.408),axis=1)
        meshes.append((xyz,uv,indices,color));all_uv.extend(uv)
    bounds=np.array(all_uv);low=bounds.min(axis=0);high=bounds.max(axis=0)
    scale=min(1100/(high[0]-low[0]),730/(high[1]-low[1]))
    pixels=np.array(image);zbuffer=np.full((850,1200),-np.inf)
    for xyz,uv,indices,color in meshes:
        projected=np.stack((50+(uv[:,0]-low[0])*scale,800-(uv[:,1]-low[1])*scale),axis=1)
        depth=xyz[:,0]+xyz[:,1]+xyz[:,2]
        for f in indices:
            ids=list(f);a,b,c=projected[ids]
            normal=np.cross(xyz[ids[1]]-xyz[ids[0]],xyz[ids[2]]-xyz[ids[0]])
            norm=np.linalg.norm(normal)
            denominator=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
            if norm==0 or abs(denominator)<1e-10:continue
            x0=max(0,int(min(a[0],b[0],c[0])));x1=min(1200,int(max(a[0],b[0],c[0]))+1)
            y0=max(0,int(min(a[1],b[1],c[1])));y1=min(850,int(max(a[1],b[1],c[1]))+1)
            yy,xx=np.mgrid[y0:y1,x0:x1];xx=xx+.5;yy=yy+.5
            wa=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/denominator
            wb=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/denominator
            wc=1-wa-wb;z=wa*depth[ids[0]]+wb*depth[ids[1]]+wc*depth[ids[2]]
            mask=(wa>=0)&(wb>=0)&(wc>=0)&(z>zbuffer[y0:y1,x0:x1])
            shade=.65+.35*abs(np.dot(normal/norm,np.array([.3,-.5,.8])))
            pixels[y0:y1,x0:x1][mask]=tuple(int(min(255,v*shade)) for v in color)
            zbuffer[y0:y1,x0:x1][mask]=z[mask]
    image=Image.fromarray(pixels);draw=ImageDraw.Draw(image)
    draw.text((25,20),'NHD NPB22-M611R nominal study | mm | fit unverified',fill='black')
    image.save(path)


def run(output):
    require(not output.exists(),'Use a fresh output namespace')
    data=model.build();parts=data['parts'];shell,bottom=parts.values()
    require(model.P['roof_thickness']<=model.NHD['maximum_panel_thickness'],'Panel too thick')
    require(intersection(shell,bottom)<1e-6,'Prints overlap')
    for p in parts.values():require(p.is_valid and len(p.solids())==1,'Invalid solid')
    require(intersection(shell,data['mounting'])<1e-6,'Mounting passage blocked')
    for shape in data['reference']:require(intersection(shape,shell)<1e-6,'Nominal reference hits shell')
    joints=model.retention.check_joints(data['covers']['pairs'],shell+bottom)
    nut_loading=model.retention.verify_nut_loading(data['covers']['pairs'],shell)
    tools=[]
    for j in data['covers']['pairs']:
        x,y=j.expected_xy;tool=model.cylinder(1.15,85,-85+j.length_datum_z,(x,y))
        require(intersection(tool,shell+bottom)<1e-6,'Cover hex key obstructed')
        tools.append(dict(axis_xy_mm=[x,y],straight_key_radius_mm=1.15,below_access_mm=85))
    # Sweep every upward-facing bottom face downward: continuous axial removal.
    withdrawal=deepcopy(bottom)
    from build123d import extrude
    for f in bottom.faces():
        if f.normal_at().Z>.9:withdrawal+=extrude(deepcopy(f),amount=-85,dir=(0,0,1))
    require(intersection(withdrawal,shell)<1e-6,'Cover cannot withdraw')
    # NHD PPB22-02T OD29.4, length79.3. Contacts detach before axial ring tool use.
    ring_tool=model.cylinder(14.7,79.3,58-79.3)
    require(intersection(ring_tool,shell)<1e-6,'OEM mounting-ring tool hits shell')
    require(intersection(model.cylinder(14.5,3,55),shell)<1e-6,'OEM nominal ring seat blocked')
    for route in data['exits']:
        require(intersection(route,shell+bottom)<1e-6,'Cable seam route blocked')
    chamfer_faces=[f for f in shell.faces() if f.bounding_box().min.Z>=3-1e-6
        and f.bounding_box().max.Z<=4+1e-6 and .1<abs(f.normal_at().Z)<.9]
    require(len(chamfer_faces)==10,'Outside chamfer topology changed')
    require(all(math.isclose(abs(f.normal_at().Z),math.sqrt(.5),abs_tol=1e-6) for f in chamfer_faces),'Wrong chamfer angle')
    output.mkdir(parents=True);records=[];actual=Artifacts()
    for name,shape in parts.items():
        dz=-shape.bounding_box().min.Z;grounded=shape.translate((0,0,dz))
        step=output/f'mushroom-{name}.step';stl=output/f'mushroom-{name}.stl'
        require(export_step(grounded,step),'STEP export failed')
        require(export_stl(grounded,stl,tolerance=.025,angular_tolerance=.1),'STL export failed')
        restored=import_step(step).solids()[0]
        require(native_boolean_volume(deepcopy(grounded),deepcopy(restored),'cut')<1e-6,'STEP lost material')
        require(native_boolean_volume(deepcopy(restored),deepcopy(grounded),'cut')<1e-6,'STEP added material')
        volume,error=adaptive_mass(grounded);mass,err2=adaptive_mass(restored)
        bb=grounded.bounding_box()
        row=dict(name=name,step=str(step.resolve()),stl=str(stl.resolve()),step_sha256=digest(step),stl_sha256=digest(stl),
            volume_mm3=volume,restored_volume_mm3=mass,mass_relative_error_estimates=[error,err2],
            mass_integration='native adaptive closed-volume Eps1e-10; original rtol1e-6 unchanged',
            source_to_print_translation_mm=[0,0,dz],bounds_mm=[list(bb.min),list(bb.max)])
        actual.load(row);records.append(row)
    actual.unchanged()
    archive=output/'MUSHROOM-TWO-PART-STL.zip'
    with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
        for row in records:z.write(row['stl'],Path(row['stl']).name)
    with zipfile.ZipFile(archive) as z:
        require(z.testzip() is None and sorted(z.namelist())==['mushroom-bottom.stl','mushroom-shell.stl'],'Wrong print inventory')
    render([(shell,(209,179,148),(0,0,0)),(bottom,(182,154,126),(95,0,0)),
            *[(s,c,(0,0,0)) for s,c in zip(data['reference'],[(50,50,55),(36,36,40),(210,40,40)])]],output/'review.png')
    report=dict(scope='TWO_PART_MUSHROOM_NOMINAL_DRAWING_STUDY',units='mm',geometry_checks_pass=True,
        physical_fit_verified=False,manufacturing_approved=False,parameters=model.P,manufacturer_nominals=model.NHD,
        source_sha256={p.name:digest(p) for p in Path(__file__).parent.glob('*.py')},
        dependency_sha256={str(p.relative_to(model.CAD)):digest(p) for p in [
            *sorted((model.CAD/'box-mount/access').glob('*.py')),
            model.CAD/'box_mount.py', model.CAD/'verification/geometry_artifacts.py']},
        sources_json_sha256=digest(Path(__file__).parent/'sources.json'),
        manufacturer_sources=json.loads((Path(__file__).parent/'sources.json').read_text()),
        review_components=records,cover_joints=joints,cover_nut_loading=nut_loading,cover_key_access=tools,
        continuous_cover_withdrawal_mm=85,roof_within_manufacturer_panel_limit=True,
        oem_mounting_ring_tool=dict(model='PPB22-02T',outside_diameter_mm=29.4,length_mm=79.3,
            cover_removed=True,contact_blocks_removed_before_tool_use=True,continuous_axial_shell_clearance=True,
            actual_ring_engagement_and_hand_access_verified=False),
        rear_study_width_mm=45.5,rear_width_is_manufacturer_dimension=False,
        rear_axial_reserve_above_bottom_mm=11.5,cable_seam_exits_mm=[12,8],actual_connector_and_bend_fit_verified=False,
        chamfer=dict(size_mm=1,angle_degrees=45,outside_shell_lower_rim=True,face_count=10),
        archive=dict(path=str(archive.resolve()),sha256=digest(archive)),
        limitations=['No exact OEM CAD; simplified reference with unmeasured rear width and head profile.',
            'Stock mounting ring and antirotation feature need actual hardware fit check.',
            'No printer, material, slicer, strength or stability verification.'])
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
    selection=model.CAD/'build/mushroom-mount/current.json'
    selection.parent.mkdir(parents=True,exist_ok=True)
    selection.write_text(json.dumps(dict(path=str((output/'receipt.json').resolve()),sha256=digest(output/'receipt.json')),indent=2)+'\n')
    print(json.dumps(dict(receipt=str((output/'receipt.json').resolve()),receipt_sha256=digest(output/'receipt.json'),geometry_checks_pass=True)))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',required=True,type=Path)
    run(p.parse_args().output)
