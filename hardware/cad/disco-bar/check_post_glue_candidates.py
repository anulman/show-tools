"""Export actual candidate geometry and endpoint evidence; continuous proof is separate."""
from __future__ import annotations
import argparse,hashlib,importlib,json,sys,math
from pathlib import Path
from build123d import Plane,Solid
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import disco_bar
m=importlib.import_module('disco-bar.post_glue_couplings');c=m.c
p=importlib.import_module('disco-bar.check_couplings')


def paired(a,b):
    names={a,b}
    if any('preset set-screw' in n for n in names):
        return any('captive nut envelope' in n for n in names) and a.split()[0]==b.split()[0]
    for prefix,suffix in (('external cover M3x8 screw ','external cover M3 nut '),('axial M4x12 socket screw ','threaded M4 full nut '),('external collar M2x8 screw ','external collar M2 nut ')):
        for first,second in ((a,b),(b,a)):
            if first.startswith(prefix) and second==suffix+first.removeprefix(prefix):return True
    return False


def check_parts(parts):
    for q in parts:
        if not q.shape.is_valid or len(q.shape.solids())!=1:raise ValueError('Invalid print/part: '+q.name)
    for i,a in enumerate(parts):
        for b in parts[i+1:]:
            aa,bb=a.shape.bounding_box(),b.shape.bounding_box()
            if any(getattr(aa.max,k)<=getattr(bb.min,k)+1e-7 or getattr(bb.max,k)<=getattr(aa.min,k)+1e-7 for k in ('X','Y','Z')):continue
            hit=a.shape&b.shape
            if c.volume(hit)<=1e-5:continue
            if not paired(a.name,b.name):raise ValueError('Interference '+a.name+' / '+b.name+': '+str(c.volume(hit)))
            nut=a if 'nut' in a.name else b
            bore=next(BRepAdaptor_Surface(f.wrapped).Cylinder() for f in nut.shape.faces() if BRepAdaptor_Surface(f.wrapped).GetType()==GeomAbs_Cylinder)
            axis=bore.Axis();o=axis.Location();d=axis.Direction();radius=2.01 if 'M4' in nut.name else 1.01 if 'M2' in nut.name else 1.51
            zone=Solid.make_cylinder(radius,100,Plane(origin=(o.X()-50*d.X(),o.Y()-50*d.Y(),o.Z()-50*d.Z()),z_dir=(d.X(),d.Y(),d.Z())))
            c.assert_empty(hit-zone,'Non-thread metal collision')


def accurate_mass(shape):
    properties=GProp_GProps()
    error=BRepGProp.VolumeProperties_s(shape.wrapped,properties,1e-10,True,False)
    value=properties.Mass()
    if not math.isfinite(value) or value<=0 or not math.isfinite(error) or error<0 or error>1e-8:
        raise ValueError('Accurate closed-solid mass integration failed')
    return value,error


def export_piece(piece,folder):
    folder.mkdir(parents=True,exist_ok=True)
    stem=piece.name.replace(' / ','--').replace(' ','-').replace('+','plus')
    step,stl=folder/(stem+'.step'),folder/(stem+'.stl')
    if not piece.shape.is_valid or len(piece.shape.solids())!=1:raise ValueError('Invalid export input')
    if not p.export_step(piece.shape,step) or not p.export_stl(piece.shape,stl,tolerance=.03):raise ValueError('Export failed')
    restored=p.import_step(step)
    if not restored.is_valid or len(restored.solids())!=1:raise ValueError('Invalid STEP roundtrip')
    original_mass,original_error=accurate_mass(piece.shape)
    restored_mass,restored_error=accurate_mass(restored)
    if not p.np.isclose(original_mass,restored_mass,rtol=1e-6):raise ValueError('STEP accurate mass changed')
    equivalence=[]
    for left,right in ((piece.shape,restored),(restored,piece.shape)):
        try:
            cut=m.channels.channel_boolean(m.channels.BRepAlgoAPI_Cut,left.wrapped,right.wrapped)
            amount=m.channels.channel_material_volume(cut)
        except ValueError as error:
            equivalence.append(dict(status='INCONCLUSIVE',reason=str(error)))
            continue
        try:
            common=m.channels.channel_boolean(m.channels.BRepAlgoAPI_Common,left.wrapped,right.wrapped)
            common_amount=m.channels.channel_material_volume(common)
        except ValueError as error:
            common_amount=None
        equivalence.append(dict(status='PASS' if amount<=1e-5 else 'INCONCLUSIVE',material_difference_mm3=amount,common_material_mm3=common_amount,reason=None if amount<=1e-5 else 'Positive native source/STEP difference retained; source identity not established. Actual delivered STEP requirements must pass independently.'))
    mesh=p.trimesh.load_mesh(stl)
    if not mesh.is_watertight or not mesh.is_winding_consistent or mesh.volume<=0 or not p.np.isclose(mesh.volume,original_mass,rtol=.005):raise ValueError('Invalid STL')
    mesh_mass=restored_mass
    if not p.np.isclose(mesh.volume,mesh_mass,rtol=.005):raise ValueError('STL differs from actual STEP')
    return dict(name=piece.name,role=piece.role,step=str(step.resolve()),stl=str(stl.resolve()),
        step_sha256=hashlib.sha256(step.read_bytes()).hexdigest(),stl_sha256=hashlib.sha256(stl.read_bytes()).hexdigest(),
        step_roundtrip=True,stl_watertight=True,volume_mm3=original_mass,restored_volume_mm3=restored_mass,
        mass_relative_error_estimates=[original_error,restored_error],mass_integration='native adaptive closed-volume Eps1e-10; original rtol1e-6 unchanged',
        native_source_step_equivalence=equivalence,delivered_step_requires_independent_requirement_checks=True)


