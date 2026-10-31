"""Export the verified disco print packet in inch coordinates, without changing size."""
from __future__ import annotations
import argparse,hashlib,io,json,math,shutil,tempfile,zipfile
from pathlib import Path
import numpy as np
import trimesh
import air_gap_disco as source
from check_air_gap_disco import check as check_source

MM_PER_INCH=25.4
HEADER=b'INCH COORDINATES - IMPORT AS INCHES - SAME PHYSICAL SIZE - PRINT QTY IN FILENAME'


def mesh(data):
    result=trimesh.load_mesh(io.BytesIO(data),file_type='stl')
    source.require(isinstance(result,trimesh.Trimesh) and result.is_watertight and result.is_winding_consistent
                   and np.isfinite(result.vertices).all() and math.isfinite(result.volume) and result.volume>0,
                   'Invalid inch print mesh')
    return result


def check(output,archive=None,report=None):
    report=json.loads((output/'validation.json').read_text()) if report is None else report
    source.require(report['coordinate_unit']=='inch' and report['mm_per_inch']==MM_PER_INCH,'Wrong inch conversion')
    source.require(report['printed_pieces']==10 and len(report['files'])==8,'Wrong inch print quantities')
    source.require(report['physical_fit_verified'] is False and report['manufacturing_approved'] is False,'Overstated physical scope')
    original=Path(report['source_validation']['path'])
    source.require(source.digest(original)==report['source_validation']['sha256'],'Changed source validation')
    # Validate the actual millimetre archive against the admitted CAD parts,
    # rather than trusting a self-consistent but edited source report/ZIP.
    check_source(original.parent)
    source.require(source.digest(original)==report['source_validation']['sha256'],'Source changed during canonical validation')
    original_report=json.loads(original.read_text())
    original_zip=Path(original_report['zip']['path'])
    source.require(source.digest(original_zip)==original_report['zip']['sha256'],'Changed original print ZIP')
    archive=Path(report['zip']['path']) if archive is None else archive
    source.require(source.digest(archive)==report['zip']['sha256'],'Changed inch print ZIP')
    expected=[(r['file'].removesuffix('.stl')+'-INCH.stl',r['quantity']) for r in original_report['files']]
    source.require([(r['file'],r['quantity']) for r in report['files']]==expected,'Changed inch inventory')
    with zipfile.ZipFile(original_zip) as before,zipfile.ZipFile(archive) as after:
        source.require(after.testzip() is None and sorted(after.namelist())==sorted(n for n,_ in expected),'Invalid inch ZIP inventory')
        for row,old in zip(report['files'],original_report['files']):
            data=after.read(row['file']);source.require(hashlib.sha256(data).hexdigest()==row['sha256'],'Changed inch mesh')
            source.require(data[:80].rstrip(b'\0')==HEADER,'Missing inch import label')
            converted=mesh(data);original_mesh=mesh(before.read(old['file']))
            source.require(converted.triangles.shape==original_mesh.triangles.shape and
                           np.allclose(converted.triangles*MM_PER_INCH,original_mesh.triangles,atol=2e-5,rtol=0),
                           'Inch mesh changed physical size or topology')
            source.require(np.allclose(converted.extents,row['dimensions_in'],atol=1e-7,rtol=0),'Wrong inch dimensions')
            source.require(math.isclose(converted.volume*MM_PER_INCH**3,original_mesh.volume,rel_tol=1e-6),'Wrong inch physical volume')
    return report


def export(original,output):
    source.require(not output.exists(),'Use a fresh inch export directory')
    check_source(original)
    original_report=json.loads((original/'validation.json').read_text())
    output.mkdir(parents=True);directory=output/'STL-INCH';directory.mkdir();rows=[]
    archive=output/'disco-air-gap-INCH-STL.zip';partial=archive.with_suffix('.zip.partial')
    with zipfile.ZipFile(original_report['zip']['path']) as before,zipfile.ZipFile(partial,'x',zipfile.ZIP_DEFLATED) as after:
        for row in original_report['files']:
            scaled=mesh(before.read(row['file']));scaled.apply_scale(1/MM_PER_INCH)
            data=scaled.export(file_type='stl');data=HEADER.ljust(80,b'\0')+data[80:]
            name=row['file'].removesuffix('.stl')+'-INCH.stl'
            (directory/name).write_bytes(data);after.writestr(name,data)
            rows.append(dict(file=name,quantity=row['quantity'],sha256=hashlib.sha256(data).hexdigest(),
                             dimensions_in=mesh(data).extents.tolist()))
    report=dict(coordinate_unit='inch',mm_per_inch=MM_PER_INCH,
                source_validation=source.pin(original/'validation.json'),files=rows,printed_pieces=10,
                physical_fit_verified=False,manufacturing_approved=False,
                zip=dict(path=str(archive.resolve()),sha256=source.digest(partial)))
    check(output,partial,report)
    negative_controls(original,output,report)
    text=['IMPORT THESE STL FILES AS INCHES. STL has no standard unit field.',
          'Coordinates were divided by exactly 25.4; physical dimensions and fits are unchanged.',
          'Print each PRINT-2 filename twice; every other file once. Eight files, ten pieces.',
          'M3/M4 hardware specifications remain unchanged; this is a unit conversion.',
          'Example: the bar height is 4.30000 inches. Do not import these STLs as millimetres.',
          '', 'DIMENSIONS BELOW: X × Y × Z in inches (orientation as exported):']
    text += [f"{r['file']}: "+' x '.join(f'{v:.5f}' for v in r['dimensions_in'])+f"; quantity {r['quantity']}" for r in rows]
    (output/'INCH-IMPORT-NOTE.txt').write_text('\n'.join(text)+'\n')
    (output/'validation.json.partial').write_text(json.dumps(report,indent=2)+'\n')
    # The public archive appears only after the round-trip and wrong-unit controls pass.
    source.load(original/'selection.json')
    source.require(source.digest(original/'validation.json')==report['source_validation']['sha256'],'Source validation changed during conversion')
    partial.replace(archive);(output/'validation.json.partial').replace(output/'validation.json')
    print(archive,flush=True)


