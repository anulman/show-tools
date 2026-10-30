"""Inspect the delivered ZIP independently and reject changed or incomplete handoffs."""
from __future__ import annotations
import argparse,hashlib,io,json,tempfile,zipfile
from pathlib import Path
import numpy as np
import trimesh
import print_handoff as handoff


def check(output):
    report=json.loads((output/'validation.json').read_text())
    data=handoff.load_selection(output/'selection.json')
    archive=Path(report['zip']['path'])
    handoff.require(handoff.digest(archive)==report['zip']['sha256'],'Changed delivered ZIP')
    files=report['files']
    handoff.require(len(files)==20 and report['print_count']==20,'Expected 20 printable parts including the optional shim')
    counts={prefix:sum(row['file'].startswith(prefix) for row in files)
            for prefix in ('01-','02-','03-','04-')}
    handoff.require(list(counts.values())==[4,8,1,7],'Changed four-assembly print quantities')
    with zipfile.ZipFile(archive) as z:
        handoff.require(z.testzip() is None,'ZIP CRC failed')
        handoff.require(sorted(z.namelist())==sorted(row['file'] for row in files),'Archive inventory differs')
        for row in files:
            name=row['file'];content=z.read(name)
            handoff.require(name.endswith('.stl') and not name.startswith('/') and '..' not in Path(name).parts,'Non-fabrication archive entry')
            handoff.require(hashlib.sha256(content).hexdigest()==row['sha256'],'Delivered mesh hash differs')
            mesh=trimesh.load_mesh(io.BytesIO(content),file_type='stl')
            source=handoff.checked_mesh(row['source_stl']);source.apply_translation(row['translation_from_source_mm'])
            handoff.require(mesh.is_watertight and mesh.is_winding_consistent and mesh.volume>0,'Invalid delivered print mesh')
            handoff.require(mesh.triangles.shape==source.triangles.shape and
                np.allclose(mesh.triangles,source.triangles,atol=2e-5,rtol=0),'Delivered mesh differs from checked source')
            handoff.require(abs(mesh.bounds[0,2])<2e-5,'Delivered mesh not grounded')
    with tempfile.TemporaryDirectory(prefix='reject-print-selection-') as folder:
        path=Path(folder)/'selection.json'
        for mutation in ('missing C actor','wrong box service scope'):
            changed=json.loads(json.dumps(data))
            if mutation=='missing C actor':changed['groups'][3]['records'].pop()
            else:
                box=handoff.read_pin(changed['box']);box['tool_service_requires_bottom_removed']=False
                altered=Path(folder)/'box.json';altered.write_text(json.dumps(box))
                changed['box']=handoff.pin(altered)
            path.write_text(json.dumps(changed))
            try:handoff.load_selection(path)
            except ValueError:print('REJECTED: '+mutation,flush=True)
            else:raise AssertionError('Invalid handoff admitted: '+mutation)
    print('PASS: actual ZIP contains 20 source-matching, closed, grounded STL parts only; four assembly quantities 4/8/1/7',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    check(parser.parse_args().output)