def run(step,concept,output):
    output.mkdir(parents=True,exist_ok=True);(output/'receipt.json').unlink(missing_ok=True)
    path,reference=disco_bar.load_reference(step);disco_bar.verify_full_reference(path,reference)
    model=importlib.import_module('disco-bar.post_glue_cassette') if concept=='C' else m
    sources={Path(f).resolve():hashlib.sha256(Path(f).read_bytes()).hexdigest() for f in (model.__file__,m.__file__,__file__,c.__file__,m.grip.__file__,m.old.__file__,m.channels.__file__,p.__file__,disco_bar.__file__)}
    def unchanged():
        for f,sha in sources.items():
            if hashlib.sha256(f.read_bytes()).hexdigest()!=sha:raise ValueError('Source changed during candidate check: '+str(f))
    candidate=model.build(reference) if concept=='C' else model.build(reference,concept)
    check_parts([c.Piece('bare glued bar',candidate.bar,'bar')])
    mask=c.cyl(46.21,30.01,(0,0,-15))
    c.assert_empty((reference-candidate.bar)-mask,'Protected original removed')
    c.assert_empty((candidate.bar-reference)-mask,'Protected original added')
    for label,record in candidate.channels.items():m.channels.equal(candidate.bar&record['envelope'],reference&record['envelope'],'Original channel '+label)
    environment=export_piece(c.Piece('bare glued bar',candidate.bar,'single printed glued environment; no installed hardware'),output/'environment')
    actual_bar=p.import_step(environment['step']).solids()[0]
    stages={}
    for stage,pose in candidate.stages.items():
        parts=model.posed(candidate,stage)
        check_parts([c.Piece('bare glued bar',candidate.bar,'bar'),*parts])
        if stage=='outside' and any(q.shape.bounding_box().min.Z<0 for q in parts):raise ValueError('Not all actors outside')
        records=[export_piece(q,output/'stages'/stage) for q in parts]
        actual=[c.Piece(record['name'],p.import_step(record['step']).solids()[0],record['role']) for record in records]
        check_parts([c.Piece('bare glued bar',actual_bar,'bar'),*actual])
        stages[stage]=dict(delivered_step_endpoint_rigid_clearance=True,source_pose=pose,world_mouth_height_rule='nominal gap + shift, keeping knob/cup fixed in world',components=records,endpoint_rigid_clearance=True)
        unchanged()
        print('ENDPOINT',concept,stage,'PASS',flush=True)
    torque={}
    if concept=='C':
        for direction,witness in model.torque_witnesses(candidate).items():
            if c.volume(witness)<=1e-5:raise ValueError('Missing positive cup/bar drive '+direction)
            torque[direction]=[export_piece(c.Piece('cup bar torque witness '+direction+' part '+str(i),solid,'penetration witness; NOT PRINT GEOMETRY'),output/'drive-witnesses') for i,solid in enumerate(witness.solids())]
    report=dict(schema=1,concept='post-glue '+concept,scope='ACTUAL GEOMETRY AND ENDPOINTS ONLY; NOT FORMALLY ADMITTED',
        geometry_review_pass=False,endpoint_geometry_pass=True,delivered_step_endpoint_geometry_pass=True,source_step_identity_policy='INCONCLUSIVE observations retained; delivered STEP is authoritative and requires independent checks',continuous_motion_verified=False,base_integration_verified=False,
        lifecycle_verified=False,physical_fit_verified=False,environment=environment,bar_already_glued=True,
        above_root_exterior_access=False,reference_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        stages=stages,positive_cup_bar_torque_witnesses=torque,source_frame='Z0 root; negative Z inside ball; positive Z root-side exterior',
        source_code_sha256={f.name:sha for f,sha in sources.items()})
    unchanged()
    (output/'receipt.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--step',type=Path,required=True);parser.add_argument('--concept',choices=('A','B','C'),required=True);parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();run(args.step,args.concept,args.output)
