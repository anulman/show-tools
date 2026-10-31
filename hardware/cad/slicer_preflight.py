"""Offline FDM reference slicing; never certifies an unknown printer/material."""
from __future__ import annotations
import argparse,collections,hashlib,json,math,subprocess,tempfile,time,zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
import numpy as np
import trimesh
import disco_inches

APP=Path('/Applications/BambuStudio.app')
BINARY=APP/'Contents/MacOS/BambuStudio'
PROFILES=APP/'Contents/Resources/profiles/BBL'
REFERENCE=[('machine','Bambu Lab X1 Carbon 0.4 nozzle'),('process','0.20mm Standard @BBL X1C'),('filament','Generic PLA')]
# Candidate rigid rotations only; these are proposed printing poses, not CAD edits.
POSES={1:('x',180),3:('x',180),6:('y',-90),8:('x',180)}


def pin(path):return dict(path=str(path.resolve()),sha256=hashlib.sha256(path.read_bytes()).hexdigest())


def flatten(kind,name,pins,ancestors=()):
    if name in ancestors:raise ValueError('Profile inheritance cycle')
    path=PROFILES/kind/(name+'.json');raw=json.loads(path.read_text());pins[str(path)]=pin(path)['sha256'];data={}
    if raw.get('inherits'):data.update(flatten(kind,raw['inherits'],pins,ancestors+(name,)))
    for included in raw.get('include',[]):data.update(flatten(kind,included,pins,ancestors+(name,)))
    data.update(raw)
    for key in ('inherits','include'):data.pop(key,None)
    return data


def prepare(inch_packet,output):
    if output.exists():raise ValueError('Use a fresh preflight directory')
    inch_report=disco_inches.check(inch_packet)
    output.mkdir(parents=True);profiles=output/'reference-profiles';profiles.mkdir();pins={};settings={}
    for kind,name in REFERENCE:
        data=flatten(kind,name,pins);settings[kind]=data
        (profiles/(kind+'.json')).write_text(json.dumps(data,indent=2)+'\n')
    supported=dict(settings['process'],enable_support='1',support_type='normal(auto)',support_on_build_plate_only='0')
    (profiles/'supported.json').write_text(json.dumps(supported,indent=2)+'\n')
    records=[]
    with zipfile.ZipFile(inch_report['zip']['path']) as archive:
        for index,row in enumerate(inch_report['files'],1):
            original=disco_inches.mesh(archive.read(row['file']));original.apply_scale(25.4)
            for variant in ('as-exported','candidate'):
                part=original.copy()
                axis,angle=POSES.get(index,('x',0)) if variant=='candidate' else ('x',0)
                vector=(1,0,0) if axis=='x' else (0,1,0)
                part.apply_transform(trimesh.transformations.rotation_matrix(math.radians(angle),vector))
                part.apply_translation([-part.bounds[:,0].mean(),-part.bounds[:,1].mean(),-part.bounds[0,2]])
                target=output/'models'/variant/row['file'].replace('-INCH.stl','-PHYSICAL-MM.stl')
                target.parent.mkdir(parents=True,exist_ok=True);part.export(target)
                actual=disco_inches.mesh(target.read_bytes())
                if not math.isclose(actual.volume,original.volume,rel_tol=1e-6):raise ValueError('Printing pose changed volume')
                records.append(dict(index=index,file=row['file'],quantity=row['quantity'],variant=variant,
                    rotation=dict(axis=axis,degrees=angle),model=pin(target),dimensions_mm=actual.extents.tolist(),
                    model_volume_mm3=float(actual.volume),supports=variant=='candidate' and index not in (2,3,6)))
    manifest=dict(scope='PRELIMINARY_OFFLINE_REFERENCE_ONLY',production_ready=False,
        actual_printer_model=None,actual_nozzle_mm=None,actual_filament=None,
        reference_profiles=[name for _,name in REFERENCE],reference_profiles_are_not_operator_hardware=True,
        missing_for_print_release=['Actual printer model and build plate','Actual nozzle size','Actual filament and calibrated process','Support removal and hardware fit trial','Load/grip/strength testing'],
        source_inch_validation=pin(inch_packet/'validation.json'),source_zip=inch_report['zip'],
        slicer_binary=pin(BINARY),preset_sources=pins,models=records,
        CAD_geometry_modified=False,printer_connected=False,print_submitted=False)
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest


def run(output,variants):
    manifest=json.loads((output/'manifest.json').read_text());profiles=output/'reference-profiles';runs=[]
    for row in manifest['models']:
        if row['variant'] not in variants:continue
        directory=output/'analysis-only'/row['variant']/str(row['index']);directory.mkdir(parents=True,exist_ok=False)
        process=profiles/('supported.json' if row['supports'] else 'process.json')
        command=[str(BINARY),'--datadir',str(output/'isolated-appdata'),
            '--load-settings',str(profiles/'machine.json')+';'+str(process),
            '--load-filaments',str(profiles/'filament.json'),'--ensure-on-bed','--arrange','1','--orient','0',
            '--slice','0','--mstpp','120','--export-3mf','REFERENCE-NOT-FOR-PRINT.3mf','--outputdir',str(directory),row['model']['path']]
        start=time.monotonic()
        try:
            completed=subprocess.run(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
            (directory/'slicer.log').write_bytes(completed.stdout);code=completed.returncode;timed_out=False
        except subprocess.TimeoutExpired as error:
            (directory/'slicer.log').write_bytes(error.stdout or b'');code=None;timed_out=True
        result_path=directory/'result.json';result=json.loads(result_path.read_text()) if result_path.exists() else None
        plates=[] if result is None else result.get('sliced_plates',[])
        run_record=dict(index=row['index'],variant=row['variant'],source_file=row['file'],quantity=row['quantity'],
            supports=row['supports'],rotation=row['rotation'],command=command,exit_code=code,timed_out=timed_out,
            elapsed_seconds=time.monotonic()-start,result=result,
            slice_completed=code==0 and result is not None and result.get('return_code')==0 and bool(plates),
            logs=pin(directory/'slicer.log'),project=pin(directory/'REFERENCE-NOT-FOR-PRINT.3mf') if (directory/'REFERENCE-NOT-FOR-PRINT.3mf').exists() else None)
        runs.append(run_record)
        (output/'slicing-results.json').write_text(json.dumps(dict(production_ready=False,reference_only=True,runs=runs),indent=2)+'\n')
        print(row['variant'],row['index'],'exit',code,'warnings',[p.get('warning_message') for p in plates],flush=True)
    return runs


def project_transform(value):
    matrix=np.array([float(v) for v in (value or '1 0 0 0 1 0 0 0 1 0 0 0').split()])
    if matrix.shape!=(12,) or not np.isfinite(matrix).all():raise ValueError('Invalid project transform')
    matrix=matrix.reshape(4,3)
    return matrix[:3],matrix[3]


def inspect_project(path,quantity,unsliced=False,models=None,expected_inventory=None):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:raise ValueError('Corrupt project archive')
        if unsliced and any('.gcode' in name.lower() for name in archive.namelist()):
            raise ValueError('Review project contains machine instructions')
        root=ET.fromstring(archive.read('3D/3dmodel.model'))
        ns={'m':'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
        builds=root.findall('m:build/m:item',ns);resources=root.findall('m:resources/m:object',ns)
        build_ids=[b.get('objectid') for b in builds];resource_ids=[r.get('id') for r in resources]
        if root.get('unit')!='millimeter' or len(builds)!=quantity:
            raise ValueError('Wrong project unit or instance count')
        config=ET.fromstring(archive.read('Metadata/model_settings.config'))
        objects=config.findall('object')
        ids=[o.get('id') for o in objects]
        if len(objects)!=quantity or len(set(ids))!=quantity or len(set(build_ids))!=quantity or sorted(ids)!=sorted(build_ids) or sorted(ids)!=sorted(resource_ids):
            raise ValueError('Wrong project object inventory')
        inventory=collections.Counter()
        for obj in objects:
            if len(obj.findall('part'))!=1 or len(obj.findall('part/mesh_stat'))!=1:
                raise ValueError('Unexpected part inventory or missing mesh statistics')
            if obj.find('part').get('subtype')!='normal_part':raise ValueError('Non-normal fabrication part')
            name=obj.find("part/metadata[@key='source_file']").get('value')
            if Path(name).name!=name:raise ValueError('Unexpected source filename')
            if expected_inventory is not None and name not in expected_inventory:raise ValueError('Wrong design in project slot')
            inventory[name]+=1
            resource=resources[resource_ids.index(obj.get('id'))]
            components=resource.findall('m:components/m:component',ns)
            if resource.get('type')!='model' or len(components)!=1 or resource.find('m:mesh',ns) is not None:
                raise ValueError('Unexpected component inventory')
            component=components[0];build=builds[build_ids.index(obj.get('id'))]
            linear,offset=project_transform(build.get('transform'))
            component_linear,component_offset=project_transform(component.get('transform'))
            if build.get('printable')!='1' or not np.allclose(linear@linear.T,np.eye(3),atol=2e-8,rtol=0) or not math.isclose(np.linalg.det(linear),1,abs_tol=2e-8):
                raise ValueError('Non-rigid or non-printable build instance')
            if not np.allclose(linear[2],(0,0,1),atol=2e-8,rtol=0) or not np.allclose(linear[:,2],(0,0,1),atol=2e-8,rtol=0):
                raise ValueError('Build instance changed printing pose')
            if not np.allclose(component_linear,np.eye(3),atol=2e-8,rtol=0):
                raise ValueError('Component changed printing pose or size')
            if models is not None:
                model_path=component.get('{http://schemas.microsoft.com/3dmanufacturing/production/2015/06}path')
                model=ET.fromstring(archive.read(model_path.lstrip('/')))
                mesh_objects=model.findall('m:resources/m:object',ns)
                if model.get('unit')!='millimeter' or len(mesh_objects)!=1 or mesh_objects[0].get('type')!='model' or mesh_objects[0].get('id')!=component.get('objectid') or mesh_objects[0].find('m:components',ns) is not None:
                    raise ValueError('Unexpected external mesh inventory or units')
                mesh=mesh_objects[0].find('m:mesh',ns)
                if mesh is None:raise ValueError('Missing referenced mesh')
                vertices=np.array([[float(v.get(k)) for k in ('x','y','z')] for v in mesh.findall('m:vertices/m:vertex',ns)])
                faces=np.array([[int(v.get(k)) for k in ('v1','v2','v3')] for v in mesh.findall('m:triangles/m:triangle',ns)])
                placed=(vertices@component_linear+component_offset)@linear+offset
                if not math.isclose(float(placed[:,2].min()),0,abs_tol=2e-5):raise ValueError('Build instance is not grounded')
                # Arrangement may translate and rotate in XY. Undo only that allowed
                # arrangement; retain Z placement and all composed component effects.
                posed=(placed-np.array([offset[0],offset[1],0]))@linear.T
                actual=posed[faces]
                expected=disco_inches.mesh((models/name).read_bytes()).triangles.copy()
                for triangles in (actual,expected):
                    centre=(triangles.min(axis=(0,1))+triangles.max(axis=(0,1)))/2
                    triangles-=np.array([centre[0],centre[1],0])
                if actual.shape!=expected.shape or not np.allclose(actual,expected,atol=2e-5,rtol=0):
                    raise ValueError('Project mesh changed physical geometry')
            for stat in obj.findall('part/mesh_stat'):
                if any(int(value) for key,value in stat.attrib.items() if key!='face_count'):
                    raise ValueError('Slicer repaired a mesh')
        if expected_inventory is not None and dict(inventory)!=expected_inventory:raise ValueError('Wrong project design quantities')
        return dict(project=pin(path),instances=quantity,unit='millimeter',inventory=dict(inventory),
                    automatic_mesh_repairs=0,composed_transforms_checked=models is not None,
                    machine_instructions_present=any('.gcode' in n.lower() for n in archive.namelist()))


def review_project(output):
    """An unsliced layout, not the individually sliced support-setting comparisons."""
    profiles=output/'reference-profiles';directory=output/'review';directory.mkdir(exist_ok=True)
    manifest=json.loads((output/'manifest.json').read_text())
    rows=[r for r in manifest['models'] if r['variant']=='candidate']
    command=[str(BINARY),'--datadir',str(output/'isolated-appdata'),
        '--load-settings',str(profiles/'machine.json')+';'+str(profiles/'supported.json'),
        '--load-filaments',str(profiles/'filament.json'),'--ensure-on-bed','--arrange','1','--orient','0',
        '--clone-objects',','.join(str(r['quantity']) for r in rows),
        '--export-3mf','DISCO-PRELIMINARY-REVIEW-NOT-FOR-PRINT.3mf','--outputdir',str(directory)]
    result=subprocess.run(command+[r['model']['path'] for r in rows],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=180)
    (directory/'layout.log').write_bytes(result.stdout)
    if result.returncode:raise ValueError('Review layout export failed')
    return inspect_project(directory/'DISCO-PRELIMINARY-REVIEW-NOT-FOR-PRINT.3mf',10,unsliced=True)


def check_bound_gcode(project,gcode):
    with zipfile.ZipFile(project) as archive:
        if archive.read('Metadata/plate_1.gcode')!=gcode.read_bytes():raise ValueError('Standalone toolpath differs from bound project')


def negative_controls(project,models,wrong_slot):
    rejected=[]
    with tempfile.TemporaryDirectory(prefix='slicer-project-controls-') as directory:
        for label in ('machine-code','missing-instance','wrong-units','mesh-repair','changed-geometry',
                      'build-scale','component-scale','build-tilt','off-bed','extra-component','missing-component','external-units',
                      'non-printable','non-normal-part'):
            target=Path(directory)/(label+'.3mf')
            with zipfile.ZipFile(project) as before,zipfile.ZipFile(target,'x') as after:
                changed=False
                for name in before.namelist():
                    data=before.read(name)
                    if name=='3D/3dmodel.model' and label in ('missing-instance','wrong-units','build-scale','component-scale','build-tilt','off-bed','extra-component','missing-component','non-printable'):
                        root=ET.fromstring(data)
                        if label=='wrong-units':root.set('unit','inch')
                        elif label=='missing-instance':
                            build=root.find('{*}build');build.remove(list(build)[0])
                        elif label in ('build-scale','build-tilt','off-bed','non-printable'):
                            item=root.find('{*}build/{*}item')
                            if label=='non-printable':item.set('printable','0')
                            elif label=='build-scale':item.set('transform','2 0 0 0 2 0 0 0 2 0 0 0')
                            elif label=='build-tilt':item.set('transform','1 0 0 0 0 1 0 -1 0 0 0 0')
                            else:
                                values=item.get('transform').split();values[-1]=str(float(values[-1])+1);item.set('transform',' '.join(values))
                        else:
                            group=root.find('{*}resources/{*}object/{*}components');component=list(group)[0]
                            if label=='component-scale':component.set('transform','2 0 0 0 2 0 0 0 2 0 0 0')
                            elif label=='extra-component':group.append(ET.fromstring(ET.tostring(component)))
                            else:group.remove(component)
                        data=ET.tostring(root)
                    if name=='Metadata/model_settings.config' and label=='mesh-repair':
                        data=data.replace(b'edges_fixed="0"',b'edges_fixed="1"',1)
                    if name=='Metadata/model_settings.config' and label=='non-normal-part':
                        root=ET.fromstring(data);root.find('object/part').set('subtype','negative_part');data=ET.tostring(root)
                    if label in ('changed-geometry','external-units') and name.startswith('3D/Objects/') and name.endswith('.model') and not changed:
                        root=ET.fromstring(data);vertex=root.find('.//{*}vertex')
                        if vertex is not None:
                            if label=='changed-geometry':vertex.set('x',str(float(vertex.get('x'))+1))
                            else:root.set('unit','inch')
                            data=ET.tostring(root);changed=True
                    after.writestr(name,data)
                if label=='machine-code':after.writestr('Metadata/plate_1.gcode','G1 X1')
            if label in ('changed-geometry','external-units') and not changed:raise ValueError('No mesh found for control')
            try:inspect_project(target,10,unsliced=True,models=models)
            except ValueError:rejected.append(label)
            else:raise ValueError('Accepted negative control: '+label)
        altered=Path(directory)/'divergent-gcode.3mf'
        with zipfile.ZipFile(wrong_slot[0]) as before,zipfile.ZipFile(altered,'x') as after:
            for name in before.namelist():
                data=before.read(name)
                if name=='Metadata/plate_1.gcode':data+=b'\n; altered archived toolpath\n'
                after.writestr(name,data)
        try:check_bound_gcode(altered,wrong_slot[0].parent/'plate_1.gcode')
        except ValueError:rejected.append('divergent-gcode')
        else:raise ValueError('Accepted a toolpath different from the inspected external G-code')
    try:inspect_project(wrong_slot[0],1,models=models,expected_inventory=wrong_slot[1])
    except ValueError:rejected.append('wrong-run-slot')
    else:raise ValueError('Accepted a different design in the comparison slot')
    return rejected


def check(output):
    manifest=json.loads((output/'manifest.json').read_text())
    if manifest['production_ready'] is not False:raise ValueError('Overstated release status')
    for item in (manifest['slicer_binary'],manifest['source_inch_validation'],manifest['source_zip']):
        if pin(Path(item['path']))!=item:raise ValueError('Changed reference input')
    for path,digest in manifest['preset_sources'].items():
        if pin(Path(path))['sha256']!=digest:raise ValueError('Changed source preset')
    source=disco_inches.check(Path(manifest['source_inch_validation']['path']).parent)
    if manifest['source_zip']!=source['zip']:raise ValueError('Wrong source archive identity')
    slots=collections.Counter((v,i) for v in ('as-exported','candidate') for i in range(1,9))
    if collections.Counter((r['variant'],r['index']) for r in manifest['models'])!=slots:raise ValueError('Wrong posed-model inventory')
    models={(r['variant'],r['index']):r for r in manifest['models']}
    runs=json.loads((output/'slicing-results.json').read_text())['runs']
    if collections.Counter((r['variant'],r['index']) for r in runs)!=slots:
        raise ValueError('Incomplete or duplicate slice comparison')
    checks=[]
    with zipfile.ZipFile(source['zip']['path']) as archive:
        for row in manifest['models']:
            canonical=source['files'][row['index']-1]
            axis,angle=POSES.get(row['index'],('x',0)) if row['variant']=='candidate' else ('x',0)
            if row['file']!=canonical['file'] or row['quantity']!=canonical['quantity'] or row['rotation']!=dict(axis=axis,degrees=angle) or row['supports']!=(row['variant']=='candidate' and row['index'] not in (2,3,6)):
                raise ValueError('Posed-model slot differs from canonical design')
            target=Path(row['model']['path'])
            if pin(target)!=row['model']:raise ValueError('Changed posed mesh')
            expected=disco_inches.mesh(archive.read(row['file']));expected.apply_scale(25.4)
            vector=(1,0,0) if row['rotation']['axis']=='x' else (0,1,0)
            expected.apply_transform(trimesh.transformations.rotation_matrix(math.radians(row['rotation']['degrees']),vector))
            expected.apply_translation([-expected.bounds[:,0].mean(),-expected.bounds[:,1].mean(),-expected.bounds[0,2]])
            actual=disco_inches.mesh(target.read_bytes())
            if expected.triangles.shape!=actual.triangles.shape or not np.allclose(expected.triangles,actual.triangles,atol=2e-5,rtol=0):
                raise ValueError('Pose changed physical geometry')
    for row in runs:
        model=models[row['variant'],row['index']]
        if any(row[k]!=model[m] for k,m in [('source_file','file'),('quantity','quantity'),('rotation','rotation'),('supports','supports')]):raise ValueError('Run slot differs from posed design')
        directory=output/'analysis-only'/row['variant']/str(row['index'])
        result=json.loads((directory/'result.json').read_text())
        if row['exit_code']!=0 or result['return_code']!=0 or not result['sliced_plates']:
            raise ValueError('Slice failed')
        expected_inventory={Path(model['model']['path']).name:1}
        project=inspect_project(directory/'REFERENCE-NOT-FOR-PRINT.3mf',1,models=output/'models'/row['variant'],expected_inventory=expected_inventory)
        if project['project']!=row['project']:raise ValueError('Changed sliced project')
        check_bound_gcode(directory/'REFERENCE-NOT-FOR-PRINT.3mf',directory/'plate_1.gcode')
        config={}
        for line in (directory/'plate_1.gcode').read_text().splitlines():
            if line.startswith('; ') and ' = ' in line:
                key,value=line[2:].split(' = ',1);config[key]=value
        expected={'printer_model':'Bambu Lab X1 Carbon','nozzle_diameter':'0.4','layer_height':'0.2',
                  'filament_type':'PLA','enable_support':str(int(row['supports']))}
        if any(config.get(k)!=v for k,v in expected.items()):raise ValueError('Wrong effective reference settings')
        checks.append(dict(index=row['index'],variant=row['variant'],archive=project,
            warning_messages=[p['warning_message'] for p in result['sliced_plates']],effective_settings=expected))
    layout=inspect_project(output/'review/DISCO-PRELIMINARY-REVIEW-NOT-FOR-PRINT.3mf',10,unsliced=True,models=output/'models/candidate')
    quantities={Path(r['model']['path']).name:r['quantity'] for r in manifest['models'] if r['variant']=='candidate'}
    if layout['inventory']!=quantities:raise ValueError('Wrong layout quantities')
    report=dict(production_ready=False,geometry_unchanged=True,comparison=checks,review_layout=layout,
                rejected_negative_controls=negative_controls(Path(layout['project']['path']),output/'models/candidate',
                    (output/'analysis-only/candidate/2/REFERENCE-NOT-FOR-PRINT.3mf',
                     {Path(models['candidate',1]['model']['path']).name:1})),
                review_layout_scope='Orientation and quantity review only; global auto-support is enabled. Per-part comparison settings are in slicing-results.json.')
    (output/'verification.json').write_text(json.dumps(report,indent=2)+'\n')
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('inch_packet',type=Path);p.add_argument('output',type=Path)
    p.add_argument('--check-existing',action='store_true')
    a=p.parse_args()
    if not a.check_existing:
        prepare(a.inch_packet,a.output);run(a.output,('as-exported','candidate'));review_project(a.output)
    print(json.dumps(check(a.output),indent=2))
