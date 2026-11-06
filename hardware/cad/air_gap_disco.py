"""Export and display the checked air-gap disco prototype without a passive bearing."""
from __future__ import annotations
import argparse,hashlib,json,math,sys,zipfile
from pathlib import Path
import numpy as np
from build123d import Axis
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'verification'))
from geometry_artifacts import Artifacts
from print_handoff import checked_mesh,digest,require,pin
from clean_disco import identical_after_rotation
CONFIG=HERE/'build/air-gap-disco/current.json'


def admitted(admission_path):
    from air_gap_c_base_admission import load
    result=load(admission_path)
    base,C=result['base'],result['candidate']
    require(base['scope']=='C_MOUNT_AIR_GAP_WITHOUT_BEARING_SUPPORT' and base['geometry_checks_pass'] is True,
            'Expected admitted air-gap mounting box')
    require(base['printed_parts_default']==4 and base['no_passive_bearing_support'] is True
            and base['no_ballast_or_retention_hardware'] is True,'Unexpected box support or ballast')
    require(base['hardware_BOM']=={'button_M3x10':4,'button_M3x12':2,'DIN934_M3_nuts':6},
            'Unexpected air-gap mounting-box hardware')
    require(not base['optional_components'] and not base['material_patterns'],'Unexpected cap or PTFE')
    require(len(base['review_components'])==4 and {q['name']:q['role'] for q in base['review_components']}=={
        'shell':'print-candidates','bottom':'print-candidates',
        'keeper_tab_0':'print-candidates','keeper_tab_1':'print-candidates'},'Unexpected mounting-box inventory')
    require(C.get('variant')=='reduced-cover-B','Wrong collar geometry')
    expected={'removable padded knob cup':'print','removable lock and driver half A':'print',
              'integrated half B and capture cover':'print'}
    for sign in ('-1','+1'):
        for suffix,role in (('retained padded shoe','print'),('cut-stock adhesive-backed pad envelope','pad'),
                            ('preset set-screw envelope','hardware'),('captive nut envelope','hardware')):
            expected[sign+' '+suffix]=role
    for angle in (130.,200.):
        for prefix in ('external cover M3x8 screw ','external cover M3 nut '):expected[prefix+str(angle)]='hardware'
    expected.update({'axial M4x12 socket screw 110.0':'hardware','threaded M4 full nut 110.0':'hardware'})
    require(set(C['stages'])=={'outside','inserted','turned','nuts-seated','locked'},'Missing collar stage')
    for stage in C['stages'].values():
        rows=stage['components']
        require(len(rows)==17 and {q['name']:q['role'] for q in rows}==expected,'Unexpected actual collar inventory')
    graph=result['panel_lifecycle'];count=result['lifecycle']['reachable_states']
    require(graph['C_projection_states']==count
        and graph['every_reachable_state_returns_to_bare_glued_bar_and_closed_box'] is True
        and graph['panel_changes_require_ball_hand_free'] is True,
        'Incomplete air-gap service lifecycle')
    require(base['physical_fit_verified'] is False and base['manufacturing_approved'] is False,'Prototype scope changed')
    placement=result['placement']
    require(placement['bar_root_above_roof_mm']==5.,'Unexpected default air-gap placement')
    require(placement['nominal_hex_top_z_mm']==-.25 and placement['required_hex_to_knob_underside_mm']==5.25
            and placement['root_to_roof_gap_is_not_global_minimum'] is True,'Changed measured adjustment contract')
    clearance=placement['minimum_all_angle_fixed_clearance_mm']
    require(math.isfinite(clearance) and clearance>0,'Positive all-angle clearance is unproved')
    references=result['base_reference_components']
    require(len(references)==13 and len({q['name'] for q in references})==13
        and all(q['role']=='hardware-reference' for q in references),'Incomplete fixed hardware references')
    return result


def inputs(admission_path):
    result=admitted(admission_path)
    return result['base'],result['candidate']


