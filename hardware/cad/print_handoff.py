"""Checked four-model print review and STL-only prototype handoff.

The selected C box is serviced with its bottom panel removed. Private geometry
and generated deliveries stay outside Git; only this reproducible tool is saved.
"""
from __future__ import annotations
import argparse,hashlib,json,math,os,re,shutil,sys,zipfile
from pathlib import Path
import numpy as np
import trimesh
from build123d import Axis
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'verification'))
from geometry_artifacts import Artifacts
from publication_bundle import load as load_couplings,check_bound_paths
import box_mount,disco_bar
CONFIG=HERE/'build/print-handoff/current.json'
ARCADE_SHA='fa2a4758e78568e396055f652add4088708fa2a2cea6d8da5aa298ae878745bb'


def require(ok,message):
    if not ok:raise ValueError(message)


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pin(path):return dict(path=str(Path(path).resolve()),sha256=digest(path))


def read_pin(record):
    require(digest(record['path'])==record['sha256'],'Changed frozen input: '+record['path'])
    return json.loads(Path(record['path']).read_text())


def read_inputs(selector,arcade_path,box_path,box_sha):
    admitted=load_couplings(selector)
    _,admission,coupling,_=next(row for row in admitted if row[0]=='C')
    require(digest(arcade_path)==ARCADE_SHA,'Unexpected inclined arcade box')
    arcade=json.loads(arcade_path.read_text());check_bound_paths(arcade)
    require(arcade['geometry_checks_pass'] is True and len(arcade['review_components'])==4,'Incomplete arcade box')
    require(digest(box_path)==box_sha,'Unexpected C box revision')
    box=json.loads(box_path.read_text());check_bound_paths(box)
    require(box['geometry_checks_pass'] is True and box['C_receipt_sha256']==admission['candidate_receipt']['sha256'],
            'Box is not checked for this C coupling')
    require(box.get('tool_service_requires_bottom_removed') is True,'C box must establish bottom-panel-off service')
    lifecycle=box['checks'].get('panel_service_lifecycle',{})
    require(lifecycle.get('reachable_states')==66 and lifecycle.get('C_projection_states')==39
            and lifecycle.get('every_reachable_state_returns_to_bare_glued_bar_and_closed_box') is True
            and lifecycle.get('initial_and_final_panel_closed') is True
            and lifecycle.get('all_installed_C_actions_require_bottom_open') is True
            and lifecycle.get('panel_changes_require_both_C_keys_withdrawn') is True
            and len(lifecycle.get('negative_controls',{}))==9,'Incomplete bottom-panel service proof')
    require(box.get('service_keeps_sealed_ballast_and_wiring_on_stationary_shell') is True,
            'Bottom removal releases ballast or wiring')
    require(box.get('no_rotor_to_box_retaining_joint_or_stop') is True,'Box constrains rotating assembly')
    require(box['manufacturing_approved'] is False and box['physical_fit_verified'] is False,'Prototype scope changed')
    return arcade,box,coupling


def checked_mesh(path):
    mesh=trimesh.load_mesh(path)
    require(isinstance(mesh,trimesh.Trimesh) and mesh.is_watertight and mesh.is_winding_consistent
            and np.isfinite(mesh.vertices).all() and math.isfinite(mesh.volume) and mesh.volume>0,
            'Invalid print mesh: '+str(path))
    return mesh


