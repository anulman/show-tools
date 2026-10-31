"""Checked ballast-free disco prototype: eight STL designs, ten printed pieces."""
from __future__ import annotations
import argparse,hashlib,json,shutil,sys,zipfile
from pathlib import Path
import numpy as np
from build123d import Axis
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'verification'))
from geometry_artifacts import Artifacts,adaptive_mass
from print_handoff import checked_mesh,digest,require,pin
CONFIG=HERE/'build/clean-disco/current.json'


def inputs(admission_path):
    from clean_c_base_admission import load as admit
    admitted=admit(admission_path);base,C=admitted['base'],admitted['candidate']
    require(base['scope']=='C_MOUNT_WITHOUT_BALLAST' and base['geometry_checks_pass'] is True,'Unverified mounting box')
    require(C.get('variant')=='reduced-cover-B' and len(C['stages']['inserted']['components'])==17,'Expected admitted reduced collar')
    expected={'removable padded knob cup':'print','removable lock and driver half A':'print',
        'integrated half B and capture cover':'print'}
    for sign in ('-1','+1'):
        for suffix,role in (('retained padded shoe','print'),('cut-stock adhesive-backed pad envelope','pad'),
                            ('preset set-screw envelope','hardware'),('captive nut envelope','hardware')):
            expected[sign+' '+suffix]=role
    for angle in (130.,200.):
        for prefix in ('external cover M3x8 screw ','external cover M3 nut '):expected[prefix+str(angle)]='hardware'
    expected.update({'axial M4x12 socket screw 110.0':'hardware','threaded M4 full nut 110.0':'hardware'})
    require({q['name']:q['role'] for q in C['stages']['inserted']['components']}==expected,'Unexpected reduced-collar inventory')
    require(base.get('spacer_is_integral_not_a_separate_print') is True and base['printed_parts_default']==4,'Expected four-part integral-support box')
    require({q['name']:q['role'] for q in base['review_components']}=={
        'shell':'print-candidates','bottom':'print-candidates','buffer':'materials-DO-NOT-PRINT',
        'keeper_tab_0':'print-candidates','keeper_tab_1':'print-candidates'},'Unexpected mounting-box inventory')
    require(base.get('no_ballast_or_retention_hardware') is True and base['no_rotor_to_box_retaining_joint_or_stop'] is True,'Unexpected fixed geometry')
    require(base['optional_height_cap_preserves_both_5_and_7_mm'] is True,'Height options were lost')
    graph=admitted['panel_lifecycle']
    lifecycle=admitted['lifecycle']
    count=lifecycle['reachable_states'] if isinstance(lifecycle,dict) else lifecycle.reachable_states
    require(graph['C_projection_states']==count
        and graph['every_reachable_state_returns_to_bare_glued_bar_and_closed_box'] is True,'Incomplete reduced-collar service lifecycle')
    require(base['physical_fit_verified'] is False and base['manufacturing_approved'] is False,'Prototype scope changed')
    return base,C


def identical_after_rotation(first,second):
    # Native Boolean material equality, rather than matching bounding boxes.
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
    from build123d import Shape
    for a,b in ((first,second),(second,first)):
        op=BRepAlgoAPI_Cut(a.wrapped,b.wrapped);op.Build();require(op.IsDone(),'Native identity check failed')
        remainder=Shape.cast(op.Shape())
        volume=sum(adaptive_mass(solid)[0] for solid in remainder.solids())
        require(volume<1e-6,'Repeated print parts are not identical')


