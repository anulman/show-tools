"""Export and reference-slice the current five-piece disco proposal."""
from __future__ import annotations
import argparse
from copy import deepcopy
import hashlib
import io
import json
import math
from pathlib import Path
import sys
import tempfile
import zipfile

import numpy as np
import trimesh
from build123d import Axis, export_stl, import_step

import concept_preview
import slicer_preflight as slicer
sys.path.insert(0,str(Path(__file__).parent/'verification'))
from geometry_artifacts import adaptive_mass

HEADER=b'INCH COORDINATES - IMPORT AS INCHES - QTY IN FILENAME - PROPOSED PROTOTYPE'
ROLES=[('bar',1,'01-PRINT-1-integral-bar-INCH.stl',('x',135),True),
       ('shoe',2,'02-PRINT-2-identical-grip-shoe-INCH.stl',('y',-90),False),
       ('shell',1,'03-PRINT-1-low-mounting-box-INCH.stl',('x',180),True),
       ('bottom',1,'04-PRINT-1-bottom-cover-INCH.stl',('x',0),False)]


def require(ok,message):
    if not ok:raise ValueError(message)


def pin(path):return slicer.pin(Path(path))


def mesh(data):
    m=trimesh.load_mesh(io.BytesIO(data),file_type='stl')
    require(isinstance(m,trimesh.Trimesh) and np.isfinite(m.vertices).all()
        and m.is_watertight and m.is_winding_consistent and math.isfinite(m.volume) and m.volume>0,
        'Invalid delivered mesh')
    return m


def admit():
    scene,selection,_=concept_preview.load()
    require(selection['sha256']=='8138b998e8a054eefd92a7d22f1cdeabe15cfd7130a6f2243de8433c677e3c0c',
            'Review a new scene revision before exporting')
    grip_path=Path(scene['source_receipts'][0]['path']);base_path=Path(scene['source_receipts'][1]['path'])
    require(pin(grip_path)==scene['source_receipts'][0] and pin(base_path)==scene['source_receipts'][1],
            'Changed current component receipt')
    grip=json.loads(grip_path.read_text());base=json.loads(base_path.read_text())
    prints=[r for r in grip['components'] if r['role']=='print']
    require(len(prints)==3 and base['parameters']['roof_to_ground_mm']==64,'Wrong five-part proposal')
    bar=next(r for r in prints if 'integral' in r['name'])
    shoes=[r for r in prints if 'shoe' in r['name']]
    require(len(shoes)==2,'Expected two shoes')
    rows={'bar':bar,'shoe':shoes[0],**{r['name']:r for r in base['preview_components']}}
    shapes={}
    for name,row in rows.items():
        require(pin(row['step'])['sha256']==row.get('step_sha256',row.get('sha256')),'Changed source STEP')
        wrapper=import_step(row['step'])
        require(wrapper.is_valid and len(wrapper.solids())==1,'Invalid canonical print solid')
        shapes[name]=wrapper.solids()[0]
    other=shoes[1]
    require(pin(other['step'])['sha256']==other['step_sha256'],'Changed second shoe')
    twin=import_step(other['step']).solids()[0].rotate(Axis.Z,180)
    sys.path.insert(0,str(Path(__file__).parent/'box-mount/access'))
    import panel_mount_box_concept as panel
    with panel.previous.inherited.detached_booleans():
        require(panel.g.outside_volume(shapes['shoe'],twin)<1e-6
            and panel.g.outside_volume(twin,shapes['shoe'])<1e-6,'Shoes are not interchangeable copies')
    check=Path('/private/tmp/panel-mount-low-box-concept-v3/check-subjects.json')
    checked=json.loads(check.read_text())
    require(checked['geometry_checks_pass'] and checked['actual_subjects_unchanged']
        and checked['real_native_mutation_negative_control_rejected']
        and checked['receipt']==pin(base_path),'Missing matching lower-box geometry check')
    return shapes,rows,dict(scene=selection,grip=pin(grip_path),base=pin(base_path),low_box_check=pin(check))