def prepare(selector,arcade_path,box_path,box_sha,step,output):
    require(not output.exists(),'Use a fresh output namespace')
    arcade,box,coupling=read_inputs(selector,arcade_path,box_path,box_sha)
    output.mkdir(parents=True);files=Artifacts();print_root=output/'STL';entries=[]
    path,original=disco_bar.load_reference(step);disco_bar.verify_full_reference(path,original)
    reference_dir=output/'reference-export';reference_dir.mkdir()
    record=box_mount.export_part(original,reference_dir/'darren-original-bar')
    record.update(name='Darren original full-height bar',role='print',step=str(reference_dir/'darren-original-bar.step'),
                  stl=str(reference_dir/'darren-original-bar.stl'))
    record.update(step_sha256=record['files']['darren-original-bar.step'],stl_sha256=record['files']['darren-original-bar.stl'])
    groups=[dict(id='arcade',title='01 Arcade button box mount',frame='box',records=arcade['review_components']),
            dict(id='knob-box',title='02 Disco knob box mount - C',frame='box',
                 records=box['review_components']+box.get('purchased_components',[])),
            dict(id='original',title='03 Darren original disco bar',frame='bar',records=[record]),
            dict(id='C',title='04 Option C disco bar and collar',frame='bar',
                 records=[coupling['environment']]+coupling['stages']['locked']['components'])]
    # Show the optional shim beside its parent box, rather than silently making it
    #part of the default 5mm installed stack.
    optional=box.get('optional_components',[])
    for group in groups:
        for item in group['records']:files.load(item)
    for item in optional:files.load(item)
    def add(item,folder,name=None):
        shape=files.load(item);source=Path(item['stl']);mesh=checked_mesh(source)
        offset=np.array([-mesh.bounds[:,0].mean(),-mesh.bounds[:,1].mean(),-mesh.bounds[0,2]])
        printable=mesh.copy();printable.apply_translation(offset)
        source_name=item['name'].replace('+','plus-')
        if source_name.startswith('-'):source_name='minus-'+source_name[1:]
        label=name or re.sub(r'[^a-zA-Z0-9._-]+','-',source_name).strip('-').lower()
        target=print_root/folder/(label+'.stl');target.parent.mkdir(parents=True,exist_ok=True)
        require(not target.exists(),'Duplicate print filename')
        printable.export(target);restored=checked_mesh(target)
        require(len(restored.faces)==len(printable.faces),'Export changed print triangle inventory')
        require(np.allclose(restored.triangles,printable.triangles,atol=2e-5,rtol=0),'Print export changed geometry')
        require(math.isclose(restored.volume,mesh.volume,rel_tol=2e-6),'Print export changed volume')
        require(np.allclose(restored.bounds[0,2],0,atol=2e-5),'Print part is not grounded')
        entries.append(dict(file=str(target.relative_to(print_root)),name=item['name'],quantity=1,
            sha256=digest(target),source_stl=str(source),source_sha256=item['stl_sha256'],
            translation_from_source_mm=offset.tolist(),units='mm',watertight=True,positive_oriented_volume_mm3=float(restored.volume)))
    for item in arcade['review_components']:add(item,'01-arcade-button-box')
    for item in box['review_components']:
        if item['role']=='print-candidates':add(item,'02-disco-knob-box')
    for item in optional:add(item,'02-disco-knob-box/optional',name='2mm-height-shim')
    add(record,'03-darren-original-bar',name='darren-original-full-height-bar')
    for item in [coupling['environment']]+coupling['stages']['inserted']['components']:
        if item is coupling['environment'] or item['role']=='print':add(item,'04-option-C-bar-and-collar')
    # Every C printed actor exactly once; pads and all steel hardware stay off the printer.
    c_expected={q['name'] for q in coupling['stages']['inserted']['components'] if q['role']=='print'}|{coupling['environment']['name']}
    require({q['name'] for q in entries if q['file'].startswith('04-')}==c_expected,'Incomplete C print inventory')
    require(len({q['file'] for q in entries})==len(entries),'Duplicate print part')
    cut_root=output/'CUT-MATERIALS-NOT-RESIN';cut_root.mkdir()
    for item in [q for q in box['review_components'] if q['role']=='materials-DO-NOT-PRINT']+box.get('material_patterns',[]):
        files.load(item);source=Path(item['step']);target=cut_root/(item['name'].replace(' ','-')+'.step')
        require(not target.exists(),'Duplicate material reference');shutil.copyfile(source,target)
        require(digest(target)==item['step_sha256'],'Material copy changed')
    files.unchanged();read_inputs(selector,arcade_path,box_path,box_sha)
    selection=dict(schema=1,presentation='four-prototype-print-assemblies',units='mm',
        post_glue_selector=pin(selector),arcade=pin(arcade_path),box=pin(box_path),original_step=pin(step),
        groups=groups,optional_box_components=optional,source_artifacts=files.files,
        tool_service_requires_bottom_removed=True,physical_fit_verified=False,manufacturing_approved=False)
    selection_path=output/'selection.json';selection_path.write_text(json.dumps(selection,indent=2)+'\n')
    archive=output/'four-models-prototype-STL.zip'
    with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
        for item in entries:z.write(print_root/item['file'],item['file'])
    with zipfile.ZipFile(archive) as z:
        require(z.testzip() is None and len(z.namelist())==len(entries),'Broken STL archive')
        require(all(name.lower().endswith('.stl') and not name.startswith('/') and '..' not in Path(name).parts for name in z.namelist()),'Non-print file in ZIP')
        for item in entries:require(hashlib.sha256(z.read(item['file'])).hexdigest()==item['sha256'],'ZIP changed STL')
    report=dict(schema=1,scope='GEOMETRICALLY_CHECKED_FIRST_PROTOTYPE_PRINT_HANDOFF',units='mm',
        print_count=len(entries),files=entries,zip=pin(archive),selection=pin(selection_path),
        shopping_list_outside_zip=True,zip_contains_STL_only=True,no_steel_or_soft_material_meshes_in_zip=True,
        physical_fit_verified=False,printer_orientation_and_supports_required=True,
        darren_original_is_separate_comparison_piece=True,source_sha256=digest(Path(__file__)))
    (output/'validation.json').write_text(json.dumps(report,indent=2)+'\n')
    load_selection(selection_path)
    print(json.dumps(dict(output=str(output),archive=str(archive),print_parts=len(entries)),indent=2),flush=True)


