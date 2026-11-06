"""Check the exact default print archive and reject incomplete publications."""
from __future__ import annotations
import argparse,hashlib,io,json,tempfile,zipfile
from pathlib import Path
from unittest.mock import patch
import numpy as np
import trimesh
import air_gap_disco as handoff


def check_native_identity():
    from build123d import Box,Face
    from OCP.BRep import BRep_Builder
    from OCP.TopoDS import TopoDS_Compound,TopoDS_Face,TopoDS_Shape
    shape=Box(1,1,1)
    handoff.identical_after_rotation(shape,shape)
    invalid=TopoDS_Face();BRep_Builder().MakeFace(invalid)
    face=Face.make_rect(1,1).wrapped
    mixed=TopoDS_Compound();builder=BRep_Builder();builder.MakeCompound(mixed)
    builder.Add(mixed,shape.wrapped);builder.Add(mixed,face)
    class Result:
        def __init__(self,value):self.value=value
        def Build(self):pass
        def IsDone(self):return True
        def Shape(self):return self.value
    for name,value in [('null',TopoDS_Shape()),('invalid face',invalid),('valid face',face),('mixed solid and face',mixed)]:
        with patch('OCP.BRepAlgoAPI.BRepAlgoAPI_Cut',return_value=Result(value)):
            try:handoff.identical_after_rotation(shape,shape)
            except ValueError:pass
            else:raise AssertionError('Native identity admitted '+name)
    try:handoff.identical_after_rotation(shape,shape.translate((.1,0,0)))
    except ValueError:pass
    else:raise AssertionError('Native identity admitted different solids')
    print('PASS: native identity accepts real empty difference and rejects null, invalid, non-solid and unequal results',flush=True)


def check_scope(report):
    handoff.require(report['physical_fit_verified'] is False and report['manufacturing_approved'] is False,
                    'Export receipt overstates physical verification or approval')


def check(output):
    check_native_identity()
    report=json.loads((output/'validation.json').read_text());selection=handoff.load(output/'selection.json')
    check_scope(report)
    require=handoff.require;rows=report['files'];archive=Path(report['zip']['path'])
    require(report['selection']==handoff.pin(output/'selection.json'),'Changed export selection binding')
    require(report['no_PTFE_or_height_cap'] is True,'Unexpected material or cap')
    require(not any('PTFE' in p.name or 'height-cap' in p.name for p in output.iterdir()),'Unexpected PTFE or cap directory')
    admitted_base,C=handoff.inputs(Path(selection['admission']['path']))
    base={r['name']:r for r in admitted_base['review_components']}
    rotor={r['name']:r for r in [C['environment']]+C['stages']['inserted']['components']}
    sources=[base['shell'],base['bottom'],base['keeper_tab_0'],rotor['bare glued bar'],
             rotor['removable padded knob cup'],rotor['-1 retained padded shoe'],
             rotor['removable lock and driver half A'],rotor['integrated half B and capture cover']]
    require([row['source'] for row in rows]==sources,'Export source does not match admitted part inventory')
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
        for flag in ('physical_fit_verified','manufacturing_approved'):
            bad=dict(report);bad[flag]=True
            changed=Path(folder)/(flag+'.json');changed.write_text(json.dumps(bad))
            try:check_scope(json.loads(changed.read_text()))
            except ValueError:pass
            else:raise AssertionError('Overstated physical scope admitted: '+flag)
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
        require(not (failed/'air-gap-disco-prototype-STL.zip').exists() and not (failed/'validation.json').exists(),
            'Late failure exposed a final archive or validation report')
        print('PASS: late admission failure leaves no final fabrication ZIP or receipt',flush=True)
    print('PASS: actual eight-file STL archive matches checked sources; PRINT-2 quantities produce ten parts',flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',type=Path)
    check(parser.parse_args().output)