def pose(m,axis,degrees):
    m=m.copy();vector=(1,0,0) if axis=='x' else (0,1,0)
    m.apply_transform(trimesh.transformations.rotation_matrix(math.radians(degrees),vector))
    m.apply_translation([-m.bounds[:,0].mean(),-m.bounds[:,1].mean(),-m.bounds[0,2]])
    return m


def equivalent(actual,expected):
    require(actual.triangles.shape==expected.triangles.shape and
        np.allclose(actual.triangles,expected.triangles,atol=2e-5,rtol=0),'Export changed physical geometry')


def bed_contact_area(part):
    bed=part.bounds[0,2]
    return float(part.area_faces[np.all(np.isclose(part.triangles[:,:,2],bed,atol=1e-5,rtol=0),axis=1)].sum())


def prepare(output):
    require(not output.exists(),'Use a fresh output directory')
    shapes,rows,provenance=admit();output.mkdir(parents=True)
    profiles=output/'reference-profiles';profiles.mkdir();pins={};settings={}
    for kind,name in slicer.REFERENCE:
        settings[kind]=slicer.flatten(kind,name,pins)
        (profiles/(kind+'.json')).write_text(json.dumps(settings[kind],indent=2)+'\n')
    supported=dict(settings['process'],enable_support='1',support_type='normal(auto)',support_on_build_plate_only='1',enable_arc_fitting='0')
    (profiles/'supported.json').write_text(json.dumps(supported,indent=2)+'\n')
    files=[];models=[];fabrication=output/'STL-INCH';fabrication.mkdir()
    for index,(role,quantity,name,(axis,degrees),supports) in enumerate(ROLES,1):
        source=output/'canonical-mm'/(role+'.stl');source.parent.mkdir(exist_ok=True)
        require(export_stl(deepcopy(shapes[role]),source,tolerance=.03,angular_tolerance=.1),'STL export failed')
        original=mesh(source.read_bytes());mass,error=adaptive_mass(shapes[role]);bb=shapes[role].bounding_box()
        require(math.isclose(original.volume,mass,rel_tol=.005),'Mesh/native adaptive mass differs')
        require(np.allclose(original.bounds,[[bb.min.X,bb.min.Y,bb.min.Z],[bb.max.X,bb.max.Y,bb.max.Z]],atol=.055,rtol=0),'Mesh/native bounds differ')
        require(len(original.split(only_watertight=False))==len(shapes[role].shells()),'Mesh boundary-shell inventory differs')
        candidate=pose(original,axis,degrees)
        inch=candidate.copy();inch.apply_scale(1/25.4)
        data=inch.export(file_type='stl');data=HEADER.ljust(80,b'\0')+data[80:]
        target=fabrication/name;target.write_bytes(data)
        roundtrip=mesh(data);roundtrip.apply_scale(25.4);equivalent(roundtrip,candidate)
        for factor in (1.,1/25.4**2):
            wrong=candidate.copy();wrong.apply_scale(factor*25.4)
            try:equivalent(wrong,candidate)
            except ValueError:pass
            else:raise AssertionError('Wrong-unit negative control admitted')
        files.append(dict(role=role,file=name,quantity=quantity,stl=pin(target),source_step=pin(rows[role]['step']),
            canonical_mm=pin(source),dimensions_inches=mesh(data).extents.tolist(),dimensions_mm=candidate.extents.tolist(),
            native_volume_mm3=mass,mass_error_estimate=error,mesh_volume_mm3=float(original.volume),
            triangle_count=len(original.faces),watertight=True,winding_consistent=True,
            boundary_shells=len(shapes[role].shells()),rotation=dict(axis=axis,degrees=degrees)))
        for variant,part in [('as-exported',pose(original,'x',0)),('candidate',candidate)]:
            path=output/'models'/variant/name.replace('-INCH.stl','-PHYSICAL-MM.stl');path.parent.mkdir(parents=True,exist_ok=True)
            part.export(path)
            actual_model=mesh(path.read_bytes())
            models.append(dict(index=index,file=name,quantity=quantity,variant=variant,
                rotation=dict(axis=axis if variant=='candidate' else 'x',degrees=degrees if variant=='candidate' else 0),
                model=pin(path),dimensions_mm=actual_model.extents.tolist(),model_volume_mm3=float(actual_model.volume),
                supports=supports if variant=='candidate' else False))
    archive=output/'disco-five-parts-PROPOSED-INCH-STL.zip'
    with zipfile.ZipFile(archive,'x',zipfile.ZIP_DEFLATED) as z:
        for row in files:z.write(row['stl']['path'],row['file'])
    manifest=dict(scope='CURRENT_FIVE_PRINT_PROPOSAL_OFFLINE_PREFLIGHT',production_ready=False,
        manufacturing_approved=False,physical_fit_verified=False,coordinate_unit='inch',mm_per_inch=25.4,
        printed_pieces=5,unique_print_files=4,files=files,zip=pin(archive),provenance=provenance,
        actual_printer_model=None,actual_nozzle_mm=None,actual_filament=None,
        reference_profiles=[name for _,name in slicer.REFERENCE],preset_sources=pins,slicer_binary=pin(slicer.BINARY),
        reference_profiles_are_not_operator_hardware=True,printer_connected=False,print_submitted=False,models=models)
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    check_packet(output)
    print(archive,flush=True)