def prepare(admission_path,output):
    require(not output.exists(),'Use a fresh output namespace')
    admission=admitted(admission_path);base,C=admission['base'],admission['candidate'];files=Artifacts()
    references=admission['base_reference_components']
    records={q['name']:q for q in base['review_components']}
    moving={q['name']:q for q in C['stages']['inserted']['components']}
    for q in [*records.values(),*references,C['environment'],*moving.values()]:files.load(q)
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
    require(not base['optional_components'],'Unexpected optional print')
    archive=output/'air-gap-disco-prototype-STL.zip';staged_archive=archive.with_suffix('.zip.partial')
    with zipfile.ZipFile(staged_archive,'x',zipfile.ZIP_DEFLATED) as z:
        for entry in entries:z.write(stls/entry['file'],entry['file'])
    with zipfile.ZipFile(staged_archive) as z:
        require(z.testzip() is None and sorted(z.namelist())==sorted(q['file'] for q in entries),'Archive inventory differs')
        for q in entries:require(hashlib.sha256(z.read(q['file'])).hexdigest()==q['sha256'],'ZIP changed printable geometry')
    files.unchanged();inputs(admission_path)
    selection=dict(schema=1,presentation='air-gap-disco-prototype',admission=pin(admission_path),
        base_components=base['review_components'],C_components=[C['environment']]+C['stages']['locked']['components'],
        base_reference_components=references,
        actual_artifacts=files.files,default_bar_root_above_roof_mm=5,printed_pieces=10,unique_STL_files=8,
        physical_fit_verified=False,manufacturing_approved=False)
    path=output/'selection.json';path.write_text(json.dumps(selection,indent=2)+'\n')
    load(path)
    report=dict(selection=pin(path),zip=dict(path=str(archive.resolve()),sha256=digest(staged_archive)),files=entries,printed_pieces=10,unique_STL_files=8,
        duplicate_geometry_verified_by_native_Boolean=True,no_PTFE_or_height_cap=True,
        physical_fit_verified=False,manufacturing_approved=False)
    staged_report=output/'validation.json.partial';staged_report.write_text(json.dumps(report,indent=2)+'\n')
    staged_archive.replace(archive);staged_report.replace(output/'validation.json')
    print(json.dumps(dict(output=str(output),archive=str(archive),files=8,printed_pieces=10)),flush=True)


def load(path):
    data=json.loads(Path(path).read_text());require(data['presentation']=='air-gap-disco-prototype','Wrong review selection')
    require(data['schema']==1 and data['default_bar_root_above_roof_mm']==5
        and data['printed_pieces']==10 and data['unique_STL_files']==8
        and data['physical_fit_verified'] is False and data['manufacturing_approved'] is False,
        'Changed air-gap selection parameters or scope')
    require(digest(data['admission']['path'])==data['admission']['sha256'],'Changed review admission')
    admission=admitted(Path(data['admission']['path']));base,C=admission['base'],admission['candidate']
    require(data['base_components']==base['review_components'] and data['C_components']==[C['environment']]+C['stages']['locked']['components'],'Changed scene inventory')
    require(data['base_reference_components']==admission['base_reference_components'],'Changed fixed hardware references')
    expected={q[kind]:q[kind+'_sha256'] for q in base['review_components']+admission['base_reference_components']+[C['environment']]+C['stages']['inserted']['components']
              for kind in ('step','stl')}
    require(data['actual_artifacts']==expected,'Changed actual artifact inventory')
    for file,sha in data['actual_artifacts'].items():require(digest(file)==sha,'Changed actual artifact')
    return data


def configure(path):
    load(path);CONFIG.parent.mkdir(parents=True,exist_ok=True);CONFIG.write_text(json.dumps(pin(path),indent=2)+'\n')


def publish_configured(port=3939,reset=False):
    from ocp_viewer import Camera,show
    config=json.loads(CONFIG.read_text());require(digest(config['path'])==config['sha256'],'Changed air-gap disco selection')
    data=load(Path(config['path']));files=Artifacts();parts=[]
    for q in data['base_components']:parts.append((q,files.load(q),'Mounting box'))
    for q in data['base_reference_components']:parts.append((q,files.load(q),'Mounting hardware (reference)'))
    for q in data['C_components']:
        part=files.load(q).rotate(Axis.X,180).rotate(Axis.Z,280).translate((0,0,5))
        parts.append((q,part,'C bar and collar'))
    ground=min(part.bounding_box().min.Z for _,part,_ in parts)
    objects=[part.translate((0,0,-ground)) for _,part,_ in parts]
    names=[group+' - '+q['name'] for q,_,group in parts]
    colors=['#969da7' if q['role']=='hardware-reference' else '#414449' if q['role']=='pad' else
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
