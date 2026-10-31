"""Check the exact default print archive and reject incomplete publications."""
from __future__ import annotations
import argparse,hashlib,io,json,tempfile,zipfile
from pathlib import Path
from unittest.mock import patch
import numpy as np
import trimesh
import clean_disco as handoff


def check(output):
    report=json.loads((output/'validation.json').read_text());selection=handoff.load(output/'selection.json')
    require=handoff.require;rows=report['files'];archive=Path(report['zip']['path'])
    require(handoff.digest(archive)==report['zip']['sha256'],'Changed delivered ZIP')
    expected={'01-mounting-box-shell.stl':1,'02-mounting-box-bottom.stl':1,'03-hex-keeper-PRINT-2.stl':2,
        '04-disco-bar.stl':1,'05-knob-cup.stl':1,'06-grip-shoe-PRINT-2.stl':2,
        '07-collar-half-A.stl':1,'08-collar-half-B-with-cover.stl':1}
    require(len(rows)==8 and {r['file']:r['quantity'] for r in rows}==expected,'Wrong printable designs or quantities')
    require(report['printed_pieces']==10 and report['unique_STL_files']==8,'Wrong declared print count')
    with zipfile.ZipFile(archive) as z:
        require(z.testzip() is None and sorted(z.namelist())==sorted(expected),'Extra or missing fabrication files')
        for row in rows:
            content=z.read(row['file']);require(hashlib.sha256(content).hexdigest()==row['sha256'],'Changed archive mesh')
            source=row['source'];require(handoff.digest(source['stl'])==source['stl_sha256'],'Changed mesh source')
            mesh=trimesh.load_mesh(io.BytesIO(content),file_type='stl')
            original=handoff.checked_mesh(source['stl']);original.apply_translation(row['translation_mm'])
            require(mesh.is_watertight and mesh.is_winding_consistent and mesh.volume>0 and abs(mesh.bounds[0,2])<2e-5,'Invalid actual print mesh')
            require(mesh.triangles.shape==original.triangles.shape and np.allclose(mesh.triangles,original.triangles,atol=2e-5,rtol=0),'Export changed checked geometry')
    with tempfile.TemporaryDirectory(prefix='clean-disco-negative-') as folder:
        path=Path(folder)/'selection.json';bad=json.loads(json.dumps(selection));bad['C_components'].pop()
        path.write_text(json.dumps(bad))
        try:handoff.load(path)
        except ValueError:print('REJECTED: omitted collar actor',flush=True)
        else:raise AssertionError('Incomplete collar scene admitted')
        failed=Path(folder)/'late-failure'
        with patch.object(handoff,'load',side_effect=ValueError('forced final admission failure')):
            try:handoff.prepare(Path(selection['admission']['path']),failed)
            except ValueError as error:require('forced final admission failure' in str(error),'Unexpected negative-control failure')
            else:raise AssertionError('Forced late failure was ignored')
        require(not (failed/'clean-disco-prototype-STL.zip').exists() and not (failed/'validation.json').exists(),
            'Late failure exposed a final archive or validation report')
        print('PASS: late admission failure leaves no final fabrication ZIP or receipt',flush=True)
    print('PASS: actual eight-file STL archive matches checked sources; PRINT-2 quantities produce ten parts',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    check(parser.parse_args().output)
