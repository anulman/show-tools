"""Load only the selected checked mushroom export; never publish a viewer."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
HERE=Path(__file__).resolve().parent
CAD=HERE.parent
CONFIG=CAD/'build/mushroom-mount/current.json'
spec=importlib.util.spec_from_file_location('mushroom_mount_model',HERE/'model.py')
model=importlib.util.module_from_spec(spec);spec.loader.exec_module(model)
sys.path.insert(0,str(CAD/'verification'))
from geometry_artifacts import Artifacts


def digest(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load():
    selection=json.loads(CONFIG.read_text());receipt_path=Path(selection['path'])
    if digest(receipt_path)!=selection['sha256']:raise ValueError('Changed mushroom receipt')
    receipt=json.loads(receipt_path.read_text())
    if (receipt.get('scope')!='TWO_PART_MUSHROOM_NOMINAL_DRAWING_STUDY'
            or receipt.get('geometry_checks_pass') is not True
            or [r['name'] for r in receipt['review_components']]!=['shell','bottom']):
        raise ValueError('Expected checked two-part mushroom study')
    for name,sha in receipt['source_sha256'].items():
        if Path(name).name!=name or digest(HERE/name)!=sha:raise ValueError('Changed mushroom source: '+name)
    for relative,sha in receipt['dependency_sha256'].items():
        if digest(CAD/relative)!=sha:raise ValueError('Changed shared CAD dependency: '+relative)
    if digest(HERE/'sources.json')!=receipt['sources_json_sha256']:raise ValueError('Changed manufacturer facts')
    artifacts=Artifacts()
    objects=[artifacts.load(r).translate(tuple(-v for v in r['source_to_print_translation_mm']))
             for r in receipt['review_components']]
    objects.extend(model.build()['reference']);artifacts.unchanged()
    labels=['Mushroom shell - nominal drawing study','Mushroom removable bottom',
            'REFERENCE rear study envelope - width unverified',
            'REFERENCE NHD stem and bezel - simplified',
            'REFERENCE red 60mm mushroom - simplified']
    provenance=dict(selection=selection,actual_artifacts=artifacts.files,
        units='mm',assembly_ground_z_mm=0,parameters=receipt['parameters'],manufacturer=model.NHD,
        source_sha256=receipt['source_sha256'],manufacturer_sources=receipt['manufacturer_sources'],
        geometry_checks_pass=True,physical_fit_verified=False,manufacturing_approved=False,
        reference_is_simplified=True,reference_rear_width_is_study_parameter=True,
        retention_strategy='arcade four ISO7380-1 M3x10 screws and DIN934 M3 nuts')
    return objects,labels,['#d1b394','#b69a7e','#303035','#222226','#cf2929'],[.55,1,1,1,1],provenance
