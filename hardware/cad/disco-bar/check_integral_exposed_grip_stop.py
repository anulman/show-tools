"""Actual preservation/nominal-stop checks and real controls; no measured knob contact claim."""
import argparse,importlib,json,sys,math
import numpy as np
from copy import deepcopy
from pathlib import Path
from build123d import Compound,export_step,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
v=importlib.import_module('disco-bar.check_post_glue_candidates')
f=importlib.import_module('disco-bar.integral_exposed_grip');a=f.a;c=f.c;u=f.u


def op(kind,x,y):return a.channel_boolean(kind,deepcopy(x).wrapped,deepcopy(y).wrapped)
def volume(kind,x,y):return a.channel_material_volume(op(kind,x,y))
def empty(kind,x,y,label):
    v=volume(kind,x,y)
    if v>1e-5:raise ValueError(label+': '+str(v))
    return v


def validate(ref,body,E):
    retained=empty(a.BRepAlgoAPI_Cut,ref,body,'Original bar material removed')
    mask=c.cyl(80,110,(0,0,-55))
    added=Compound(op(a.BRepAlgoAPI_Cut,body,ref));negative=Compound(op(a.BRepAlgoAPI_Common,added,mask))
    outside=empty(a.BRepAlgoAPI_Cut,negative,c.pocket(),'Added original-region material outside old central socket void')
    channels={}
    for n,q in a.source_channels(ref).items():
        before=Compound(op(a.BRepAlgoAPI_Common,ref,q['envelope']));after=Compound(op(a.BRepAlgoAPI_Common,body,q['envelope']))
        channels[n]=dict(original_material_differences_mm3=[empty(a.BRepAlgoAPI_Cut,before,after,'Debond material removed'),empty(a.BRepAlgoAPI_Cut,after,before,'Debond lumen blocked')],extension_added_material_mm3=empty(a.BRepAlgoAPI_Common,body,c.cyl(q['radius_mm'],E,(*q['center_xy_mm'],E/2)),'Extended lumen blocked'))
    pocket=c.pocket().translate((0,0,E));floor=c.cyl(c.R,1.5875,(0,0,E-26.19375))
    void=empty(a.BRepAlgoAPI_Common,body,pocket,'Relocated pocket blocked')
    missing=empty(a.BRepAlgoAPI_Cut,floor,body,'Relocated full floor missing')
    knob=c.cyl(c.R,25.4,(0,0,E-12.7));nominal=empty(a.BRepAlgoAPI_Common,knob,body,'Nominal socket-cylinder knob blocked')
    contact=volume(a.BRepAlgoAPI_Common,knob.translate((0,0,-.01)),body)
    if contact<=1e-5:raise ValueError('Nominal top-stop witness missing')
    return dict(all_original_material_retained_mm3=retained,negative_z_addition_outside_original_socket_mm3=outside,channels=channels,relocated_pocket_added_material_mm3=void,full_floor_missing_material_mm3=missing,nominal_cylinder_added_material_mm3=nominal,nominal_top_stop_0p01_overtravel_mm3=contact,nominal_top_contact_is_not_measured_knob_contact=True)


def run(concept,reference,output):
    if output.exists():raise ValueError('Use a fresh stop-check namespace')
    output.mkdir(parents=True);data=json.loads(concept.read_text());E=data['exploratory_parameters']['exposure_below_original_root_mm']
    pins={str(concept.resolve()):f.digest(concept),str(reference.resolve()):f.digest(reference)}
    for mod in (sys.modules[__name__],f,a,c,u,v):pins[str(Path(mod.__file__).resolve())]=f.digest(mod.__file__)
    parts={};mesh_checks=[]
    import trimesh
    for r in data['components']:
        for k in ('step','stl'):
            if f.digest(r[k])!=r[k+'_sha256']:raise ValueError('Changed actual stop input')
            pins[r[k]]=r[k+'_sha256']
        s=import_step(r['step'])
        if not s.is_valid or len(s.solids())!=1:raise ValueError('Invalid actual stop component')
        mesh=trimesh.load_mesh(r['stl'])
        if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume<=0:raise ValueError('Invalid stop STL')
        part=s.solids()[0];mass,error=v.accurate_mass(part);bounds=part.bounding_box()
        if not math.isclose(mesh.volume,mass,rel_tol=.005):raise ValueError('Actual STEP/STL volumes differ')
        if not np.allclose(mesh.bounds,[[bounds.min.X,bounds.min.Y,bounds.min.Z],[bounds.max.X,bounds.max.Y,bounds.max.Z]],atol=.05,rtol=0):raise ValueError('Actual STEP/STL bounds differ')
        mesh_checks.append(dict(name=r['name'],native_adaptive_volume_mm3=mass,mesh_volume_mm3=float(mesh.volume),mass_relative_error=error))
        parts[r['name']]=part
    body=parts[data['components'][0]['name']];_,ref=f.disco_bar.load_reference(reference);f.disco_bar.verify_full_reference(reference,ref)
    result=validate(ref,body,E);controls={}
    channel=next(iter(a.source_channels(ref).values()))
    mutants={'shortened original bar':deepcopy(body)-c.cyl(80.,1.,(0,0,-108.72)),'blocked extended debond lumen':deepcopy(body)+c.cyl(channel['radius_mm']+.2,1.,(*channel['center_xy_mm'],E/2)), 'missing nominal stop floor':deepcopy(body)-c.cyl(c.R,2.,(0,0,E-25.9))}
    for name,mutant in mutants.items():
        if not mutant.is_valid or len(mutant.solids())!=1:raise ValueError('Control mutant invalid')
        path=output/(name.replace(' ','-')+'.step');export_step(deepcopy(mutant),path);actual=import_step(path).solids()[0]
        try:validate(ref,actual,E)
        except ValueError as error:controls[name]=dict(rejected=True,reason=str(error),step=str(path),sha256=f.digest(path))
        else:raise AssertionError('Actual stop mutant admitted: '+name)
    restored=validate(ref,import_step(data['components'][0]['step']).solids()[0],E)
    if restored!=result:raise ValueError('Restored positive stop result differs')
    u.unchanged(parts,data['components'])
    for p,sha in pins.items():
        if f.digest(p)!=sha:raise ValueError('Stop input changed')
    report=dict(schema=1,scope='ACTUAL_INTEGRAL_STOP_OPTION_STATIC_GEOMETRY_ONLY',source_concept_sha256=f.digest(concept),source_frame='Original material and exterior profile retained; central original socket void intentionally filled. Exposed foot sourceZ0..22. Roof/flange alignment is nominal only.',input_files=pins,all9_actual_components_and_meshes_valid=True,actual_subjects_reimport_unchanged=True,checks=result,actual_STEP_STL_mesh_checks=mesh_checks,real_geometry_negative_controls=controls,restored_positive_pass=True,full109p22_outer_original_bar_and_debond_preserved=True,operator_reported_approx_fixed_flange_axial_thickness_mm=2.38125,nominal_knob_underside_to_flange_top_gap_mm=0.,approximate_thickness_is_not_tolerance_or_installed_clearance=True,actual_knob_top_contact_verified=False,base_alignment_verified=False,lifecycle_verified=False,physical_fit_verified=False,manufacturing_approved=False)
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print('INTEGRAL RELOCATED STOP STATIC AND REAL CONTROLS PASS',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for n in ('concept','reference','output'):p.add_argument('--'+n,type=Path,required=True)
    q=p.parse_args();run(q.concept,q.reference,q.output)