def check_packet(output):
    report=json.loads((output/'manifest.json').read_text());shapes,rows,provenance=admit()
    require(provenance==report['provenance'],'Changed canonical selection')
    require(report['coordinate_unit']=='inch' and report['mm_per_inch']==25.4 and report['manufacturing_approved'] is False and report['physical_fit_verified'] is False,'Overstated units or physical scope')
    require(report['printed_pieces']==5 and report['unique_print_files']==4 and report['production_ready'] is False,'Wrong package scope')
    require(pin(report['zip']['path'])==report['zip'],'Changed archive')
    require([(r['role'],r['quantity'],r['file']) for r in report['files']]==[(r,q,n) for r,q,n,_,_ in ROLES],'Wrong print inventory')
    require(pin(slicer.BINARY)==report['slicer_binary'],'Changed slicer binary')
    profile_pins={};settings={}
    for kind,name in slicer.REFERENCE:
        settings[kind]=slicer.flatten(kind,name,profile_pins)
        require(json.loads((output/'reference-profiles'/(kind+'.json')).read_text())==settings[kind],'Changed reference profile')
    require(report['preset_sources']==profile_pins,'Changed source preset inventory')
    supported=dict(settings['process'],enable_support='1',support_type='normal(auto)',support_on_build_plate_only='1',enable_arc_fitting='0')
    require(json.loads((output/'reference-profiles/supported.json').read_text())==supported,'Changed support policy')
    expected_slots=[(variant,index) for index in range(1,5) for variant in ('as-exported','candidate')]
    require([(r['variant'],r['index']) for r in report['models']]==expected_slots,'Wrong posed model inventory')
    with zipfile.ZipFile(report['zip']['path']) as z:
        require(z.testzip() is None and sorted(z.namelist())==sorted(r['file'] for r in report['files']),'Wrong STL-only ZIP inventory')
        for index,(row,policy) in enumerate(zip(report['files'],ROLES),1):
            _,_,_,(axis,degrees),supports=policy
            require(row['source_step']==pin(rows[row['role']]['step']),'Wrong source binding')
            require(pin(row['canonical_mm']['path'])==row['canonical_mm'],'Changed canonical mesh')
            original=mesh(Path(row['canonical_mm']['path']).read_bytes())
            with tempfile.TemporaryDirectory(prefix='current-print-canonical-') as directory:
                fresh=Path(directory)/'fresh.stl'
                require(export_stl(deepcopy(shapes[row['role']]),fresh,tolerance=.03,angular_tolerance=.1),'Canonical retessellation failed')
                equivalent(original,mesh(fresh.read_bytes()))
            expected=pose(original,axis,degrees);data=z.read(row['file'])
            require(hashlib.sha256(data).hexdigest()==row['stl']['sha256'] and data[:80].rstrip(b'\0')==HEADER,'Changed inch STL/header')
            actual=mesh(data);require(np.allclose(actual.extents,row['dimensions_inches'],atol=1e-7,rtol=0),'Wrong declared inch dimensions')
            actual.apply_scale(25.4);equivalent(actual,expected)
            for variant in ('as-exported','candidate'):
                models=[m for m in report['models'] if m['variant']==variant and m['index']==index]
                require(len(models)==1,'Duplicate posed model')
                model=models[0]
                expected_rotation=dict(axis=axis if variant=='candidate' else 'x',degrees=degrees if variant=='candidate' else 0)
                require(model['file']==row['file'] and model['quantity']==row['quantity']
                    and model['rotation']==expected_rotation and model['supports']==(supports if variant=='candidate' else False),'Wrong slicer pose or quantity')
                model_path=output/'models'/variant/row['file'].replace('-INCH.stl','-PHYSICAL-MM.stl')
                require(model['model']==pin(model_path),'Changed posed model')
                posed=mesh(model_path.read_bytes());canonical=pose(original,expected_rotation['axis'],expected_rotation['degrees'])
                equivalent(posed,canonical)
                if row['role']=='shoe' and variant=='candidate':
                    require(bed_contact_area(posed)>300,'Shoe must rest on its broad flat back')
                require(np.allclose(posed.extents,model['dimensions_mm'],atol=1e-6,rtol=0)
                    and math.isclose(posed.volume,model['model_volume_mm3'],rel_tol=1e-6),'Wrong posed model measurements')
    return report


