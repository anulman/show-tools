"""Actual concept preservation and continuous exposed-side assembly bounds; no base."""
from __future__ import annotations
import argparse,hashlib,importlib,json,math,sys
from copy import deepcopy
from pathlib import Path
from build123d import Axis,Compound,import_step
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
f=importlib.import_module('disco-bar.integral_exposed_grip');c=f.c;a=f.a;u=f.u
v=importlib.import_module('disco-bar.check_post_glue_candidates')


def run(source,reference_path,output):
    if output.exists():raise ValueError('Use a fresh concept-check namespace')
    output.mkdir(parents=True);data=json.loads(source.read_text());E=data['exploratory_parameters']['exposure_below_original_root_mm'];z=E-13.
    inputs={str(source.resolve()):f.digest(source),str(reference_path.resolve()):f.digest(reference_path)}
    for module in (sys.modules[__name__],f,c,a,u,v):inputs[str(Path(module.__file__).resolve())]=f.digest(module.__file__)
    def load(r):
        for k in ('step','stl'):
            if f.digest(r[k])!=r[k+'_sha256']:raise ValueError('Changed concept artifact')
            inputs[r[k]]=r[k+'_sha256']
        p=import_step(r['step'])
        if not p.is_valid or len(p.solids())!=1:raise ValueError('Invalid actual concept solid')
        import trimesh
        mesh=trimesh.load_mesh(r['stl'])
        if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume<=0:raise ValueError('Invalid concept mesh')
        return p.solids()[0]
    parts={r['name']:load(r) for r in data['components']};body=parts[data['components'][0]['name']]
    _,ref=f.disco_bar.load_reference(reference_path);f.disco_bar.verify_full_reference(reference_path,ref)
    def op(kind,x,y):return a.channel_boolean(kind,deepcopy(x).wrapped,deepcopy(y).wrapped)
    def shape(kind,x,y):return Compound(op(kind,x,y))
    def empty(x,y,label,kind=a.BRepAlgoAPI_Common):
        amount=a.channel_material_volume(op(kind,x,y))
        if amount>1e-5:raise ValueError(label+': '+str(amount))
        return amount
    mask=c.cyl(80.,110.,(0,0,-55.))
    old=shape(a.BRepAlgoAPI_Common,ref,mask);new=shape(a.BRepAlgoAPI_Common,body,mask)
    profile=[empty(old,new,'Original negative-Z bar material removed',a.BRepAlgoAPI_Cut),empty(new,old,'Original negative-Z bar material added',a.BRepAlgoAPI_Cut)]
    channels={}
    for name,q in a.source_channels(ref).items():
        before=shape(a.BRepAlgoAPI_Common,ref,q['envelope']);after=shape(a.BRepAlgoAPI_Common,body,q['envelope'])
        channels[name]=dict(original_material_differences_mm3=[empty(before,after,'Original debond wall removed',a.BRepAlgoAPI_Cut),empty(after,before,'Original debond void filled',a.BRepAlgoAPI_Cut)],extended_lumen_added_material_mm3=empty(body,c.cyl(q['radius_mm'],E,(*q['center_xy_mm'],E/2)),'Extended debond lumen blocked'))
    records=[]
    def evidence(name,bound,obstacles,frame='source; positive Z below ball opening'):
        for n,p in obstacles.items():empty(bound,p,name+' blocked by '+n)
        exports=[v.export_piece(c.Piece(name+' '+str(i),deepcopy(s),'continuous concept bound; not print geometry'),output/'bounds') for i,s in enumerate(bound.solids())]
        records.append(dict(id=name,coordinate_frame=frame,components=exports,native_obstacle_common_mm3=0.))
    nominal=c.cyl(c.R,125.4,(0,0,E+50.-12.7))
    evidence('nominal socket-radius knob full100mm axial entry and reverse',nominal,{'integral bar':body})
    for sign in (-1,1):
        key=f'{sign:+d}';shoe=parts[key+' retained padded shoe'];pad=parts[key+' cut-stock adhesive-backed pad envelope'];nut=parts[key+' captive nut envelope'];screw=parts[key+' preset set-screw envelope']
        radial=c.box(27-(c.R+2)+10,22,14,(sign*((27+c.R+2)/2-.2-5),0,z))
        for y in (-12,12):radial+=c.box(13,2,10,(sign*20.3,y,z))
        radial+=c.box(12,16,8,(sign*(c.R+.8-5),0,z))
        empty(shoe,radial,'Shoe outside radial bound',a.BRepAlgoAPI_Cut);empty(pad,radial,'Pad outside radial bound',a.BRepAlgoAPI_Cut)
        evidence(key+' shoe plus bonded pad full10mm radial seat and reverse',radial,{'integral bar':body})
        axial=c.cyl(21.5,64.,(0,0,z+25.))
        for actor in (shoe,pad):empty(actor.translate((-sign*10,0,0)),axial,'Inward actor outside axial bound',a.BRepAlgoAPI_Cut)
        evidence(key+' inward shoe and pad axial entry from exposed mouth',axial,{'integral bar':body})
        nut_radial=c.hexagon(3.2,16.4,(sign*22.1,0,z),'x')
        empty(nut,nut_radial,'Actual nut outside radial prism',a.BRepAlgoAPI_Cut)
        evidence(key+' nut continuous14mm radial loading before shoes',nut_radial,{'integral bar':body})
        screw_path=c.cyl(1.5,66.,(sign*59.8,0,z),'x')
        empty(screw,screw_path,'Actual screw outside entry bound',a.BRepAlgoAPI_Cut)
        evidence(key+' M3x6 full60mm screw entry and reverse',screw_path,{'integral bar':body,'shoe':shoe,'pad':pad})
        # Full ordinary key, quarter-turn/reindex rather than a full handle sweep above the ball opening.
        stem=c.cyl(1.3,201.,(sign*132.3,0,z),'x')
        handle=c.cyl(22.,104.,(sign*182.3,0,z),'x')&c.box(110.,50.,25.,(sign*182.3,0,z+11.2))
        tool=stem+handle
        for turn in (0.,90.,180.):
            actual_key=c.cyl(1.3,101.,(sign*82.3,0,z),'x')+c.cyl(1.3,20.,(sign*132.3,10.,z),'y')
            actual_key=actual_key.rotate(Axis((0,0,z),(1,0,0)),turn)
            for retreat in (0.,100.):empty(actual_key.translate((sign*retreat,0,0)),tool,'Full L-key endpoint outside continuous bound',a.BRepAlgoAPI_Cut)
        evidence(key+' ordinary AF1.5 side key entry lower-half operation and reindex withdrawal',tool,{'integral bar':body,'shoe':shoe,'pad':pad,'nut':nut})
        if tool.bounding_box().min.Z<0:raise ValueError('Whole side tool reaches above original opening plane')
    u.unchanged(parts,data['components'])
    for path,sha in inputs.items():
        if f.digest(path)!=sha:raise ValueError('Concept input changed')
    report=dict(schema=1,scope='INTEGRAL_EXPOSED_GRIP_STATIC_PRESERVATION_AND_CONTINUOUS_ACCESS_ONLY',source_receipt_sha256=f.digest(source),input_files=inputs,all9_actual_solids_and_meshes_valid=True,actual_subjects_reimport_unchanged=True,original_full_negative_z_bar_difference_mm3=profile,original_height109p22_and_OD94p4613302_preserved=True,channels=channels,evidence=records,exposure_parameter_mm=E,side_axis_source_z_mm=z,base_alignment_verified=False,actual_knob_bottom_to_fixed_flange_gap_mm=None,nominal_socket_radius_is_not_measured_knob_OD=True,no_new_axial_knob_top_stop=E<26.9875,physical_fit_verified=False,manufacturing_approved=False,lifecycle_verified=False,pending=['8-actor exhaustive post-glue protocol','Full nut axial loading and actual stock screw hex engagement','Check actual ordinary key dimensions against nominal100x20mm L-key envelope','Pad adhesive/load/slip and integral flare strength','Measured fixed flange gap, base clearance and complete installed tool access'])
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n');print('INTEGRAL CONCEPT STATIC AND CONTINUOUS ACCESS PASS',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for n in ('source','reference','output'):p.add_argument('--'+n,type=Path,required=True)
    q=p.parse_args();run(q.source,q.reference,q.output)
