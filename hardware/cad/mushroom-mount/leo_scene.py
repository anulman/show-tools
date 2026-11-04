"""Explicit opt-in loader for the checked Leo candidate; baseline stays selected."""
import json
from pathlib import Path
from build123d import Axis
import importlib.util
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('mushroom_leo_scene_model',HERE/'leo_model.py')
model=importlib.util.module_from_spec(spec);spec.loader.exec_module(model)
import sys
sys.path.insert(0,str(model.baseline.CAD/'verification'))
from geometry_artifacts import Artifacts,digest
CONFIG=model.baseline.CAD/'build/mushroom-leo/current.json'


def load():
    selection=json.loads(CONFIG.read_text());path=Path(selection['path'])
    if digest(path)!=selection['sha256']:raise ValueError('Changed Leo receipt')
    receipt=json.loads(path.read_text())
    if (receipt.get('scope')!='MUSHROOM_LEO_ROOF_DOWN_GUSSETS'
            or receipt.get('geometry_checks_pass') is not True
            or [r['name'] for r in receipt['review_components']]!=['shell','bottom']):
        raise ValueError('Expected checked Leo mushroom pair')
    for relative,sha in receipt['source_sha256'].items():
        if digest(model.baseline.CAD/relative)!=sha:raise ValueError('Changed Leo source: '+relative)
    artifacts=Artifacts();objects=[]
    for record in receipt['review_components']:
        transform=record['source_to_print'];part=artifacts.load(record)
        part=part.translate(tuple(-v for v in transform['translation_mm']))
        objects.append(part.rotate(Axis.X,-transform['rotation_x_degrees']))
    objects.extend(model.baseline.build()['reference']);artifacts.unchanged()
    return (objects,['Mushroom Leo shell - roof-down ramps','Mushroom unchanged removable bottom',
        'REFERENCE rear width unverified','REFERENCE simplified stem/bezel','REFERENCE 60mm mushroom'],
        ['#d1b394','#b69a7e','#303035','#222226','#cf2929'],[.55,1,1,1,1],
        dict(selection=selection,actual_artifacts=artifacts.files,units='mm',geometry_checks_pass=True,
             physical_fit_verified=False,manufacturing_approved=False,features=receipt['features'],
             print_pose=receipt['print_pose'],reference_is_simplified=True))