def check_slices(output):
    report=check_packet(output);checks=[]
    for variant in ('as-exported','candidate'):
        root=output/'runs'/variant
        manifest=json.loads((root/'manifest.json').read_text())
        runs=json.loads((root/'slicing-results.json').read_text())['runs']
        expected=[r for r in report['models'] if r['variant']==variant]
        require(manifest['models']==expected and len(runs)==4,'Incomplete reference slice inventory')
        require([(r['variant'],r['index']) for r in runs]==[(variant,i) for i in range(1,5)],'Wrong reference slice slots')
        for name in ('machine.json','process.json','filament.json','supported.json'):
            require((root/'reference-profiles'/name).read_bytes()==(output/'reference-profiles'/name).read_bytes(),'Changed run profile')
        for run,row in zip(runs,expected):
            require(all(run[a]==row[b] for a,b in [('index','index'),('source_file','file'),('quantity','quantity'),('rotation','rotation'),('supports','supports')]),'Wrong slice subject')
            directory=root/'analysis-only'/variant/str(row['index'])
            result=json.loads((directory/'result.json').read_text())
            slicer.check_run_receipt(run,result,directory/'slicer.log')
            path=Path(row['model']['path']);require(pin(path)==row['model'],'Changed slicer input')
            require(len(result['sliced_plates'][0]['objects'])==1
                and result['sliced_plates'][0]['objects'][0]['name']==path.name,'Wrong sliced model')
            project=slicer.inspect_project(directory/'REFERENCE-NOT-FOR-PRINT.3mf',1,
                models=path.parent,expected_inventory={path.name:1})
            require(project['project']==run['project'],'Changed slicer project')
            slicer.check_bound_gcode(directory/'REFERENCE-NOT-FOR-PRINT.3mf',directory/'plate_1.gcode')
            effective={}
            for line in (directory/'plate_1.gcode').read_text().splitlines():
                if line.startswith('; ') and ' = ' in line:
                    key,value=line[2:].split(' = ',1);effective[key]=value
            policy={'printer_model':'Bambu Lab X1 Carbon','nozzle_diameter':'0.4','layer_height':'0.2',
                'filament_type':'PLA','enable_support':str(int(row['supports']))}
            if row['supports']:policy.update(support_on_build_plate_only='1',enable_arc_fitting='0')
            require(all(effective.get(k)==v for k,v in policy.items()),'Wrong effective G-code reference settings')
            checks.append(dict(effective_settings=policy,role=ROLES[row['index']-1][0],variant=variant,supports=row['supports'],
                slice_completed=True,automatic_mesh_repairs=0,
                warnings=[p['warning_message'] for p in result['sliced_plates']],project=project['project']))
    summary=dict(scope='OFFLINE_REFERENCE_SLICING_ONLY',production_ready=False,reference_only=True,
        actual_printer_model=None,actual_material=None,source_zip=report['zip'],checks=checks)
    (output/'slice-validation.json').write_text(json.dumps(summary,indent=2)+'\n')
    print('PASS: 8 bound reference slices; candidate warnings '+str([c['warnings'] for c in checks if c['variant']=='candidate']),flush=True)
    return summary


