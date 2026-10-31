"""Reject altered air-gap proof/config pairs, including physical claims."""
from __future__ import annotations
import argparse,json
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
import air_gap_c_base_admission as c


def mutants():
    return [
        ('failed rotation',lambda p:p['checks']['rotors']['locked']['5'].__setitem__('arbitrary_revolutions_geometrically_clear',False)),
        ('missing actor',lambda p:p['checks']['rotors']['locked']['5']['components'].pop()),
        ('empty clearance obstacles',lambda p:p['checks']['positive_all_angle_clearance']['5'].__setitem__('fixed_geometry',[])),
        ('zero air gap',lambda p:p['checks']['positive_all_angle_clearance']['5'].__setitem__('minimum_all_angle_fixed_clearance_mm',0.)),
        ('empty root tools',lambda p:p['checks']['root_tools'].__setitem__('actions',[])),
        ('duplicate tool coverage',lambda p:p['checks']['root_tools']['actions'].__setitem__(0,deepcopy(p['checks']['root_tools']['actions'][1]))),
        ('failed root key',lambda p:p['checks']['root_tools']['actions'][0].__setitem__('whole_tool_sweep_vs_base_clear',False)),
        ('empty key phase',lambda p:p['checks']['root_tools']['actions'][0].__setitem__('clearance_rows',[])),
        ('simultaneous keys',lambda p:p['checks']['root_tools'].__setitem__('simultaneous_keys_permitted',True)),
        ('empty module',lambda p:p['checks'].__setitem__('module_and_grip_service',{})),
        ('empty race actors',lambda p:p['checks']['bounded_race_recovery']['base_clear_for_bounded_recovery']['turned'].__setitem__('5',[])),
        ('failed panel path',lambda p:p['checks']['panel_service'].__setitem__('continuous_panel_downward_removal_and_reverse_mm',0.)),
        ('keys-present panel refit',lambda p:p['checks']['panel_service'].__setitem__('panel_refit_requires_all_keys_withdrawn',False)),
        ('empty panel graph',lambda p:p['checks'].__setitem__('panel_lifecycle',{})),
        ('invented physical fit',lambda p:p.__setitem__('physical_fit_verified',True)),
        ('invented spindle load capacity',lambda p:p.__setitem__('physical_spindle_load_capacity_verified',True)),
        ('invented manufacturing approval',lambda p:p.__setitem__('manufacturing_approved',True)),
        ('wrong placement',lambda p:p['placement'].__setitem__('bar_root_above_roof_mm',3.)),
        ('missing hardware reference',lambda p:p['base_reference_components'].pop()),
    ]


def check(path):
    c.load(path);config=json.loads(path.read_bytes());original=c.old.read_pin(config['compatibility'])
    with TemporaryDirectory(prefix='air-gap-proof-mutants-') as temporary:
        directory=Path(temporary)
        for index,(name,mutate) in enumerate(mutants()):
            proof=deepcopy(original);mutate(proof)
            target=directory/f'proof-{index}.json';target.write_text(json.dumps(proof))
            changed=deepcopy(config);changed['compatibility']=c.old.pin(target)
            admission=directory/f'admission-{index}.json';admission.write_text(json.dumps(changed))
            try:c.load(admission)
            except ValueError:pass
            else:raise AssertionError('Altered air-gap proof admitted: '+name)
        # The obsolete bearing base is rejected by scope before other bindings.
        changed=deepcopy(config)
        base=c.old.read_pin(config['base'])
        changed['base']=base['gate_provenance']['input_receipts']['four_print_base']
        admission=directory/'old-bearing-base.json';admission.write_text(json.dumps(changed))
        try:c.load(admission)
        except ValueError:pass
        else:raise AssertionError('Old bearing base admitted as air-gap base')
        changed=deepcopy(config);coupling=c.old.read_pin(config['coupling_admission'])
        old_record=coupling['geometry_admission']
        old_path=Path(config['coupling_admission']['path']).parent/old_record['path']
        changed['coupling_admission']=c.old.pin(old_path)
        admission=directory/'old-bearing-protocol.json';admission.write_text(json.dumps(changed))
        try:c.load(admission)
        except ValueError:pass
        else:raise AssertionError('Old simultaneous-key protocol admitted as air-gap service')
    c.load(path)
    print('PASS: actual air-gap admission; nineteen altered/rehashed proofs, old bearing base and old simultaneous-key protocol rejected; original reload passed')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--admission',type=Path,required=True)
    check(parser.parse_args().admission)
