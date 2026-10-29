"""Export only source-verified M3 hardware fit coupons, never full candidate parts."""
from __future__ import annotations
import argparse
import hashlib
import importlib
import json
from pathlib import Path
import shutil
import sys
import zipfile

CAD = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(CAD))
import final_review
r = importlib.import_module('box-mount.access.resin_retention')
audit = r.audit
REQUIRED_SOURCES = {'resin_base.py','resin_retention.py','final_base.py',
                    'integrate_receipt.py','access_study.py','box_mount.py'}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition,message):
    if not condition:
        raise ValueError(message)


def prepare(receipt):
    receipt=Path(receipt).resolve()
    receipt_sha=digest(receipt)
    report=json.loads(receipt.read_text())
    require(report.get('independent_base_geometry_checks_pass') is True,'Independent candidate checks must pass')
    sources=report.get('source_code_sha256',{})
    require(set(sources)==REQUIRED_SOURCES,'Required source inventory differs')
    for name,sha in sources.items():
        require(digest(final_review.source_path(name))==sha,'Changed trial producer source: '+name)
    expected={}
    for af in (5.7,5.8,5.9):
        sample=r.joint_coupon(af)
        r.verify_joint_coupon(sample)
        for part in ('lower','upper'):
            expected[f'coupon-AF{str(af).replace(chr(46),chr(112))}-{part}']=sample[part].solids()[0]
    records=report.get('fit_coupons',[])
    require(len(records)==len(expected) and {p['name'] for p in records}==set(expected),
            'Keep exactly the six required hardware coupon parts')
    artifacts=audit.Artifacts()
    for record in records:
        actual=artifacts.load(record)
        shape=expected[record['name']]
        require(audit.volume(actual-shape)<1e-5 and audit.volume(shape-actual)<1e-5,
                'Coupon differs from actual source joint: '+record['name'])
    artifacts.unchanged()
    require(digest(receipt)==receipt_sha,'Trial receipt changed')
    return report,records,receipt_sha


def run(args):
    report,records,receipt_sha=prepare(args.receipt)
    output=args.output.resolve()
    require(not output.exists() and not output.with_suffix('.zip').exists(),'Use a fresh trial output path')
    output.mkdir(parents=True)
    listed=[]
    archive=output.with_suffix('.zip')
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for record in sorted(records,key=lambda p:p['name']):
            filename=record['name']+'.stl'
            target=output/filename
            shutil.copyfile(record['stl'],target)
            require(digest(target)==record['stl_sha256'],'Changed copied coupon')
            z.write(target,filename)
            listed.append(dict(file=filename,quantity=1,sha256=digest(target)))
    with zipfile.ZipFile(archive) as z:
        require(z.testzip() is None and set(z.namelist())=={p['file'] for p in listed},'Incorrect trial archive')
        for record in listed:
            require(hashlib.sha256(z.read(record['file'])).hexdigest()==record['sha256'],'Archived coupon changed')
    protocol=Path(__file__).with_name('printer-fit-check.md')
    shutil.copyfile(protocol,output/'printer-fit-check.md')
    note='''# Print these small hardware trials first

This ZIP contains only six printable STL files: the upper/lower halves of three M3 hardware joint samples, with nut-pocket widths 5.7, 5.8 and 5.9 mm. Print quantity 1 of each in millimetres. Use the final intended resin and full processing cycle.

Use one real ISO 7380-1 M3 x 10 mm button-head screw and one DIN 934 M3 nut to test each pair. The selected envelope has head diameter at most 5.7 mm, head height at most 1.65 mm, 2 mm hex drive, and nut width at most 5.5 mm / height at most 2.4 mm. Select the smallest sample that seats without forcing and prevents the nut turning. Report the result before the final CAD and full run are released.

These are hardware fit samples only. They do not include or validate the revised latch, the button/spinner installation, resin strength, or the full boxes. Follow printer-fit-check.md for the additional latch acceptance stage once its checked files and purchasing BOM are supplied.
'''
    (output/'README.md').write_text(note)
    manifest=dict(scope='HARDWARE_FIT_TRIAL_ONLY',units='mm',latch_geometry_included=False,
                  manufacturing_approved=False,receipt_sha256=receipt_sha,
                  producer_sources_sha256=report['source_code_sha256'],packager_sha256=digest(__file__),
                  protocol_sha256=digest(protocol),readme_sha256=digest(output/'README.md'),
                  archive_sha256=digest(archive),files=listed)
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(dict(archive=str(archive),sha256=digest(archive),parts=len(listed)),indent=2))


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--receipt',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    run(p.parse_args())