def run_slices(output,variant):
    report=check_packet(output);root=output/'runs'/variant
    root.mkdir(parents=True)
    import shutil
    shutil.copytree(output/'reference-profiles',root/'reference-profiles')
    (root/'manifest.json').write_text(json.dumps(dict(models=[r for r in report['models'] if r['variant']==variant])))
    slicer.run(root,[variant])


def negative_controls(output):
    import shutil
    report=check_packet(output);rejected=[]
    labels=('posed-scale','wrong-quantity','missing-slot','wrong-inch-scale','support-everywhere')
    with tempfile.TemporaryDirectory(prefix='five-part-export-controls-') as folder:
        for label in labels:
            root=Path(folder)/label
            shutil.copytree(output,root,ignore=shutil.ignore_patterns('runs','cavity-*','*validation.json','*controls.json','proposal-release.json'))
            changed=json.loads((root/'manifest.json').read_text())
            for row in changed['models']:
                row['model']=pin(root/'models'/row['variant']/Path(row['model']['path']).name)
            if label=='posed-scale':
                row=next(r for r in changed['models'] if r['variant']=='candidate' and r['index']==1)
                path=Path(row['model']['path']);bad=mesh(path.read_bytes());bad.apply_scale(1.01);bad.export(path)
                row.update(model=pin(path),dimensions_mm=mesh(path.read_bytes()).extents.tolist(),model_volume_mm3=float(mesh(path.read_bytes()).volume))
            elif label=='wrong-quantity':changed['models'][3]['quantity']=1
            elif label=='missing-slot':changed['models'].pop()
            elif label=='support-everywhere':
                path=root/'reference-profiles/supported.json';bad=json.loads(path.read_text());bad['support_on_build_plate_only']='0';path.write_text(json.dumps(bad))
            else:
                archive=root/'wrong-inch.zip'
                with zipfile.ZipFile(changed['zip']['path']) as before,zipfile.ZipFile(archive,'x') as after:
                    for index,name in enumerate(before.namelist()):
                        data=before.read(name)
                        if index==0:
                            bad=mesh(data);bad.apply_scale(25.4);data=HEADER.ljust(80,b'\0')+bad.export(file_type='stl')[80:]
                            changed['files'][0]['stl']['sha256']=hashlib.sha256(data).hexdigest()
                            changed['files'][0]['dimensions_inches']=mesh(data).extents.tolist()
                        after.writestr(name,data)
                changed['zip']=pin(archive)
            (root/'manifest.json').write_text(json.dumps(changed,indent=2))
            try:check_packet(root)
            except ValueError as error:rejected.append(dict(control=label,rejected=True,reason=str(error)))
            else:raise AssertionError('Bad export/control admitted: '+label)
    shoe=next(r for r in report['files'] if r['role']=='shoe')
    source=mesh(Path(shoe['canonical_mm']['path']).read_bytes())
    good=bed_contact_area(pose(source,'y',-90));bad=bed_contact_area(pose(source,'y',90))
    require(good>300 and bad<100,'Wrong shoe bed pose was not distinguished')
    result=dict(source_zip=report['zip'],rejected=rejected,shoe_bed_contact_mm2=dict(correct=good,rejected=bad),
        unit_scale_controls_during_prepare=True,production_ready=False)
    path=output/'packet-controls.json';encoded=json.dumps(result,indent=2)+'\n'
    if path.exists():require(path.read_text()==encoded,'Changed control result')
    else:path.write_text(encoded)
    return pin(path)