def load_selection(path):
    data=json.loads(Path(path).read_text());require(data.get('presentation')=='four-prototype-print-assemblies','Unknown print review')
    arcade,box,coupling=read_inputs(Path(data['post_glue_selector']['path']),Path(data['arcade']['path']),Path(data['box']['path']),data['box']['sha256'])
    for key in ('post_glue_selector','arcade','box','original_step'):require(digest(data[key]['path'])==data[key]['sha256'],'Print selection input changed')
    for file,sha in data['source_artifacts'].items():require(digest(file)==sha,'Print source artifact changed')
    require([q['id'] for q in data['groups']]==['arcade','knob-box','original','C'],'Exactly four requested assemblies required')
    require([q['frame'] for q in data['groups']]==['box','box','bar','bar'],'Changed assembly frames')
    expected={'arcade':arcade['review_components'],
              'knob-box':box['review_components']+box.get('purchased_components',[]),
              'C':[coupling['environment']]+coupling['stages']['locked']['components']}
    for group in data['groups']:
        if group['id'] in expected:require(group['records']==expected[group['id']],'Wrong displayed assembly inventory')
    require(data['optional_box_components']==box.get('optional_components',[]),'Changed optional shim')
    require(data['original_step']['sha256']==disco_bar.REFERENCE_SHA256,'Original bar input differs')
    check_bound_paths(data)
    return data


def configure(path):
    load_selection(path);CONFIG.parent.mkdir(parents=True,exist_ok=True)
    CONFIG.write_text(json.dumps(pin(path),indent=2)+'\n')


def publish(path,port=3939,reset=False,boxes_only=False):
    from ocp_viewer import Camera,show
    data=load_selection(path);files=Artifacts();objects=[];labels=[];colors=[];alphas=[];groups=[]
    selected=data['groups'][:2] if boxes_only else data['groups']
    for index,group in enumerate(selected):
        x=(index-(len(selected)-1)/2)*180.
        pieces=[]
        for item in group['records']:
            shape=files.load(item)
            if group['frame']=='bar':shape=shape.rotate(Axis.X,180).rotate(Axis.Z,-90)
            pieces.append((item,shape))
        minimum=min(shape.bounding_box().min.Z for _,shape in pieces)
        group_labels=[]
        for item,shape in pieces:
            objects.append(shape.translate((x,0,-minimum)));label=group['title']+' - '+item['name'];labels.append(label);group_labels.append(label)
            shell=item['name'] in ('shell','bare glued bar','Darren original full-height bar')
            colors.append('#e4b24a' if item['role']=='materials-DO-NOT-PRINT' else
                          '#969da7' if item['role'].startswith('purchased') else
                          '#d1b394' if group['id']=='arcade' else '#96b5c8' if group['id']=='knob-box' else '#83a4c1' if group['id']=='original' else
                          '#a48bc5' if item['role']=='print' else '#414449' if item['role']=='pad' else '#969da7')
            alphas.append(.4 if shell and group['id'] in ('arcade','knob-box','C') else 1.)
        if group['id']=='knob-box':
            for item in data['optional_box_components']:
                shape=files.load(item);bb=shape.bounding_box()
                objects.append(shape.translate((x,-130,-bb.min.Z)));label=group['title']+' - OPTIONAL 2mm height shim';labels.append(label);group_labels.append(label)
                colors.append('#7894ab');alphas.append(1.)
        groups.append(dict(id=group['id'],title=group['title'],labels=group_labels))
    files.unchanged();show(*objects,names=labels,colors=colors,alphas=alphas,port=port,
        reset_camera=Camera.RESET if reset else Camera.KEEP,
        zoom=.85 if reset else None,ortho=True if reset else None)
    receipt=dict(workspace='box-mount' if boxes_only else 'disco-bar',presentation=data['presentation'],groups=groups,labels=labels,
        selection=pin(path),tool_service_requires_bottom_removed=True,actual_artifacts=files.files,
        physical_fit_verified=False,manufacturing_approved=False,canvas_delivery_verified=False)
    target=HERE/'build/workspace/current-view.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(dict(presentation=receipt['presentation'],groups=[q['title'] for q in groups],objects=len(objects))),flush=True)


def publish_configured(port=3939,reset=False,boxes_only=False):
    config=json.loads(CONFIG.read_text());require(digest(config['path'])==config['sha256'],'Changed print-review selection')
    publish(Path(config['path']),port,reset,boxes_only)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    build=sub.add_parser('prepare')
    for name in ('selector','arcade','box','step','output'):build.add_argument('--'+name,type=Path,required=True)
    build.add_argument('--box-sha256',required=True)
    c=sub.add_parser('configure');c.add_argument('selection',type=Path)
    p=sub.add_parser('publish');p.add_argument('selection',type=Path);p.add_argument('--port',type=int,default=3939);p.add_argument('--reset-camera',action='store_true')
    a=parser.parse_args()
    if a.command=='prepare':prepare(a.selector,a.arcade,a.box,a.box_sha256,a.step,a.output)
    elif a.command=='configure':configure(a.selection)
    else:publish(a.selection,a.port,a.reset_camera)