def prepare(admission_path,output):
    require(not output.exists(),'Use a fresh output namespace')
    base,C=inputs(admission_path);files=Artifacts()
    records={q['name']:q for q in base['review_components']}
    moving={q['name']:q for q in C['stages']['inserted']['components']}
    for q in [*records.values(),C['environment'],*moving.values(),*base['optional_components']]:files.load(q)
    identical_after_rotation(files.load(records['keeper_tab_0']).rotate(Axis.Z,180),files.load(records['keeper_tab_1']))
    identical_after_rotation(files.load(moving['-1 retained padded shoe']).rotate(Axis.Z,180),files.load(moving['+1 retained padded shoe']))
    chosen=[('01-mounting-box-shell',records['shell'],1),('02-mounting-box-bottom',records['bottom'],1),
        ('03-hex-keeper-PRINT-2',records['keeper_tab_0'],2),('04-disco-bar',C['environment'],1),
        ('05-knob-cup',moving['removable padded knob cup'],1),('06-grip-shoe-PRINT-2',moving['-1 retained padded shoe'],2),
        ('07-collar-half-A',moving['removable lock and driver half A'],1),
        ('08-collar-half-B-with-cover',moving['integrated half B and capture cover'],1)]
    output.mkdir(parents=True);stls=output/'STL';stls.mkdir();entries=[]
    def export_mesh(record,target):
        mesh=checked_mesh(record['stl']);delta=np.array([-mesh.bounds[:,0].mean(),-mesh.bounds[:,1].mean(),-mesh.bounds[0,2]])
        mesh.apply_translation(delta);mesh.export(target);actual=checked_mesh(target)
        require(actual.triangles.shape==mesh.triangles.shape and np.allclose(actual.triangles,mesh.triangles,atol=2e-5,rtol=0),'Delivered STL changed geometry')
        require(abs(actual.bounds[0,2])<2e-5,'Print part not grounded')
        return dict(sha256=digest(target),source=record,translation_mm=delta.tolist())
    for name,record,quantity in chosen:
        target=stls/(name+'.stl');entry=export_mesh(record,target)
        entries.append(dict(file=target.name,quantity=quantity,**entry))
    require(len(entries)==8 and sum(q['quantity'] for q in entries)==10,'Wrong default print inventory')
    optional=output/'OPTIONAL-height-cap';optional.mkdir()
    require(len(base['optional_components'])==1,'Unexpected optional inventory')
    optional_entry=export_mesh(base['optional_components'][0],optional/'2mm-height-cap.stl')
    materials=output/'CUT-PTFE-NOT-RESIN';materials.mkdir()
    shutil.copyfile(records['buffer']['step'],materials/'formed-PTFE-reference.step')
    flat=next(q for q in base['material_patterns'] if q['name']=='developed_flat_PTFE')
    files.load(flat);shutil.copyfile(flat['step'],materials/'flat-PTFE-cutting-pattern.step')
    archive=output/'clean-disco-prototype-STL.zip';staged_archive=archive.with_suffix('.zip.partial')
    with zipfile.ZipFile(staged_archive,'x',zipfile.ZIP_DEFLATED) as z:
        for entry in entries:z.write(stls/entry['file'],entry['file'])
    with zipfile.ZipFile(staged_archive) as z:
        require(z.testzip() is None and sorted(z.namelist())==sorted(q['file'] for q in entries),'Archive inventory differs')
        for q in entries:require(hashlib.sha256(z.read(q['file'])).hexdigest()==q['sha256'],'ZIP changed printable geometry')
    files.unchanged();inputs(admission_path)
    selection=dict(schema=1,presentation='clean-disco-prototype',admission=pin(admission_path),
        base_components=base['review_components'],C_components=[C['environment']]+C['stages']['locked']['components'],
        actual_artifacts=files.files,default_gap_mm=5,printed_pieces=10,unique_STL_files=8,
        physical_fit_verified=False,manufacturing_approved=False)
    path=output/'selection.json';path.write_text(json.dumps(selection,indent=2)+'\n')
    load(path)
    report=dict(selection=pin(path),zip=dict(path=str(archive.resolve()),sha256=digest(staged_archive)),files=entries,printed_pieces=10,unique_STL_files=8,
        duplicate_geometry_verified_by_native_Boolean=True,optional_height_cap_outside_default_zip=optional_entry,
        physical_fit_verified=False,manufacturing_approved=False)
    staged_report=output/'validation.json.partial';staged_report.write_text(json.dumps(report,indent=2)+'\n')
    staged_archive.replace(archive);staged_report.replace(output/'validation.json')
    print(json.dumps(dict(output=str(output),archive=str(archive),files=8,printed_pieces=10)),flush=True)


def load(path):
    data=json.loads(Path(path).read_text());require(data['presentation']=='clean-disco-prototype','Wrong review selection')
    require(digest(data['admission']['path'])==data['admission']['sha256'],'Changed review admission')
    base,C=inputs(Path(data['admission']['path']))
    require(data['base_components']==base['review_components'] and data['C_components']==[C['environment']]+C['stages']['locked']['components'],'Changed scene inventory')
    for file,sha in data['actual_artifacts'].items():require(digest(file)==sha,'Changed actual artifact')
    return data


def configure(path):
    load(path);CONFIG.parent.mkdir(parents=True,exist_ok=True);CONFIG.write_text(json.dumps(pin(path),indent=2)+'\n')


def publish_configured(port=3939,reset=False):
    from ocp_viewer import Camera,show
    config=json.loads(CONFIG.read_text());require(digest(config['path'])==config['sha256'],'Changed clean disco selection')
    data=load(Path(config['path']));files=Artifacts();parts=[]
    for q in data['base_components']:parts.append((q,files.load(q),'Mounting box'))
    for q in data['C_components']:
        part=files.load(q).rotate(Axis.X,180).rotate(Axis.Z,280).translate((0,0,5))
        parts.append((q,part,'C bar and collar'))
    ground=min(part.bounding_box().min.Z for _,part,_ in parts)
    objects=[part.translate((0,0,-ground)) for _,part,_ in parts]
    names=[group+' - '+q['name'] for q,_,group in parts]
    colors=['#e4b24a' if q['role']=='materials-DO-NOT-PRINT' else '#414449' if q['role']=='pad' else
            '#96b5c8' if group=='Mounting box' else '#a48bc5' if q['role']=='print' else '#969da7' for q,_,group in parts]
    alphas=[.45 if q['name'] in ('shell','bare glued bar') else 1. for q,_,_ in parts]
    path=HERE/'build/workspace/current-view.json'
    previous=json.loads(path.read_text()) if path.exists() else {}
    reset=reset or previous.get('presentation')!=data['presentation'] or previous.get('selection')!=config
    files.unchanged();show(*objects,names=names,colors=colors,alphas=alphas,port=port,
        reset_camera=Camera.RESET if reset else Camera.KEEP,ortho=True if reset else None,zoom=.85 if reset else None)
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(dict(workspace='disco-bar',presentation=data['presentation'],selection=config,
        labels=names,actual_artifacts=files.files,canvas_delivery_verified=False),indent=2)+'\n')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    p=sub.add_parser('prepare')
    for name in ('admission','output'):p.add_argument('--'+name,type=Path,required=True)
    c=sub.add_parser('configure');c.add_argument('selection',type=Path)
    p=sub.add_parser('publish');p.add_argument('--port',type=int,default=3939);p.add_argument('--reset-camera',action='store_true')
    a=parser.parse_args()
    if a.command=='prepare':prepare(a.admission,a.output)
    elif a.command=='configure':configure(a.selection)
    else:publish_configured(a.port,a.reset_camera)