def support_pass(report):
    return (report['status']=='NO_SUPPORT_CENTERLINE_IN_CLOSED_CAVITY'
        and report['native_strict_inside_common_edge_union_length_mm']==0
        and report['native_boundary_contact_common_edge_union_length_mm']==0
        and report['native_positive_control_length_mm']>79.99
        and report['wall_frame_positive_samples_inside']>=90
        and report['all_native_candidates_processed'] is True)


def publish_handoff(output,delivery,source_zip,notes,evidence):
    import shutil
    require(not delivery.exists(),'Use a fresh human handoff directory')
    partial=None;published=False
    with tempfile.TemporaryDirectory(prefix='.disco-handoff-',dir=delivery.parent) as directory:
        staged=Path(directory)/'handoff';staged.mkdir()
        target=staged/'DISCO-BALL-5-PIECES-PROPOSED-INCH-STL.zip'
        shutil.copyfile(source_zip['path'],target)
        require(pin(target)['sha256']==source_zip['sha256'],'Delivered ZIP changed')
        with zipfile.ZipFile(target) as archive:
            require(archive.testzip() is None and len(archive.namelist())==4
                and all(name.endswith('.stl') for name in archive.namelist()),'Invalid staged fabrication ZIP')
        note=staged/'PRINT-NOTES.txt';note.write_text(notes)
        require(note.read_text()==notes,'Printer notes changed during staging')
        result=dict(evidence,delivered_zip=dict(path=str((delivery/target.name).resolve()),sha256=pin(target)['sha256']),
            printer_notes=dict(path=str((delivery/note.name).resolve()),sha256=pin(note)['sha256']))
        try:
            with tempfile.NamedTemporaryFile(prefix='.proposal-release-',dir=output,delete=False) as receipt:
                partial=Path(receipt.name)
                receipt.write((json.dumps(result,indent=2)+'\n').encode())
            require(not delivery.exists(),'Handoff target appeared during preparation')
            staged.rename(delivery);published=True
            partial.replace(output/'proposal-release.json')
        except BaseException:
            if published:shutil.rmtree(delivery)
            raise
        finally:
            if partial is not None:partial.unlink(missing_ok=True)
    final=delivery/target.name
    print(final,flush=True)
    return final