def negative_controls(original,output,report):
    old=json.loads((original/'validation.json').read_text())
    good_archive=Path(report['zip']['path'])
    if not good_archive.exists():good_archive=Path(str(good_archive)+'.partial')
    with tempfile.TemporaryDirectory(prefix='inch-scale-controls-') as folder:
        for label,factor in [('unconverted millimetres',1.),('double inch conversion',1/MM_PER_INCH**2)]:
            changed=json.loads(json.dumps(report));target=Path(folder)/(label+'.zip')
            with zipfile.ZipFile(old['zip']['path']) as before,zipfile.ZipFile(good_archive) as good,zipfile.ZipFile(target,'x') as bad:
                for index,row in enumerate(changed['files']):
                    data=good.read(row['file'])
                    if index==3:
                        wrong=mesh(before.read(old['files'][index]['file']));wrong.apply_scale(factor)
                        data=wrong.export(file_type='stl');data=HEADER.ljust(80,b'\0')+data[80:]
                        row['sha256']=hashlib.sha256(data).hexdigest();row['dimensions_in']=mesh(data).extents.tolist()
                    bad.writestr(row['file'],data)
            changed['zip']=source.pin(target)
            try:check(output,target,changed)
            except ValueError as error:source.require('physical size' in str(error),'Unexpected scale-control rejection')
            else:raise AssertionError('Wrong-size export admitted: '+label)
        # A self-consistent edited pair must not become its own size authority.
        # Preserve a valid CAD selection but double the shell in both archives,
        # updating every affected hash, dimension and source-report binding.
        directory=Path(folder)/'changed-source';directory.mkdir()
        shutil.copyfile(original/'selection.json',directory/'selection.json')
        changed_mm=json.loads(json.dumps(old));mm_zip=directory/'millimetres.zip'
        changed_inch=json.loads(json.dumps(report));inch_zip=directory/'inches.zip'
        for before_path,target,rows,is_inch in ((Path(old['zip']['path']),mm_zip,changed_mm['files'],False),
                                               (good_archive,inch_zip,changed_inch['files'],True)):
            with zipfile.ZipFile(before_path) as before,zipfile.ZipFile(target,'x') as after:
                for index,row in enumerate(rows):
                    data=before.read(row['file'])
                    if index==0:
                        wrong=mesh(data);wrong.apply_scale(2.)
                        data=wrong.export(file_type='stl')
                        if is_inch:data=HEADER.ljust(80,b'\0')+data[80:]
                        row['sha256']=hashlib.sha256(data).hexdigest()
                        if is_inch:row['dimensions_in']=mesh(data).extents.tolist()
                    after.writestr(row['file'],data)
        changed_mm['zip']=source.pin(mm_zip);changed_mm['selection']=source.pin(directory/'selection.json')
        changed_source=directory/'validation.json';changed_source.write_text(json.dumps(changed_mm))
        changed_inch['source_validation']=source.pin(changed_source);changed_inch['zip']=source.pin(inch_zip)
        changed_receipt=directory/'inch-validation.json';changed_receipt.write_text(json.dumps(changed_inch))
        try:check(output,inch_zip,json.loads(changed_receipt.read_text()))
        except ValueError as error:source.require('Export changed checked geometry' in str(error),'Unexpected changed-source rejection')
        else:raise AssertionError('Self-consistent altered source and inch exports admitted')
    print('PASS: actual8inch meshes round-trip; unchanged-mm and double-conversion exports rejected',flush=True)
    print('PASS: rehashed doubled shell in both MM and inch archives rejected against admitted CAD',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);commands=p.add_subparsers(dest='command',required=True)
    e=commands.add_parser('export');e.add_argument('source',type=Path);e.add_argument('output',type=Path)
    c=commands.add_parser('check');c.add_argument('output',type=Path)
    args=p.parse_args()
    if args.command=='export':export(args.source,args.output)
    else:check(args.output);print('PASS: delivered8inchSTLs preserve verified physical geometry')
