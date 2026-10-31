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


def inspect_project(path,quantity,unsliced=False,models=None):
    with zipfile.ZipFile(path) as archive:
        if archive.testzip() is not None:raise ValueError('Corrupt project archive')
        if unsliced and any('.gcode' in name.lower() for name in archive.namelist()):
            raise ValueError('Review project contains machine instructions')
        root=ET.fromstring(archive.read('3D/3dmodel.model'))
        ns={'m':'http://schemas.microsoft.com/3dmanufacturing/core/2015/02'}
        if root.get('unit')!='millimeter' or len(root.findall('m:build/m:item',ns))!=quantity:
            raise ValueError('Wrong project unit or instance count')
        config=ET.fromstring(archive.read('Metadata/model_settings.config'))
        objects=config.findall('object')
        if len(objects)!=quantity:raise ValueError('Wrong project object count')
        inventory=collections.Counter()
        for obj in objects:
            name=obj.find("part/metadata[@key='source_file']").get('value')
            inventory[name]+=1
            if models is not None:
                component=root.find(f"m:resources/m:object[@id='{obj.get('id')}']/m:components/m:component",ns)
                model_path=component.get('{http://schemas.microsoft.com/3dmanufacturing/production/2015/06}path')
                model=ET.fromstring(archive.read(model_path.lstrip('/')))
                vertices=np.array([[float(v.get(k)) for k in ('x','y','z')] for v in model.findall('.//m:vertex',ns)])
                faces=np.array([[int(v.get(k)) for k in ('v1','v2','v3')] for v in model.findall('.//m:triangle',ns)])
                actual=vertices[faces]
                expected=disco_inches.mesh((models/name).read_bytes()).triangles.copy()
                for triangles in (actual,expected):
                    triangles-=(triangles.min(axis=(0,1))+triangles.max(axis=(0,1)))/2
                if actual.shape!=expected.shape or not np.allclose(actual,expected,atol=2e-5,rtol=0):
                    raise ValueError('Project mesh changed physical geometry')
            for stat in obj.findall('part/mesh_stat'):
                if any(int(value) for key,value in stat.attrib.items() if key!='face_count'):
                    raise ValueError('Slicer repaired a mesh')
        return dict(project=pin(path),instances=quantity,unit='millimeter',inventory=dict(inventory),
                    automatic_mesh_repairs=0,machine_instructions_present=any('.gcode' in n.lower() for n in archive.namelist()))


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


def negative_controls(project,models):
    rejected=[]
    with tempfile.TemporaryDirectory(prefix='slicer-project-controls-') as directory:
        for label in ('machine-code','missing-instance','wrong-units','mesh-repair','changed-geometry'):
            target=Path(directory)/(label+'.3mf')
            with zipfile.ZipFile(project) as before,zipfile.ZipFile(target,'x') as after:
                changed=False
                for name in before.namelist():
                    data=before.read(name)
                    if name=='3D/3dmodel.model' and label in ('missing-instance','wrong-units'):
                        root=ET.fromstring(data)
                        if label=='wrong-units':root.set('unit','inch')
                        else:
                            build=root.find('{*}build');build.remove(list(build)[0])
                        data=ET.tostring(root)
                    if name=='Metadata/model_settings.config' and label=='mesh-repair':
                        data=data.replace(b'edges_fixed="0"',b'edges_fixed="1"',1)
                    if label=='changed-geometry' and name.startswith('3D/Objects/') and name.endswith('.model') and not changed:
                        root=ET.fromstring(data);vertex=root.find('.//{*}vertex')
                        if vertex is not None:
                            vertex.set('x',str(float(vertex.get('x'))+1));data=ET.tostring(root);changed=True
                    after.writestr(name,data)
                if label=='machine-code':after.writestr('Metadata/plate_1.gcode','G1 X1')
            if label=='changed-geometry' and not changed:raise ValueError('No mesh found for control')
            try:inspect_project(target,10,unsliced=True,models=models)
            except ValueError:rejected.append(label)
            else:raise ValueError('Accepted negative control: '+label)
    return rejected


def check(output):
    manifest=json.loads((output/'manifest.json').read_text())
    if manifest['production_ready'] is not False:raise ValueError('Overstated release status')
    for item in (manifest['slicer_binary'],manifest['source_inch_validation'],manifest['source_zip']):
        if pin(Path(item['path']))!=item:raise ValueError('Changed reference input')
    for path,digest in manifest['preset_sources'].items():
        if pin(Path(path))['sha256']!=digest:raise ValueError('Changed source preset')
    source=disco_inches.check(Path(manifest['source_inch_validation']['path']).parent)
    runs=json.loads((output/'slicing-results.json').read_text())['runs']
    if collections.Counter((r['variant'],r['index']) for r in runs)!=collections.Counter((v,i) for v in ('as-exported','candidate') for i in range(1,9)):
        raise ValueError('Incomplete or duplicate slice comparison')
    checks=[]
    with zipfile.ZipFile(source['zip']['path']) as archive:
        for row in manifest['models']:
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
        directory=output/'analysis-only'/row['variant']/str(row['index'])
        result=json.loads((directory/'result.json').read_text())
        if row['exit_code']!=0 or result['return_code']!=0 or not result['sliced_plates']:
            raise ValueError('Slice failed')
        project=inspect_project(directory/'REFERENCE-NOT-FOR-PRINT.3mf',1,models=output/'models'/row['variant'])
        if project['project']!=row['project']:raise ValueError('Changed sliced project')
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
                rejected_negative_controls=negative_controls(Path(layout['project']['path']),output/'models/candidate'),
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