def release(output,guard_path,negative_path,cover_path,grip_path,delivery):
    slices=check_slices(output);controls=negative_controls(output);report=check_packet(output)
    guard=json.loads(guard_path.read_text());negative=json.loads(negative_path.read_text())
    cover=json.loads(cover_path.read_text());grip=json.loads(grip_path.read_text())
    require(support_pass(guard) and guard['actual_bar_subject_reimport_unchanged'] is True,'Final bar support guard failed')
    require(not support_pass(negative) and negative['status']=='TRAPPED_SUPPORT_CENTERLINES'
        and negative['native_strict_inside_common_edge_union_length_mm']>1,'Unsafe upright control was not rejected')
    bar=next(r for r in report['models'] if r['variant']=='candidate' and r['index']==1)
    directory=output/'runs/candidate/analysis-only/candidate/1'
    require(guard['rotation_x_deg']==bar['rotation']['degrees'],'Wrong guarded printing orientation')
    for path in (Path(bar['model']['path']),directory/'REFERENCE-NOT-FOR-PRINT.3mf',directory/'result.json',directory/'plate_1.gcode'):
        require(guard['source_input_files'].get(str(path.resolve()))==pin(path)['sha256'],'Cavity guard belongs to another slice')
    for proof in (guard,negative):
        for path,sha in proof['source_input_files'].items():
            require(pin(path)['sha256']==sha,'Changed support evidence input')
        require(proof['source_input_files'].get(report['provenance']['grip']['path'])==report['provenance']['grip']['sha256'],'Wrong guarded bar source')
    require(cover['geometry_checks_pass'] and cover['actual_subjects_reimport_unchanged']
        and not cover['dimensional_standard_mismatch_found'] and cover['base_receipt']==report['provenance']['base'],'Cover hardware audit mismatch')
    require(grip['standard_dimensions_match'] and grip['actual_subject_unchanged']
        and grip['provenance']==report['provenance'],'Grip hardware audit mismatch')
    require(all(not warning.strip() for row in slices['checks'] if row['variant']=='candidate' for warning in row['warnings']),
        'A proposed printing pose still has a slicer warning')
    notes="""DISCO BALL - PROPOSED FILAMENT PROTOTYPE

Four STL files, five printed pieces: bar x1, identical shoe x2, box shell x1, bottom cover x1.
IMPORT AS INCHES. If imported as mm, scale uniformly by 25.4 (2540%).
Sanity check: mounting-box foot is 6.56693 inches (166.8 mm) wide; roof is 2.51969 inches (64 mm) above the desk.

Proposed poses are already baked into the files. The bar is tilted 45 degrees; shoe flat backs and shell roof face down.
Use build-plate-only supports for the bar. Its large sealed cavity must contain NO removable supports.
The checked reference slice used a Bambu X1 Carbon, 0.4 mm nozzle, 0.2 mm layers and Generic PLA. These are reference settings, not confirmed printer/material choices.

Please confirm tomorrow: actual printer and filament, orientation/support removal, thin-wall quality, M3 nut-pocket fit, and sliding-shoe fit before the full run. A small grip crop made with the slicer's cut tool can check fit without another design file.
The bar remains hollow; 100% infill is not required. Resin printing would need a separate drainage/venting review.

HARDWARE TO HAVE ON HAND
4 x M3 x 0.5 x 10 mm button-head hex-socket screws, ISO 7380-1; length measured below head.
2 x M3 x 0.5 x 6 mm flat-point set screws, ISO 4026 / DIN 913.
6 x plain M3 x 0.5 full hex nuts, DIN 934: maximum 5.5 mm across flats, 2.4 mm thick.
Ordinary 2 mm and 1.5 mm hex keys. Reuse the spinner's original mounting nut.
2 x cut grip pads, 0.079 x 0.630 x 0.315 inches (2 x 16 x 8 mm), adhesive toward the printed shoes.

Mesh integrity, inch conversion, nominal hardware fit and reference slicing passed. Actual printed fit, grip strength, bonding and stability still need prototype testing.
"""
    evidence=dict(ready_to_send_for_printer_review=True,production_ready=False,physical_fit_verified=False,
        source_manifest=pin(output/'manifest.json'),
        reference_slices=pin(output/'slice-validation.json'),support_guard=pin(guard_path),
        unsafe_upright_negative_control=pin(negative_path),cover_hardware=pin(cover_path),grip_hardware=pin(grip_path),
        packet_controls=controls,quantity=5,unique_stl_files=4)
    return publish_handoff(output,delivery,report['zip'],notes,evidence)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=('prepare','check','slice','check-slices','release'))
    parser.add_argument('output',type=Path)
    parser.add_argument('--variant',choices=('as-exported','candidate'))
    for name in ('guard','negative','cover-hardware','grip-hardware','delivery'):
        parser.add_argument('--'+name,type=Path)
    args=parser.parse_args()
    if args.command=='prepare':prepare(args.output)
    elif args.command=='check':check_packet(args.output);print('PASS current four-file five-piece inch packet')
    elif args.command=='check-slices':check_slices(args.output)
    elif args.command=='release':
        require(all((args.guard,args.negative,args.cover_hardware,args.grip_hardware,args.delivery)),'Supply final proof paths and delivery directory')
        release(args.output,args.guard,args.negative,args.cover_hardware,args.grip_hardware,args.delivery)
    else:
        require(args.variant is not None,'Select one reference variant')
        run_slices(args.output,args.variant)
